/**
 * Job Dispatcher Abstraction
 *
 * Defines the interface for background job dispatchers.
 * Implementation: Inngest.
 */

import type { ProcessDocumentEventData } from "~/lib/ocr/types";

/**
 * Result returned when a job is dispatched
 */
export interface DispatchResult {
  /** Unique job ID for tracking */
  jobId: string;
  /** Event/run IDs from the job runner (empty for some adapters) */
  eventIds: string[];
}

/**
 * Supported job runner backends
 */
export type JobRunner = "inngest";

/**
 * Interface that all job dispatchers must implement.
 *
 * Each dispatcher is responsible for sending a document processing
 * event to its respective backend. The actual pipeline steps
 * (ingest, chunk, vectorize, store, graph) are defined in the
 * backend-specific function/task definitions.
 */
export interface JobDispatcher {
  /** Human-readable name for logging */
  readonly name: string;

  /**
   * Dispatch a document processing job.
   * Returns a job ID and optional event IDs for tracking.
   */
  dispatch(data: ProcessDocumentEventData): Promise<DispatchResult>;
}
