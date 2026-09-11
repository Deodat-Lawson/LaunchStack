/**
 * Bundle derivation — stage C of the pipe (design §3.3): one deterministic
 * pass over a checkout that produces everything the explain stage warm-starts
 * from. No LLM anywhere in this file's call graph; same SHA and same deriver
 * version ⇒ the same bundle.
 */
import type { ContextBundle, SymbolExtractor, WorkspaceView } from "../types.js";
export interface DeriveBundleOptions {
    extractor?: SymbolExtractor;
    mapMaxChars?: number;
    treeMaxChars?: number;
    treeMaxDepth?: number;
}
export declare function deriveContextBundle(view: WorkspaceView, options?: DeriveBundleOptions): Promise<ContextBundle>;
//# sourceMappingURL=bundle.d.ts.map