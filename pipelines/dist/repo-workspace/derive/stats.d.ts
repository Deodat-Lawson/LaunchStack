/**
 * Deterministic repo statistics — "what kind of repo is this" without a
 * model call (design §3.3).
 */
import type { RepoStats, WorkspaceFile } from "../types.js";
export declare function computeRepoStats(files: WorkspaceFile[]): RepoStats;
export declare function renderRepoStats(stats: RepoStats): string;
//# sourceMappingURL=stats.d.ts.map