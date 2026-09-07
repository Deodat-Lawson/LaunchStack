/**
 * The ranked repo map — the token-budgeted overview handed to the model as
 * its warm start (design §3.3). Rendering is plain text: one line per file,
 * its top symbols indented beneath, highest-ranked files first, cut off at
 * the character budget on a whole-file boundary.
 */
import { buildSymbolGraph, pageRank } from "./graph.js";
const DEFAULT_MAX_CHARS = 12_000;
const MAX_SYMBOLS_PER_FILE = 8;
const MAX_ENTRIES = 200;
export function buildRepoMap(files, options) {
    const graph = buildSymbolGraph(files);
    const ranks = pageRank(graph, { personalization: options?.personalization });
    const entries = files
        .map(file => {
        // A file's listed symbols are its most-referenced definitions —
        // the names other files actually reach for.
        const symbols = [...file.definitions]
            .sort((a, b) => {
            const diff = (graph.referenceCounts.get(b) ?? 0) - (graph.referenceCounts.get(a) ?? 0);
            return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
        })
            .slice(0, MAX_SYMBOLS_PER_FILE);
        return { path: file.path, rank: ranks.get(file.path) ?? 0, symbols };
    })
        .sort((a, b) => (b.rank !== a.rank ? b.rank - a.rank : a.path < b.path ? -1 : 1))
        .slice(0, MAX_ENTRIES);
    return { entries, rendered: renderRepoMap(entries, options?.maxChars ?? DEFAULT_MAX_CHARS) };
}
export function renderRepoMap(entries, maxChars) {
    const lines = [];
    let used = 0;
    for (const entry of entries) {
        const block = entry.symbols.length > 0
            ? `${entry.path}\n  ${entry.symbols.join(", ")}\n`
            : `${entry.path}\n`;
        if (used + block.length > maxChars) {
            if (lines.length > 0)
                lines.push("… (map truncated at budget)");
            break;
        }
        lines.push(block.trimEnd());
        used += block.length;
    }
    return lines.join("\n");
}
//# sourceMappingURL=repo-map.js.map