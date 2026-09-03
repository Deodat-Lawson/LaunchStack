/**
 * Stages A→C stitched together against real git: origin repo → bare mirror →
 * detached worktree → directory view → derived context bundle. The pieces
 * are unit-tested individually; this proves the seams.
 */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deriveContextBundle } from "./derive/bundle";
import { createDirectoryView } from "./fs-view";
import { createGitPort } from "./git";

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

describe.skipIf(!gitAvailable())("workspace stages A→C (integration)", () => {
    let root: string;
    const port = createGitPort();

    beforeAll(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-ws-e2e-"));
        const origin = path.join(root, "origin");
        await fs.mkdir(path.join(origin, "src"), { recursive: true });
        await fs.writeFile(
            path.join(origin, "README.md"),
            "# E2E fixture\n\nProof-of-seams repository.\n"
        );
        await fs.writeFile(
            path.join(origin, "src", "index.ts"),
            'import { helper } from "./util";\nexport function main(): void {\n    helper();\n}\n'
        );
        await fs.writeFile(
            path.join(origin, "src", "util.ts"),
            "export function helper(): void {}\n"
        );
        await fs.writeFile(path.join(origin, ".env"), "CANARY_SECRET=do-not-leak\n");
        git(origin, "init", "--initial-branch=main");
        git(origin, "add", "-A");
        git(origin, "commit", "-m", "fixture");
    });

    afterAll(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("mirrors, checks out, and derives a bundle whose hygiene holds", async () => {
        const origin = path.join(root, "origin");
        const mirrorPath = path.join(root, "mirror.git");
        const { headSha } = await port.ensureMirror({ remoteUrl: origin, mirrorPath });

        const worktreePath = path.join(root, "wt", headSha);
        await port.addWorktree({ mirrorPath, sha: headSha, worktreePath });
        try {
            const view = createDirectoryView(worktreePath, headSha);
            const bundle = await deriveContextBundle(view);

            expect(bundle.sha).toBe(headSha);
            // The map ranks the imported helper module.
            expect(bundle.map.entries.map(entry => entry.path)).toContain("src/util.ts");
            // The repo's own documentation is in the bundle.
            expect(bundle.memoryFiles.map(file => file.path)).toContain("README.md");
            // The committed secret is denied and its content appears nowhere.
            expect(bundle.hygiene.deniedPaths).toContain(".env");
            expect(JSON.stringify(bundle)).not.toContain("do-not-leak");
            // The tree shows the code but not the secret.
            expect(bundle.tree).toContain("index.ts");
            expect(bundle.tree).not.toContain(".env");
        } finally {
            await port.removeWorktree({ mirrorPath, worktreePath });
        }
    });
});
