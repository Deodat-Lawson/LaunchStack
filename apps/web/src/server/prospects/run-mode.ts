import { configuredWebSearchProvider } from "@launchstack/tools/web-research";

import { isChatEndpointConfigured } from "~/server/chat-endpoint";

/**
 * Which way a run executes, decided from what the environment has.
 *
 * - `fixture`: the caller asked for sample data; deterministic stand-ins.
 * - `live`: a model and at least one search provider are configured; the
 *   run is queued to the worker and uses the research agent.
 * - `keyless`: anything else. Public sources and the page profiler, run in
 *   this process. This is what a fresh dev environment gets.
 */
export type RunMode = "live" | "fixture" | "keyless";

export interface RunEnvironment {
    hasModel: boolean;
    hasSearch: boolean;
}

export function readRunEnvironment(
    env: Record<string, string | undefined>,
    /** The workspace brought its own working model (Workspace › Bring your own keys). */
    workspaceHasOwnModel = false,
    /** The server's search engine (SEARCH_PROVIDER) can run. */
    hasWebSearch = configuredWebSearchProvider() !== null
): RunEnvironment {
    return {
        // The model is whatever chat talks to: ask its resolution, never a list
        // here. A workspace's own model counts even where the server has none.
        hasModel: workspaceHasOwnModel || isChatEndpointConfigured(env),
        // Same for search: whichever engine the server uses, never a key list.
        hasSearch: hasWebSearch || Boolean(env.FOURSQUARE_SERVICE_KEY),
    };
}

export function pickRunMode(
    requested: "sample" | "live" | "keyless" | "auto",
    environment: RunEnvironment
): RunMode {
    if (requested === "sample") return "fixture";
    if (requested === "keyless") return "keyless";
    if (requested === "live") return "live";
    return environment.hasModel && environment.hasSearch ? "live" : "keyless";
}

export function describeRunMode(mode: RunMode): string {
    switch (mode) {
        case "fixture":
            return "sample data";
        case "keyless":
            return "public sources, no keys";
        case "live":
            return "live providers";
    }
}
