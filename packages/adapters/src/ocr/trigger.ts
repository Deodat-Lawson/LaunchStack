/**
 * Pipeline trigger utilities.
 *
 * Dispatches document processing jobs via the configured JobDispatcherPort.
 * The host (apps/web) wires the port in createEngine, so this module does not
 * import any runner-specific SDK.
 */

import { getJobDispatcher } from "../jobs/slot";
import type { ProcessDocumentEventData, OCRProvider } from "./types";

/**
 * Inngest / trigger.dev event name used for document processing.
 * Kept as a named constant so runner implementations can subscribe to the
 * same literal.
 *
 * @deprecated Replaced by the transactional outbox (ADR-003): document
 * ingestion is driven by outbox events consumed by apps/worker, not by a
 * dispatched job event. Kept for external consumers who wire their own
 * JobDispatcherPort.
 */
export const DOCUMENT_PROCESS_EVENT = "document/process.requested";

/**
 * Options for triggering the document processing pipeline
 */
export interface TriggerOptions {
    /** Stable job ID for idempotent dispatch */
    jobId: string;
    /** Stable logical identity used for archive keys across retries */
    archiveIdentity?: string;
    /** Force OCR even for native PDFs */
    forceOCR?: boolean;
    /** Preferred OCR provider */
    preferredProvider?: OCRProvider;
    /** MIME type of the uploaded file — forwarded to the ingestion router */
    mimeType?: string;
    /** Original filename with extension — used for adapter routing */
    originalFilename?: string;
    /** True when the document originated from a website upload */
    isWebsite?: boolean;
    /**
     * Every chunk written to the RLM tables is tagged with this version_id so
     * RAG can filter to the current version of each document.
     */
    versionId: number;
    /**
     * Opaque transcription provenance metadata, set only for documents that
     * were produced by audio transcription. Carried through so the pipeline
     * can record the source in document metadata.
     */
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
}

/**
 * Trigger the OCR-to-Vector pipeline for a document.
 *
 * Dispatches via the configured JobDispatcherPort. Throws on dispatch
 * failure; no sync fallback.
 *
 * @deprecated Replaced by the transactional outbox (ADR-003): the app writes
 * `source.version.created` outbox events in the same transaction as the
 * upload, and apps/worker runs the pipeline stages. The hosting app no
 * longer registers a JobDispatcherPort, so calling this without wiring your
 * own port via `configureJobDispatcher` throws. Kept for external consumers
 * who wire their own JobDispatcherPort.
 */
export async function triggerDocumentProcessing(
    documentUrl: string,
    documentName: string,
    companyId: string,
    userId: string,
    documentId: number,
    category: string,
    options: TriggerOptions
): Promise<{ jobId: string; eventIds: string[] }> {
    const jobId = options.jobId;
    const eventData: ProcessDocumentEventData = {
        jobId,
        documentUrl,
        documentName,
        companyId,
        userId,
        documentId,
        archiveIdentity: options.archiveIdentity,
        category,
        mimeType: options.mimeType,
        originalFilename: options.originalFilename,
        isWebsite: options.isWebsite,
        versionId: options.versionId,
        transcriptionMetadata: options.transcriptionMetadata,
        options: {
            forceOCR: options.forceOCR,
            preferredProvider: options.preferredProvider,
            embeddingIndexKey: options.embeddingIndexKey,
        },
    };

    const dispatcher = getJobDispatcher();
    console.log(
        `[Trigger] Dispatching job=${jobId}, doc="${documentName}", docId=${documentId}, ` +
            `mime=${options.mimeType ?? "none"}, provider=${options.preferredProvider ?? "auto"}, ` +
            `runner=${dispatcher.name}`
    );

    try {
        const result = await dispatcher.dispatch({
            name: DOCUMENT_PROCESS_EVENT,
            data: eventData as unknown as Record<string, unknown>,
        });

        console.log(
            `[Trigger] Successfully queued job=${jobId} via ${dispatcher.name}, ` +
                `eventIds=${result.eventIds.length}`
        );
        return { jobId, eventIds: result.eventIds };
    } catch (error) {
        console.error(`[Trigger] Job dispatch failed for job=${jobId}:`, error);
        throw new Error(
            `Job dispatch failed for job=${jobId}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Parse a provider string to OCRProvider type
 */
export function parseProvider(provider?: string): OCRProvider | undefined {
    if (!provider) return undefined;

    const normalized = provider.toUpperCase();
    const validProviders: OCRProvider[] = ["AZURE", "LANDING_AI", "NATIVE_PDF", "DATALAB"];

    if (validProviders.includes(normalized as OCRProvider)) {
        return normalized as OCRProvider;
    }

    return undefined;
}
