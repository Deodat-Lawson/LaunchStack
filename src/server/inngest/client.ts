import { EventSchemas, Inngest } from "inngest";
import type { ProcessDocumentEventData } from "~/lib/ocr/types";
import type { TrendSearchEventData } from "~/lib/tools/trend-search/types";
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

export type Events = ProcessDocumentEvent | TrendSearchEvent | ClientProspectorEvent;

/**
 * Create the Inngest client.
 * INNGEST_EVENT_KEY is required in all environments (validated in env.ts).
 */
function createInngestClient() {
  const eventKey = process.env.INNGEST_EVENT_KEY;

  return new Inngest({
    id: "pdr-ai",
    name: "PDR AI",
    schemas: new EventSchemas().fromUnion<Events>(),
    ...(eventKey && { eventKey }),
  });
}

// Inngest client — always available (key is required)
export const inngest = createInngestClient();
