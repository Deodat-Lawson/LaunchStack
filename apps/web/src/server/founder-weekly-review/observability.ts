import { createLogger } from "~/lib/logger";
import {
    founderWeeklyReviewGenerationTotal,
    founderWeeklyReviewJobsEnqueued,
    founderWeeklyReviewRetries,
    founderWeeklyReviewStageDuration,
    founderWeeklyReviewCitationFailures,
} from "~/server/metrics/registry";

const logger = createLogger("founder-weekly-review");
export function logFounderWeeklyReview(fields: {
    runId: string; companyId: string; stage: string; status: string; durationMs?: number;
    generationAttempt?: number; retryCount?: number; errorClass?: string; provider?: string; model?: string;
}) { logger.info(fields, "founder weekly review stage"); }
export { founderWeeklyReviewGenerationTotal, founderWeeklyReviewJobsEnqueued, founderWeeklyReviewRetries, founderWeeklyReviewStageDuration, founderWeeklyReviewCitationFailures };
