/**
 * Repo workspaces — persistent, synced server-side repositories
 * (design: Repo Explainer Rebuild rev 4, stages A–C).
 */

export * from "./types";
export * from "./events";
export * from "./git";
export { createDirectoryView, matchesGlob } from "./fs-view";
export { runWorkspaceSync } from "./sync";
export type { SyncDeps, SyncOutcome, SyncPaths, SyncStore } from "./sync";
export { deriveContextBundle } from "./derive/bundle";
export type { DeriveBundleOptions } from "./derive/bundle";
export { buildSymbolGraph, pageRank } from "./derive/graph";
export type { GraphEdge, PageRankOptions, SymbolGraph } from "./derive/graph";
export { buildRepoMap, renderRepoMap } from "./derive/repo-map";
export { extractFileSymbols, supportedLanguageForPath } from "./derive/symbols";
export { collectMemoryFiles } from "./derive/memory-files";
export { computeRepoStats, renderRepoStats } from "./derive/stats";
export { renderTree } from "./derive/tree-render";
export { buildHygieneManifest, isDeniedPath, makeDeniedSet } from "./derive/hygiene";
