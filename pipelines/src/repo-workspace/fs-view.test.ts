import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDirectoryView, matchesGlob } from "./fs-view";

const cleanupDirs: string[] = [];

async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-view-test-"));
    cleanupDirs.push(dir);
    return dir;
}

async function makeRepo(files: Record<string, string | Buffer>): Promise<string> {
    const root = await makeTempDir();
    for (const [rel, content] of Object.entries(files)) {
        const absolute = path.join(root, ...rel.split("/"));
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, content);
    }
    return root;
}

afterEach(async () => {
    const dirs = cleanupDirs.splice(0);
    await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

/** Probed once: sandboxes and some filesystems refuse symlink creation. */
const canSymlink = await (async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-view-symlink-probe-"));
    try {
        await fs.writeFile(path.join(dir, "target"), "x");
        await fs.symlink(path.join(dir, "target"), path.join(dir, "link"));
        return true;
    } catch {
        return false;
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
})();

describe("matchesGlob", () => {
    it("accepts everything when no glob is given", () => {
        expect(matchesGlob("src/a.ts", undefined)).toBe(true);
        expect(matchesGlob("", undefined)).toBe(true);
    });

    it("matches a suffix glob against the end of the path", () => {
        expect(matchesGlob("src/a.ts", "*.ts")).toBe(true);
        expect(matchesGlob("a.ts", "*.ts")).toBe(true);
        expect(matchesGlob("a.tsx", "*.ts")).toBe(false);
        expect(matchesGlob("a.md", "*.ts")).toBe(false);
    });

    it("matches a prefix glob against the start of the path", () => {
        expect(matchesGlob("src/a.ts", "src/*")).toBe(true);
        expect(matchesGlob("src/deep/b.ts", "src/*")).toBe(true);
        expect(matchesGlob("lib/a.ts", "src/*")).toBe(false);
        expect(matchesGlob("src", "src/*")).toBe(false);
    });

    it("treats a bare star as match-all", () => {
        expect(matchesGlob("anything/at/all.txt", "*")).toBe(true);
    });

    it("falls back to exact equality for a literal glob", () => {
        expect(matchesGlob("src/a.ts", "src/a.ts")).toBe(true);
        expect(matchesGlob("src/a.ts", "src/b.ts")).toBe(false);
        expect(matchesGlob("deep/src/a.ts", "src/a.ts")).toBe(false);
    });
});

describe("createDirectoryView listFiles", () => {
    it("lists files sorted by path with their sizes", async () => {
        const root = await makeRepo({
            "b.ts": "bb",
            "a/z.ts": "zzz",
            "a/a.ts": "a",
            "c.md": "cccc",
        });
        const view = createDirectoryView(root, "sha-list");
        const files = await view.listFiles();
        expect(files).toEqual([
            { path: "a/a.ts", size: 1 },
            { path: "a/z.ts", size: 3 },
            { path: "b.ts", size: 2 },
            { path: "c.md", size: 4 },
        ]);
    });

    it("is deterministic across calls and across views", async () => {
        const root = await makeRepo({
            "src/one.ts": "1",
            "src/two.ts": "22",
            "readme.md": "hello",
        });
        const view = createDirectoryView(root, "sha-a");
        const first = await view.listFiles();
        const second = await view.listFiles();
        expect(second).toEqual(first);

        const other = createDirectoryView(root, "sha-b");
        expect(await other.listFiles()).toEqual(first);
    });

    it("never lists skipped directories, at any depth", async () => {
        const root = await makeRepo({
            ".git/config": "[core]",
            "node_modules/pkg/index.js": "x",
            "dist/out.js": "x",
            "build/artifact.txt": "x",
            "src/node_modules/nested.js": "x",
            "src/keep.ts": "keep",
        });
        const view = createDirectoryView(root, "sha");
        const files = await view.listFiles();
        expect(files.map(f => f.path)).toEqual(["src/keep.ts"]);
    });

    it.skipIf(!canSymlink)("skips symlinked files entirely", async () => {
        const root = await makeRepo({ "real.txt": "real content" });
        await fs.symlink(path.join(root, "real.txt"), path.join(root, "link.txt"));
        const view = createDirectoryView(root, "sha");
        const files = await view.listFiles();
        expect(files.map(f => f.path)).toEqual(["real.txt"]);
        expect(await view.readFile("link.txt")).toBeNull();
    });

    it("exposes the sha it was constructed with", async () => {
        const root = await makeRepo({});
        expect(createDirectoryView(root, "deadbeef").sha).toBe("deadbeef");
    });
});

describe("createDirectoryView readFile", () => {
    it("reads a normal UTF-8 file", async () => {
        const root = await makeRepo({ "src/hello.ts": "export const hi = 'there';\n" });
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("src/hello.ts")).toBe("export const hi = 'there';\n");
    });

    it("preserves CRLF line endings byte-for-byte", async () => {
        const root = await makeRepo({ "crlf.txt": "one\r\ntwo\r\n" });
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("crlf.txt")).toBe("one\r\ntwo\r\n");
    });

    it("returns null for a missing file", async () => {
        const root = await makeRepo({});
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("nope.txt")).toBeNull();
    });

    it("returns null for a path escaping the root", async () => {
        const parent = await makeTempDir();
        const root = path.join(parent, "repo");
        await fs.mkdir(root);
        await fs.writeFile(path.join(parent, "secret.txt"), "outside");
        await fs.writeFile(path.join(root, "inside.txt"), "inside");
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("../secret.txt")).toBeNull();
        expect(await view.readFile("a/../../secret.txt")).toBeNull();
        expect(await view.readFile("inside.txt")).toBe("inside");
    });

    it("returns null for an absolute path", async () => {
        const root = await makeRepo({ "a.txt": "a" });
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("/etc/passwd")).toBeNull();
    });

    it("returns null for a path containing a NUL byte", async () => {
        const root = await makeRepo({ "a.txt": "a" });
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("a\0.txt")).toBeNull();
    });

    it("returns null for binary content (NUL in the probe window)", async () => {
        const root = await makeRepo({ "blob.bin": Buffer.from([0x68, 0x69, 0x00, 0x21]) });
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("blob.bin")).toBeNull();
    });

    it("returns null when the file exceeds maxBytes, and reads at the boundary", async () => {
        const root = await makeRepo({ "sized.txt": "x".repeat(100) });
        const view = createDirectoryView(root, "sha");
        expect(await view.readFile("sized.txt", 99)).toBeNull();
        expect(await view.readFile("sized.txt", 100)).toBe("x".repeat(100));
    });
});

