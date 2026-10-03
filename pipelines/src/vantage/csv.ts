/**
 * Metric CSV import — the "simple CSV or spreadsheet import" from the brief.
 *
 * Accepts a header row with any of these columns, in any order and case:
 * `metric` (key or name), `value`, `period_start`, `period_end`, `source`,
 * `note`. `period` alone (a single date) counts as both start and end. Rows
 * that cannot be read are returned as problems with their line number, and
 * the good rows still import — a founder pasting from a spreadsheet should
 * not lose thirty rows to one typo.
 */

import { isIsoDate } from "./week";

export interface CsvMetricRow {
    line: number;
    metric: string;
    value: number;
    periodStart: string;
    periodEnd: string;
    source: string | null;
    note: string | null;
}

export interface CsvProblem {
    line: number;
    message: string;
}

export interface CsvParseResult {
    rows: CsvMetricRow[];
    problems: CsvProblem[];
}

const ALIASES: Record<string, string> = {
    metric: "metric",
    key: "metric",
    name: "metric",
    metric_key: "metric",
    value: "value",
    count: "value",
    number: "value",
    period_start: "periodStart",
    start: "periodStart",
    from: "periodStart",
    period_end: "periodEnd",
    end: "periodEnd",
    to: "periodEnd",
    period: "period",
    date: "period",
    week: "period",
    source: "source",
    note: "note",
    notes: "note",
};

/** RFC-4180-ish line split: quoted fields may hold commas and doubled quotes. */
export function splitCsvLine(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quoted) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === delimiter) {
            cells.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells.map(c => c.trim());
}

function detectDelimiter(header: string): string {
    const tabs = (header.match(/\t/g) ?? []).length;
    const semis = (header.match(/;/g) ?? []).length;
    const commas = (header.match(/,/g) ?? []).length;
    if (tabs > commas && tabs > semis) return "\t";
    if (semis > commas) return ";";
    return ",";
}

function normaliseHeader(cell: string): string {
    return cell
        .trim()
        .toLowerCase()
        .replace(/^﻿/, "")
        .replace(/[\s-]+/g, "_");
}

/** "1,200" → 1200, "12.5%" → 12.5, "€40" → 40. */
export function parseNumber(raw: string): number | null {
    const cleaned = raw.replace(/[^\d.\-eE]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

export function parseMetricCsv(text: string): CsvParseResult {
    const lines = text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(l => l.trimEnd());
    const first = lines.findIndex(l => l.trim() !== "");
    if (first === -1) return { rows: [], problems: [{ line: 1, message: "The file is empty." }] };

    const delimiter = detectDelimiter(lines[first]!);
    const header = splitCsvLine(lines[first]!, delimiter).map(normaliseHeader);
    const columns = header.map(h => ALIASES[h] ?? null);

    const has = (name: string) => columns.includes(name);
    if (!has("metric") || !has("value")) {
        return {
            rows: [],
            problems: [
                {
                    line: first + 1,
                    message:
                        "The header needs a `metric` column and a `value` column (and `period` or `period_start`/`period_end`).",
                },
            ],
        };
    }
    if (!has("period") && !(has("periodStart") && has("periodEnd"))) {
        return {
            rows: [],
            problems: [
                {
                    line: first + 1,
                    message:
                        "Every number needs its period: add a `period` column (one date) or `period_start` and `period_end`.",
                },
            ],
        };
    }

    const rows: CsvMetricRow[] = [];
    const problems: CsvProblem[] = [];
    for (let i = first + 1; i < lines.length; i++) {
        const raw = lines[i]!;
        if (raw.trim() === "") continue;
        const line = i + 1;
        const cells = splitCsvLine(raw, delimiter);
        const record: Record<string, string> = {};
        columns.forEach((name, idx) => {
            if (name) record[name] = cells[idx] ?? "";
        });

        const metric = (record.metric ?? "").trim();
        if (!metric) {
            problems.push({ line, message: "Missing metric." });
            continue;
        }
        const value = parseNumber(record.value ?? "");
        if (value === null) {
            problems.push({ line, message: `"${record.value ?? ""}" is not a number.` });
            continue;
        }
        const periodStart = (record.periodStart ?? record.period ?? "").trim();
        const periodEnd = (record.periodEnd ?? record.period ?? "").trim();
        if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) {
            problems.push({
                line,
                message: `Period must be YYYY-MM-DD (got "${periodStart || "?"}" to "${periodEnd || "?"}").`,
            });
            continue;
        }
        if (periodEnd < periodStart) {
            problems.push({ line, message: "The period ends before it starts." });
            continue;
        }
        rows.push({
            line,
            metric,
            value,
            periodStart,
            periodEnd,
            source: (record.source ?? "").trim() || null,
            note: (record.note ?? "").trim() || null,
        });
    }
    return { rows, problems };
}
