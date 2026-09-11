import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDirectoryView } from "../fs-view";
import type { ContextBundle } from "../types";
import { deriveContextBundle } from "./bundle";

const CANARY = "hygiene-canary-9f3a";

const cleanupDirs: string[] = [];

afterEach(async () => {
    const dirs = cleanupDirs.splice(0);
    await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

/** Small multi-language repo: README, a secret .env, TS files that reference
 * each other, one oversized TS file, and a JSON data file. */
async function makeFixtureRepo(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bundle-test-"));
    cleanupDirs.push(root);
    const files: Record<string, string> = {
        "README.md": "# Fixture repo\n\nDemo repository for bundle derivation.\n",
        ".env": `CANARY_SECRET_VALUE=${CANARY}\n`,
        "src/core.ts": "export function coreHelper(): number {\n    return 42;\n}\n",
        "src/app.ts": [
            'import { coreHelper } from "./core";',
            "",
            "export function runApp(): number {",
            "    return coreHelper() + 1;",
            "}",
            "",
        ].join("\n"),
        "src/big.ts": `export function bigMarker(): void {}\n${"// filler\n".repeat(22_000)}`,
        "data.json": '{"name": "fixture"}\n',
    };
    for (const [rel, content] of Object.entries(files)) {
        const absolute = path.join(root, ...rel.split("/"));
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, content);
    }
    return root;
}

async function deriveFixtureBundle(root: string): Promise<ContextBundle> {
    return deriveContextBundle(createDirectoryView(root, "fixture-sha"));
}

describe("deriveContextBundle", () => {
    it("stamps the view's sha and the schema version", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        expect(bundle.sha).toBe("fixture-sha");
        expect(bundle.schemaVersion).toBe(1);
    });

    it("lists .env in the hygiene manifest", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        expect(bundle.hygiene.deniedPaths).toEqual([".env"]);
    });

    it("never leaks denied file content anywhere in the bundle", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        const serialized = JSON.stringify(bundle);
        expect(serialized).not.toContain(CANARY);
        expect(serialized).not.toContain("CANARY_SECRET_VALUE");
    });

    it("excludes the oversized file from the map but keeps the linked sources", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        const mapPaths = bundle.map.entries.map(entry => entry.path);
        expect(mapPaths).toContain("src/core.ts");
        expect(mapPaths).toContain("src/app.ts");
        expect(mapPaths).not.toContain("src/big.ts");
        expect(bundle.map.rendered).not.toContain("big.ts");
        expect(bundle.map.entries.some(entry => entry.symbols.includes("bigMarker"))).toBe(false);
        // Unsupported languages never enter the graph.
        expect(mapPaths).not.toContain("README.md");
        expect(mapPaths).not.toContain("data.json");
    });

    it("ranks the referenced module above its caller", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        expect(bundle.map.entries[0]?.path).toBe("src/core.ts");
        expect(bundle.map.entries[0]?.symbols).toContain("coreHelper");
    });

    it("collects README.md as a memory file", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        expect(bundle.memoryFiles.map(file => file.path)).toEqual(["README.md"]);
        expect(bundle.memoryFiles[0]?.content).toContain("Fixture repo");
        expect(bundle.memoryFiles[0]?.truncated).toBe(false);
    });

    it("computes stats over visible files only, denied files excluded", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        // 6 files on disk, .env denied → 5 visible.
        expect(bundle.stats.totalFiles).toBe(5);
        const byLanguage = new Map(bundle.stats.languages.map(l => [l.language, l]));
        expect(byLanguage.get("TypeScript")?.files).toBe(3);
        expect(byLanguage.get("Markdown")?.files).toBe(1);
        expect(byLanguage.get("JSON")?.files).toBe(1);
        // The .env would have counted as Other; denied files must not.
        expect(byLanguage.has("Other")).toBe(false);
    });

    it("renders the tree without denied paths", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveFixtureBundle(root);
        expect(bundle.tree).toContain("README.md");
        expect(bundle.tree).toContain("src/");
        expect(bundle.tree).toContain("core.ts");
        expect(bundle.tree).toContain("big.ts");
        expect(bundle.tree).not.toContain(".env");
    });

    it("is deterministic: two derivations over fresh views are byte-identical", async () => {
        const root = await makeFixtureRepo();
        const first = await deriveContextBundle(createDirectoryView(root, "same-sha"));
        const second = await deriveContextBundle(createDirectoryView(root, "same-sha"));
        expect(second).toEqual(first);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it("honours the tree and map budget options", async () => {
        const root = await makeFixtureRepo();
        const bundle = await deriveContextBundle(createDirectoryView(root, "sha"), {
            treeMaxChars: 20,
            mapMaxChars: 15,
        });
        expect(bundle.tree).toContain("… (tree truncated at budget)");
        expect(bundle.map.rendered.length).toBeLessThanOrEqual(
            15 + "… (map truncated at budget)".length + 1
        );
    });
});
