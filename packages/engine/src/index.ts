/**
 * @launchstack/engine — the one-install aggregate. createEngine() assembles
 * the feature packages behind a single CoreConfig; the re-exports below
 * replicate the historical @launchstack/core and @launchstack/adapters
 * barrels for consumers who want one dependency instead of eight.
 */
export * from "./engine";

// The old @launchstack/adapters barrel surface, now owned by the features:
export {
    DrizzleOutboxStore,
    enqueueOutboxEventsWithRevive,
    type DrizzleOutboxStoreOptions,
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
    type CreateDocumentLifecycleParams,
    type CreateDocumentVersionLifecycleParams,
    type CreatedDocumentLifecycle,
    type CreatedDocumentVersionLifecycle,
    type DocumentCreationProcessing,
    type DocumentLifecycleJob,
    buildSourceVersionCreatedEvent,
    normalizeStoredProvider,
    type SourceEventInput,
    DrizzleSourceLifecycle,
} from "@launchstack/orchestration";

export {
    DocIngestionPipeline,
    runDocIngestionTool,
    runExtractionStage,
    runIndexingStage,
    type DocIngestionToolInput,
    type DocIngestionToolResult,
    type DocIngestionToolRuntimeOptions,
    type ExtractionStageSummary,
    type IndexingStageCounts,
} from "@launchstack/indexing";

export {
    expandArchive,
    isTextFastPathFile,
    isZipFile,
    type ExpandArchiveInput,
    type ExpandArchiveResult,
    ComputeServiceError,
    postJson,
    type ServiceClientConfig,
    HttpDocumentConverterClient,
    type ConverterClientConfig,
    HttpTranscriptionClient,
    type TranscriptionClientConfig,
} from "@launchstack/conversion";
