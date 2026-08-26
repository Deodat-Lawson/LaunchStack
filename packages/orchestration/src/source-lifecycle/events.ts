/**
 * Builds the `source.version.created` event a lifecycle transaction enqueues
 * (ADR-003 §2). Kept separate from the lifecycle so tests can pin the
 * payload shape without a database.
 */
import {
    eventIds,
    PROTOCOL_VERSION,
    ocrProviderSchema,
    type OcrProvider,
    type SourceVersionCreatedEvent,
} from "../pipeline-events";

export interface SourceEventInput {
    ocrJobId: string;
    companyId: number;
    sourceId: number;
    sourceVersionId: number;
    documentUrl: string;
    documentName: string;
    category: string;
    userId: string;
    traceId: string;
    occurredAt: string;
    mimeType?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    archiveIdentity?: string;
    transcriptionMetadata?: Record<string, unknown>;
    forceOCR?: boolean;
    preferredProvider?: string;
    embeddingIndexKey?: string;
}

/**
 * Historical `dispatch_options` rows may name the removed MARKER provider;
 * it never had a real implementation and always ran Docling (ADR-004), so
 * replays map it to DOCLING. Unknown names are dropped, not guessed.
 */
export function normalizeStoredProvider(
    provider: string | undefined,
    warn: (msg: string) => void
): OcrProvider | undefined {
    if (!provider) return undefined;
    const normalized = provider.toUpperCase();
    if (normalized === "MARKER") {
        warn(
            "dispatch options named the removed MARKER provider; using DOCLING (its real implementation)"
        );
        return "DOCLING";
    }
    const parsed = ocrProviderSchema.safeParse(normalized);
    if (!parsed.success) {
        warn(`dispatch options named unknown OCR provider "${provider}"; ignoring it`);
        return undefined;
    }
    return parsed.data;
}

export function buildSourceVersionCreatedEvent(
    input: SourceEventInput,
    warn: (msg: string) => void = msg => console.warn(`[source-lifecycle] ${msg}`)
): SourceVersionCreatedEvent {
    const preferredProvider = normalizeStoredProvider(input.preferredProvider, warn);
    return {
        eventId: eventIds.sourceVersionCreated(input.ocrJobId),
        eventType: "source.version.created",
        schemaVersion: PROTOCOL_VERSION,
        occurredAt: input.occurredAt,
        traceId: input.traceId,
        companyId: input.companyId,
        payload: {
            sourceId: input.sourceId,
            sourceVersionId: input.sourceVersionId,
            ocrJobId: input.ocrJobId,
            documentUrl: input.documentUrl,
            documentName: input.documentName,
            category: input.category,
            userId: input.userId,
            mimeType: input.mimeType,
            originalFilename: input.originalFilename,
            isWebsite: input.isWebsite,
            archiveIdentity: input.archiveIdentity,
            transcriptionMetadata: input.transcriptionMetadata,
            options:
                input.forceOCR !== undefined ||
                preferredProvider !== undefined ||
                input.embeddingIndexKey !== undefined
                    ? {
                          forceOCR: input.forceOCR,
                          preferredProvider,
                          embeddingIndexKey: input.embeddingIndexKey,
                      }
                    : undefined,
        },
    };
}
