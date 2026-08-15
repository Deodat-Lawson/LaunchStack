import type { PipelineResult, ProcessDocumentEventData } from "../../ocr/types";

export interface DocIngestionToolRuntimeOptions {
    /** Embedding batch size per pipeline step (historic name kept for callers). */
    sidecarBatchSize?: number;
    updateJobStatus?: boolean;
    markFailureInDb?: boolean;
    /** When true, skips OCR routing and uses TextAdapter directly */
    fastTextPath?: boolean;
    runStep?<T>(stepName: string, fn: () => Promise<T>): Promise<T>;
}

export interface DocIngestionToolInput extends ProcessDocumentEventData {
    runtime?: DocIngestionToolRuntimeOptions;
}

export type DocIngestionToolResult = PipelineResult;
