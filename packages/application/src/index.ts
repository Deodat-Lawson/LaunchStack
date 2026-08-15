/**
 * @launchstack/application — use cases, commands/queries, and ports
 * (ADR-002). Implementations of the ports live in @launchstack/adapters;
 * composition happens in apps/web and apps/worker.
 */
export type { ActorContext, TraceContext } from "./context";

export type {
    ClockPort,
    LoggerPort,
    ClaimedEvent,
    OutboxStorePort,
    SourceDispatchOptions,
    CreateSourceCommand,
    CreateSourceVersionCommand,
    SourceLifecycleResult,
    SourceLifecyclePort,
    DocumentConverterPort,
    TranscriptionPort,
    ExtractionJob,
    IndexingJob,
    ExtractionOutcome,
    IndexOutcome,
    ExtractionPipelinePort,
    CompanyProjectionPort,
    NoteRehydrationPort,
    NoteEmbeddingPort,
} from "./ports";

export {
    createPipelineProcessor,
    type PipelineProcessor,
    type PipelineProcessorDeps,
    type ProcessResult,
} from "./pipeline/process-event";

export {
    runOutboxTick,
    retryDelayMs,
    describeError,
    DEFAULT_RETRY_POLICY,
    type RetryPolicy,
    type OutboxTickDeps,
    type OutboxTickResult,
} from "./pipeline/outbox-tick";

export {
    buildCitations,
    type RetrievedEvidence,
    type SourceVersionInfo,
    type Citation,
} from "./citations";

export {
    createAcceptSourceUpload,
    type AcceptSourceUpload,
    type AcceptSourceUploadDeps,
} from "./use-cases/accept-source-upload";
