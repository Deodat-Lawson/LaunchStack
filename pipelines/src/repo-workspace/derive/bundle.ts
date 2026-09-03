/**
 * Bundle derivation — stage C of the pipe (design §3.3): one deterministic
 * pass over a checkout that produces everything the explain stage warm-starts
 * from. No LLM anywhere in this file's call graph; same SHA and same deriver
 * version ⇒ the same bundle.
 */

import type { ContextBundle, FileSymbols, SymbolExtractor, WorkspaceView } from "../types";
import { CONTEXT_BUNDLE_SCHEMA_VERSION } from "../types";
import { buildHygieneManifest, makeDeniedSet } from "./hygiene";
import { collectMemoryFiles } from "./memory-files";
import { buildRepoMap } from "./repo-map";
import { computeRepoStats } from "./stats";
import { extractFileSymbols, supportedLanguageForPath } from "./symbols";
import { renderTree } from "./tree-render";

/** Files above this size never enter symbol extraction — generated bundles
 * and vendored blobs would dominate the graph with noise. */
const MAX_SYMBOL_FILE_BYTES = 200 * 1024;
/** Upper bound on files parsed for symbols; the listing is sorted, so the
 * cut is deterministic. */
const MAX_SYMBOL_FILES = 2_000;

export interface DeriveBundleOptions {
    extractor?: SymbolExtractor;
    mapMaxChars?: number;
    treeMaxChars?: number;
    treeMaxDepth?: number;
}

export async function deriveContextBundle(
    view: WorkspaceView,
    options?: DeriveBundleOptions
): Promise<ContextBundle> {
    const extractor = options?.extractor ?? extractFileSymbols;
    const files = await view.listFiles();

    const hygiene = buildHygieneManifest(files);
    const denied = makeDeniedSet(hygiene);
    const visible = files.filter(file => !denied.has(file.path));

    const symbolCandidates = visible
        .filter(
            file =>
                file.size <= MAX_SYMBOL_FILE_BYTES && supportedLanguageForPath(file.path) !== null
        )
        .slice(0, MAX_SYMBOL_FILES);

    const fileSymbols: FileSymbols[] = [];
    for (const file of symbolCandidates) {
        const content = await view.readFile(file.path, MAX_SYMBOL_FILE_BYTES);
        if (content === null) continue;
        const symbols = extractor(file.path, content);
        if (symbols) fileSymbols.push(symbols);
    }

    const map = buildRepoMap(fileSymbols, { maxChars: options?.mapMaxChars });
    const memoryFiles = await collectMemoryFiles(view);
    const stats = computeRepoStats(visible);
    const tree = renderTree(
        visible.map(file => file.path),
        { maxChars: options?.treeMaxChars, maxDepth: options?.treeMaxDepth }
    );

    return {
        schemaVersion: CONTEXT_BUNDLE_SCHEMA_VERSION,
        sha: view.sha,
        tree,
        map,
        memoryFiles,
        stats,
        hygiene,
    };
}
