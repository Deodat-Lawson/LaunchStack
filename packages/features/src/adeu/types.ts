export type MatchMode = "strict" | "first" | "all";

export interface DocumentEdit {
    target_text: string;
    new_text: string;
    comment?: string;
    /** How to resolve a target that occurs more than once. Default "strict". */
    match_mode?: MatchMode;
}

/** A document identified by URL rather than uploaded inline (ADR-004 §6). */
export interface ObjectRef {
    url: string;
    filename?: string;
}

export type ReviewActionType = "ACCEPT" | "REJECT" | "REPLY";

export interface ReviewAction {
    action: ReviewActionType;
    target_id: string;
    text?: string;
    comment?: string;
}

export interface ReadDocxResponse {
    text: string;
    filename: string;
}

export interface ProcessBatchParams {
    author_name: string;
    edits?: DocumentEdit[];
    actions?: ReviewAction[];
    /** Apply what validates and report the rest, rather than rejecting all. */
    partial?: boolean;
    /** Let adeu expand ambiguous targets with surrounding context. */
    self_contained?: boolean;
    source?: ObjectRef;
}

export interface BatchSummary {
    applied_edits: number;
    skipped_edits: number;
    applied_actions: number;
    skipped_actions: number;
}

export interface ApplyEditsMarkdownParams {
    edits: DocumentEdit[];
    highlight_only?: boolean;
    include_index?: boolean;
}

export interface ApplyEditsMarkdownResponse {
    markdown: string;
}

export interface DiffResponse {
    diff: string;
    has_differences: boolean;
}

export interface AdeuErrorResponse {
    detail: string;
    errors?: string[];
}

// --- review model (adeu 2.4) -------------------------------------------------

export type ReviewItemKind = "insert" | "delete" | "format" | "comment";

export interface ReviewItem {
    /** adeu revision id, e.g. "Chg:12" — round-trips as a ReviewAction target_id. */
    id: string;
    kind: ReviewItemKind;
    author: string;
    date?: string | null;
    /** Changed text, or the comment body. */
    text: string;
    /** Document text the item attaches to. */
    anchor_text: string;
    /**
     * Id of the revision this resolves with. A replacement is a delete+insert
     * pair — resolving either resolves both, so the UI shows one decision.
     */
    paired_with?: string | null;
    offset: number;
    context: string;
}

export interface ReviewItemsResponse {
    filename: string;
    items: ReviewItem[];
    authors: string[];
    change_count: number;
    comment_count: number;
}

export interface EditReport {
    index?: number | null;
    status?: string | null;
    target_text?: string | null;
    new_text?: string | null;
    reason?: string | null;
    occurrences_modified?: number | null;
    heading_path?: string | null;
    page?: number | null;
}

export interface FailedEdit {
    index?: number | null;
    reason: string;
}

/** Per-edit outcome of a batch. `summary` keeps the frozen v1 counts. */
export interface BatchResult {
    status: string;
    summary: BatchSummary;
    edits: EditReport[];
    failed: FailedEdit[];
    skipped_details: string[];
    occurrences_modified: number;
    actions_already_resolved: number;
    author_impersonation_warning?: string | null;
    adeu_version?: string | null;
}

export interface ProcessBatchJsonResponse {
    document_base64: string;
    filename: string;
    result: BatchResult;
}
