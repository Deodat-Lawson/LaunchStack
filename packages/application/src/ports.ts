/**
 * Ports — the interfaces the use cases depend on. Implementations live in
 * @launchstack/adapters (Postgres, HTTP service clients) and are injected by
 * the composition roots in apps/web and apps/worker. Nothing here may touch
 * a database, the network, or the environment.
 */
import type {
  ConvertRequest,
  EvidenceDocument,
  PipelineEvent,
  RenderPagesRequest,
  RenderPagesResponse,
  RouteRequest,
  RouteResponse,
  TranscribeResponse,
  VideoTranscribeRequest,
  VideoTranscribeResponse,
} from "@launchstack/protocol";

export interface ClockPort {
  now(): Date;
}

export interface LoggerPort {
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Outbox (ADR-003)
// ---------------------------------------------------------------------------

/** An outbox row claimed by the worker, ready for its handler. */
export interface ClaimedEvent {
  /** Outbox row id — pass back to markProcessed/markFailed. */
  outboxId: number;
  event: PipelineEvent;
  attemptCount: number;
}

export interface OutboxStorePort {
  /**
   * Enqueue events outside a producing transaction (e.g. note-embedding
   * requests from web request handlers). Idempotent: rows conflicting on
   * eventId are silently skipped. Producers that change pipeline state MUST
   * instead enqueue inside their own transaction via the lifecycle port.
   */
  enqueue(events: PipelineEvent[]): Promise<void>;
  /**
   * Claim up to `batchSize` due pending events with FOR UPDATE SKIP LOCKED,
   * marking them `processing`. Concurrent workers never claim the same row.
   */
  claimBatch(batchSize: number): Promise<ClaimedEvent[]>;
  /**
   * Mark a claimed event processed and atomically enqueue its follow-up
   * events in the same transaction — the pipeline's event chaining is
   * itself transactional. Follow-ups use insert-or-revive semantics: a live
   * `pending`/`processing` row is left untouched, while a `processed` or
   * `dead` row returns to `pending` — replaying stage N therefore re-runs
   * stages N+1..end (cascade replay; all handlers are idempotent). A stale
   * claimant whose row was reclaimed mid-handler has its outcome discarded
   * and enqueues nothing.
   */
  markProcessed(outboxId: number, followUps?: PipelineEvent[]): Promise<void>;
  /**
   * Record a handler failure. Attempts below `maxAttempts` return the row to
   * `pending` with the given not-before time; at the limit the row goes
   * `dead` and stays visible for operator replay (docs/runbooks/outbox.md).
   * A stale claimant whose row was reclaimed mid-handler has its outcome
   * discarded.
   */
  markFailed(
    outboxId: number,
    error: string,
    opts: { retryAt: Date | null },
  ): Promise<void>;
  /**
   * Return stale `processing` rows (claimed before `claimedBefore`, i.e. the
   * worker died mid-handler) to `pending`, counting each reclaim as one
   * consumed attempt so a crash-poison event cannot loop forever: a row
   * whose incremented count reaches `maxAttempts` goes `dead` instead.
   * Returns the number of rows reclaimed (including newly dead ones).
   */
  reclaimStale(claimedBefore: Date, maxAttempts: number): Promise<number>;
  /** Failure visibility: dead-row count for health/metrics surfaces. */
  countDead(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Source lifecycle (command acceptance)
// ---------------------------------------------------------------------------

/** Options routed to extraction, persisted on the job for replay. */
export interface SourceDispatchOptions {
  forceOCR?: boolean;
  preferredProvider?: string;
  embeddingIndexKey?: string;
  mimeType?: string;
  originalFilename?: string;
  isWebsite?: boolean;
  archiveIdentity?: string;
  transcriptionMetadata?: Record<string, unknown>;
  skipProcessing?: boolean;
}

export interface CreateSourceCommand {
  actor: ActorLike;
  documentUrl: string;
  documentName: string;
  category: string;
  /** Idempotency key parts — same key converges on the same source. */
  creationKey: string[] | string;
  traceId: string;
  options: SourceDispatchOptions;
}

export interface CreateSourceVersionCommand {
  actor: ActorLike;
  sourceId: number;
  documentUrl: string;
  creationKey: string[] | string;
  changelog?: string;
  fileSize?: number;
  traceId: string;
  options: SourceDispatchOptions;
}

interface ActorLike {
  actorId: string;
  companyId: number;
}

export interface SourceLifecycleResult {
  sourceId: number;
  sourceVersionId: number;
  versionNumber: number;
  ocrJobId: string | null;
}

/**
 * Creates source versions and their `source.version.created` outbox event in
 * ONE transaction (ADR-003 §2). Implementations must be idempotent on the
 * creation key and must never dispatch anything post-commit.
 */
export interface SourceLifecyclePort {
  createSource(cmd: CreateSourceCommand): Promise<SourceLifecycleResult>;
  createSourceVersion(
    cmd: CreateSourceVersionCommand,
  ): Promise<SourceLifecycleResult>;
}

// ---------------------------------------------------------------------------
// Compute services (ADR-004)
// ---------------------------------------------------------------------------

export interface DocumentConverterPort {
  route(req: RouteRequest): Promise<RouteResponse>;
  convert(req: ConvertRequest): Promise<EvidenceDocument>;
  renderPages(req: RenderPagesRequest): Promise<RenderPagesResponse>;
}

export interface TranscriptionPort {
  transcribeFile(input: {
    bytes: Uint8Array;
    filename: string;
    traceId: string;
  }): Promise<TranscribeResponse>;
  transcribeUrl(
    req: VideoTranscribeRequest & { traceId: string },
  ): Promise<VideoTranscribeResponse>;
}

// ---------------------------------------------------------------------------
// Extraction/indexing pipeline (implemented over the existing doc-ingestion
// engine in @launchstack/adapters; the worker orchestrates the stages)
// ---------------------------------------------------------------------------

export interface ExtractionJob {
  companyId: number;
  sourceId: number;
  sourceVersionId: number;
  ocrJobId: string;
  documentUrl: string;
  documentName: string;
  category: string;
  actorId: string;
  traceId: string;
  options: SourceDispatchOptions;
}

export interface ExtractionOutcome {
  provider: string;
  pageCount?: number;
  /** Provider-reported only — never fabricated (ADR-005 §3). */
  confidence?: number;
  usedFastTextPath: boolean;
  /**
   * True when the source was a ZIP archive that fanned out into per-entry
   * sources (each with its own lifecycle + event) and deleted itself — the
   * pipeline for THIS source ends here with no follow-up events.
   */
  expandedArchive?: boolean;
}

export interface IndexOutcome {
  embeddingIndexKey?: string;
  contextChunkCount: number;
  retrievalChunkCount: number;
  graphSynced: boolean;
}

/**
 * Indexing re-hydrates url/name/options from the persisted job row
 * (`dispatch_options`) rather than carrying them in the event — the job row
 * is the single source of truth for replay.
 */
export interface IndexingJob {
  companyId: number;
  sourceId: number;
  sourceVersionId: number;
  ocrJobId: string;
  traceId: string;
}

/**
 * The two durable pipeline stages. Both must be idempotent: re-running a
 * stage for the same (sourceVersionId, ocrJobId) converges on the same
 * persisted state (content-hash dedup, upserts) — this is what makes outbox
 * redelivery and operator replay safe.
 */
export interface ExtractionPipelinePort {
  extract(job: ExtractionJob): Promise<ExtractionOutcome>;
  index(job: IndexingJob): Promise<IndexOutcome>;
}

/** Refreshes derived company state from indexed evidence (ADR-005 §5). */
export interface CompanyProjectionPort {
  projectCompanyState(input: {
    companyId: number;
    /** The indexed source whose evidence feeds the extraction. */
    sourceId: number;
    traceId: string;
  }): Promise<{ projected: boolean }>;
}

/** Re-anchors user notes after a version was indexed. */
export interface NoteRehydrationPort {
  rehydrateForSourceVersion(input: {
    sourceId: number;
    sourceVersionId: number;
    traceId: string;
  }): Promise<void>;
}

/** Embeds a note for retrieval (consumer of note.embedding.requested). */
export interface NoteEmbeddingPort {
  embedNote(input: { noteId: number; traceId: string }): Promise<void>;
}
