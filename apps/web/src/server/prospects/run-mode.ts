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

export function readRunEnvironment(env: Record<string, string | undefined>): RunEnvironment {
    return {
        hasModel: [
            env.OPENAI_API_KEY,
            env.OPENROUTER_API_KEY,
            env.ANTHROPIC_API_KEY,
            env.AI_API_KEY,
        ].some(v => Boolean(v)),
        hasSearch: [env.EXA_API_KEY, env.SERPER_API_KEY, env.FOURSQUARE_SERVICE_KEY].some(v =>
            Boolean(v)
        ),
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
