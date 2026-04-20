// Public entry point for the Client Prospector module.
//
// This re-exports the pipeline function and types so that agents
// and other callers can import from a single path:
//
//   import { runClientProspector } from "~/lib/tools/client-prospector";
//
// The pipeline is stateless — callers are responsible for persistence.

export { runClientProspector } from "./run";
export type {
    RunClientProspectorInput,
    RunClientProspectorOptions,
    ClientProspectorPipelineStage,
} from "./run";
export type {
    ProspectorInput,
    ProspectorOutput,
    ProspectResult,
    PlannedSearch,
    RawPlaceResult,
    LatLng,
} from "./types";
