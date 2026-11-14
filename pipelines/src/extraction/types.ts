import type { ZodType } from "zod";

/**
 * The extraction vertical: one set of fields read out of many documents.
 *
 * A table is a list of fields (the columns) and a set of documents (the
 * rows). Each cell is what one document says for one field, with the
 * sentence it came from. Everything here is plain JSON so the same shapes
 * serve the database, the engine and the wire.
 */

export const EXTRACTION_FIELD_TYPES = ["text", "number", "date", "boolean", "list"] as const;
export type ExtractionFieldType = (typeof EXTRACTION_FIELD_TYPES)[number];

export const EXTRACTION_TABLE_STATUSES = [
    "queued",
    "running",
    "done",
    "failed",
    "cancelled",
] as const;
export type ExtractionTableStatus = (typeof EXTRACTION_TABLE_STATUSES)[number];

export const EXTRACTION_ROW_STATUSES = ["pending", "running", "done", "failed"] as const;
export type ExtractionRowStatus = (typeof EXTRACTION_ROW_STATUSES)[number];

/** Limits enforced where a table is created; the engine assumes them. */
export const EXTRACTION_LIMITS = {
    maxFields: 30,
    maxDocuments: 500,
    fieldNameLength: 80,
    instructionLength: 500,
    titleLength: 200,
    /** Characters of quote kept per cell. */
    quoteLength: 300,
    /** Characters of a text value kept per cell. */
    valueLength: 1000,
    /** Items kept in a list value. */
    listItems: 50,
} as const;

/** One column. `id` is stable for the life of the table ("f1", "f2", …). */
export interface ExtractionField {
    id: string;
    name: string;
    type: ExtractionFieldType;
    /** What to look for, in the author's words. Optional. */
    instruction?: string;
}

export type ExtractionValue = string | number | boolean | string[] | null;

/**
 * One cell.
 *
 * - `found`: a value, with the quote it rests on. For `via: "text"` the quote
 *   was checked to appear verbatim in the document's text; a value whose quote
 *   does not appear is never stored as found.
 * - `not_found`: the document does not say (or the model's answer could not
 *   be tied to the text). `value` and `quote` are null.
 *
 * `via: "vision"` means the value was read from the image itself because the
 * text had nothing; its quote is the model's transcription and cannot be
 * checked against text.
 */
export interface ExtractionCell {
    status: "found" | "not_found";
    value: ExtractionValue;
    quote: string | null;
    /** 1-based page of the quote when known. */
    page: number | null;
    via: "text" | "vision";
}

/** Cells of one row, keyed by field id. A field with no key has not been read yet. */
export type ExtractionCells = Record<string, ExtractionCell>;

export interface ExtractionUsage {
    calls: number;
    inputTokens: number;
    outputTokens: number;
}

export const EMPTY_EXTRACTION_USAGE: ExtractionUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
};

/** A passage of a document, in reading order. */
export interface ExtractionPassage {
    text: string;
    /** 1-based page when the source has pages. */
    page: number | null;
}

/** What the engine is handed for one document. */
export interface ExtractionDocument {
    title: string;
    passages: ExtractionPassage[];
    /** True when the source file is an image (png, jpg, tiff, webp, gif, bmp). */
    isImage: boolean;
}

/** A table as the engine and the app's server code see it. */
export interface ExtractionTableRecord {
    id: number;
    companyId: bigint;
    createdByUserId: string;
    title: string;
    fields: ExtractionField[];
    status: ExtractionTableStatus;
    usage: ExtractionUsage;
    error: string | null;
    sharedAt: Date | null;
    cancelRequestedAt: Date | null;
    leaseUntil: Date | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
}

export interface ExtractionRowRecord {
    id: number;
    tableId: number;
    companyId: bigint;
    documentId: number;
    /** The document's title when the row was made; kept if the document is renamed. */
    documentTitle: string;
    status: ExtractionRowStatus;
    cells: ExtractionCells;
    error: string | null;
    attempts: number;
}

/**
 * The structured model call the host provides. `schema` is a zod schema; the
 * result is typed by it. Throws on failure.
 */
export type ExtractStructuredFn = <T>(args: {
    system: string;
    prompt: string;
    schema: ZodType<T>;
    schemaName: string;
}) => Promise<{ result: T; usage: { inputTokens: number; outputTokens: number } }>;

/**
 * Reads the listed fields straight from an image document with a vision
 * model. Returns null when no vision-capable model is available, in which
 * case the cells stay `not_found`.
 */
export type ReadImageFieldsFn = (args: {
    table: ExtractionTableRecord;
    row: ExtractionRowRecord;
    fields: ExtractionField[];
}) => Promise<{
    cells: ExtractionCells;
    usage: { inputTokens: number; outputTokens: number };
} | null>;

/** Storage the engine needs. Implemented in `./db.ts`. */
export interface ExtractionStore {
    getTable(tableId: number): Promise<ExtractionTableRecord | null>;
    /** Queued → running, stamping startedAt. No-op in any other state. */
    markRunning(tableId: number, now: Date): Promise<void>;
    /**
     * Atomically claim up to `limit` pending rows (pending → running,
     * attempts + 1) and return them. Two callers never get the same row.
     */
    claimRows(tableId: number, limit: number): Promise<ExtractionRowRecord[]>;
    /** Running → done with its cells. */
    completeRow(rowId: number, cells: ExtractionCells): Promise<void>;
    /** Running → failed with the reason. */
    failRow(rowId: number, error: string): Promise<void>;
    /** Rows left in `running` by a process that died go back to pending. */
    releaseRunningRows(tableId: number): Promise<number>;
    addUsage(tableId: number, usage: ExtractionUsage): Promise<void>;
    countRows(tableId: number): Promise<Record<ExtractionRowStatus, number>>;
    /** Ends the table; a no-op if it already ended. */
    finish(
        tableId: number,
        status: "done" | "failed" | "cancelled",
        error: string | null,
        now: Date
    ): Promise<void>;
}

export interface ExtractionPorts {
    store: ExtractionStore;
    /**
     * The document's text under the table creator's access. Null when the
     * document is gone or the creator may no longer read it; the row fails
     * with a plain reason.
     */
    readDocument(
        table: ExtractionTableRecord,
        row: ExtractionRowRecord
    ): Promise<ExtractionDocument | null>;
    extract: ExtractStructuredFn;
    /** Omitted when the host has no vision path. */
    readImageFields?: ReadImageFieldsFn;
    now(): Date;
    /** Documents read in parallel per unit. */
    concurrency: number;
    log(message: string, meta?: Record<string, unknown>): void;
}

/**
 * The result of one unit (`advanceTable`): one batch of rows.
 * - `advanced`: rows were processed and more may remain; call again.
 * - `finished`: the table reached done, failed or cancelled in this call.
 * - `skipped`: nothing to do (unknown table, or already ended).
 */
export type AdvanceTableOutcome =
    | { state: "advanced"; processed: number }
    | { state: "finished"; status: "done" | "failed" | "cancelled" }
    | { state: "skipped" };
