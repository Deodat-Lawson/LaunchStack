/**
 * Extraction tables, as the API routes and Ask's table tool use them.
 * Access rules:
 *
 * - Making a table and running rows again take `documents.read` (the same
 *   gate as Ask; both spend the person's AI allowance).
 * - A table is private to its creator until they share it with the whole
 *   workspace. Anyone else gets 404 for a private table. Only the creator
 *   renames, shares, cancels, re-runs or deletes.
 * - A table holds only documents its creator could read when they made it,
 *   and the run reads each one under the creator's access again
 *   (`./documents`). A reader of a shared table sees a row's title and cells
 *   only for documents they can open themselves (`./views`).
 */
import {
    EXTRACTION_FIELD_TYPES,
    EXTRACTION_LIMITS,
    type ExtractionField,
    type ExtractionFieldType,
    type ExtractionTableRecord,
} from "@launchstack/pipelines/extraction/types";
import { createExtractionStore } from "@launchstack/pipelines/extraction/db";

import { copy, type Copy, type CopyValues, type MessageKey } from "~/i18n/copy";
import type { Locale } from "~/i18n/locales";
import type { Messages } from "~/i18n/messages";
import { englishCopy, translatorFor } from "~/i18n/translate";
import type {
    CreateExtractionBody,
    ExtractionSourceOption,
    ExtractionTableSummary,
    ExtractionTableView,
} from "~/lib/extraction/types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { assertWithinAiAllowance } from "~/server/ai-usage/refusal";
import { workspaceLooks } from "~/server/profile/store";

import type { ExtractionTableOutline } from "./chat";
import { dispatchTable, readExtractionExecutor, resumeIfStalled } from "./executor";
import {
    attachmentDisposition,
    EXPORT_CONTENT_TYPES,
    exportFileName,
    tableToCsv,
    tableToXlsx,
    type ExportFormat,
    type ExportLabels,
} from "./export";
import { sourceKindOf } from "./kinds";
import {
    countRowsByTable,
    deleteTable,
    EMPTY_COUNTS,
    getCompanyTable,
    insertTable,
    listReadableSourceRows,
    listTableRows,
    listVisibleTables,
    readableDocuments,
    requestCancel,
    requeueRows,
    updateTableMeta,
} from "./store";
import { leftWorkspaceName, toSummary, toView } from "./views";

/**
 * An expected failure with its status and machine `code`. The sentence is a
 * `Copy`: `message` is its English, and the route words it in the reader's
 * language (`handleExtractionError`).
 */
export class ExtractionError extends Error {
    readonly copy: Copy;

    constructor(
        message: Copy,
        readonly status: number,
        readonly code: string
    ) {
        super(englishCopy(message));
        this.name = "ExtractionError";
        this.copy = message;
    }
}

type ErrorName = keyof Messages["extractServer"]["errors"];

/** One of `extractServer.errors`, as a Copy. */
export const extractionErrorCopy = (name: ErrorName, values?: CopyValues): Copy =>
    copy(`extractServer.errors.${name}` as MessageKey, values);

const fail = (name: ErrorName, status: number, code: string, values?: CopyValues) =>
    new ExtractionError(extractionErrorCopy(name, values), status, code);

const notFound = () => fail("notFound", 404, "not_found");
const notCreator = () => fail("notCreator", 403, "forbidden");

type Ctx = Pick<WorkspaceContext, "authUserId" | "companyId" | "can" | "documentScope">;

async function namesFor(
    companyId: bigint,
    ids: Iterable<string>,
    locale: Locale
): Promise<Map<string, string>> {
    const looks = await workspaceLooks(companyId, ids);
    const out = new Map<string, string>();
    for (const [id, look] of looks)
        out.set(id, look.member ? look.displayName : leftWorkspaceName(locale));
    return out;
}

/** The table if the viewer may read it: their own, or shared with the workspace. */
async function readableTable(ctx: Ctx, id: number): Promise<ExtractionTableRecord> {
    const table = await getCompanyTable(ctx.companyId, id);
    if (!table) throw notFound();
    if (table.createdByUserId !== ctx.authUserId && !table.sharedAt) throw notFound();
    return table;
}

async function ownTable(ctx: Ctx, id: number): Promise<ExtractionTableRecord> {
    const table = await readableTable(ctx, id);
    if (table.createdByUserId !== ctx.authUserId) throw notCreator();
    return table;
}

