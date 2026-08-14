/**
 * Job dispatcher port — the boundary core uses to queue background work.
 *
 * Concrete implementations (Inngest, Trigger.dev, BullMQ, etc.) live in the
 * hosting app; core is handed one via CoreConfig.jobs.dispatcher. Keeping this
 * as a port means core can trigger document-processing pipelines without
 * depending on any specific job-runner SDK.
 */

export interface JobDispatcherPort {
  /** Queue an event for asynchronous processing. */
  dispatch(event: DispatchEvent): Promise<DispatchResult>;
  /** Human-readable backend name (e.g. "inngest", "trigger.dev"). */
  readonly name: string;
}

export interface DispatchEvent {
  /** Event name understood by the runner (e.g. "document/process.requested"). */
  name: string;
  /** Arbitrary JSON-serializable payload. */
  data: Record<string, unknown>;
}

export interface DispatchResult {
  /** Optional identifier the caller can use for tracking. */
  jobId?: string;
  /** Runner-returned event/run IDs. Empty array when the runner returns none. */
  eventIds: string[];
}
