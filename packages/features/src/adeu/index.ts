export {
  AdeuConfigError,
  AdeuServiceError,
  acceptAllChanges,
  applyEditsAsMarkdown,
  diffDocxFiles,
  getBaseUrl,
  processDocumentBatch,
  readDocx,
  type ProcessBatchResponse,
} from "./client";
export type {
  ApplyEditsMarkdownParams,
  ApplyEditsMarkdownResponse,
  BatchSummary,
  DiffResponse,
  DocumentEdit,
  ProcessBatchParams,
  ReadDocxResponse,
  ReviewAction,
} from "./types";
