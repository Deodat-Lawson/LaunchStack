/**
 * The small-repo fast path's input: a repomix-style single digest of the
 * whole checkout (design §3.4). When the digest fits the budget the agent
 * loop is skipped entirely — one gated call over the full text is cheaper
 * and better for small repositories.
 *
 * Ordering is deliberate and deterministic: memory files first (the author's
 * map), then files by repo-map rank (the load-bearing code), then everything
 * else sorted by path. Denied paths never enter the digest.
 */
import type { ContextBundle, WorkspaceView } from "@launchstack/pipelines/repo-workspace";
export interface PackResult {
    digest: string;
    includedPaths: string[];
    /** True when the budget cut files out — the fast path must not run. */
    truncated: boolean;
}
export declare function packDigest(view: WorkspaceView, bundle: ContextBundle, maxChars: number): Promise<PackResult>;
//# sourceMappingURL=pack.d.ts.map