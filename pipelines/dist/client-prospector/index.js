// Public entry point for the Client Prospector module.
//
// The pipeline is stateless — callers are responsible for persistence
// (use ./db helpers for the Drizzle-backed job store).
export { runClientProspector } from "./run.js";
// Re-export the full types surface so consumers can import from
// @launchstack/features/client-prospector directly.
export * from "./types.js";
//# sourceMappingURL=index.js.map