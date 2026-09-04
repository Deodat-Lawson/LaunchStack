/**
 * The ranked repo map — the token-budgeted overview handed to the model as
 * its warm start (design §3.3). Rendering is plain text: one line per file,
 * its top symbols indented beneath, highest-ranked files first, cut off at
 * the character budget on a whole-file boundary.
 */
import type { FileSymbols, RepoMap, RepoMapEntry } from "../types.js";
export interface BuildRepoMapOptions {
    /** Character budget for the rendered map (≈ tokens × 4). */
    maxChars?: number;
    personalization?: ReadonlyMap<string, number>;
}
export declare function buildRepoMap(files: FileSymbols[], options?: BuildRepoMapOptions): RepoMap;
export declare function renderRepoMap(entries: RepoMapEntry[], maxChars: number): string;
//# sourceMappingURL=repo-map.d.ts.map