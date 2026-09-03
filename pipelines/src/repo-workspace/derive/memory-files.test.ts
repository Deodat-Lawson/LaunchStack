import { describe, expect, it } from "vitest";

import type { WorkspaceView } from "../types";
import { collectMemoryFiles } from "./memory-files";

/** In-memory WorkspaceView: enough of the port for memory-file collection. */
function makeView(
    files: Record<string, string>,
    overrides?: Partial<WorkspaceView>
): WorkspaceView {
    return {
        sha: "fake-sha",
        listFiles: async () =>
            Object.keys(files)
                .sort()
                .map(path => ({ path, size: files[path]?.length ?? 0 })),
        readFile: async (path: string) => files[path] ?? null,
        searchText: async () => [],
        ...overrides,
    };
}

describe("collectMemoryFiles", () => {
    it("collects slots in priority order, README first", async () => {
        const view = makeView({
            "contributing.md": "contrib",
            "claude.md": "claude",
            "AGENTS.md": "agents",
            "README.md": "readme",
            "src/index.ts": "not a memory file",
        });
        const collected = await collectMemoryFiles(view);
        expect(collected.map(f => f.path)).toEqual([
            "README.md",
            "AGENTS.md",
            "claude.md",
            "contributing.md",
        ]);
        expect(collected.map(f => f.truncated)).toEqual([false, false, false, false]);
    });

    it("matches basenames case-insensitively but reports the actual path", async () => {
        const view = makeView({ "readme.MD": "shouty readme" });
        const collected = await collectMemoryFiles(view);
        expect(collected).toEqual([
            { path: "readme.MD", content: "shouty readme", truncated: false },
        ]);
    });

    it("takes only the first hit per slot: README.md beats readme.rst", async () => {
        const view = makeView({
            "readme.rst": "rst variant",
            "README.md": "markdown variant",
        });
        const collected = await collectMemoryFiles(view);
        expect(collected).toEqual([
            { path: "README.md", content: "markdown variant", truncated: false },
        ]);
    });

    it("falls through to a later slot candidate when the first is absent", async () => {
        const view = makeView({
            "readme.rst": "rst only",
            "docs/architecture.md": "arch notes",
        });
        const collected = await collectMemoryFiles(view);
        expect(collected.map(f => f.path)).toEqual(["readme.rst", "docs/architecture.md"]);
    });

    it("prefers the root architecture.md over docs/architecture.md", async () => {
        const view = makeView({
            "architecture.md": "root arch",
            "docs/architecture.md": "docs arch",
        });
        const collected = await collectMemoryFiles(view);
        expect(collected).toEqual([
            { path: "architecture.md", content: "root arch", truncated: false },
        ]);
    });

    it("caps a single file at 20k characters and flags the truncation", async () => {
        const view = makeView({ "README.md": "r".repeat(25_000) });
        const collected = await collectMemoryFiles(view);
        expect(collected).toHaveLength(1);
        expect(collected[0]?.content).toHaveLength(20_000);
        expect(collected[0]?.truncated).toBe(true);
    });

    it("stops collecting once the 48k total budget is spent", async () => {
        const view = makeView({
            "README.md": "a".repeat(20_000),
            "agents.md": "b".repeat(20_000),
            "claude.md": "c".repeat(20_000),
            "contributing.md": "d".repeat(100),
        });
        const collected = await collectMemoryFiles(view);
        expect(collected.map(f => f.path)).toEqual(["README.md", "agents.md", "claude.md"]);
        expect(collected[0]?.content).toHaveLength(20_000);
        expect(collected[1]?.content).toHaveLength(20_000);
        // Third file only gets the 8k left in the total budget.
        expect(collected[2]?.content).toHaveLength(8_000);
        expect(collected[2]?.truncated).toBe(true);
        expect(collected.some(f => f.path === "contributing.md")).toBe(false);
    });

    it("skips empty and whitespace-only files", async () => {
        const view = makeView({
            "README.md": "   \n\t  \n",
            "agents.md": "real content",
        });
        const collected = await collectMemoryFiles(view);
        expect(collected.map(f => f.path)).toEqual(["agents.md"]);
    });

    it("skips files the view refuses to read", async () => {
        const base = {
            "README.md": "unreadable",
            "agents.md": "readable",
        };
        const view = makeView(base, {
            readFile: async (path: string) =>
                path === "README.md" ? null : (base[path as keyof typeof base] ?? null),
        });
        const collected = await collectMemoryFiles(view);
        expect(collected.map(f => f.path)).toEqual(["agents.md"]);
    });

    it("returns an empty list when no memory files exist", async () => {
        const view = makeView({ "src/main.ts": "code", "package.json": "{}" });
        expect(await collectMemoryFiles(view)).toEqual([]);
    });
});
