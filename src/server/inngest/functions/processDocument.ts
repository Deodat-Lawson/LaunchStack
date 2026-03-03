/**
 * Inngest Document Processing Function
 * Background job handler that delegates to the backend Doc Ingestion tool.
 */

import { inngest } from "../client";
import { runDocIngestionTool } from "~/lib/tools";

import type {
  ProcessDocumentEventData,
  PipelineResult,
  VectorizedChunk,
} from "~/lib/ocr/types";

export type { ProcessDocumentEventData, PipelineResult, VectorizedChunk };

// ---------------------------------------------------------------------------
// Inngest Function
// ---------------------------------------------------------------------------

// Inngest client is always available (required in production, created in dev)
export const uploadDocument = inngest.createFunction(
  {
    id: "process-document",
    name: "Document Ingestion Pipeline (V2)",
    retries: 5,
    onFailure: async ({ error, event }) => {
      console.error(`[ProcessDocument] Pipeline failed for job ${JSON.stringify(event.data)}:`, error);
    },
  },
  { event: "document/process.requested" },
  async ({ event, step }) => {
    const eventData = event.data;
    const result = await runDocIngestionTool({
      ...eventData,
      runtime: {
        updateJobStatus: false,
        markFailureInDb: false,
        runStep: async <T>(stepName: string, fn: () => Promise<T>) =>
          step.run(stepName, fn) as Promise<T>,
      },
    });

    // Trigger company metadata extraction after successful ingestion
    if (result.success && eventData.documentId && eventData.companyId) {
      await step.sendEvent("trigger-metadata-extraction", {
        name: "company-metadata/extract.requested" as const,
        data: {
          documentId: eventData.documentId,
          companyId: String(eventData.companyId),
        },
      });
    }

    return result;
  },
);
