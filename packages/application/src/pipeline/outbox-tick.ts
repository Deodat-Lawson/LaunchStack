/**
 * One polling tick of the outbox consumer (ADR-003 §3).
 *
 * Claim → process → markProcessed(followUps) | markFailed(backoff).
 * The retry policy lives here so it is unit-testable without a database;
 * apps/worker only supplies the loop, signals, and ports.
 */
import type {
  ClaimedEvent,
  ClockPort,
  LoggerPort,
  OutboxStorePort,
} from "../ports";
import type { PipelineProcessor } from "./process-event";

export interface RetryPolicy {
  /** Attempts after which a row goes `dead` (visible for operator replay). */
  maxAttempts: number;
  /** First-retry delay; doubles each attempt. */
  baseDelayMs: number;
  /** Upper bound for the computed delay. */
  maxDelayMs: number;
}

/** Mirrors the proven founder-weekly-review dispatch constants. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 60 * 60_000,
};

/** Exponential backoff for the (1-based) attempt that just failed. */
export function retryDelayMs(attempt: number, policy: RetryPolicy): number {
  const exp = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exp, policy.maxDelayMs);
}

/**
 * Renders an error including its `cause` chain — drizzle (and fetch) wrap
 * the actionable failure in `cause`, and an outbox row whose last_error
 * hides the real reason is undebuggable from the runbook.
 */
/** One link of the cause chain, without ever printing "[object Object]". */
function describeCause(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current !== undefined && current !== null && depth < 5) {
    parts.push(describeCause(current));
    current = current instanceof Error ? current.cause : undefined;
    depth += 1;
  }
  return parts.join(" ← caused by: ");
}

export interface OutboxTickDeps {
  outbox: OutboxStorePort;
  processor: PipelineProcessor;
  clock: ClockPort;
  logger: LoggerPort;
  policy?: RetryPolicy;
  batchSize?: number;
  /**
   * Failure-visibility hook, called once when an event exhausts its attempts
   * and goes dead — e.g. to mark the underlying OCR job failed so the UI
   * shows the terminal state. Hook errors are logged, never thrown.
   */
  onDead?: (claimed: ClaimedEvent, error: string) => Promise<void>;
}

export interface OutboxTickResult {
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
}

export async function runOutboxTick(
  deps: OutboxTickDeps,
): Promise<OutboxTickResult> {
  const policy = deps.policy ?? DEFAULT_RETRY_POLICY;
  const batchSize = deps.batchSize ?? 10;
  const { outbox, processor, clock, logger } = deps;

  const batch = await outbox.claimBatch(batchSize);
  const result: OutboxTickResult = {
    claimed: batch.length,
    processed: 0,
    failed: 0,
    dead: 0,
  };

  // Claimed rows are independent aggregates — process them concurrently so
  // one slow handler (e.g. an LLM-backed projection riding out provider
  // retries) cannot starve the rest of the batch. Chain ordering is
  // preserved per aggregate because follow-ups only enqueue on completion.
  await Promise.all(batch.map((claimed) => processOne(claimed)));

  return result;

  async function processOne(claimed: ClaimedEvent): Promise<void> {
    const fields = {
      outboxId: claimed.outboxId,
      eventId: claimed.event.eventId,
      eventType: claimed.event.eventType,
      traceId: claimed.event.traceId,
      attempt: claimed.attemptCount + 1,
    };
    try {
      const { followUps } = await processor.process(claimed);
      await outbox.markProcessed(claimed.outboxId, followUps);
      result.processed += 1;
      logger.info(fields, "outbox event processed");
    } catch (error) {
      const message = describeError(error);
      const attempt = claimed.attemptCount + 1;
      const exhausted = attempt >= policy.maxAttempts;
      const retryAt = exhausted
        ? null
        : new Date(clock.now().getTime() + retryDelayMs(attempt, policy));
      await outbox.markFailed(claimed.outboxId, message, { retryAt });
      if (exhausted) {
        result.dead += 1;
        logger.error(
          { ...fields, error: message },
          "outbox event dead after max attempts — see docs/runbooks/outbox.md",
        );
        if (deps.onDead) {
          try {
            await deps.onDead(claimed, message);
          } catch (hookError) {
            logger.error(
              { ...fields, error: String(hookError) },
              "onDead hook failed",
            );
          }
        }
      } else {
        result.failed += 1;
        logger.warn(
          { ...fields, error: message, retryAt: retryAt?.toISOString() },
          "outbox event failed; retry scheduled",
        );
      }
    }
  }
}

export type { ClaimedEvent };
