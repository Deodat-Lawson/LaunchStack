import { describe, expect, it } from "vitest";

import type { AgentToolDefinition, AgentToolResult } from "@launchstack/llm";

import type {
    ContextBundle,
    SearchMatch,
    SearchOptions,
    WorkspaceView,
} from "@launchstack/pipelines/repo-workspace";

import { makeExplainerTools, READ_BUDGET, type ExplainerToolset } from "./workspace-tools";

/* ──────────────────────────────────────────────────────────────
 * Fixture builders
 * ────────────────────────────────────────────────────────────── */

const SHA = "fedcba9876543210fedcba9876543210fedcba98";

/** In-memory WorkspaceView; `null` content models a binary/unreadable file. */
function makeView(files: Record<string, string | null>): WorkspaceView {
    const paths = Object.keys(files).sort();
    return {
        sha: SHA,
        listFiles: async () => paths.map(path => ({ path, size: files[path]?.length ?? 0 })),
        readFile: async path => files[path] ?? null,
        searchText: async (pattern: string, options?: SearchOptions): Promise<SearchMatch[]> => {
            let regex: RegExp;
            try {
                regex = new RegExp(pattern, "i");
            } catch {
                regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            }
            const matches: SearchMatch[] = [];
            for (const path of paths) {
                const content = files[path];
                if (content == null) continue;
                content.split("\n").forEach((text, index) => {
                    if (regex.test(text)) {
                        matches.push({ path, line: index + 1, text: text.trim() });
                    }
                });
            }
            return matches.slice(0, options?.maxResults ?? 50);
        },
    };
}

const ROUTER_TS = [
    'import { handlers } from "./handlers";',
    "",
    "export function registerRoutes(app: AppServer): void {",
    '    app.get("/health", handlers.health);',
    '    app.post("/webhooks", handlers.webhook);',
    "}",
    'export const SHARED_TOKEN_HEADER = "x-shared-token";',
].join("\n");

const FILES: Record<string, string | null> = {
    "README.md": "# Widgets\n\nWebhooks in, reports out. Start at src/server/router.ts.\n",
    "src/server/router.ts": ROUTER_TS,
    "src/server/handlers.ts": [
        "export const handlers = {",
        "    health: () => ({ ok: true }),",
        "    webhook: (body: unknown) => enqueue(body),",
        "};",
    ].join("\n"),
    "src/lib/util.ts": [
        "export function clamp(n: number, lo: number, hi: number): number {",
        "    return Math.min(hi, Math.max(lo, n));",
        "}",
    ].join("\n"),
    "deep/one/two/inner.ts": "export const nested = true;\n",
    "secrets/.env": "API_KEY=sk-live-999\nSHARED_TOKEN=hunter2\n",
    "assets/logo.png": null,
};

function makeBundle(
    overrides: Partial<Pick<ContextBundle, "map" | "memoryFiles" | "hygiene">> = {}
): ContextBundle {
    return {
        schemaVersion: 1,
        sha: SHA,
        tree: "",
        map: overrides.map ?? {
            entries: [
                {
                    path: "src/server/router.ts",
                    rank: 0.6,
                    symbols: ["registerRoutes", "SHARED_TOKEN_HEADER"],
                },
                { path: "src/lib/util.ts", rank: 0.4, symbols: [] },
            ],
            rendered: "src/server/router.ts\n  registerRoutes\nsrc/lib/util.ts",
        },
        memoryFiles: overrides.memoryFiles ?? [
            { path: "README.md", content: FILES["README.md"]!, truncated: false },
        ],
        stats: { totalFiles: 0, totalBytes: 0, languages: [], largestDirectories: [] },
        hygiene: overrides.hygiene ?? { deniedPaths: ["secrets/.env"] },
    };
}

interface Fixture {
    toolset: ExplainerToolset;
    tool(name: string): AgentToolDefinition;
    run(name: string, input: unknown): Promise<AgentToolResult>;
}

function makeFixture(
    files: Record<string, string | null> = FILES,
    bundleOverrides: Partial<Pick<ContextBundle, "map" | "memoryFiles" | "hygiene">> = {}
): Fixture {
    const toolset = makeExplainerTools(makeView(files), makeBundle(bundleOverrides));
    const tool = (name: string): AgentToolDefinition => {
        const found = toolset.tools.find(candidate => candidate.name === name);
        if (!found) throw new Error(`no such tool: ${name}`);
        return found;
    };
    return {
        toolset,
        tool,
        run: async (name, input) => tool(name).run(input, {}),
    };
}

