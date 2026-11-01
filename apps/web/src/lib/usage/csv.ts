/**
 * What the Usage tab's "Export CSV" writes: the rows on screen, as RFC 4180
 * text a spreadsheet opens. Plain, so it is tested without a browser.
 *
 * A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is
 * a formula to Excel and Sheets; a person's display name or a document title
 * could be one. Such text gets a leading apostrophe, which spreadsheets read
 * as "this is text". Numbers are written as numbers, negative ones included.
 */

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    const text = FORMULA_START.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
    return [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A file name for an export: `usage-people-2026-09-28-to-2026-10-27.csv`. */
export function csvFileName(what: string, window: { from: string; to: string }): string {
    return `usage-${what}-${window.from}-to-${window.to}.csv`;
}

/** Hand the viewer the file. A byte-order mark first, so Excel reads UTF-8 names and Chinese. */
export function downloadCsv(fileName: string, csv: string): void {
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
