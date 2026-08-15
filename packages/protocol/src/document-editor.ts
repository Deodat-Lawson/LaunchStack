/**
 * HTTP contract for `services/document-editor` (ADR-004) — the authoritative
 * Adeu DOCX-redlining service. Mirrors `app/schemas/adeu.py` byte-for-byte
 * (snake_case wire format); the Python side validates against the JSON
 * Schemas generated from these definitions.
 */
import { z } from "zod";

export const documentEditSchema = z.object({
    /** Exact text to find in the document. */
    target_text: z.string(),
    /** Replacement text. */
    new_text: z.string(),
    /** Comment bubble text. */
    comment: z.string().nullable().optional(),
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
