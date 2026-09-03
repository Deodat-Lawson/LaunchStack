import { describe, expect, it } from "vitest";

import type {
    ContextBundle,
    MemoryFile,
    RepoMapEntry,
    SearchMatch,
    WorkspaceView,
} from "@launchstack/pipelines/repo-workspace";

import { packDigest } from "./pack";

/* ──────────────────────────────────────────────────────────────
 * Fixture builders
 * ────────────────────────────────────────────────────────────── */

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** In-memory WorkspaceView; `null` content models a binary/oversized file. */
function makeView(files: Record<string, string | null>): WorkspaceView {
    const paths = Object.keys(files).sort();
    return {
        sha: SHA,
        listFiles: async () => paths.map(path => ({ path, size: files[path]?.length ?? 0 })),
        readFile: async path => files[path] ?? null,
        searchText: async (): Promise<SearchMatch[]> => [],
    };
}

function makeBundle(
    overrides: Partial<Pick<ContextBundle, "map" | "memoryFiles" | "hygiene">> = {}
): ContextBundle {
    return {
        schemaVersion: 1,
        sha: SHA,
        tree: "",
        map: overrides.map ?? { entries: [], rendered: "" },
        memoryFiles: overrides.memoryFiles ?? [],
        stats: { totalFiles: 0, totalBytes: 0, languages: [], largestDirectories: [] },
        hygiene: overrides.hygiene ?? { deniedPaths: [] },
    };
}

const memory = (path: string, content = `# ${path}\n\nAuthor notes.\n`): MemoryFile => ({
    path,
    content,
    truncated: false,
});

const mapEntry = (path: string, rank: number, symbols: string[] = []): RepoMapEntry => ({
    path,
    rank,
    symbols,
});

const REPO_FILES: Record<string, string | null> = {
    "README.md": "# Widgets\n\nA demo service that turns webhooks into reports.\n",
    "alpha.ts": 'export const alpha = "first-by-name";\nexport const kind = "leaf";\n',
    "zeta.ts": 'import { core } from "./src/core";\n\nexport const zeta = core.name;\n',
    "src/core.ts": [
        "export const core = {",
        '    name: "core",',
        "    start(): void {",
        '        console.log("booting the widget engine");',
        "    },",
        "};",
        "",
    ].join("\n"),
    "src/util.ts":
        "export function clamp(n: number, lo: number, hi: number): number {\n    return Math.min(hi, Math.max(lo, n));\n}\n",
    "secrets/.env": "API_KEY=sk-live-1234567890\nDB_PASSWORD=hunter2\n",
    "assets/logo.png": null,
};

const bigBudget = 1_000_000;

