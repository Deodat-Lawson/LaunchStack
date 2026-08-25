/**
 * HTTP contract for `services/document-editor` (ADR-004) — the authoritative
 * Adeu DOCX-redlining service. Mirrors `app/schemas/adeu.py` byte-for-byte
 * (snake_case wire format); the Python side validates against the JSON
 * Schemas generated from these definitions.
 */
import { z } from "zod";

/** A document identified by URL rather than uploaded inline (ADR-004 §6). */
export const objectRefSchema = z.object({
    url: z.string().min(1),
    filename: z.string().nullable().optional(),
});
export type ObjectRef = z.infer<typeof objectRefSchema>;

export const matchModeSchema = z.enum(["strict", "first", "all"]);
export type MatchMode = z.infer<typeof matchModeSchema>;

export const documentEditSchema = z.object({
    /** Exact text to find in the document. */
    target_text: z.string(),
    /** Replacement text. */
    new_text: z.string(),
    /** Comment bubble text. */
    comment: z.string().nullable().optional(),
    /**
     * How to resolve a target that appears more than once. `strict` (adeu's
     * default) fails on ambiguity rather than guessing which occurrence was
     * meant.
     */
    match_mode: matchModeSchema.nullable().optional(),
});
export type DocumentEdit = z.infer<typeof documentEditSchema>;

export const reviewActionTypeSchema = z.enum(["ACCEPT", "REJECT", "REPLY"]);
export type ReviewActionType = z.infer<typeof reviewActionTypeSchema>;

export const reviewActionSchema = z.object({
    action: reviewActionTypeSchema,
    /** Target ID (e.g. "Chg:1" or "Com:5"). */
    target_id: z.string(),
    /** Reply body text. */
    text: z.string().nullable().optional(),
    /** Rationale for accept/reject. */
    comment: z.string().nullable().optional(),
});
export type ReviewAction = z.infer<typeof reviewActionSchema>;

export const readDocxResponseSchema = z.object({
    text: z.string(),
    filename: z.string(),
});
export type ReadDocxResponse = z.infer<typeof readDocxResponseSchema>;

export const processBatchRequestSchema = z.object({
    author_name: z.string().min(1),
    edits: z.array(documentEditSchema).nullable().optional(),
    actions: z.array(reviewActionSchema).nullable().optional(),
    /**
     * Apply what validates and report the rest, instead of rejecting the whole
     * batch. Off by default — all-or-nothing is the safer default for an
     * automated caller.
     */
    partial: z.boolean().optional(),
    /** Let adeu expand ambiguous targets with surrounding context. */
    self_contained: z.boolean().optional(),
    /** Fetch the document from an allow-listed URL instead of uploading it. */
    source: objectRefSchema.nullable().optional(),
});
export type ProcessBatchRequest = z.infer<typeof processBatchRequestSchema>;

export const batchSummarySchema = z.object({
    applied_edits: z.number().int().nonnegative(),
    skipped_edits: z.number().int().nonnegative(),
    applied_actions: z.number().int().nonnegative(),
    skipped_actions: z.number().int().nonnegative(),
});
export type BatchSummary = z.infer<typeof batchSummarySchema>;

export const applyEditsMarkdownRequestSchema = z.object({
    edits: z.array(documentEditSchema),
    highlight_only: z.boolean().default(false),
    include_index: z.boolean().default(false),
    /** Fetch the document from an allow-listed URL instead of uploading it. */
    source: objectRefSchema.nullable().optional(),
});
export type ApplyEditsMarkdownRequest = z.infer<typeof applyEditsMarkdownRequestSchema>;

export const applyEditsMarkdownResponseSchema = z.object({
    markdown: z.string(),
});
export type ApplyEditsMarkdownResponse = z.infer<typeof applyEditsMarkdownResponseSchema>;

export const diffResponseSchema = z.object({
    diff: z.string(),
    has_differences: z.boolean(),
});
export type DiffResponse = z.infer<typeof diffResponseSchema>;

export const editorErrorResponseSchema = z.object({
    detail: z.string(),
    errors: z.array(z.string()).nullable().optional(),
});
export type EditorErrorResponse = z.infer<typeof editorErrorResponseSchema>;

// --- review model (adeu 2.4) -------------------------------------------------
//
// Review actions address changes by ids like `Chg:12`, but until the editor
// service grew a `/adeu/review-items` route nothing handed a caller that list:
// the ids exist only inside adeu's CriticMarkup output. These are the shapes
// that make ACCEPT / REJECT / REPLY callable from a UI.

export const reviewItemKindSchema = z.enum(["insert", "delete", "format", "comment"]);
export type ReviewItemKind = z.infer<typeof reviewItemKindSchema>;

export const reviewItemSchema = z.object({
    /** adeu revision id, e.g. "Chg:12" or "Com:5". Round-trips as target_id. */
    id: z.string(),
    kind: reviewItemKindSchema,
    author: z.string(),
    date: z.string().nullable().optional(),
    /** Changed text, or the comment body. */
    text: z.string(),
    /** Document text the item attaches to. */
    anchor_text: z.string(),
    /**
     * Id of the revision this one resolves with. A replacement is a
     * delete+insert pair: resolving either resolves both, so a UI must present
     * them as a single decision rather than two.
     */
    paired_with: z.string().nullable().optional(),
    /** Character offset in the CriticMarkup text. */
    offset: z.number().int().nonnegative(),
    context: z.string(),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const reviewItemsResponseSchema = z.object({
    filename: z.string(),
    items: z.array(reviewItemSchema),
    authors: z.array(z.string()),
    change_count: z.number().int().nonnegative(),
    comment_count: z.number().int().nonnegative(),
});
export type ReviewItemsResponse = z.infer<typeof reviewItemsResponseSchema>;

// --- per-edit batch reporting ------------------------------------------------

export const editReportSchema = z
    .object({
        index: z.number().int().nullable().optional(),
        status: z.string().nullable().optional(),
        target_text: z.string().nullable().optional(),
        new_text: z.string().nullable().optional(),
        reason: z.string().nullable().optional(),
        occurrences_modified: z.number().int().nullable().optional(),
        heading_path: z.string().nullable().optional(),
        page: z.number().int().nullable().optional(),
    })
    .passthrough();
export type EditReport = z.infer<typeof editReportSchema>;

export const failedEditSchema = z
    .object({
        index: z.number().int().nullable().optional(),
        reason: z.string(),
    })
    .passthrough();
export type FailedEdit = z.infer<typeof failedEditSchema>;

export const batchResultSchema = z.object({
    status: z.string(),
    /** Frozen v1 counts, kept so pre-2.4 callers are unaffected. */
    summary: batchSummarySchema,
    edits: z.array(editReportSchema),
    failed: z.array(failedEditSchema),
    skipped_details: z.array(z.string()),
    occurrences_modified: z.number().int().nonnegative(),
    actions_already_resolved: z.number().int().nonnegative(),
    author_impersonation_warning: z.string().nullable().optional(),
    adeu_version: z.string().nullable().optional(),
});
export type BatchResult = z.infer<typeof batchResultSchema>;

export const processBatchJsonResponseSchema = z.object({
    document_base64: z.string(),
    filename: z.string(),
    result: batchResultSchema,
});
export type ProcessBatchJsonResponse = z.infer<typeof processBatchJsonResponseSchema>;
