import type { PipelineResult, ProcessDocumentEventData } from "~/lib/ocr/types";

export interface DocIngestionToolRuntimeOptions {
  sidecarUrl?: string;
  sidecarBatchSize?: number;
  updateJobStatus?: boolean;
  markFailureInDb?: boolean;
  runStep?<T>(stepName: string, fn: () => Promise<T>): Promise<T>;
}

export interface DocIngestionToolInput extends ProcessDocumentEventData {
  runtime?: DocIngestionToolRuntimeOptions;
}

export type DocIngestionToolResult = PipelineResult;
