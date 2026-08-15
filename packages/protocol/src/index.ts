/**
 * @launchstack/protocol — cross-language contracts only (ADR-002).
 *
 * Zod schemas are the source of truth; `pnpm schemas:generate` emits JSON
 * Schemas under `schemas/v1/` for the Python services' contract tests, and
 * CI fails when the generated files drift from these definitions.
 *
 * This package must depend on nothing but zod. No database, no HTTP, no
 * Node built-ins, no environment access.
 */
export { PROTOCOL_VERSION, type ProtocolVersion } from "./version";

export {
    EVENT_TYPES,
    eventTypeSchema,
    eventEnvelopeBaseSchema,
    ocrProviderSchema,
    sourceVersionCreatedPayloadSchema,
    evidenceVersionExtractedPayloadSchema,
    evidenceVersionIndexedPayloadSchema,
    companyStateProjectionRequestedPayloadSchema,
    companyStateProjectedPayloadSchema,
    noteEmbeddingRequestedPayloadSchema,
    sourceVersionCreatedEventSchema,
    evidenceVersionExtractedEventSchema,
    evidenceVersionIndexedEventSchema,
    companyStateProjectionRequestedEventSchema,
    companyStateProjectedEventSchema,
    noteEmbeddingRequestedEventSchema,
    pipelineEventSchema,
    eventIds,
    type EventType,
    type OcrProvider,
    type SourceVersionCreatedEvent,
    type EvidenceVersionExtractedEvent,
    type EvidenceVersionIndexedEvent,
    type CompanyStateProjectionRequestedEvent,
    type CompanyStateProjectedEvent,
    type NoteEmbeddingRequestedEvent,
    type PipelineEvent,
} from "./events";

export {
    boundingBoxSchema,
    layoutBlockTypeSchema,
    layoutBlockSchema,
    evidencePageSchema,
    evidenceDocumentSchema,
    type BoundingBox,
    type LayoutBlockType,
    type LayoutBlock,
    type EvidencePage,
    type EvidenceDocument,
} from "./evidence-document";

export {
    serviceErrorSchema,
    routeRequestSchema,
    routingReasonSchema,
    routeResponseSchema,
    renderPagesRequestSchema,
    renderPagesResponseSchema,
    convertRequestSchema,
    convertResponseSchema,
    type ServiceError,
    type RouteRequest,
    type RoutingReason,
    type RouteResponse,
    type RenderPagesRequest,
    type RenderPagesResponse,
    type ConvertRequest,
    type ConvertResponse,
} from "./converter";

export {
    transcriptSegmentSchema,
    transcribeResponseSchema,
    videoTranscribeRequestSchema,
    videoTranscribeResponseSchema,
    type TranscriptSegment,
    type TranscribeResponse,
    type VideoTranscribeRequest,
    type VideoTranscribeResponse,
} from "./transcription";

export {
    documentEditSchema,
    reviewActionTypeSchema,
    reviewActionSchema,
    readDocxResponseSchema,
    processBatchRequestSchema,
    batchSummarySchema,
    applyEditsMarkdownRequestSchema,
    applyEditsMarkdownResponseSchema,
    diffResponseSchema,
    editorErrorResponseSchema,
    type DocumentEdit,
    type ReviewActionType,
    type ReviewAction,
    type ReadDocxResponse,
    type ProcessBatchRequest,
    type BatchSummary,
    type ApplyEditsMarkdownRequest,
    type ApplyEditsMarkdownResponse,
    type DiffResponse,
    type EditorErrorResponse,
} from "./document-editor";
