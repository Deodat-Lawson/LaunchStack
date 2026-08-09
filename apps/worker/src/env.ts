/**
 * Worker-specific configuration, validated once at startup. Everything the
 * engine itself needs (DATABASE_URL, storage, providers, …) is validated by
 * the shared composition root (`~/server/engine` → `~/env`) when the engine
 * boots — this module only owns the worker's own runtime knobs.
 */
import { z } from "zod";

const schema = z.object({
  /** HTTP port for /healthz, /readyz and the Inngest serve endpoint. */
  WORKER_PORT: z.coerce.number().int().positive().default(8020),
  /** Outbox poll interval when the last tick claimed nothing. */
  OUTBOX_IDLE_POLL_MS: z.coerce.number().int().min(100).default(2000),
  /** Max events claimed per tick. */
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * A `processing` claim older than this is presumed orphaned (worker died
   * mid-handler) and is returned to `pending` by the reclaimer.
   */
  OUTBOX_STALE_CLAIM_MS: z.coerce.number().int().min(60_000).default(30 * 60_000),
  /** How often the stale-claim reclaimer runs. */
  OUTBOX_RECLAIM_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type WorkerEnv = z.infer<typeof schema>;

export function parseWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid worker environment:\n${details}`);
  }
  return parsed.data;
}
