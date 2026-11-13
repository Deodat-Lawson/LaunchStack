/**
 * Extraction tables as text for Ask's `read_extraction_table` tool: the list
 * of tables a person can see, and one table's rows, a line per document.
 * Pure, over the views the service already redacted for that person — a row
 * whose document they can't open has no title or cells there, and is left
 * out here.
 */
import type {
    ExtractionCell,
    ExtractionCounts,
    ExtractionTableStatus,
    ExtractionTableView,
} from "~/lib/extraction/types";

/** What the list shows of one table. */
export interface ExtractionTableOutline {
    id: number;
    title: string;
    status: ExtractionTableStatus;
    /** Field names, in column order. */
    fields: string[];
    counts: ExtractionCounts;
    mine: boolean;
    createdByName: string | null;
}

/** Characters of rows shown per call; the rest is counted, not shown. */
export const TABLE_TEXT_MAX_CHARS = 20_000;
const VALUE_CHARS = 300;
const LIST_MAX = 40;

function clip(text: string, max: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function rowsLine(counts: ExtractionCounts): string {
    const parts = [`${counts.done} read`];
    if (counts.failed > 0) parts.push(`${counts.failed} failed`);
    const waiting = counts.pending + counts.running;
    if (waiting > 0) parts.push(`${waiting} not read yet`);
    return `${counts.total} document${counts.total === 1 ? "" : "s"} (${parts.join(", ")})`;
}

const matches = (text: string, query: string | undefined) =>
    !query || text.toLowerCase().includes(query.trim().toLowerCase());

/** The tables the person can see, newest first; `query` keeps those whose title or fields contain it. */
export function formatExtractionTableList(
    tables: readonly ExtractionTableOutline[],
    query?: string
): string {
    if (tables.length === 0) return "The person has no extraction tables in this workspace yet.";
    const found = tables.filter(table =>
        matches(`${table.title} ${table.fields.join(" ")}`, query)
    );
    if (found.length === 0) {
        return `No extraction table matches "${query?.trim()}". Call read_extraction_table with no query to list them all.`;
    }
    const shown = found.slice(0, LIST_MAX);
    const lines = shown.map(table => {
        const by = table.mine
            ? "made by this person"
            : `shared by ${table.createdByName ?? "a colleague"}`;
        return `- table ${table.id}: "${table.title}" — ${table.status}, ${rowsLine(table.counts)}, ${by}. Fields: ${table.fields.join("; ")}`;
    });
    return [
        `${found.length} extraction table${found.length === 1 ? "" : "s"}${query ? ` matching "${query.trim()}"` : ""}, newest first:`,
        ...lines,
        ...(found.length > shown.length
            ? [`${found.length - shown.length} more tables not shown. Narrow it with query.`]
            : []),
        "",
        "Call read_extraction_table with a table's number to read its rows.",
    ].join("\n");
}

function valueText(cell: ExtractionCell): string | null {
    if (cell.status !== "found" || cell.value === null) return null;
    const value = cell.value;
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (Array.isArray(value)) return clip(value.join("; "), VALUE_CHARS);
    return clip(String(value), VALUE_CHARS);
}

/**
 * One table: its fields, then a line per document with each field that was
 * found. `query` keeps the rows whose line contains it. Lines stop at
 * `maxChars`, and the result says how many rows were left out.
 */
export function formatExtractionTable(
    view: ExtractionTableView,
    options: { query?: string; maxChars?: number } = {}
): string {
    const maxChars = options.maxChars ?? TABLE_TEXT_MAX_CHARS;
    const head = [
        `Extraction table ${view.id}: "${view.title}" — ${view.status}, ${rowsLine(view.counts)}.`,
        "Fields:",
        ...view.fields.map(
            field =>
                `- ${field.name} (${field.type})${field.instruction ? `: ${clip(field.instruction, 200)}` : ""}`
        ),
    ];
    const readable = view.rows.filter(row => row.readable);
    const withheld = view.rows.length - readable.length;
    const lines = readable
        .map(row => {
            const label = `- "${row.title}" (${row.sourceId})`;
            if (row.status === "failed") return `${label}: (could not be read)`;
            if (row.status !== "done") return `${label}: (not read yet)`;
            const values = view.fields.flatMap(field => {
                const cell = row.cells[field.id];
                const text = cell ? valueText(cell) : null;
                return text === null ? [] : [`${field.name}: ${text}`];
            });
            return values.length > 0
                ? `${label} — ${values.join(" | ")}`
                : `${label}: (none of the fields were found in this document)`;
        })
        .filter(line => matches(line, options.query));

    const shown: string[] = [];
    let used = 0;
    for (const line of lines) {
        if (used + line.length + 1 > maxChars) break;
        shown.push(line);
        used += line.length + 1;
    }
    const tail: string[] = [];
    if (lines.length > shown.length) {
        tail.push(
            `${lines.length - shown.length} more rows not shown. Call read_extraction_table again with query to narrow the rows.`
        );
    }
    if (withheld > 0) {
        tail.push(
            `${withheld} row${withheld === 1 ? " is" : "s are"} from files this person cannot open and ${withheld === 1 ? "is" : "are"} left out.`
        );
    }
    const rowsHeading = options.query
        ? `Rows matching "${options.query.trim()}" (${lines.length} of ${readable.length}):`
        : `Rows (one per document; a field that is not listed was not found in it):`;
    return [
        ...head,
        "",
        rowsHeading,
        ...(shown.length > 0 ? shown : ["(none)"]),
        ...(tail.length > 0 ? ["", ...tail] : []),
    ].join("\n");
}
