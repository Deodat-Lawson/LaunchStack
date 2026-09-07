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
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
const EXEC_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 32 * 1024 * 1024;
export const defaultExec = (file, args, cwd) => new Promise(resolve => {
    execFile(file, args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
        let code = 0;
        if (error) {
            const raw = error.code;
            code = typeof raw === "number" ? raw : 1;
        }
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
});
export class GitOperationError extends Error {
    operation;
    constructor(operation, detail) {
        super(`git ${operation} failed: ${detail}`);
        this.operation = operation;
        this.name = "GitOperationError";
    }
}
function redact(text, token) {
    if (!token)
        return text;
    return text.split(token).join("[redacted]");
}
function authArgs(token) {
    if (!token)
        return [];
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    return ["-c", `http.extraheader=Authorization: Basic ${basic}`];
}
async function directorySizeBytes(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const absolute = path.join(current, entry.name);
            if (entry.isSymbolicLink())
                continue;
            if (entry.isDirectory()) {
                stack.push(absolute);
            }
            else if (entry.isFile()) {
                try {
                    total += (await fs.lstat(absolute)).size;
                }
                catch {
                    // Removed between readdir and lstat — skip.
                }
            }
        }
    }
    return total;
}
export function createGitPort(exec = defaultExec) {
    const run = async (operation, args, options) => {
        const result = await exec("git", args, options?.cwd);
        if (result.code !== 0 && !options?.allowFailure) {
            const detail = redact((result.stderr || result.stdout).trim().slice(0, 500), options?.token);
            throw new GitOperationError(operation, detail || `exit code ${result.code}`);
        }
        return result;
    };
    const resolveHead = async (mirrorPath) => {
        const result = await run("rev-parse", ["--git-dir", mirrorPath, "rev-parse", "HEAD"]);
        const sha = result.stdout.trim();
        if (!/^[0-9a-f]{40,64}$/.test(sha)) {
            throw new GitOperationError("rev-parse", `unexpected HEAD "${sha.slice(0, 80)}"`);
        }
        return sha;
    };
    return {
        async ensureMirror({ remoteUrl, mirrorPath, token }) {
            const headPath = path.join(mirrorPath, "HEAD");
            let exists = false;
            try {
                await fs.stat(headPath);
                exists = true;
            }
            catch {
                exists = false;
            }
            if (!exists) {
                await fs.mkdir(path.dirname(mirrorPath), { recursive: true });
                await run("clone", [
                    ...authArgs(token),
                    "clone",
                    "--mirror",
                    "--filter=blob:none",
                    remoteUrl,
                    mirrorPath,
                ], { token });
            }
            return { created: !exists, headSha: await resolveHead(mirrorPath) };
        },
        async fetchMirror({ mirrorPath, token }) {
            const previousSha = await resolveHead(mirrorPath).catch(() => null);
            await run("fetch", [...authArgs(token), "--git-dir", mirrorPath, "fetch", "--prune", "origin"], { token });
            const headSha = await resolveHead(mirrorPath);
            const advanced = previousSha !== headSha;
            let nonFastForward = false;
            if (advanced && previousSha) {
                const ancestry = await run("merge-base", ["--git-dir", mirrorPath, "merge-base", "--is-ancestor", previousSha, headSha], { allowFailure: true });
                nonFastForward = ancestry.code !== 0;
            }
            return { previousSha, headSha, advanced, nonFastForward };
        },
        resolveHead,
        async addWorktree({ mirrorPath, sha, worktreePath, token }) {
            if (!/^[0-9a-f]{40,64}$/.test(sha)) {
                throw new GitOperationError("worktree-add", `invalid sha "${sha.slice(0, 80)}"`);
            }
            await fs.mkdir(path.dirname(worktreePath), { recursive: true });
            await run("worktree-add", [
                ...authArgs(token),
                "--git-dir",
                mirrorPath,
                "worktree",
                "add",
                "--detach",
                worktreePath,
                sha,
            ], { token });
        },
        async removeWorktree({ mirrorPath, worktreePath }) {
            const result = await run("worktree-remove", ["--git-dir", mirrorPath, "worktree", "remove", "--force", worktreePath], { allowFailure: true });
            if (result.code !== 0) {
                // The worktree metadata may already be gone; make the
                // filesystem state converge regardless.
                await fs.rm(worktreePath, { recursive: true, force: true });
                await run("worktree-prune", ["--git-dir", mirrorPath, "worktree", "prune"], {
                    allowFailure: true,
                });
            }
        },
        mirrorSizeBytes: directorySizeBytes,
    };
}
/** Remote URL for a GitHub repo — https, no embedded credentials ever. */
export function githubRemoteUrl(owner, repo) {
    const safe = /^[A-Za-z0-9_.-]+$/;
    if (!safe.test(owner) || !safe.test(repo)) {
        throw new GitOperationError("remote-url", `invalid owner/repo "${owner}/${repo}"`);
    }
    return `https://github.com/${owner}/${repo}.git`;
}
//# sourceMappingURL=git.js.map