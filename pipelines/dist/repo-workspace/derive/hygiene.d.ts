/**
 * The hygiene manifest — the list of paths in a checkout that must never
 * reach the model or a published source, computed once at derive time
 * (design §3.3, failure mode "secrets in repo content").
 *
 * The patterns are the agent-knowledge connector's credential denylist,
 * reused rather than re-invented: one definition of "reads as secret
 * material" for the whole codebase.
 */
import type { HygieneManifest, WorkspaceFile } from "../types.js";
export declare function isDeniedPath(filePath: string): boolean;
export declare function buildHygieneManifest(files: WorkspaceFile[]): HygieneManifest;
/** Fast membership check callers use to filter tool results. */
export declare function makeDeniedSet(manifest: HygieneManifest): ReadonlySet<string>;
//# sourceMappingURL=hygiene.d.ts.map