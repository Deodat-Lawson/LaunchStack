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

// Register all Inngest functions
const handler = serve({
  client: inngest,
  functions: [uploadDocument, trendSearchJob],
});

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
