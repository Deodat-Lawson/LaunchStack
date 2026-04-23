/**
 * Inngest API Route
 * This endpoint serves the Inngest SDK and registers all background functions.
 *
 * Inngest is a core dependency — the route is always enabled.
 * In development, the Inngest dev server syncs with this endpoint.
 * In production, the Inngest cloud service communicates with this endpoint.
 */

import { serve } from "inngest/next";
import { inngest } from "~/server/inngest/client";
import { uploadDocument } from "~/server/inngest/functions/processDocument";
import { trendSearchJob } from "~/server/inngest/functions/trendSearch";
import { clientProspectorJob } from "~/server/inngest/functions/clientProspector";
import { extractCompanyMetadataJob } from "~/server/inngest/functions/extractCompanyMetadata";
import { predictiveAnalysisJob } from "~/server/inngest/functions/predictiveAnalysis";
import { reindexCompanyEmbeddingsJob } from "~/server/inngest/functions/reindexCompanyEmbeddings";
import { modifyDocument } from "~/server/inngest/functions/modifyDocument";
import { crawlWebsite } from "~/server/inngest/functions/crawlWebsite";

// Register all Inngest functions
const handler = serve({
  client: inngest,
  functions: [
    uploadDocument,
    trendSearchJob,
    clientProspectorJob,
    extractCompanyMetadataJob,
    predictiveAnalysisJob,
    reindexCompanyEmbeddingsJob,
    modifyDocument,
    crawlWebsite,
  ],
});

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;

// Long-running Inngest steps (embeddings, OCR, RAG) can take minutes.
// Requires Vercel Pro — on Hobby the effective cap is 60s, which limits
// how much work each step can do.
export const maxDuration = 300;
