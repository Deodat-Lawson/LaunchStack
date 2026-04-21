import type { PipelineResult, ProcessDocumentEventData } from "@launchstack/core/ocr/types";

export interface DocIngestionToolRuntimeOptions {
  sidecarUrl?: string;
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