describe("makeExplainerTools", () => {
    it("exposes exactly the four read-only tools", () => {
        const { toolset } = makeFixture();
        expect(toolset.tools.map(tool => tool.name)).toEqual([
            "repo_map",
            "repo_tree",
            "search_code",
            "read_files",
        ]);
    });

    it("seeds the read set with the memory-file paths", () => {
        const { toolset } = makeFixture();
        expect([...toolset.getReadPaths()]).toEqual(["README.md"]);
    });
});

describe("repo_map", () => {
    it("returns the full rendered map when no query is given", async () => {
        const { run } = makeFixture();
        const result = await run("repo_map", {});
        expect(result.content).toBe("src/server/router.ts\n  registerRoutes\nsrc/lib/util.ts");
        expect(result.isError).toBeUndefined();
    });

    it("falls back to a placeholder for an empty rendered map", async () => {
        const { run } = makeFixture(FILES, { map: { entries: [], rendered: "" } });
        const result = await run("repo_map", {});
        expect(result.content).toBe("(empty map)");
    });

    it("matches entries by path substring", async () => {
        const { run } = makeFixture();
        const result = await run("repo_map", { query: "lib/util" });
        expect(result.content).toBe("src/lib/util.ts");
        expect(result.isError).toBeUndefined();
    });

    it("matches symbols case-insensitively and lists them under the path", async () => {
        const { run } = makeFixture();
        const result = await run("repo_map", { query: "REGISTERROUTES" });
        expect(result.content).toContain("src/server/router.ts");
        expect(result.content).toContain("registerRoutes, SHARED_TOKEN_HEADER");
        expect(result.content).not.toContain("src/lib/util.ts");
    });

    it("returns a typed error when nothing matches", async () => {
        const { run } = makeFixture();
        const result = await run("repo_map", { query: "zzz-not-there" });
        expect(result.isError).toBe(true);
        expect(result.content).toBe('No map entries match "zzz-not-there".');
    });

    it("rejects over-long queries at the schema", () => {
        const { tool } = makeFixture();
        const schema = tool("repo_map").inputSchema;
        expect(() => schema.parse({ query: "x".repeat(201) })).toThrow();
        expect(schema.parse({ query: "router" })).toEqual({ query: "router" });
    });
});

describe("repo_tree", () => {
    it("renders the full tree with denied paths invisible", async () => {
        const { run } = makeFixture();
        const result = await run("repo_tree", {});
        expect(result.content.startsWith("./")).toBe(true);
        expect(result.content).toContain("README.md");
        expect(result.content).toContain("router.ts");
        expect(result.content).not.toContain(".env");
        expect(result.content).not.toContain("secrets");
        expect(result.isError).toBeUndefined();
    });

    it("scopes to a subdirectory with the scope as root label", async () => {
        const { run } = makeFixture();
        const result = await run("repo_tree", { path: "src/server" });
        expect(result.content.startsWith("src/server/")).toBe(true);
        expect(result.content).toContain("router.ts");
        expect(result.content).toContain("handlers.ts");
        expect(result.content).not.toContain("README.md");
        expect(result.content).not.toContain("util.ts");
    });

    it("normalizes a trailing slash on the scope", async () => {
        const { run } = makeFixture();
        const scoped = await run("repo_tree", { path: "src/server" });
        const trailing = await run("repo_tree", { path: "src/server/" });
        expect(trailing.content).toBe(scoped.content);
    });

    it("returns a corrective error for an unknown scope", async () => {
        const { run } = makeFixture();
        const result = await run("repo_tree", { path: "no/such" });
        expect(result.isError).toBe(true);
        expect(result.content).toContain('No files under "no/such"');
        expect(result.content).toContain("repo_tree without a path");
    });

    it("respects the depth parameter", async () => {
        const { run } = makeFixture();
        const shallow = await run("repo_tree", { depth: 1 });
        expect(shallow.content).toContain("deep");
        expect(shallow.content).not.toContain("one");

        const deeper = await run("repo_tree", { depth: 8 });
        expect(deeper.content).toContain("one");
        expect(deeper.content).toContain("inner.ts");
    });
});

