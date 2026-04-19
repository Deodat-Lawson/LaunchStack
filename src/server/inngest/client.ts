import { EventSchemas, Inngest } from "inngest";
import type { ProcessDocumentEventData } from "~/lib/ocr/types";
import type { TrendSearchEventData } from "~/lib/tools/trend-search/types";
import type { DocumentEdit, ReviewAction } from "~/lib/adeu/types";
import type { ProspectorEventData } from "~/lib/tools/client-prospector/types";

export type ProcessDocumentEvent = {
  name: "document/process.requested";
  data: ProcessDocumentEventData;
};

export type TrendSearchEvent = {
  name: "trend-search/run.requested";
  data: TrendSearchEventData;
};

export type ClientProspectorEvent = {
  name: "client-prospector/run.requested";
  data: ProspectorEventData;
};

export type CompanyMetadataExtractEvent = {
  name: "company-metadata/extract.requested";
  data: { documentId: number; companyId: string };
};

export type PredictiveAnalysisEvent = {
  name: "predictive-analysis/run.requested";
  data: {
    documentId: number;
    analysisType: string;
    includeRelatedDocs: boolean;
    timeoutMs?: number;
    jobId: string;
  };
};

export type ReindexCompanyEmbeddingsEvent = {
  name: "company/reindex-embeddings.requested";
  data: {
    companyId: number;
    pendingIndexKey: string;
    triggeredByUserId?: string;
  };
};

export type DocumentModifyEvent = {
  name: "document/modify.requested";
  data: {
    documentId: number;
    documentUrl: string;
    authorName: string;
    edits?: DocumentEdit[];
    actions?: ReviewAction[];
  };
};

export type Events =
  | ProcessDocumentEvent
  | TrendSearchEvent
  | ClientProspectorEvent
  | CompanyMetadataExtractEvent
  | PredictiveAnalysisEvent
  | ReindexCompanyEmbeddingsEvent
  | DocumentModifyEvent;

/**
 * Create the Inngest client.
 * INNGEST_EVENT_KEY is required in all environments (validated in env.ts).
 */
function createInngestClient() {
  const eventKey = process.env.INNGEST_EVENT_KEY;

  return new Inngest({
    id: "pdr-ai",
    name: "Launchstack",
    schemas: new EventSchemas().fromUnion<Events>(),
    ...(eventKey && { eventKey }),
  });
}

// Inngest client — always available (key is required)
export const inngest = createInngestClient();
