/**
 * A table as a file: CSV (the results grid) and XLSX (the grid plus an
 * Evidence sheet with every found cell's quote and page). Pure functions of
 * the view the reader was given, so a row they can't open — already withheld
 * there — never reaches a file, and the tests need no server.
 *
 * Text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is a
 * formula to a spreadsheet; a document title or an extracted value could be
 * one. Such text gets a leading apostrophe in both formats (the CSV writer in
 * ~/lib/usage/csv does it for its cells; the same rule is applied to XLSX
 * strings here). Numbers are written as numbers.
 */
import * as XLSX from "xlsx";

import type {
    ExtractionCell,
    ExtractionRowView,
    ExtractionTableView,
} from "~/lib/extraction/types";
import { toCsv, type CsvCell } from "~/lib/usage/csv";

/** The words a file is written with, in the reader's language (`extractServer.export`). */
export interface ExportLabels {
    /** Sheet names. */
    results: string;
    evidence: string;
    /** Column headers. */
    document: string;
    field: string;
    value: string;
    quote: string;
    page: string;
    readFrom: string;
    /** Boolean values. */
    yes: string;
    no: string;
    /** Where a value was read from. */
    text: string;
    image: string;
    /** The file's name when the table's title has no usable character. */
    fileName: string;
}

export type ExportFormat = "csv" | "xlsx";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
    csv: "text/csv; charset=utf-8",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type Grid = { header: string[]; rows: CsvCell[][] };

/** A found cell's value as a spreadsheet takes it; null for not found or not read. */
export function cellValue(cell: ExtractionCell | undefined, labels: ExportLabels): CsvCell {
    if (!cell || cell.status !== "found") return null;
    const value = cell.value;
    if (value === null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value ? labels.yes : labels.no;
    if (Array.isArray(value)) return value.join("; ");
    return value;
}

const shownRows = (view: ExtractionTableView): ExtractionRowView[] =>
    view.rows.filter(row => row.readable);

/** Sheet 1: Document, then one column per field. */
export function resultsGrid(view: ExtractionTableView, labels: ExportLabels): Grid {
    return {
        header: [labels.document, ...view.fields.map(field => field.name)],
        rows: shownRows(view).map(row => [
            row.title,
            ...view.fields.map(field => cellValue(row.cells[field.id], labels)),
        ]),
    };
}

/** Sheet 2: one line per found cell, with the words it rests on. */
export function evidenceGrid(view: ExtractionTableView, labels: ExportLabels): Grid {
    const rows: CsvCell[][] = [];
    for (const row of shownRows(view)) {
        for (const field of view.fields) {
            const cell = row.cells[field.id];
            if (!cell || cell.status !== "found") continue;
            rows.push([
                row.title,
                field.name,
                cellValue(cell, labels),
                cell.quote,
                cell.page,
                cell.via === "vision" ? labels.image : labels.text,
            ]);
        }
    }
    return {
        header: [
            labels.document,
            labels.field,
            labels.value,
            labels.quote,
            labels.page,
            labels.readFrom,
        ],
        rows,
    };
}

/** The Results sheet as RFC 4180 text, with a byte-order mark so Excel reads UTF-8. */
export function tableToCsv(view: ExtractionTableView, labels: ExportLabels): string {
    const { header, rows } = resultsGrid(view, labels);
    return `\uFEFF${toCsv(header, rows)}`;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** The same guard `toCsv` applies, for a cell written into a workbook. */
export function guardFormula(value: string): string {
    return FORMULA_START.test(value) ? `'${value}` : value;
}

function sheetCell(value: CsvCell): string | number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return guardFormula(value);
}

/** Excel refuses these in a sheet name, and anything over 31 characters. */
function sheetName(name: string, fallback: string): string {
    const clean = name
        .replace(/[[\]:*?/\\]/g, " ")
        .replace(/^'+|'+$/g, "")
        .trim()
        .slice(0, 31);
    return clean || fallback;
}

function sheetOf(grid: Grid): XLSX.WorkSheet {
    const sheet = XLSX.utils.aoa_to_sheet([
        grid.header.map(sheetCell),
        ...grid.rows.map(row => row.map(sheetCell)),
    ]);
    sheet["!cols"] = grid.header.map((_, column) => {
        let widest = 8;
        for (const row of [grid.header, ...grid.rows]) {
            const value = row[column];
            if (value !== null && value !== undefined)
                widest = Math.max(widest, String(value).length);
        }
        return { wch: Math.min(60, widest + 2) };
    });
    return sheet;
}

/** The workbook: "Results", then "Evidence". */
export function tableToXlsx(view: ExtractionTableView, labels: ExportLabels): Buffer {
    const book = XLSX.utils.book_new();
    const results = sheetName(labels.results, "Results");
    let evidence = sheetName(labels.evidence, "Evidence");
    if (evidence.toLowerCase() === results.toLowerCase()) evidence = "Evidence";
    XLSX.utils.book_append_sheet(book, sheetOf(resultsGrid(view, labels)), results);
    XLSX.utils.book_append_sheet(book, sheetOf(evidenceGrid(view, labels)), evidence);
    return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

/**
 * A file name from a table's title: no path separators, control characters
 * or characters a file system refuses; at most 100 characters before the
 * extension.
 */
export function exportFileName(title: string, format: ExportFormat, fallback: string): string {
    const clean = (value: string) =>
        value
            .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/^\.+|[. ]+$/g, "")
            .slice(0, 100)
            .trim();
    return `${clean(title) || clean(fallback) || "extraction"}.${format}`;
}

/**
 * `attachment` with both spellings of the name: an ASCII `filename` for old
 * clients and the RFC 5987 `filename*` that carries the real one.
 */
export function attachmentDisposition(fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(fileName).replace(
        /['()*]/g,
        char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
