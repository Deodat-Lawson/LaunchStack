/**
 * @launchstack/adapters — implementations of the application ports
 * (ADR-002). Postgres repositories, the transactional outbox, and HTTP
 * clients for the compute services. Configuration is injected by the
 * composition roots; nothing here reads process.env.
 */
export {
  DrizzleOutboxStore,
  enqueueOutboxEventsWithRevive,
  type DrizzleOutboxStoreOptions,
} from "./outbox/drizzle-outbox-store";

export {
  createDocumentLifecycle,
  createDocumentVersionLifecycle,
  type CreateDocumentLifecycleParams,
  type CreateDocumentVersionLifecycleParams,
  type CreatedDocumentLifecycle,
  type CreatedDocumentVersionLifecycle,
  type DocumentCreationProcessing,
  type DocumentLifecycleJob,
} from "./ingestion/source-lifecycle";

export {
  buildSourceVersionCreatedEvent,
  normalizeStoredProvider,
  type SourceEventInput,
} from "./ingestion/source-events";

export { DrizzleSourceLifecycle } from "./ingestion/source-lifecycle-port";

export { DocIngestionPipeline } from "./ingestion/pipeline-port";

export {
  expandArchive,
  isTextFastPathFile,
  isZipFile,
  type ExpandArchiveInput,
  type ExpandArchiveResult,
} from "./ingestion/archive-expansion";

export {
  runDocIngestionTool,
  runExtractionStage,
  runIndexingStage,
  type DocIngestionToolInput,
  type DocIngestionToolResult,
  type DocIngestionToolRuntimeOptions,
  type ExtractionStageSummary,
  type IndexingStageCounts,
} from "./ingestion/doc-ingestion/index";

export {
  ComputeServiceError,
  postJson,
  type ServiceClientConfig,
} from "./http/service-client";

export {
  HttpDocumentConverterClient,
  type ConverterClientConfig,
} from "./http/converter-client";

export {
  HttpTranscriptionClient,
  type TranscriptionClientConfig,
} from "./http/transcription-client";
