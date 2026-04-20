import {
    Counter,
    Histogram,
    Registry,
    collectDefaultMetrics
} from "prom-client";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
    register: metricsRegistry,
    prefix: "pdr_"
});

export const predictiveAnalysisDuration = new Histogram({
    name: "pdr_predictive_analysis_duration_seconds",
    help: "Time spent serving predictive analysis requests",
    labelNames: ["result", "cached"],
    buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34],
    registers: [metricsRegistry]
});

export const predictiveAnalysisRequests = new Counter({
    name: "pdr_predictive_analysis_requests_total",
    help: "Total predictive analysis requests grouped by outcome",
    labelNames: ["result", "cached"],
    registers: [metricsRegistry]
});

export const predictiveAnalysisCacheHits = new Counter({
    name: "pdr_predictive_analysis_cache_hits_total",
    help: "Count of predictive analysis cache hits",
    registers: [metricsRegistry]
});

export const predictiveAnalysisAiCalls = new Histogram({
    name: "pdr_predictive_analysis_ai_calls",
    help: "Distribution of GPT calls per predictive analysis run",
    buckets: [1, 5, 10, 20, 40, 80, 120, 200],
    registers: [metricsRegistry]
});

export const qaRequestDuration = new Histogram({
    name: "pdr_qa_request_duration_seconds",
    help: "Time spent serving question answering requests",
    labelNames: ["result", "retrieval"],
    buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21],
    registers: [metricsRegistry]
});

export const qaRequestCounter = new Counter({
    name: "pdr_qa_requests_total",
    help: "Total question answering requests grouped by outcome",
    labelNames: ["result", "retrieval"],
    registers: [metricsRegistry]
});

export async function getMetricsSnapshot(): Promise<string> {
    return metricsRegistry.metrics();
}