function requireRead(ctx: Ctx): void {
    if (!ctx.can("documents.read")) throw fail("roleCantRun", 403, "forbidden");
}

const isUnfinished = (table: Pick<ExtractionTableRecord, "status">) =>
    table.status === "queued" || table.status === "running";

// ─── Validation ──────────────────────────────────────────────────────────────

/** The fields of a new table, checked against the limits, with ids "f1", "f2", … */
export function cleanFields(raw: unknown): ExtractionField[] {
    const list: unknown[] = Array.isArray(raw) ? raw : [];
    if (list.length === 0) throw fail("addField", 400, "invalid");
    if (list.length > EXTRACTION_LIMITS.maxFields) {
        throw fail("tooManyFields", 400, "invalid", { max: EXTRACTION_LIMITS.maxFields });
    }
    const seen = new Set<string>();
    return list.map((item, index) => {
        const input = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
        if (!name) throw fail("fieldNameEmpty", 400, "invalid");
        if (name.length > EXTRACTION_LIMITS.fieldNameLength) {
            throw fail("fieldNameTooLong", 400, "invalid", {
                max: EXTRACTION_LIMITS.fieldNameLength,
            });
        }
        const key = name.toLocaleLowerCase();
        if (seen.has(key)) throw fail("fieldNameRepeated", 400, "invalid", { name });
        seen.add(key);
        if (!(EXTRACTION_FIELD_TYPES as readonly unknown[]).includes(input.type)) {
            throw fail("fieldTypeInvalid", 400, "invalid", { name });
        }
        const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
        if (instruction.length > EXTRACTION_LIMITS.instructionLength) {
            throw fail("instructionTooLong", 400, "invalid", {
                max: EXTRACTION_LIMITS.instructionLength,
            });
        }
        return {
            id: `f${index + 1}`,
            name,
            type: input.type as ExtractionFieldType,
            ...(instruction ? { instruction } : {}),
        };
    });
}

