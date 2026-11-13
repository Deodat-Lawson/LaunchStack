/**
 * The scenario graph service (Graphiti + Neo4j), when this deployment runs
 * one: SCENARIOS_GRAPH_URL names it and SCENARIO_GRAPH_TOKEN authenticates
 * the worker to it. Null otherwise, and v2 runs use passages.
 */
import type { ScenarioGraphPort } from "@launchstack/pipelines/scenarios/v2";
import { createGraphitiHttpPort } from "@launchstack/pipelines/scenarios/v2/graph-http";

/** Long enough for an ingestion batch on a slow extraction model. */
const GRAPH_TIMEOUT_MS = 10 * 60_000;

export function scenarioGraphPort(
    env: Record<string, string | undefined> = process.env
): ScenarioGraphPort | null {
    const baseUrl = env.SCENARIOS_GRAPH_URL?.trim();
    if (!baseUrl) return null;
    return createGraphitiHttpPort({
        baseUrl,
        token: env.SCENARIO_GRAPH_TOKEN?.trim() ?? "",
        timeoutMs: GRAPH_TIMEOUT_MS,
    });
}
