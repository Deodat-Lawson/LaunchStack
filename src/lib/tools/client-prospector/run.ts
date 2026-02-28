// Pipeline stages that the Inngest function tracks.
// These correspond to the status enum values in the DB schema.
// "planning" = LLM generating Foursquare search params
// "searching" = calling Foursquare API
// "scoring" = LLM ranking the results
export type ClientProspectorPipelineStage = "planning" | "searching" | "scoring";

export interface RunClientProspectorOptions {
    onStageChange?: (stage: ClientProspectorPipelineStage) => Promise<void> | void;
}

export interface RunClientProspectorInput {
    query: string;
    companyContext: string;
    location: { lat: number; lng: number };
    radius: number;
    categories?: string[];
}

import type { ProspectorOutput } from "~/lib/tools/client-prospector/types";

// Pipeline: planSearches (LLM) -> placeSearch (Foursquare) -> scoreLeads (LLM)
//
// This function owns the pipeline execution only.
// It does NOT touch the database. The Inngest function handles
// persistence and status tracking via the onStageChange callback.
//
// TODO: implement the actual pipeline steps (Tasks 4.1-4.6)
export async function runClientProspector(
    input: RunClientProspectorInput,
    options: RunClientProspectorOptions = {},
): Promise<ProspectorOutput> {
    // Step 1: Plan searches — LLM decides what Foursquare queries to run
    await options.onStageChange?.("planning");

    // Step 2: Search — call Foursquare Places API for each planned search
    await options.onStageChange?.("searching");

    // Step 3: Score — LLM ranks and scores the results by relevance
    await options.onStageChange?.("scoring");

    // Placeholder until pipeline steps are implemented
    return {
        results: [],
        metadata: {
            query: input.query,
            companyContext: input.companyContext,
            location: input.location,
            radius: input.radius,
            categories: input.categories ?? [],
            createdAt: new Date().toISOString(),
        },
    };
}