describe("createDirectoryView searchText", () => {
    it("finds a literal match with path, 1-indexed line, and text", async () => {
        const root = await makeRepo({
            "src/beta.ts": "const zero = 0;\nfunction findNeedle() {}\n",
        });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("findNeedle");
        expect(matches).toEqual([
            { path: "src/beta.ts", line: 2, text: "function findNeedle() {}" },
        ]);
    });

    it("counts lines per file even with CRLF endings", async () => {
        const root = await makeRepo({ "crlf.txt": "one\r\nneedle two\r\n" });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("needle");
        expect(matches).toEqual([{ path: "crlf.txt", line: 2, text: "needle two" }]);
    });

    it("supports real regex patterns", async () => {
        const root = await makeRepo({ "a.txt": "haystack\nneedle\nnoodle\n" });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("n[eo]{2}dle");
        expect(matches.map(m => m.line)).toEqual([2, 3]);
    });

    it("falls back to a literal search for an invalid regex", async () => {
        const root = await makeRepo({ "weird.txt": "value a(b end\nplain ab\n" });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("a(b");
        expect(matches).toEqual([{ path: "weird.txt", line: 1, text: "value a(b end" }]);
    });

    it("is case-insensitive by default and case-sensitive on request", async () => {
        const root = await makeRepo({ "case.txt": "needle low\nNeedle up\n" });
        const view = createDirectoryView(root, "sha");
        const insensitive = await view.searchText("NEEDLE");
        expect(insensitive.map(m => m.line)).toEqual([1, 2]);
        const sensitive = await view.searchText("Needle", { caseSensitive: true });
        expect(sensitive).toEqual([{ path: "case.txt", line: 2, text: "Needle up" }]);
    });

    it("filters by suffix glob", async () => {
        const root = await makeRepo({ "a.ts": "needle ts\n", "b.md": "needle md\n" });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("needle", { glob: "*.ts" });
        expect(matches.map(m => m.path)).toEqual(["a.ts"]);
    });

    it("filters by prefix glob", async () => {
        const root = await makeRepo({ "src/a.txt": "needle src\n", "lib/b.txt": "needle lib\n" });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("needle", { glob: "src/*" });
        expect(matches.map(m => m.path)).toEqual(["src/a.txt"]);
    });

    it("caps results at the requested maxResults", async () => {
        const lines = Array.from({ length: 5 }, (_, i) => `needle ${i}`).join("\n");
        const root = await makeRepo({ "many.txt": lines });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("needle", { maxResults: 2 });
        expect(matches).toHaveLength(2);
        expect(matches.map(m => m.line)).toEqual([1, 2]);
    });

    it("caps results at 50 by default", async () => {
        const lines = Array.from({ length: 60 }, (_, i) => `needle ${i}`).join("\n");
        const root = await makeRepo({ "many.txt": lines });
        const view = createDirectoryView(root, "sha");
        expect(await view.searchText("needle")).toHaveLength(50);
    });

    it("never exceeds the hard cap of 200 even when asked to", async () => {
        const lines = Array.from({ length: 250 }, (_, i) => `needle ${i}`).join("\n");
        const root = await makeRepo({ "many.txt": lines });
        const view = createDirectoryView(root, "sha");
        expect(await view.searchText("needle", { maxResults: 500 })).toHaveLength(200);
    });

    it("skips lines longer than 5000 characters", async () => {
        const content = `needle${"x".repeat(5001)}\nshort needle\n`;
        const root = await makeRepo({ "long.txt": content });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("needle");
        expect(matches).toEqual([{ path: "long.txt", line: 2, text: "short needle" }]);
    });

    it("trims the matching line and cuts it to 240 characters", async () => {
        const root = await makeRepo({ "wide.txt": `   needle${"y".repeat(300)}\n` });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("needle");
        expect(matches).toHaveLength(1);
        const text = matches[0]?.text ?? "";
        expect(text).toHaveLength(240);
        expect(text.startsWith("needle")).toBe(true);
        expect(text).toBe(`needle${"y".repeat(300)}`.slice(0, 240));
    });

    it("skips binary files", async () => {
        const root = await makeRepo({ "bin.dat": Buffer.from("needle\0needle") });
        const view = createDirectoryView(root, "sha");
        expect(await view.searchText("needle")).toEqual([]);
    });

    it("skips files larger than the search size cap", async () => {
        const big = `needle\n${"x".repeat(600 * 1024)}`;
        const root = await makeRepo({ "huge.txt": big, "small.txt": "needle here\n" });
        const view = createDirectoryView(root, "sha");
        const matches = await view.searchText("needle");
        expect(matches.map(m => m.path)).toEqual(["small.txt"]);
    });

    it("returns nothing for an empty or oversized pattern", async () => {
        const root = await makeRepo({ "a.txt": "needle\n" });
        const view = createDirectoryView(root, "sha");
        expect(await view.searchText("")).toEqual([]);
        expect(await view.searchText("n".repeat(501))).toEqual([]);
    });
});
