/**
 * Wire shapes for `/api/extraction/*`, shared by the server views and the
 * Extract tool. Field, cell and status types come from the vertical.
 *
 * Routes:
 *   GET    /api/extraction                 → { tables: ExtractionTableSummary[] }
 *   POST   /api/extraction                 ← CreateExtractionBody → { table: ExtractionTableView } (201)
 *   GET    /api/extraction/sources         → { sources: ExtractionSourceOption[] }  (what the viewer may read)
 *   GET    /api/extraction/:id             → { table: ExtractionTableView }  (poll while unfinished)
 *   PATCH  /api/extraction/:id             ← { title?: string; shared?: boolean } → { table: ExtractionTableView }
 *   DELETE /api/extraction/:id             → { ok: true }
 *   POST   /api/extraction/:id/cancel      → { table: ExtractionTableView }
 *   POST   /api/extraction/:id/rerun       ← { rowIds?: number[] } (default: every failed row) → { table: ExtractionTableView }
 *   GET    /api/extraction/:id/export?format=csv|xlsx → the file (Content-Disposition: attachment)
 *
 * Errors are `{ error: string; code?: string }` with a 4xx/5xx status.
 */
import type {
    ExtractionCells,
    ExtractionField,
    ExtractionFieldType,
    ExtractionRowStatus,
    ExtractionTableStatus,
    ExtractionUsage,
} from "@launchstack/pipelines/extraction/types";

export type {
    ExtractionCell,
    ExtractionCells,
    ExtractionField,
    ExtractionFieldType,
    ExtractionRowStatus,
    ExtractionTableStatus,
    ExtractionUsage,
    ExtractionValue,
} from "@launchstack/pipelines/extraction/types";
export { EXTRACTION_FIELD_TYPES, EXTRACTION_LIMITS } from "@launchstack/pipelines/extraction/types";

export interface ExtractionCounts {
    total: number;
    pending: number;
    running: number;
    done: number;
    failed: number;
}

export interface ExtractionTableSummary {
    id: number;
    title: string;
    status: ExtractionTableStatus;
    fieldCount: number;
    counts: ExtractionCounts;
    /** ISO timestamps. */
    createdAt: string;
    finishedAt: string | null;
    /** True when the viewer created it. */
    mine: boolean;
    /** Shared with the whole workspace. */
    shared: boolean;
    /** Display name of the creator; null when the viewer may not see it. */
    createdByName: string | null;
}

export interface ExtractionRowView {
    id: number;
    documentId: number;
    /** The workspace source id used in links and chat chips ("d12"). */
    sourceId: string;
    title: string;
    status: ExtractionRowStatus;
    cells: ExtractionCells;
    /** Why the row failed, in the reader's language. */
    error: string | null;
    /** False when the viewer may not open the document; cells are then withheld (empty). */
    readable: boolean;
}

export interface ExtractionTableView extends ExtractionTableSummary {
    fields: ExtractionField[];
    rows: ExtractionRowView[];
    usage: ExtractionUsage;
    /** Why the table failed, in the reader's language. */
    error: string | null;
    /** The viewer may rename, share, cancel, re-run and delete. */
    canManage: boolean;
}

export interface CreateExtractionFieldInput {
    name: string;
    type: ExtractionFieldType;
    instruction?: string;
}

export interface CreateExtractionBody {
    title?: string;
    fields: CreateExtractionFieldInput[];
    /** Numeric document ids (the number in a source id: "d12" → 12). */
    documentIds: number[];
}

/** A document the viewer can put in a table. */
export interface ExtractionSourceOption {
    documentId: number;
    sourceId: string;
    title: string;
    /** Folder path ("Clients/Acme"), or null when unfiled. */
    folder: string | null;
    /** File kind for the icon: "pdf", "image", "docx", … */
    kind: string;
    /** False while the document is still being processed; it can't be chosen yet. */
    indexed: boolean;
}
