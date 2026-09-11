/**
 * ASCII tree rendering from a flat path list — the same layout overview the
 * legacy repo-explainer built from the GitHub API tree, rebuilt over a local
 * listing. Deterministic: sorted, directories first, capped by depth and by
 * total characters with an explicit truncation marker.
 */
export interface RenderTreeOptions {
    maxChars?: number;
    maxDepth?: number;
    rootLabel?: string;
}
export declare function renderTree(paths: string[], options?: RenderTreeOptions): string;
//# sourceMappingURL=tree-render.d.ts.map