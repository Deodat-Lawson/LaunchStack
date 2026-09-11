/**
 * GitPort integration tests against the real git binary, using throwaway
 * local repositories as the "remote". Local-path remotes ignore the blob
 * filter with a warning, which is exactly the production-degrades-gracefully
 * behavior the port documents.
 */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitOperationError, createGitPort, defaultExec, githubRemoteUrl } from "./git";

function gitAvailable(): boolean {
    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const GIT_ENV = [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "-c",
    "commit.gpgsign=false",
];

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", [...GIT_ENV, ...args], { cwd, encoding: "utf8" }).trim();
}

describe.skipIf(!gitAvailable())("createGitPort (integration)", () => {
    let root: string;
    let originDir: string;
    let mirrorPath: string;
    const port = createGitPort();

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-ws-git-"));
        originDir = path.join(root, "origin");
        mirrorPath = path.join(root, "mirrors", "origin.git");
        await fs.mkdir(originDir, { recursive: true });
        git(originDir, "init", "--initial-branch=main");
        await fs.writeFile(path.join(originDir, "README.md"), "# fixture\n");
        git(originDir, "add", ".");
        git(originDir, "commit", "-m", "initial");
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("creates a mirror on first ensure and is idempotent after", async () => {
        const first = await port.ensureMirror({ remoteUrl: originDir, mirrorPath });
        expect(first.created).toBe(true);
        expect(first.headSha).toMatch(/^[0-9a-f]{40}$/);
        expect(first.headSha).toBe(git(originDir, "rev-parse", "HEAD"));

        const second = await port.ensureMirror({ remoteUrl: originDir, mirrorPath });
        expect(second.created).toBe(false);
        expect(second.headSha).toBe(first.headSha);
    });

    it("fetch reports no advance when the remote is unchanged", async () => {
        await port.ensureMirror({ remoteUrl: originDir, mirrorPath });
        const fetch = await port.fetchMirror({ mirrorPath });
        expect(fetch.advanced).toBe(false);
        expect(fetch.nonFastForward).toBe(false);
        expect(fetch.headSha).toBe(fetch.previousSha);
    });

    it("fetch reports a fast-forward advance after a new commit", async () => {
        const { headSha: before } = await port.ensureMirror({
            remoteUrl: originDir,
            mirrorPath,
        });
        await fs.writeFile(path.join(originDir, "next.txt"), "more\n");
        git(originDir, "add", ".");
        git(originDir, "commit", "-m", "second");

        const fetch = await port.fetchMirror({ mirrorPath });
        expect(fetch.previousSha).toBe(before);
        expect(fetch.advanced).toBe(true);
        expect(fetch.nonFastForward).toBe(false);
        expect(fetch.headSha).toBe(git(originDir, "rev-parse", "HEAD"));
    });

    it("fetch flags a force-push as non-fast-forward and still converges", async () => {
        await port.ensureMirror({ remoteUrl: originDir, mirrorPath });
        git(originDir, "commit", "--amend", "-m", "rewritten history");

        const fetch = await port.fetchMirror({ mirrorPath });
        expect(fetch.advanced).toBe(true);
        expect(fetch.nonFastForward).toBe(true);
        expect(fetch.headSha).toBe(git(originDir, "rev-parse", "HEAD"));
    });

    it("adds a readable detached worktree at a sha and removes it cleanly", async () => {
        const { headSha } = await port.ensureMirror({ remoteUrl: originDir, mirrorPath });
        const worktreePath = path.join(root, "worktrees", headSha);

        await port.addWorktree({ mirrorPath, sha: headSha, worktreePath });
        const readme = await fs.readFile(path.join(worktreePath, "README.md"), "utf8");
        expect(readme).toBe("# fixture\n");

        await port.removeWorktree({ mirrorPath, worktreePath });
        await expect(fs.stat(worktreePath)).rejects.toThrow();

        // Removal is idempotent — a second call converges instead of failing.
        await port.removeWorktree({ mirrorPath, worktreePath });
    });

    it("rejects an invalid sha before touching git", async () => {
        await port.ensureMirror({ remoteUrl: originDir, mirrorPath });
        await expect(
            port.addWorktree({
                mirrorPath,
                sha: "not-a-sha; rm -rf /",
                worktreePath: path.join(root, "wt"),
            })
        ).rejects.toBeInstanceOf(GitOperationError);
    });

    it("reports a positive mirror size", async () => {
        await port.ensureMirror({ remoteUrl: originDir, mirrorPath });
        expect(await port.mirrorSizeBytes(mirrorPath)).toBeGreaterThan(0);
    });

    it("fails loudly when the remote does not exist", async () => {
        await expect(
            port.ensureMirror({
                remoteUrl: path.join(root, "no-such-repo"),
                mirrorPath: path.join(root, "mirrors", "missing.git"),
            })
        ).rejects.toBeInstanceOf(GitOperationError);
    });
});

describe("createGitPort (unit, faked exec)", () => {
    it("redacts the token from error messages", async () => {
        const port = createGitPort(() =>
            Promise.resolve({
                code: 128,
                stdout: "",
                stderr: "fatal: Authorization: Basic eC1hY2Nlc3M= rejected for token sekrit-token-123",
            })
        );
        await expect(
            port.fetchMirror({ mirrorPath: "/tmp/x.git", token: "sekrit-token-123" })
        ).rejects.toSatisfy((error: unknown) => {
            expect(error).toBeInstanceOf(GitOperationError);
            expect((error as Error).message).not.toContain("sekrit-token-123");
            expect((error as Error).message).toContain("[redacted]");
            return true;
        });
    });

    it("passes the auth header as a config flag, not into the remote URL", async () => {
        const invocations: string[][] = [];
        const port = createGitPort((_, args) => {
            invocations.push(args);
            // First call is resolveHead (rev-parse), then the fetch itself.
            return Promise.resolve({ code: 0, stdout: "a".repeat(40), stderr: "" });
        });
        await port.fetchMirror({ mirrorPath: "/tmp/x.git", token: "tok" });
        const fetchArgs = invocations.find(args => args.includes("fetch"))!;
        expect(fetchArgs[0]).toBe("-c");
        expect(fetchArgs[1]).toMatch(/^http\.extraheader=Authorization: Basic /);
        expect(fetchArgs.join(" ")).not.toContain("tok@");
    });
});

describe("githubRemoteUrl", () => {
    it("builds the https URL without credentials", () => {
        expect(githubRemoteUrl("octo", "repo")).toBe("https://github.com/octo/repo.git");
    });

    it.each(["../evil", "a b", "a/b", "", "a\nb"])("rejects unsafe segment %j", segment => {
        expect(() => githubRemoteUrl(segment, "repo")).toThrow(GitOperationError);
    });
});

describe("defaultExec", () => {
    it("returns a non-zero code instead of throwing for failing commands", async () => {
        const result = await defaultExec("git", ["rev-parse", "--verify", "nonexistent-ref"]);
        expect(result.code).not.toBe(0);
    });
});
