/**
 * The explainer's four read-only tools over one workspace checkout
 * (design §3.4): `repo_map`, `repo_tree`, `search_code`, `read_files`.
 *
 * Everything enforced in the tools, not the prompt:
 * - hygiene: denied paths are invisible in every result,
 * - membership: unknown paths return typed errors the model corrects,
 * - budgets: 25 files / 30k chars per file / 100k chars total per run,
 *   with the remaining budget reported after every read.
 *
 * The factory also tracks which paths actually entered the model's context —
 * the read-set the acceptance gate checks grounding against.
 */
import { z } from "zod";
import { defineAgentTool } from "@launchstack/llm";
import { makeDeniedSet } from "@launchstack/pipelines/repo-workspace";
import { renderTree } from "@launchstack/pipelines/repo-workspace";
export const READ_BUDGET = {
    maxFilesPerRun: 25,
    maxCharsPerFile: 30_000,
    maxTotalChars: 100_000,
    maxPathsPerCall: 10,
};
const MAX_MAP_QUERY_RESULTS = 20;
const MAX_SEARCH_RESULTS = 50;
export function makeExplainerTools(view, bundle) {
    const denied = makeDeniedSet(bundle.hygiene);
    const readPaths = new Set();
    // Memory files were inlined into the warm-start context, so they count
    // as read from turn zero.
    for (const memory of bundle.memoryFiles)
        readPaths.add(memory.path);
    let filesReadCount = 0;
    let totalCharsUsed = 0;
    const repoMap = defineAgentTool({
        name: "repo_map",
        description: "Query the ranked repo map (files other files depend on most). " +
            "Without a query, returns the full ranked map; with a query, returns " +
            "entries whose path or symbols match it.",
        inputSchema: z.object({
            query: z
                .string()
                .max(200)
                .optional()
                .describe("Substring to match against paths and symbol names"),
        }),
        run: ({ query }) => {
            if (!query)
                return { content: bundle.map.rendered || "(empty map)" };
            const needle = query.toLowerCase();
            const hits = bundle.map.entries
                .filter(entry => entry.path.toLowerCase().includes(needle) ||
                entry.symbols.some(symbol => symbol.toLowerCase().includes(needle)))
                .slice(0, MAX_MAP_QUERY_RESULTS);
            if (hits.length === 0) {
                return { content: `No map entries match "${query}".`, isError: true };
            }
            return {
                content: hits
                    .map(entry => entry.symbols.length > 0
                    ? `${entry.path}\n  ${entry.symbols.join(", ")}`
                    : entry.path)
                    .join("\n"),
            };
        },
    });
    const repoTree = defineAgentTool({
        name: "repo_tree",
        description: "Render the directory tree. Optionally scope it to a subdirectory " +
            "and limit the depth.",
        inputSchema: z.object({
            path: z
                .string()
                .max(500)
                .optional()
                .describe("Subdirectory to scope to, e.g. src/server"),
            depth: z.number().int().min(1).max(8).optional().describe("Levels to show (default 5)"),
        }),
        run: async ({ path: scope, depth }) => {
            const files = await view.listFiles();
            const prefix = scope ? `${scope.replace(/\/+$/, "")}/` : "";
            const paths = files
                .map(file => file.path)
                .filter(p => !denied.has(p))
                .filter(p => (prefix ? p.startsWith(prefix) : true))
                .map(p => (prefix ? p.slice(prefix.length) : p));
            if (paths.length === 0) {
                return {
                    content: scope
                        ? `No files under "${scope}". Check repo_tree without a path first.`
                        : "The repository appears to be empty.",
                    isError: true,
                };
            }
            return {
                content: renderTree(paths, {
                    maxDepth: depth,
                    rootLabel: scope ? prefix.slice(0, -1) : ".",
                }),
            };
        },
    });
    const searchCode = defineAgentTool({
        name: "search_code",
        description: "Search file contents (regex or literal). Returns matching lines as " +
            "path:line: text. Use this to find where something is actually wired " +
            "before reading files.",
        inputSchema: z.object({
            pattern: z.string().min(1).max(300).describe("Regex (falls back to literal)"),
            glob: z
                .string()
                .max(200)
                .optional()
                .describe("Path filter: *.ts (suffix) or src/* (prefix)"),
            maxResults: z.number().int().min(1).max(100).optional(),
        }),
        run: async ({ pattern, glob, maxResults }) => {
            const matches = await view.searchText(pattern, {
                glob,
                maxResults: Math.min(maxResults ?? MAX_SEARCH_RESULTS, 100),
            });
            const visible = matches.filter(match => !denied.has(match.path));
            if (visible.length === 0) {
                return { content: `No matches for "${pattern}".`, isError: true };
            }
            return {
                content: visible
                    .map(match => `${match.path}:${match.line}: ${match.text}`)
                    .join("\n"),
            };
        },
    });
    const readFiles = defineAgentTool({
        name: "read_files",
        description: `Read up to ${READ_BUDGET.maxPathsPerCall} files by exact repo-relative path. ` +
            `Budget per run: ${READ_BUDGET.maxFilesPerRun} files, ` +
            `${READ_BUDGET.maxTotalChars} characters total; the remaining budget is ` +
            "reported after every call. Spend it on load-bearing files.",
        inputSchema: z.object({
            paths: z
                .array(z.string().min(1).max(500))
                .min(1)
                .max(READ_BUDGET.maxPathsPerCall)
                .describe("Exact repo-relative paths from repo_tree/repo_map/search_code"),
        }),
        run: async ({ paths }) => {
            const files = await view.listFiles();
            const existing = new Set(files.map(file => file.path));
            const sections = [];
            let anyContent = false;
            for (const requested of paths) {
                if (denied.has(requested)) {
                    sections.push(`===== ${requested} =====\n(unavailable: excluded by policy)`);
                    continue;
                }
                if (!existing.has(requested)) {
                    sections.push(`===== ${requested} =====\n(error: no such file — paths must come ` +
                        "from repo_tree, repo_map, or search_code, exactly as shown)");
                    continue;
                }
                if (readPaths.has(requested)) {
                    sections.push(`===== ${requested} =====\n(already read — content omitted)`);
                    continue;
                }
                if (filesReadCount >= READ_BUDGET.maxFilesPerRun) {
                    sections.push(`===== ${requested} =====\n(error: file budget exhausted — ` +
                        `${READ_BUDGET.maxFilesPerRun} files max; work with what you have)`);
                    continue;
                }
                if (totalCharsUsed >= READ_BUDGET.maxTotalChars) {
                    sections.push(`===== ${requested} =====\n(error: character budget exhausted; ` +
                        "work with what you have)");
                    continue;
                }
                const content = await view.readFile(requested);
                if (content === null) {
                    sections.push(`===== ${requested} =====\n(unreadable: binary, oversized, or missing)`);
                    continue;
                }
                const remaining = READ_BUDGET.maxTotalChars - totalCharsUsed;
                const budgeted = Math.min(READ_BUDGET.maxCharsPerFile, remaining);
                const clipped = content.length > budgeted;
                const kept = clipped ? content.slice(0, budgeted) : content;
                filesReadCount += 1;
                totalCharsUsed += kept.length;
                readPaths.add(requested);
                anyContent = true;
                sections.push(`===== ${requested}${clipped ? " (truncated)" : ""} =====\n${kept}`);
            }
            sections.push(`--- budget: ${READ_BUDGET.maxFilesPerRun - filesReadCount} files, ` +
                `${READ_BUDGET.maxTotalChars - totalCharsUsed} chars remaining ---`);
            return { content: sections.join("\n\n"), isError: !anyContent };
        },
    });
    return {
        tools: [repoMap, repoTree, searchCode, readFiles],
        getReadPaths: () => readPaths,
    };
}
//# sourceMappingURL=workspace-tools.js.map