// Public entry point for the Client Prospector module.
//
// The pipeline is stateless — callers are responsible for persistence
// (use ./db helpers for the Drizzle-backed job store).

export { runClientProspector } from "./run";
export type {
    RunClientProspectorInput,
    RunClientProspectorOptions,
    ClientProspectorPipelineStage,
} from "./run";

// Re-export the full types surface so consumers can import from
// @launchstack/features/client-prospector directly.
export * from "./types";