/** The picked document ids: positive integers, each once, within the limit. */
export function cleanDocumentIds(raw: unknown): number[] {
    const list: unknown[] = Array.isArray(raw) ? raw : [];
    const ids = [
        ...new Set(
            list.filter(
                (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
            )
        ),
    ];
    if (ids.length === 0) throw fail("pickDocuments", 400, "invalid");
    if (ids.length > EXTRACTION_LIMITS.maxDocuments) {
        throw fail("tooManyDocuments", 400, "invalid", { max: EXTRACTION_LIMITS.maxDocuments });
    }
    return ids;
}

/** A table named after its fields: "Party, Term, Fee" or "Party, Term, Fee and 4 more". */
export function defaultTitle(fields: readonly ExtractionField[], locale: Locale = "en"): string {
    const t = translatorFor(locale, "extractServer.defaultTitle");
    const first = fields
        .slice(0, 3)
        .map(field => field.name)
        .join(t("separator"));
    const title =
        fields.length > 3 ? t("more", { fields: first, count: fields.length - 3 }) : first;
    return title.slice(0, EXTRACTION_LIMITS.titleLength);
}

function cleanTitle(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    return raw.replace(/\s+/g, " ").trim().slice(0, EXTRACTION_LIMITS.titleLength);
}

// ─── Views ───────────────────────────────────────────────────────────────────

async function viewOf(
    ctx: Ctx,
    table: ExtractionTableRecord,
    locale: Locale
): Promise<ExtractionTableView> {
    const rows = await listTableRows(table.id);
    const [readable, names] = await Promise.all([
        ctx
            .documentScope()
            .then(scope =>
                readableDocuments(ctx.companyId, scope, [
                    ...new Set(rows.map(row => row.documentId)),
                ])
            ),
        namesFor(ctx.companyId, [table.createdByUserId], locale),
    ]);
    return toView(table, rows, {
        viewerUserId: ctx.authUserId,
        names,
        readableIds: new Set(readable.map(doc => doc.id)),
        locale,
    });
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createExtractionTable(
    ctx: Ctx,
    input: Partial<CreateExtractionBody>,
    locale: Locale = "en"
): Promise<ExtractionTableView> {
    requireRead(ctx);
    const fields = cleanFields(input.fields);
    const picked = cleanDocumentIds(input.documentIds);
    // Documents the creator can't open are dropped here, and checked again
    // each time the run reads one.
    const readable = new Map(
        (await readableDocuments(ctx.companyId, await ctx.documentScope(), picked)).map(doc => [
            doc.id,
            doc,
        ])
    );
    const documents = picked.flatMap(id => readable.get(id) ?? []);
    if (documents.length === 0) throw fail("noReadableDocuments", 400, "no_documents");

    // Before anything is stored: a person at their AI limit gets the 429 now.
    await assertWithinAiAllowance(ctx.companyId, ctx.authUserId);

    const given = cleanTitle(input.title);
    const title = given !== undefined && given.length > 0 ? given : defaultTitle(fields, locale);
    const table = await insertTable({
        companyId: ctx.companyId,
        createdByUserId: ctx.authUserId,
        title,
        fields,
        documents,
    });
    await dispatchTable(table);
    return viewOf(ctx, table, locale);
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listExtractionTables(
    ctx: Ctx,
    locale: Locale = "en"
): Promise<ExtractionTableSummary[]> {
    const tables = await listVisibleTables(ctx.companyId, ctx.authUserId);
    // A table whose executor went away (a restart) shows as running here for
    // good unless someone opens it; looking at the list is enough to resume it.
    for (const table of tables) resumeIfStalled(table);
    const [counts, names] = await Promise.all([
        countRowsByTable(tables.map(table => table.id)),
        namesFor(
            ctx.companyId,
            tables.map(table => table.createdByUserId),
            locale
        ),
    ]);
    return tables.map(table =>
        toSummary(table, counts.get(table.id) ?? { ...EMPTY_COUNTS }, ctx.authUserId, names, locale)
    );
}

/** The visible tables with their field names, for Ask's table tool. */
export async function listExtractionTableOutlines(
    ctx: Ctx,
    locale: Locale = "en"
): Promise<ExtractionTableOutline[]> {
    const tables = await listVisibleTables(ctx.companyId, ctx.authUserId);
    const [counts, names] = await Promise.all([
        countRowsByTable(tables.map(table => table.id)),
        namesFor(
            ctx.companyId,
            tables.map(table => table.createdByUserId),
            locale
        ),
    ]);
    return tables.map(table => ({
        id: table.id,
        title: table.title,
        status: table.status,
        fields: table.fields.map(field => field.name),
        counts: counts.get(table.id) ?? { ...EMPTY_COUNTS },
        mine: table.createdByUserId === ctx.authUserId,
        createdByName: names.get(table.createdByUserId) ?? leftWorkspaceName(locale),
    }));
}

/** The table as the viewer may see it, or null: missing and private read alike. */
export async function findExtractionTable(
    ctx: Ctx,
    id: number,
    locale: Locale = "en"
): Promise<ExtractionTableView | null> {
    try {
        return await getExtractionTable(ctx, id, locale);
    } catch (error) {
        if (error instanceof ExtractionError && error.status === 404) return null;
        throw error;
    }
}

export async function getExtractionTable(
    ctx: Ctx,
    id: number,
    locale: Locale = "en"
): Promise<ExtractionTableView> {
    return viewOf(ctx, await readableTable(ctx, id), locale);
}

/**
 * The table for the screen that polls it. A table whose in-process executor
 * went away (a restart, a crash) is picked up again here.
 */
export async function pollExtractionTable(
    ctx: Ctx,
    id: number,
    locale: Locale = "en"
): Promise<ExtractionTableView> {
    const table = await readableTable(ctx, id);
    resumeIfStalled(table);
    return viewOf(ctx, table, locale);
}

/** What the viewer can put in a table: every document they can read, newest first. */
export async function extractionSourceOptions(ctx: Ctx): Promise<ExtractionSourceOption[]> {
    const rows = await listReadableSourceRows(ctx.companyId, await ctx.documentScope());
    return rows.map(row => ({
        documentId: row.id,
        sourceId: `d${row.id}`,
        title: row.title,
        folder: row.folder || null,
        kind: sourceKindOf(row),
        indexed: row.processed,
    }));
}

// ─── Manage ──────────────────────────────────────────────────────────────────

export async function updateExtractionTable(
    ctx: Ctx,
    id: number,
    patch: { title?: unknown; shared?: unknown },
    locale: Locale = "en"
): Promise<ExtractionTableView> {
    await ownTable(ctx, id);
    const title = cleanTitle(patch.title);
    if (title !== undefined && !title) throw fail("titleEmpty", 400, "invalid");
    const shared = typeof patch.shared === "boolean" ? patch.shared : undefined;
    await updateTableMeta(ctx.companyId, id, { title, shared }, new Date());
    return getExtractionTable(ctx, id, locale);
}

export async function deleteExtractionTable(ctx: Ctx, id: number): Promise<void> {
    await ownTable(ctx, id);
    await deleteTable(ctx.companyId, id);
}

export async function cancelExtractionTable(
    ctx: Ctx,
    id: number,
    locale: Locale = "en"
): Promise<ExtractionTableView> {
    const table = await ownTable(ctx, id);
    if (isUnfinished(table)) {
        const now = new Date();
        await requestCancel(ctx.companyId, id, now);
        // No live in-process executor: nothing will look at the flag, so stop it here.
        const held = table.leaseUntil && table.leaseUntil.getTime() > now.getTime();
        if (!held && readExtractionExecutor() === "inline") {
            await createExtractionStore().finish(id, "cancelled", null, now);
        }
    }
    return getExtractionTable(ctx, id, locale);
}

/**
 * Run rows again: the ones named, or every failed row. They go back to
 * pending with their cells kept, and the table back to queued. Refused while
 * the table is still running.
 */
export async function rerunExtractionTable(
    ctx: Ctx,
    id: number,
    rowIdsRaw: unknown,
    locale: Locale = "en"
): Promise<ExtractionTableView> {
    requireRead(ctx);
    const table = await ownTable(ctx, id);
    if (isUnfinished(table)) throw fail("stillRunning", 409, "still_running");
    let rowIds: number[] | null = null;
    if (rowIdsRaw !== undefined && rowIdsRaw !== null) {
        const list: unknown[] = Array.isArray(rowIdsRaw) ? rowIdsRaw : [];
        rowIds = [
            ...new Set(
                list.filter(
                    (rowId): rowId is number =>
                        typeof rowId === "number" && Number.isSafeInteger(rowId) && rowId > 0
                )
            ),
        ];
        if (rowIds.length === 0) throw fail("nothingToRerun", 400, "invalid");
    }
    await assertWithinAiAllowance(ctx.companyId, ctx.authUserId);
    const requeued = await requeueRows(ctx.companyId, id, rowIds);
    if (requeued === 0) {
        // Nothing matched, or another request re-queued the table first.
        const fresh = await getCompanyTable(ctx.companyId, id);
        if (fresh && isUnfinished(fresh)) throw fail("stillRunning", 409, "still_running");
        throw fail("nothingToRerun", 409, "nothing_to_rerun");
    }
    await dispatchTable(table);
    return getExtractionTable(ctx, id, locale);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function isExportFormat(value: unknown): value is ExportFormat {
    return value === "csv" || value === "xlsx";
}

export function exportLabels(locale: Locale = "en"): ExportLabels {
    const t = translatorFor(locale, "extractServer.export");
    return {
        results: t("results"),
        evidence: t("evidence"),
        document: t("document"),
        field: t("field"),
        value: t("value"),
        quote: t("quote"),
        page: t("page"),
        readFrom: t("readFrom"),
        yes: t("yes"),
        no: t("no"),
        text: t("text"),
        image: t("image"),
        fileName: t("fileName"),
    };
}

export interface ExtractionExport {
    body: string | Buffer;
    contentType: string;
    /** The whole Content-Disposition value. */
    disposition: string;
}

/** The table as the viewer sees it, as a file. Rows they can't open are left out. */
export async function exportExtractionTable(
    ctx: Ctx,
    id: number,
    format: unknown,
    locale: Locale = "en"
): Promise<ExtractionExport> {
    if (!isExportFormat(format)) throw fail("formatInvalid", 400, "invalid");
    const view = await getExtractionTable(ctx, id, locale);
    const labels = exportLabels(locale);
    return {
        body: format === "csv" ? tableToCsv(view, labels) : tableToXlsx(view, labels),
        contentType: EXPORT_CONTENT_TYPES[format],
        disposition: attachmentDisposition(exportFileName(view.title, format, labels.fileName)),
    };
}
