/**
 * apps/worker — the sole durable workflow coordinator (ADR-003).
 *
 * Two responsibilities in one process:
 * 1. The outbox consumer: claims pipeline events, runs the handlers through
 *    the application layer, chains follow-up events transactionally.
 * 2. The Inngest serve endpoint for the remaining background verticals
 *    (trend search, prospector, founder review, predictive analysis,
 *    website crawl, document modify, reindex), moved from apps/web.
 *
 * Boot order matters: the engine (shared composition root from apps/web)
 * must be configured before any port touches the DB or providers.
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPipelineProcessor,
  runOutboxTick,
  DEFAULT_RETRY_POLICY,
} from "@launchstack/application";
import { DocIngestionPipeline, DrizzleOutboxStore } from "@launchstack/adapters";

import { parseWorkerEnv } from "./env";
import { createLogger } from "./logger";
// Everything that transitively imports `~/env` (the web modules) is imported
// DYNAMICALLY inside main(), after the CHAT_MODELS_CONFIG default is set —
// env validation runs at module load, so a static import would parse the
// environment before the default exists.

async function main(): Promise<void> {
  const workerEnv = parseWorkerEnv();
  const logger = createLogger(workerEnv.LOG_LEVEL);

  // The chat-models config default is relative to apps/web's working
  // directory; the worker runs from apps/worker, so resolve the shared file
  // explicitly when the operator hasn't pointed elsewhere. Startup-time
  // default only — never mutated after boot.
  if (!process.env.CHAT_MODELS_CONFIG) {
    const workerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const shared = path.resolve(workerDir, "../web/config/chat-models.yaml");
    if (existsSync(shared)) {
      process.env.CHAT_MODELS_CONFIG = shared;
    }
  }

  // Shared composition root: validates env, opens the DB pool, registers
  // storage/providers/LLM/graph slots. The worker reuses it so config has
  // exactly one authority (transitional — see ADR-002 consequences).
  const { getEngine } = await import("~/server/engine");
  const engine = getEngine();

  const [
    { createInngestHandler },
    { createCompanyProjectionPort },
    { createNoteEmbeddingPort, createNoteRehydrationPort },
    { createDeadEventHandler },
  ] = await Promise.all([
    import("./inngest"),
    import("./ports/projection"),
    import("./ports/notes"),
    import("./ports/failure"),
  ]);

  const clock = { now: () => new Date() };
  const outbox = new DrizzleOutboxStore(engine.db, logger);
  const processor = createPipelineProcessor({
    pipeline: new DocIngestionPipeline(logger),
    projection: createCompanyProjectionPort(logger),
    noteRehydration: createNoteRehydrationPort(logger),
    noteEmbedding: createNoteEmbeddingPort(logger),
    clock,
    logger,
  });
  const onDead = createDeadEventHandler(logger);

  let stopping = false;
  let tickRunning = false;

  const inngestHandler = createInngestHandler();

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url === "/readyz") {
      void (async () => {
        try {
          await engine.dbHandle.client`SELECT 1`;
          const dead = await outbox.countDead();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ready", deadOutboxEvents: dead }));
        } catch (error) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "unready",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      })();
      return;
    }
    if (url.startsWith("/api/inngest")) {
      inngestHandler(req, res);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not-found", message: url } }));
  });

  server.listen(workerEnv.WORKER_PORT, () => {
    logger.info(
      { port: workerEnv.WORKER_PORT },
      "worker http listening (healthz/readyz/api/inngest)",
    );
  });

  const reclaimTimer = setInterval(() => {
    void outbox
      .reclaimStale(new Date(Date.now() - workerEnv.OUTBOX_STALE_CLAIM_MS))
      .catch((error) =>
        logger.error({ error: String(error) }, "stale-claim reclaim failed"),
      );
  }, workerEnv.OUTBOX_RECLAIM_INTERVAL_MS);

  logger.info(
    {
      batchSize: workerEnv.OUTBOX_BATCH_SIZE,
      idlePollMs: workerEnv.OUTBOX_IDLE_POLL_MS,
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
    },
    "outbox consumer starting",
  );

  const loop = (async () => {
    while (!stopping) {
      tickRunning = true;
      let claimed = 0;
      try {
        const result = await runOutboxTick({
          outbox,
          processor,
          clock,
          logger,
          batchSize: workerEnv.OUTBOX_BATCH_SIZE,
          onDead,
        });
        claimed = result.claimed;
      } catch (error) {
        logger.error({ error: String(error) }, "outbox tick crashed");
      } finally {
        tickRunning = false;
      }
      if (stopping) break;
      // Busy: immediately poll again. Idle: back off to the poll interval.
      if (claimed === 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, workerEnv.OUTBOX_IDLE_POLL_MS),
        );
      }
    }
  })();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    clearInterval(reclaimTimer);
    server.close();
    // Let an in-flight tick finish its current handler before closing the pool.
    const deadline = Date.now() + 30_000;
    while (tickRunning && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // The loop already logs its own failures; shutdown only needs it settled.
    await loop.catch(() => undefined);
    await engine.close();
    logger.info({}, "worker stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      msg: "worker failed to start",
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    }),
  );
  process.exit(1);
});
