/**
 * Tables → the wire contract in `~/lib/extraction/types`, and the place a
 * shared table is redacted: a row whose document the reader can't open keeps
 * its place in the table but gives up its title, its cells and its error
 * (ADR-014). The same rule holds for the creator, whose access may have
 * shrunk since the run.
 *
 * With the reader's locale, the sentences the server composes — "Someone who
 * has left", a row's failure — are in their language; the stored records stay
 * English.
 */
import type {
    ExtractionRowRecord,
    ExtractionTableRecord,
} from "@launchstack/pipelines/extraction/types";

import type { Locale } from "~/i18n/locales";
import { translatorFor, wordEnglish } from "~/i18n/translate";
import type {
    ExtractionCounts,
    ExtractionRowView,
    ExtractionTableSummary,
    ExtractionTableView,
} from "~/lib/extraction/types";

export function leftWorkspaceName(locale: Locale = "en"): string {
    return translatorFor(locale, "extractServer")("leftWorkspace");
}

const COULD_NOT_READ = "This file could not be read";

/**
 * A row's failure for the reader. The engine stores English: its two fixed
 * sentences are worded in `locale`, and "This file could not be read: <the
 * provider's error>" is shown without the detail, which stays in the server
 * log. Anything else comes back as it was.
 */
export function rowErrorText(error: string | null, locale: Locale = "en"): string | null {
    if (!error) return null;
    if (error.startsWith(COULD_NOT_READ)) {
        return translatorFor(locale, "extractServer.rowErrors")("couldNotRead");
    }
    return locale === "en" ? error : wordEnglish(error, "extractServer.rowErrors", locale);
}

/** A table's failure in `locale` when it is one of the run's own sentences. */
export function tableErrorText(error: string | null, locale: Locale = "en"): string | null {
    if (!error || locale === "en") return error;
    return wordEnglish(error, "extractServer.tableErrors", locale);
}

export function countRows(rows: readonly Pick<ExtractionRowRecord, "status">[]): ExtractionCounts {
    const counts: ExtractionCounts = { total: 0, pending: 0, running: 0, done: 0, failed: 0 };
    for (const row of rows) {
        counts[row.status] += 1;
        counts.total += 1;
    }
    return counts;
}

export function toSummary(
    table: ExtractionTableRecord,
    counts: ExtractionCounts,
    viewerUserId: string,
    names: Map<string, string>,
    locale: Locale = "en"
): ExtractionTableSummary {
    return {
        id: table.id,
        title: table.title,
        status: table.status,
        fieldCount: table.fields.length,
        counts,
        createdAt: table.createdAt.toISOString(),
        finishedAt: table.finishedAt ? table.finishedAt.toISOString() : null,
        mine: table.createdByUserId === viewerUserId,
        shared: table.sharedAt !== null,
        createdByName: names.get(table.createdByUserId) ?? leftWorkspaceName(locale),
    };
}

export function toRowView(
    row: ExtractionRowRecord,
    readable: boolean,
    locale: Locale = "en"
): ExtractionRowView {
    const base = {
        id: row.id,
        documentId: row.documentId,
        sourceId: `d${row.documentId}`,
        status: row.status,
    };
    if (!readable) {
        return {
            ...base,
            title: translatorFor(locale, "extractServer")("withheldTitle"),
            cells: {},
            error: null,
            readable: false,
        };
    }
    return {
        ...base,
        title: row.documentTitle,
        cells: row.cells,
        error: rowErrorText(row.error, locale),
        readable: true,
    };
}

export function toView(
    table: ExtractionTableRecord,
    rows: readonly ExtractionRowRecord[],
    options: {
        viewerUserId: string;
        names: Map<string, string>;
        /** Documents among the rows' that the viewer can open. */
        readableIds: ReadonlySet<number>;
        locale?: Locale;
    }
): ExtractionTableView {
    const locale = options.locale ?? "en";
    return {
        ...toSummary(table, countRows(rows), options.viewerUserId, options.names, locale),
        fields: table.fields,
        rows: rows.map(row => toRowView(row, options.readableIds.has(row.documentId), locale)),
        usage: table.usage,
        error: tableErrorText(table.error, locale),
        canManage: table.createdByUserId === options.viewerUserId,
    };
}
