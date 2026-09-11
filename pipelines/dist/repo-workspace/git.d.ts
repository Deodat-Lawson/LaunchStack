/**
 * GitPort over the git binary — stages A and B's only side-effectful code
 * (design §3.1–3.2).
 *
 * Decisions that live here and nowhere else:
 * - Mirrors are `--mirror --filter=blob:none`: full ref/commit history at a
 *   fraction of the disk; blobs stream in on first checkout. Local-path
 *   remotes (tests) ignore the filter with a warning, which is fine.
 * - Credentials travel per-invocation as an HTTP header (`-c
 *   http.extraheader=…`), never into the on-disk remote URL or config, and
 *   are redacted from every error this module throws.
 * - `execFile`, never a shell — no interpolation surface.
 */
import type { GitPort } from "./types.js";
export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}
export type ExecFn = (file: string, args: string[], cwd?: string) => Promise<ExecResult>;
export declare const defaultExec: ExecFn;
export declare class GitOperationError extends Error {
    readonly operation: string;
    constructor(operation: string, detail: string);
}
export declare function createGitPort(exec?: ExecFn): GitPort;
/** Remote URL for a GitHub repo — https, no embedded credentials ever. */
export declare function githubRemoteUrl(owner: string, repo: string): string;
//# sourceMappingURL=git.d.ts.map