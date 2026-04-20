export interface DocumentEdit {
    target_text: string;
    new_text: string;
    comment?: string;
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