describe("packDigest", () => {
    it("orders memory files first, then map entries, then the rest by path", async () => {
        const view = makeView(REPO_FILES);
        const bundle = makeBundle({
            memoryFiles: [memory("README.md")],
            map: {
                entries: [mapEntry("src/core.ts", 0.7, ["core"]), mapEntry("zeta.ts", 0.3)],
                rendered: "src/core.ts\nzeta.ts",
            },
            hygiene: { deniedPaths: ["secrets/.env"] },
        });

        const result = await packDigest(view, bundle, bigBudget);

        expect(result.includedPaths).toEqual([
            "README.md",
            "src/core.ts",
            "zeta.ts",
            "alpha.ts",
            "src/util.ts",
        ]);
        const offsets = result.includedPaths.map(path =>
            result.digest.indexOf(`===== ${path} =====`)
        );
        expect(offsets.every(offset => offset >= 0)).toBe(true);
        expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    });

    it("does not double-include a file that is both a memory file and mapped", async () => {
        const view = makeView(REPO_FILES);
        const bundle = makeBundle({
            memoryFiles: [memory("README.md")],
            map: { entries: [mapEntry("README.md", 1)], rendered: "README.md" },
            hygiene: { deniedPaths: ["secrets/.env"] },
        });

        const result = await packDigest(view, bundle, bigBudget);

        expect(result.includedPaths.filter(path => path === "README.md")).toHaveLength(1);
        expect(result.digest.match(/===== README\.md =====/g)).toHaveLength(1);
    });

    it("keeps denied paths and their content out of the digest", async () => {
        const view = makeView(REPO_FILES);
        const bundle = makeBundle({ hygiene: { deniedPaths: ["secrets/.env"] } });

        const result = await packDigest(view, bundle, bigBudget);

        expect(result.includedPaths).not.toContain("secrets/.env");
        expect(result.digest).not.toContain("secrets/.env");
        expect(result.digest).not.toContain("sk-live-1234567890");
        expect(result.digest).not.toContain("hunter2");
        expect(result.truncated).toBe(false);
    });

    it("skips nonexistent memory-file and map-entry paths without failing", async () => {
        const view = makeView(REPO_FILES);
        const bundle = makeBundle({
            memoryFiles: [memory("MISSING.md"), memory("README.md")],
            map: {
                entries: [mapEntry("gone/away.ts", 0.9), mapEntry("src/core.ts", 0.1)],
                rendered: "",
            },
            hygiene: { deniedPaths: ["secrets/.env"] },
        });

        const result = await packDigest(view, bundle, bigBudget);

        expect(result.includedPaths).not.toContain("MISSING.md");
        expect(result.includedPaths).not.toContain("gone/away.ts");
        expect(result.includedPaths[0]).toBe("README.md");
        expect(result.includedPaths[1]).toBe("src/core.ts");
    });

    it("clips a single file at 30k chars with a (truncated) header marker", async () => {
        const body = "x".repeat(30_000);
        const view = makeView({ "big.txt": `${body}OVERFLOW-TAIL` });
        const result = await packDigest(view, makeBundle(), bigBudget);

        expect(result.digest).toContain("===== big.txt (truncated) =====");
        expect(result.digest).not.toContain("OVERFLOW-TAIL");
        expect(result.digest.endsWith(body)).toBe(true);
        // A per-file clip is not budget truncation.
        expect(result.truncated).toBe(false);
        expect(result.includedPaths).toEqual(["big.txt"]);
    });

    it("stops at the character budget and reports truncated", async () => {
        const view = makeView({
            "a.txt": "A".repeat(100),
            "b.txt": "B".repeat(100),
        });
        // "===== a.txt =====\n" (18 chars) + 100 = 118; two sections never fit in 200.
        const result = await packDigest(view, makeBundle(), 200);

        expect(result.truncated).toBe(true);
        expect(result.includedPaths).toEqual(["a.txt"]);
        expect(result.digest).toContain("===== a.txt =====");
        expect(result.digest).not.toContain("b.txt");
    });

    it("returns an empty digest when not even the first file fits", async () => {
        const view = makeView({ "a.txt": "A".repeat(100) });
        const result = await packDigest(view, makeBundle(), 10);

        expect(result.truncated).toBe(true);
        expect(result.includedPaths).toEqual([]);
        expect(result.digest).toBe("");
    });

    it("skips binary (null) reads without setting truncated", async () => {
        const view = makeView(REPO_FILES);
        const bundle = makeBundle({ hygiene: { deniedPaths: ["secrets/.env"] } });

        const result = await packDigest(view, bundle, bigBudget);

        expect(result.includedPaths).not.toContain("assets/logo.png");
        expect(result.digest).not.toContain("assets/logo.png");
        expect(result.truncated).toBe(false);
    });

    it("includes every visible readable file when the whole repo fits", async () => {
        const view = makeView(REPO_FILES);
        const bundle = makeBundle({ hygiene: { deniedPaths: ["secrets/.env"] } });

        const result = await packDigest(view, bundle, bigBudget);

        expect(result.truncated).toBe(false);
        expect([...result.includedPaths].sort()).toEqual([
            "README.md",
            "alpha.ts",
            "src/core.ts",
            "src/util.ts",
            "zeta.ts",
        ]);
        expect(result.digest).toContain("booting the widget engine");
    });

    it("is deterministic for the same view, bundle, and budget", async () => {
        const view = makeView(REPO_FILES);
        const bundle = makeBundle({
            memoryFiles: [memory("README.md")],
            map: { entries: [mapEntry("src/core.ts", 1, ["core"])], rendered: "" },
            hygiene: { deniedPaths: ["secrets/.env"] },
        });

        const first = await packDigest(view, bundle, bigBudget);
        const second = await packDigest(view, bundle, bigBudget);

        expect(second.digest).toBe(first.digest);
        expect(second.includedPaths).toEqual(first.includedPaths);
        expect(second.truncated).toBe(first.truncated);
    });
});
