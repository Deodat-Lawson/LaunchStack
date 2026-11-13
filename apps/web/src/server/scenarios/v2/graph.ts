/**
 * The scenario graph service (Graphiti + Neo4j), when this deployment runs
 * one: SCENARIOS_GRAPH_URL names it and SCENARIO_GRAPH_TOKEN authenticates
 * the worker to it. Null otherwise, and v2 runs use passages.
 */
import type { ScenarioGraphPort } from "@launchstack/pipelines/scenarios/v2";
import { createGraphitiHttpPort } from "@launchstack/pipelines/scenarios/v2/graph-http";

export function scenarioGraphPort(
    env: Record<string, string | undefined> = process.env
): ScenarioGraphPort | null {
    const baseUrl = env.SCENARIOS_GRAPH_URL?.trim();
    if (!baseUrl) return null;
    return createGraphitiHttpPort({
        baseUrl,
        // Empty in the app container: it only reads the unauthenticated
        // health check; the worker, which drives units, holds the token.
        token: env.SCENARIO_GRAPH_TOKEN?.trim() ?? "",
    });
}
