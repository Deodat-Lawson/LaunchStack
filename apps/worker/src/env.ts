/**
 * Worker-specific configuration, validated once at startup. Everything the
 * engine itself needs (DATABASE_URL, storage, providers, …) is validated by
 * the shared composition root (`~/server/engine` → `~/env`) when the engine
 * boots — this module only owns the worker's own runtime knobs.
 */
import { existsSync } from "node:fs";
import path from "node:path";

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
   * mid-handler) and is returned to `pending` by the reclaimer. Default is
   * 60 minutes: long archive expansions legitimately hold a claim well past
   * 30, and a premature reclaim double-runs the handler (it converges —
   * handlers are idempotent — but wastes compute). Keep this above your
   * slowest expected handler; see docs/runbooks/outbox.md.
   */
  OUTBOX_STALE_CLAIM_MS: z.coerce.number().int().min(60_000).default(60 * 60_000),
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

/**
 * Resolves CHAT_MODELS_CONFIG for the worker process. The web app's default
 * (`config/chat-models.yaml`) is relative to apps/web's working directory;
 * the worker runs from apps/worker, so a relative value that resolves fine
 * for the app crash-loops the worker. Three cases:
 *
 * - Unset → point at the shared apps/web config file if it exists.
 * - Set but RELATIVE and missing from the worker's cwd → re-resolve it
 *   against apps/web (degrade gracefully instead of crash-looping).
 * - Anything else (absolute, or relative and present from cwd) → untouched.
 *
 * Returns the replacement value plus why, or undefined to leave env alone.
 * Pure given `exists` — injected for tests.
 */
export function resolveChatModelsConfig(options: {
  /** Current process.env.CHAT_MODELS_CONFIG (may be unset). */
  configured: string | undefined;
  /** Absolute path of apps/worker (…/apps/worker). */
  workerDir: string;
  /** The worker process's working directory. */
  cwd: string;
  exists?: (candidate: string) => boolean;
}): { value: string; reason: "defaulted" | "remapped-to-web" } | undefined {
  const exists = options.exists ?? existsSync;
  const webDir = path.resolve(options.workerDir, "../web");
  const configured = options.configured?.trim();
  if (!configured) {
    const shared = path.resolve(webDir, "config/chat-models.yaml");
    return exists(shared) ? { value: shared, reason: "defaulted" } : undefined;
  }
  if (path.isAbsolute(configured)) return undefined;
  if (exists(path.resolve(options.cwd, configured))) return undefined;
  const remapped = path.resolve(webDir, configured);
  return exists(remapped)
    ? { value: remapped, reason: "remapped-to-web" }
    : undefined;
}
