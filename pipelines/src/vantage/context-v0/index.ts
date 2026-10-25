/**
 * Proposed V0 integration surface. Importing this module registers no routes,
 * providers or workers and does not alter the frozen Vantage v1 wire format.
 */
export * from "../proposals/context-v0";
export * from "./contracts";
export * from "./registry";
export * from "./assembler";
export * from "./evidence-snapshot";
export * from "./ports";
export * from "./adapters";
export * from "./mocks";
export * from "../dynamic-retrieval";
