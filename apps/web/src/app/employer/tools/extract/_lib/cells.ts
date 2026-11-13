import type {
    ExtractionCell,
    ExtractionCounts,
    ExtractionField,
    ExtractionFieldType,
    ExtractionRowView,
    ExtractionTableStatus,
    ExtractionValue,
} from "~/lib/extraction/types";

/**
 * The results grid as plain functions: how a value reads, how rows sort and
 * filter, how far a run is. Pinned by a unit test; the words around them
 * ("Not found", "Yes") are messages, said where they render.
 */

export const isLive = (status: ExtractionTableStatus) =>
    status === "queued" || status === "running";

/** Documents the run is finished with (read, or failed), out of all of them. */
export function progressOf(counts: ExtractionCounts): {
    finished: number;
    total: number;
    percent: number;
} {
    const finished = Math.min(counts.total, counts.done + counts.failed);
    const percent = counts.total > 0 ? Math.round((finished / counts.total) * 100) : 0;
    return { finished, total: counts.total, percent };
}

/** A row's cell for a field when it holds a value, else null (not found, not read, withheld). */
export function foundCell(row: ExtractionRowView, fieldId: string): ExtractionCell | null {
    if (!row.readable || row.status !== "done") return null;
    const cell = row.cells[fieldId];
    return cell && cell.status === "found" && cell.value !== null ? cell : null;
}

/** A number in the reader's locale; as many decimals as it has, up to six. */
export function formatNumber(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

/** Milliseconds for an ISO date ("2026-03-14", or a timestamp starting with one); null for anything else. */
export function dateMs(value: string): number | null {
    const match = ISO_DATE.exec(value.trim());
    if (!match) return null;
    const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(ms) ? null : ms;
}

/**
 * A date the way the reader's locale writes it. The value is a calendar
 * day, so it is formatted in UTC and never slips a day with the viewer's
 * time zone. A value that is not an ISO date ("Q3 2026") is shown as it is.
 */
export function formatDate(value: string, locale: string): string {
    const ms = dateMs(value);
    if (ms === null) return value;
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(ms);
}

/** A list cell's items; a lone string is a list of one. */
export function listItems(value: ExtractionValue): string[] {
    if (Array.isArray(value)) return value.filter(item => item.trim() !== "");
    if (typeof value === "string" && value.trim()) return [value];
    return [];
}

/** The first `max` items and how many are left over ("+3"). */
export function listPreview(
    items: readonly string[],
    max: number
): { shown: string[]; more: number } {
    return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/**
 * A found value as one line of text, in the reader's locale: what a cell
 * shows for text, numbers and dates, and what its popover and tooltip say.
 * Yes/No is a word, so the caller passes it.
 */
export function valueText(
    value: ExtractionValue,
    type: ExtractionFieldType,
    locale: string,
    words: { yes: string; no: string; listSeparator: string }
): string {
    if (value === null) return "";
    if (typeof value === "boolean") return value ? words.yes : words.no;
    if (Array.isArray(value)) return listItems(value).join(words.listSeparator);
    if (typeof value === "number") return formatNumber(value, locale);
    if (type === "date") return formatDate(value, locale);
    if (type === "number") {
        const n = Number(value);
        return value.trim() !== "" && Number.isFinite(n) ? formatNumber(n, locale) : value;
    }
    return value;
}

export type SortDirection = "asc" | "desc";

/** `column`: a field id, or "title" for the document column. */
export interface GridSort {
    column: string;
    direction: SortDirection;
}

/** Click a header: sort by it ascending; click it again: descending; and back. */
export function nextSort(current: GridSort | null, column: string): GridSort {
    if (current?.column === column) {
        return { column, direction: current.direction === "asc" ? "desc" : "asc" };
    }
    return { column, direction: "asc" };
}

type SortKey = number | string;

function sortKey(value: ExtractionValue, type: ExtractionFieldType): SortKey | null {
    if (value === null) return null;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (Array.isArray(value)) return listItems(value).join(", ").toLowerCase();
    if (type === "number") {
        const n = Number(value);
        return Number.isFinite(n) && value.trim() !== "" ? n : value.toLowerCase();
    }
    if (type === "date") return dateMs(value) ?? value.toLowerCase();
    return value.toLowerCase();
}

function compareKeys(a: SortKey, b: SortKey, locale: string): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    // A column that mixes numbers and words: numbers first, then the words.
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.localeCompare(b, locale, { numeric: true, sensitivity: "base" });
}

/**
 * Rows in the order the grid shows them. By a field: found values in the
 * chosen direction, then every row without one (not found, failed, still
 * being read, withheld) — last in both directions, in their original order,
 * so reversing a column never floats the blanks to the top. By "title":
 * every row has one. The sort is stable.
 */
export function sortRows(
    rows: readonly ExtractionRowView[],
    fields: readonly ExtractionField[],
    sort: GridSort | null,
    locale: string
): ExtractionRowView[] {
    if (!sort) return [...rows];
    const sign = sort.direction === "asc" ? 1 : -1;
    if (sort.column === "title") {
        return [...rows].sort(
            (a, b) =>
                sign *
                a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: "base" })
        );
    }
    const field = fields.find(f => f.id === sort.column);
    if (!field) return [...rows];
    const keyed = rows.map((row, index) => {
        const cell = foundCell(row, field.id);
        return { row, index, key: cell ? sortKey(cell.value, field.type) : null };
    });
    keyed.sort((a, b) => {
        if (a.key === null && b.key === null) return a.index - b.index;
        if (a.key === null) return 1;
        if (b.key === null) return -1;
        return sign * compareKeys(a.key, b.key, locale) || a.index - b.index;
    });
    return keyed.map(k => k.row);
}

/** Rows whose document title contains every word of the query, in any order. */
export function filterRows(rows: readonly ExtractionRowView[], query: string): ExtractionRowView[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [...rows];
    return rows.filter(row => {
        const title = row.title.toLowerCase();
        return words.every(word => title.includes(word));
    });
}