describe("search_code", () => {
    it("formats matches as path:line: text", async () => {
        const { run } = makeFixture();
        const result = await run("search_code", { pattern: "registerRoutes" });
        expect(result.isError).toBeUndefined();
        expect(result.content).toContain(
            "src/server/router.ts:3: export function registerRoutes(app: AppServer): void {"
        );
    });

    it("filters matches inside denied paths out of the results", async () => {
        const { run } = makeFixture();
        const result = await run("search_code", { pattern: "SHARED_TOKEN" });
        expect(result.isError).toBeUndefined();
        expect(result.content).toContain("src/server/router.ts:7:");
        expect(result.content).not.toContain("secrets/.env");
        expect(result.content).not.toContain("hunter2");
    });

    it("reports an error when every match was denied", async () => {
        const { run } = makeFixture();
        const result = await run("search_code", { pattern: "API_KEY" });
        expect(result.isError).toBe(true);
        expect(result.content).toBe('No matches for "API_KEY".');
        expect(result.content).not.toContain("sk-live-999");
    });

    it("reports an error when nothing matches anywhere", async () => {
        const { run } = makeFixture();
        const result = await run("search_code", { pattern: "zzz_never_written" });
        expect(result.isError).toBe(true);
        expect(result.content).toBe('No matches for "zzz_never_written".');
    });
});

