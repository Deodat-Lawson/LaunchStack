/**
 * ExtractionPipelinePort implementation over the doc-ingestion stages
 * (ADR-003). The worker's outbox handlers call these; both stages re-read
 * the persisted job row so operator replay needs nothing but the event.
 */
import { eq } from "drizzle-orm";

import { getDb } from "../db";
import { document, ocrJobs } from "../db/schema";
import type { OCRProvider } from "../ocr/types";

/**
 * Providers the processor honors as an explicit pin. The event payload is
 * already protocol-validated; this only excludes INGESTION (the text
 * adapter's pseudo-provider, never a routing pin). The legacy
 * `parseProvider` whitelist must NOT be used here — it predates DOCLING
 * pins and silently degraded them to auto-routing.
 */
const PINNABLE_PROVIDERS: ReadonlySet<string> = new Set([
    "AZURE",
    "LANDING_AI",
    "NATIVE_PDF",
    "DATALAB",
    "DOCLING",
]);

function acceptPreferredProvider(provider?: string): OCRProvider | undefined {
    if (provider && PINNABLE_PROVIDERS.has(provider)) {
        return provider as OCRProvider;
    }
    return undefined;
}
import { getStoragePort } from "../storage";
import type {
    ExtractionJob,
    ExtractionOutcome,
    ExtractionPipelinePort,
    IndexingJob,
    IndexOutcome,
    LoggerPort,
} from "@launchstack/application";

import {
    runExtractionStage,
    runIndexingStage,
} from "./doc-ingestion/index";
import { expandArchive, isTextFastPathFile, isZipFile } from "./archive-expansion";

interface StoredDispatchOptions {
    archiveIdentity?: string;
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
    mimeType?: string;
    forceOCR?: boolean;
}

async function loadJobRow(ocrJobId: string) {
    const db = getDb();
    const [job] = await db
        .select()
        .from(ocrJobs)
        .where(eq(ocrJobs.id, ocrJobId))
        .limit(1);
    return job;
}

export class DocIngestionPipeline implements ExtractionPipelinePort {
    constructor(private readonly logger: LoggerPort) {}

    async extract(job: ExtractionJob): Promise<ExtractionOutcome> {
        const routingName = job.options.originalFilename ?? job.documentName;

        if (isZipFile(job.options.mimeType, routingName)) {
            const storage = getStoragePort();
            const result = await expandArchive({
                companyId: job.companyId,
                sourceId: job.sourceId,
                ocrJobId: job.ocrJobId,
                documentUrl: job.documentUrl,
                documentName: routingName,
                category: job.category,
                userId: job.actorId,
                archiveIdentity: job.options.archiveIdentity,
                embeddingIndexKey: job.options.embeddingIndexKey,
                traceId: job.traceId,
                fetchArchive: url => storage.download(url),
            });
            this.logger.info(
                {
                    traceId: job.traceId,
                    sourceId: job.sourceId,
                    extracted: result.extracted,
                    ...result.stats,
                },
                "archive expanded into per-entry sources",
            );
            return {
                provider: "INGESTION",
                usedFastTextPath: false,
                expandedArchive: true,
            };
        }

        const fastTextPath = isTextFastPathFile(job.options.mimeType, routingName);
        const summary = await runExtractionStage({
            jobId: job.ocrJobId,
            documentUrl: job.documentUrl,
            documentName: job.documentName,
            companyId: String(job.companyId),
            userId: job.actorId,
            documentId: job.sourceId,
            category: job.category,
            mimeType: job.options.mimeType,
            originalFilename: job.options.originalFilename,
            isWebsite: job.options.isWebsite,
            versionId: job.sourceVersionId,
            transcriptionMetadata: job.options.transcriptionMetadata,
            options: {
                forceOCR: job.options.forceOCR,
                preferredProvider: acceptPreferredProvider(job.options.preferredProvider),
                embeddingIndexKey: job.options.embeddingIndexKey,
            },
            runtime: {
                updateJobStatus: true,
                markFailureInDb: false,
                fastTextPath,
            },
        });

        return {
            provider: summary.provider,
            pageCount: summary.pageCount,
            // Normalize legacy 0–100 confidence scales to [0,1]; absent stays absent.
            confidence:
                summary.confidenceScore === undefined
                    ? undefined
                    : summary.confidenceScore > 1
                      ? Math.min(summary.confidenceScore / 100, 1)
                      : summary.confidenceScore,
            usedFastTextPath: summary.usedFastTextPath,
        };
    }

    async index(job: IndexingJob): Promise<IndexOutcome> {
        const row = await loadJobRow(job.ocrJobId);
        if (!row) {
            throw new Error(
                `OCR job ${job.ocrJobId} not found — cannot index source version ${job.sourceVersionId}`,
            );
        }
        const options = (row.dispatchOptions as StoredDispatchOptions | null) ?? {};
        const db = getDb();
        const [doc] = await db
            .select({ category: document.category })
            .from(document)
            .where(eq(document.id, job.sourceId))
            .limit(1);

        const counts = await runIndexingStage({
            jobId: job.ocrJobId,
            documentUrl: row.documentUrl,
            documentName: row.documentName,
            companyId: String(job.companyId),
            userId: row.userId,
            documentId: job.sourceId,
            category: doc?.category ?? "",
            mimeType: options.mimeType,
            originalFilename: options.originalFilename,
            isWebsite: options.isWebsite,
            versionId: job.sourceVersionId,
            transcriptionMetadata: options.transcriptionMetadata,
            options: {
                forceOCR: options.forceOCR,
                embeddingIndexKey: options.embeddingIndexKey,
            },
            runtime: {
                updateJobStatus: false,
                markFailureInDb: false,
            },
        });

        return {
            embeddingIndexKey: counts.embeddingIndexKey,
            contextChunkCount: counts.contextChunkCount,
            retrievalChunkCount: counts.retrievalChunkCount,
            graphSynced: counts.graphSynced,
        };
    }
}
