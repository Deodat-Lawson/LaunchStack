import type { PipelineProgressEvent } from "@launchstack/tools/contract";
import type { ProspectorOutput } from "./types.js";
export type ClientProspectorPipelineStage = "planning" | "searching" | "scoring";
export interface RunClientProspectorOptions {
    onStageChange?: (stage: ClientProspectorPipelineStage) => Promise<void> | void;
    /**
     * Shared progress protocol (unification P3, design D5) — a superset of
     * onStageChange with labels, durations, and statuses.
     */
    onProgress?: (event: PipelineProgressEvent<ClientProspectorPipelineStage>) => void;
}
export interface RunClientProspectorInput {
    query: string;
    companyContext: string;
    location: {
        lat: number;
        lng: number;
    } | string;
    radius?: number;
    categories?: string[];
    excludeChains?: boolean;
}
/**
 * Runs the full Client Prospector pipeline:
 *   1. Resolve location to lat/lng (pass-through if already coordinates)
 *   2. Plan Foursquare searches via LLM
 *   3. Execute searches against Foursquare Places API
 *   4. Score and rank results via LLM
 *
 * Pure pipeline — no DB writes. Callers own persistence.
 */
export declare function runClientProspector(input: RunClientProspectorInput, options?: RunClientProspectorOptions): Promise<ProspectorOutput>;
//# sourceMappingURL=run.d.ts.map