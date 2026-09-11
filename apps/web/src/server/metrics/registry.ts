import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
    register: metricsRegistry,
    prefix: "pdr_",
});

export const predictiveAnalysisDuration = new Histogram({
    name: "pdr_predictive_analysis_duration_seconds",
    help: "Time spent serving predictive analysis requests",
    labelNames: ["result", "cached"],
    buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34],
    registers: [metricsRegistry],
});

export const predictiveAnalysisRequests = new Counter({
    name: "pdr_predictive_analysis_requests_total",
    help: "Total predictive analysis requests grouped by outcome",
    labelNames: ["result", "cached"],
    registers: [metricsRegistry],
});

export const predictiveAnalysisCacheHits = new Counter({
    name: "pdr_predictive_analysis_cache_hits_total",
    help: "Count of predictive analysis cache hits",
    registers: [metricsRegistry],
});

export const predictiveAnalysisAiCalls = new Histogram({
    name: "pdr_predictive_analysis_ai_calls",
    help: "Distribution of GPT calls per predictive analysis run",
    buckets: [1, 5, 10, 20, 40, 80, 120, 200],
    registers: [metricsRegistry],
});

export const qaRequestDuration = new Histogram({
    name: "pdr_qa_request_duration_seconds",
    help: "Time spent serving question answering requests",
    labelNames: ["result", "retrieval"],
    buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21],
    registers: [metricsRegistry],
});

export const qaRequestCounter = new Counter({
    name: "pdr_qa_requests_total",
    help: "Total question answering requests grouped by outcome",
    labelNames: ["result", "retrieval"],
    registers: [metricsRegistry],
});

// ── Founder Weekly Review ────────────────────────────────────────────────────

export const founderWeeklyReviewJobsEnqueued = new Counter({
    name: "pdr_founder_weekly_review_jobs_enqueued_total",
    help: "Founder weekly review jobs enqueued",
    labelNames: ["operation"],
    registers: [metricsRegistry],
});

export const founderWeeklyReviewGenerationTotal = new Counter({
    name: "pdr_founder_weekly_review_generation_total",
    help: "Founder weekly review generations grouped by result",
    labelNames: ["result", "error_class"],
    registers: [metricsRegistry],
});

export const founderWeeklyReviewRetries = new Counter({
    name: "pdr_founder_weekly_review_retries_total",
    help: "Founder weekly review retries",
    registers: [metricsRegistry],
});

export const founderWeeklyReviewCitationFailures = new Counter({
    name: "pdr_founder_weekly_review_citation_validation_failures_total",
    help: "Founder weekly review citation validation failures",
    registers: [metricsRegistry],
});

export const founderWeeklyReviewRunsCreated = new Counter({
    name: "pdr_founder_weekly_review_runs_created_total",
    help: "Founder weekly review runs created",
    registers: [metricsRegistry],
});

export const founderWeeklyReviewRunsCompleted = new Counter({
    name: "pdr_founder_weekly_review_runs_completed_total",
    help: "Founder weekly review runs completed",
    registers: [metricsRegistry],
});

export const founderWeeklyReviewRunsFailed = new Counter({
    name: "pdr_founder_weekly_review_runs_failed_total",
    help: "Founder weekly review runs failed",
    labelNames: ["error_class"],
    registers: [metricsRegistry],
});

export const founderWeeklyReviewDispatchFailures = new Counter({
    name: "pdr_founder_weekly_review_dispatch_failures_total",
    help: "Founder weekly review outbox dispatch failures",
    registers: [metricsRegistry],
});

export const founderWeeklyReviewStageDuration = new Histogram({
    name: "pdr_founder_weekly_review_stage_duration_seconds",
    help: "Founder weekly review stage duration",
    labelNames: ["stage", "result"],
    buckets: [0.1, 0.5, 1, 5, 15, 60, 300],
    registers: [metricsRegistry],
});

export async function getMetricsSnapshot(): Promise<string> {
    return metricsRegistry.metrics();
}