describe("read_files", () => {
    it("reads a file under a ===== path ===== header with a budget footer", async () => {
        const { run } = makeFixture();
        const result = await run("read_files", { paths: ["src/lib/util.ts"] });
        expect(result.isError).toBe(false);
        expect(result.content).toContain(
            `===== src/lib/util.ts =====\n${FILES["src/lib/util.ts"]}`
        );
        const charsUsed = FILES["src/lib/util.ts"]!.length;
        expect(result.content).toContain(
            `--- budget: ${READ_BUDGET.maxFilesPerRun - 1} files, ` +
                `${READ_BUDGET.maxTotalChars - charsUsed} chars remaining ---`
        );
    });

    it("grows the read set with successful reads only", async () => {
        const { toolset, run } = makeFixture();
        expect([...toolset.getReadPaths()]).toEqual(["README.md"]);

        await run("read_files", { paths: ["src/lib/util.ts", "secrets/.env", "nope.ts"] });

        const readPaths = toolset.getReadPaths();
        expect(readPaths.has("src/lib/util.ts")).toBe(true);
        expect(readPaths.has("secrets/.env")).toBe(false);
        expect(readPaths.has("nope.ts")).toBe(false);
        expect(readPaths.size).toBe(2);
    });

    it("marks denied paths unavailable without leaking content", async () => {
        const { run } = makeFixture();
        const result = await run("read_files", { paths: ["secrets/.env"] });
        expect(result.isError).toBe(true);
        expect(result.content).toContain(
            "===== secrets/.env =====\n(unavailable: excluded by policy)"
        );
        expect(result.content).not.toContain("sk-live-999");
    });

    it("points nonexistent paths back at repo_tree", async () => {
        const { run } = makeFixture();
        const result = await run("read_files", { paths: ["src/typo.ts"] });
        expect(result.isError).toBe(true);
        expect(result.content).toContain("===== src/typo.ts =====\n(error: no such file");
        expect(result.content).toContain("repo_tree");
    });

    it("omits content on a duplicate read", async () => {
        const { run } = makeFixture();
        const first = await run("read_files", { paths: ["src/lib/util.ts"] });
        expect(first.isError).toBe(false);

        const second = await run("read_files", { paths: ["src/lib/util.ts"] });
        expect(second.isError).toBe(true);
        expect(second.content).toContain("(already read");
        expect(second.content).not.toContain("Math.min");
    });

    it("treats warm-started memory files as already read", async () => {
        const { run } = makeFixture();
        const result = await run("read_files", { paths: ["README.md"] });
        expect(result.isError).toBe(true);
        expect(result.content).toContain("===== README.md =====\n(already read");
    });

    it("marks binary files unreadable without spending budget", async () => {
        const { toolset, run } = makeFixture();
        const result = await run("read_files", { paths: ["assets/logo.png"] });
        expect(result.isError).toBe(true);
        expect(result.content).toContain("(unreadable: binary, oversized, or missing)");
        expect(toolset.getReadPaths().has("assets/logo.png")).toBe(false);
        expect(result.content).toContain(
            `--- budget: ${READ_BUDGET.maxFilesPerRun} files, ${READ_BUDGET.maxTotalChars} chars remaining ---`
        );
    });

    it("clips a single file at the per-file cap with a (truncated) marker", async () => {
        const body = "y".repeat(READ_BUDGET.maxCharsPerFile);
        const { run } = makeFixture(
            { "big/log.txt": `${body}OVERFLOW-TAIL` },
            {
                memoryFiles: [],
                map: { entries: [], rendered: "" },
                hygiene: { deniedPaths: [] },
            }
        );
        const result = await run("read_files", { paths: ["big/log.txt"] });
        expect(result.isError).toBe(false);
        expect(result.content).toContain("===== big/log.txt (truncated) =====");
        expect(result.content).not.toContain("OVERFLOW-TAIL");
        expect(result.content).toContain(
            `${READ_BUDGET.maxTotalChars - READ_BUDGET.maxCharsPerFile} chars remaining`
        );
    });

    it("exhausts the file budget after 25 distinct reads", async () => {
        const bulk = Object.fromEntries(
            Array.from({ length: READ_BUDGET.maxFilesPerRun + 1 }, (_, i) => [
                `bulk/file${String(i).padStart(2, "0")}.ts`,
                `export const value${i} = ${i};\n`,
            ])
        );
        const { run } = makeFixture(bulk, {
            memoryFiles: [],
            map: { entries: [], rendered: "" },
            hygiene: { deniedPaths: [] },
        });
        const paths = Object.keys(bulk).sort();

        // 25 successful reads across three calls (10-path cap per call).
        const first = await run("read_files", { paths: paths.slice(0, 10) });
        const second = await run("read_files", { paths: paths.slice(10, 20) });
        const third = await run("read_files", { paths: paths.slice(20, 25) });
        expect(first.isError).toBe(false);
        expect(second.isError).toBe(false);
        expect(third.isError).toBe(false);
        expect(third.content).toContain("--- budget: 0 files,");

        const overflow = await run("read_files", { paths: [paths[25]!] });
        expect(overflow.isError).toBe(true);
        expect(overflow.content).toContain("(error: file budget exhausted");
        expect(overflow.content).toContain(`${READ_BUDGET.maxFilesPerRun} files max`);
    });

    it("exhausts the character budget and clips the read that crosses it", async () => {
        const files = Object.fromEntries(
            Array.from({ length: 5 }, (_, i) => [
                `chunks/k${i}.txt`,
                "z".repeat(READ_BUDGET.maxCharsPerFile),
            ])
        );
        const { run } = makeFixture(files, {
            memoryFiles: [],
            map: { entries: [], rendered: "" },
            hygiene: { deniedPaths: [] },
        });

        // 30k + 30k + 30k, then a 10k clip lands exactly on the 100k ceiling.
        const result = await run("read_files", {
            paths: [
                "chunks/k0.txt",
                "chunks/k1.txt",
                "chunks/k2.txt",
                "chunks/k3.txt",
                "chunks/k4.txt",
            ],
        });
        expect(result.isError).toBe(false);
        expect(result.content).toContain("===== chunks/k2.txt =====");
        expect(result.content).toContain("===== chunks/k3.txt (truncated) =====");
        expect(result.content).toContain(
            "===== chunks/k4.txt =====\n(error: character budget exhausted"
        );
        expect(result.content).toContain("0 chars remaining");

        const refused = await run("read_files", { paths: ["chunks/k4.txt"] });
        expect(refused.isError).toBe(true);
        expect(refused.content).toContain("(error: character budget exhausted");
    });

    it("is not an error when at least one requested file was read", async () => {
        const { run } = makeFixture();
        const result = await run("read_files", {
            paths: ["src/server/handlers.ts", "missing.ts", "secrets/.env"],
        });
        expect(result.isError).toBe(false);
        expect(result.content).toContain("===== src/server/handlers.ts =====");
        expect(result.content).toContain("(error: no such file");
        expect(result.content).toContain("(unavailable: excluded by policy)");
    });

    it("enforces the per-call path count and shape at the schema", () => {
        const { tool } = makeFixture();
        const schema = tool("read_files").inputSchema;
        expect(() => schema.parse({ paths: [] })).toThrow();
        expect(() =>
            schema.parse({ paths: Array.from({ length: 11 }, (_, i) => `f${i}.ts`) })
        ).toThrow();
        expect(schema.parse({ paths: ["a.ts", "b.ts"] })).toEqual({ paths: ["a.ts", "b.ts"] });
    });
});
