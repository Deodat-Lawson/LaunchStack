/**
 * Inngest serve endpoint — moved here from apps/web/app/api/inngest
 * (ADR-003 §3): the worker is the sole executor of durable work; web only
 * sends events. The retired functions are NOT registered:
 * - process-document        → the outbox `source.version.created` handler
 * - extract-company-metadata → the `evidence.version.indexed` handler
 * - rehydrate-note-anchors   → same handler (chunks exist by then)
 */
import { serve } from "inngest/node";

import { inngest } from "~/server/inngest/client";
import { trendSearchJob } from "~/server/inngest/functions/trendSearch";
import { clientProspectorJob } from "~/server/inngest/functions/clientProspector";
import { predictiveAnalysisJob } from "~/server/inngest/functions/predictiveAnalysis";
import { reindexCompanyEmbeddingsJob } from "~/server/inngest/functions/reindexCompanyEmbeddings";
import { modifyDocument } from "~/server/inngest/functions/modifyDocument";
import { crawlWebsite } from "~/server/inngest/functions/crawlWebsite";
import { googleDriveSyncReconciler } from "~/server/inngest/functions/googleDriveSyncReconciler";
import {
    founderWeeklyReviewDispatcher,
    founderWeeklyReviewDispatchReconciler,
    founderWeeklyReviewGenerationJob,
} from "~/server/inngest/functions/founderWeeklyReview";

export function createInngestHandler() {
    return serve({
        client: inngest,
        functions: [
            trendSearchJob,
            clientProspectorJob,
            predictiveAnalysisJob,
            reindexCompanyEmbeddingsJob,
            modifyDocument,
            crawlWebsite,
            googleDriveSyncReconciler,
            founderWeeklyReviewDispatcher,
            founderWeeklyReviewDispatchReconciler,
            founderWeeklyReviewGenerationJob,
        ],
    });
}
