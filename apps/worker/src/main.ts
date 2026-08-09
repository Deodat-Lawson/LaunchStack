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
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPipelineProcessor,
  runOutboxTick,
  DEFAULT_RETRY_POLICY,
} from "@launchstack/application";
import { DocIngestionPipeline, DrizzleOutboxStore } from "@launchstack/adapters";

import { parseWorkerEnv, resolveChatModelsConfig } from "./env";
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
  // explicitly when the operator hasn't pointed elsewhere — and when the
  // operator DID set a relative path that doesn't exist from our cwd (e.g. a
  // compose env shared with the app), remap it against apps/web so a mis-set
  // relative path degrades gracefully instead of crash-looping the container.
  // Startup-time resolution only — never mutated after boot.
  {
    const workerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const resolved = resolveChatModelsConfig({
      configured: process.env.CHAT_MODELS_CONFIG,
      workerDir,
      cwd: process.cwd(),
    });
    if (resolved) {
      if (resolved.reason === "remapped-to-web") {
        logger.info(
          { configured: process.env.CHAT_MODELS_CONFIG, resolved: resolved.value },
          "CHAT_MODELS_CONFIG is relative and missing from the worker cwd; using the shared apps/web copy",
        );
      }
      process.env.CHAT_MODELS_CONFIG = resolved.value;
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
    { createDeadEventHandler, createValidationDeadHandler },
  ] = await Promise.all([
    import("./inngest"),
    import("./ports/projection"),
    import("./ports/notes"),
    import("./ports/failure"),
  ]);

  const clock = { now: () => new Date() };
  const outbox = new DrizzleOutboxStore(engine.db, logger, {
    // Rows dead-lettered at claim time (payload failed protocol validation)
    // never reach the tick-level onDead hook; this restores their failure
    // visibility (OCR job marked failed → UI shows the terminal state).
    onValidationDead: createValidationDeadHandler(logger),
  });
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
          // A wedged pool would otherwise hang the probe (and the prober)
          // indefinitely — bound it explicitly.
          const probe = engine.dbHandle.client`SELECT 1`.execute();
          // If the timeout wins the race, the probe may still reject later;
          // pre-attach a no-op handler so that late rejection stays handled.
          probe.catch(() => undefined);
          let timeoutHandle: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              probe,
              new Promise((_, reject) => {
                timeoutHandle = setTimeout(
                  () => reject(new Error("db probe timed out")),
                  5_000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timeoutHandle);
          }
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
      // The serve handler is async; fire-and-forget would turn any rejection
      // (e.g. an unauthenticated malformed POST body) into an unhandled
      // rejection that kills the process. Treat the return as a possible
      // promise and answer 500 ourselves if the handler died mid-request.
      // inngestHandler is typed as a void RequestListener but returns a
      // promise at runtime — resolve whatever comes back so the rejection
      // is catchable without tripping await-thenable on the void type.
      void Promise.resolve(
        (inngestHandler as (rq: typeof req, rs: typeof res) => unknown)(req, res),
      ).catch((error: unknown) => {
        logger.error(
          {
            path: url,
            method: req.method,
            error: error instanceof Error ? (error.stack ?? error.message) : String(error),
          },
          "inngest handler failed",
        );
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                code: "inngest-handler-error",
                message: "the inngest handler failed to process this request",
              },
            }),
          );
        } else {
          res.end();
        }
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not-found", message: url } }));
  });

  // Bind failures (port in use, bad address) otherwise throw as uncaught
  // exceptions with no structured record; log and exit non-zero so the
  // orchestrator restarts us visibly.
  server.on("error", (error) => {
    logger.error(
      { error: error.stack ?? error.message },
      "worker http server failed",
    );
    process.exit(1);
  });
  // Malformed requests that fail before HTTP parsing completes must not
  // leak sockets; drop them.
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });

  server.listen(workerEnv.WORKER_PORT, () => {
    logger.info(
      { port: workerEnv.WORKER_PORT },
      "worker http listening (healthz/readyz/api/inngest)",
    );
  });

  const reclaimTimer = setInterval(() => {
    void outbox
      .reclaimStale(
        new Date(Date.now() - workerEnv.OUTBOX_STALE_CLAIM_MS),
        DEFAULT_RETRY_POLICY.maxAttempts,
      )
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
    // Let an in-flight tick finish its current handler before closing the
    // pool — but never block past the deadline: an unconditional `await loop`
    // here would wait for the in-flight handler regardless, making the 30s
    // deadline illusory.
    const deadline = Date.now() + 30_000;
    while (tickRunning && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (tickRunning) {
      logger.warn(
        {},
        "shutdown proceeding with handler in flight; its claim will be reclaimed",
      );
    } else {
      // Tick idle — await the loop only if it has already settled (it may
      // still be in its idle-poll sleep, which never touches the DB again).
      await Promise.race([
        loop.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 0)),
      ]);
    }
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
