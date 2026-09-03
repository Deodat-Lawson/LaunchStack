import { normalizeFolderPath } from "~/lib/folders/path";
import {
    shouldTranscribeFile,
    transcribeAudioFromUrl,
    isVideoUrl,
    transcribeVideoFromUrl,
} from "@launchstack/conversion";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";
import { getEngine } from "~/server/engine";
import { uploadFile } from "~/lib/storage";
import { putFile } from "~/server/storage/vercel-blob";
import { parseProvider } from "@launchstack/conversion/ocr/trigger";
import { detectStorageType, toAbsoluteUrl, type StorageType } from "./detect-storage-type";
import { authorizeInternalFileRef } from "./internal-file-ref";
import { createDocumentLifecycle, type CreatedDocumentLifecycle } from "./document-creation";
import { hasTokens } from "~/lib/credits";
import { isMeteringEnforced } from "@launchstack/store/credits";
import { buildInternalFileUrl } from "@launchstack/store/crypto";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";

export type { StorageType } from "./detect-storage-type";
export { detectStorageType, toAbsoluteUrl } from "./detect-storage-type";

function toDocumentUploadResult(
    lifecycle: CreatedDocumentLifecycle,
    storageType: StorageType,
    resolvedDocumentUrl: string
): DocumentUploadResult {
    return {
        jobId: lifecycle.jobId ?? "",
        eventIds: lifecycle.eventIds,
        storageType,
        document: {
            id: lifecycle.document.id,
            title: lifecycle.document.title,
            url: lifecycle.document.url,
            category: lifecycle.document.category,
        },
        resolvedDocumentUrl,
    };
}

export interface DocumentUploadUserContext {
    userId: string;
    companyId: bigint;
}

export interface DocumentUploadParams {
    user: DocumentUploadUserContext;
    documentName: string;
    rawDocumentUrl: string;
    requestUrl: string;
    category?: string;
    preferredProvider?: string;
    explicitStorageType?: StorageType;
    mimeType?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    /** Links crawled pages together for UI grouping */
    crawlGroupId?: string;
    /** Stable idempotency key for this logical upload. */
    creationKey?: string;
    embeddingIndexKey?: string;
}

export interface DocumentUploadResult {
    jobId: string;
    eventIds: string[];
    storageType: StorageType;
    document: {
        id: number;
        title: string;
        url: string;
        category: string;
    };
    resolvedDocumentUrl: string;
}

/**
 * Core document upload handler shared by single-file and batch commits.
 */
export async function processDocumentUpload({
    user,
    documentName,
    rawDocumentUrl,
    requestUrl,
    category,
    preferredProvider,
    explicitStorageType,
    mimeType,
    originalFilename,
    isWebsite,
    creationKey,
    embeddingIndexKey,
}: DocumentUploadParams): Promise<DocumentUploadResult> {
    // Populate OCR (and provider) config before reading getOcrConfig() or
    // authorizing internal file refs. On a cold process, an empty slot makes
    // effectiveProvider / workerUrl / FILE_ACCESS_TOKEN_SECRET look unset and
    // skips the ingress rejection for unsigned OSS fetches. Idempotent/cached.
    // Also required before isMeteringEnforced() below: the metering slot is
    // populated by createEngine, and an unbuilt engine reads as "off".
    getEngine();

    const effectiveProvider = parseProvider(preferredProvider) ?? getOcrConfig().defaultProvider;

    // Throws before anything is created when the URL names a file this
    // workspace does not own. An internal reference is always database-backed
    // regardless of what the caller declared — otherwise `storageType: "s3"`
    // would keep the path unresolved and hand it straight to the token signer.
    const internalFileId = await authorizeInternalFileRef(
        rawDocumentUrl,
        user.companyId,
        effectiveProvider
    );
    const storageType: StorageType =
        internalFileId !== null
            ? "database"
            : (explicitStorageType ?? detectStorageType(rawDocumentUrl));
    const resolvedDocumentUrl =
        internalFileId !== null
            ? buildInternalFileUrl(
                  getOcrConfig().appPublicUrl ?? new URL(requestUrl).origin,
                  internalFileId
              )
            : storageType === "database"
              ? toAbsoluteUrl(rawDocumentUrl, requestUrl)
              : rawDocumentUrl;

    // The workspace's root bucket; a caller that names no folder lands there,
    // not in a folder of its own that then needs tidying away.
    const documentCategory = normalizeFolderPath(category);

    // ------------------------------------------------------------------
    // Credit pre-check. Only a deployment that actually bills gates on the
    // balance: a self-hosted instance records usage but must never refuse
    // work, because nothing in the product can add credits and the refusal
    // would be permanent.
    // ------------------------------------------------------------------
    if (isMeteringEnforced()) {
        // Rough estimate: 20 credits covers a typical document (OCR + embeddings)
        const estimatedCredits = shouldTranscribeFile(mimeType, originalFilename) ? 30 : 20;
        const sufficient = await hasTokens(user.companyId, estimatedCredits);
        if (!sufficient) {
            throw new Error(
                "This workspace has run out of processing credits, so the upload was not started. Contact your workspace owner to top up."
            );
        }
    }

    // Resolve the embedding index key ONCE at enqueue time and thread it through
    // the Inngest event payload. The worker must never re-resolve from DB — that
    // would race against a mid-flight `updateCompany` index switch and produce
    // embeddings under the wrong index_key. Prefer `pending` during an active
    // reindex so new docs end up in the in-flight target.
    const resolvedEmbeddingIndexKey =
        embeddingIndexKey ?? (await resolveIngestIndexKey(user.companyId)) ?? undefined;

    // ------------------------------------------------------------------
    // Audio file: save the original audio as a document, then create a
    // separate transcript document that goes through the embedding pipeline.
    // ------------------------------------------------------------------
    if (shouldTranscribeFile(mimeType, originalFilename)) {
        console.log(`[DocumentUpload] Audio file detected: ${documentName}, transcribing...`);

        const baseCreationKey = creationKey ?? `upload:${rawDocumentUrl}`;
        const audioLifecycle = await createDocumentLifecycle({
            companyId: user.companyId,
            userId: user.userId,
            title: documentName,
            category: documentCategory,
            url: rawDocumentUrl,
            creationKey: `${baseCreationKey}:audio-source`,
            mimeType: mimeType ?? null,
            ocrEnabled: false,
            ocrProcessed: true,
        });

        try {
            getEngine();
            const transcriptionResult = await transcribeAudioFromUrl(
                resolvedDocumentUrl,
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty filenames must fall back to the document name.
                originalFilename || documentName,
                user.companyId
            );

            const textBlob = await uploadFile({
                filename: `${documentName}-transcription.txt`,
                data: Buffer.from(transcriptionResult.text, "utf-8"),
                contentType: "text/plain",
                userId: user.userId,
                companyId: user.companyId,
            });

            const transcriptionMetadata = {
                source: "transcription",
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty filenames must fall back to the document name.
                audioFilename: originalFilename || documentName,
                audioDocumentId: audioLifecycle.document.id,
                audioUrl: resolvedDocumentUrl,
                language: transcriptionResult.language,
                confidence: transcriptionResult.confidence,
                segments: transcriptionResult.segments,
                transcribedAt: new Date().toISOString(),
            };

            const transcriptName = `${documentName} (Transcription)`;
            const transcriptLifecycle = await createDocumentLifecycle({
                companyId: user.companyId,
                userId: user.userId,
                title: transcriptName,
                category: documentCategory,
                url: textBlob.url,
                processingUrl: textBlob.url,
                creationKey: `${baseCreationKey}:audio-transcript`,
                mimeType: "text/plain",
                ocrEnabled: true,
                ocrProcessed: false,
                ocrMetadata: transcriptionMetadata,
                processing: {
                    preferredProvider,
                    originalFilename: `${documentName}-transcription.txt`,
                    transcriptionMetadata,
                    embeddingIndexKey: resolvedEmbeddingIndexKey,
                },
            });

            return {
                ...toDocumentUploadResult(audioLifecycle, storageType, resolvedDocumentUrl),
                jobId: transcriptLifecycle.jobId ?? "",
                eventIds: transcriptLifecycle.eventIds,
            };
        } catch (error) {
            console.error(
                `[DocumentUpload] Audio transcription failed for ${documentName}:`,
                error
            );
            throw error;
        }
    }

    // ------------------------------------------------------------------
    // Normal (non-audio) document processing
    // ------------------------------------------------------------------
    const baseCreationKey = creationKey ?? `upload:${rawDocumentUrl}`;
    const lifecycle = await createDocumentLifecycle({
        companyId: user.companyId,
        userId: user.userId,
        title: documentName,
        category: documentCategory,
        url: rawDocumentUrl,
        processingUrl: resolvedDocumentUrl,
        creationKey: baseCreationKey,
        mimeType: mimeType ?? null,
        ocrEnabled: true,
        ocrProcessed: false,
        processing: {
            preferredProvider,
            originalFilename,
            isWebsite,
            embeddingIndexKey: resolvedEmbeddingIndexKey,
        },
    });

    return toDocumentUploadResult(lifecycle, storageType, resolvedDocumentUrl);
}

// ------------------------------------------------------------------
// Video URL upload — download + transcribe via sidecar, then embed
// ------------------------------------------------------------------

export interface VideoUrlUploadParams {
    user: DocumentUploadUserContext;
    videoUrl: string;
    requestUrl: string;
    category: string;
    title?: string;
    preferredProvider?: string;
    creationKey?: string;
    embeddingIndexKey?: string;
}

export async function processVideoUrlUpload({
    user,
    videoUrl,
    category,
    title,
    preferredProvider,
    creationKey,
    embeddingIndexKey,
}: VideoUrlUploadParams): Promise<DocumentUploadResult> {
    if (!isVideoUrl(videoUrl)) {
        throw new Error(
            "Unsupported video URL. Supported platforms include YouTube, Vimeo, TikTok, Twitter/X, and more."
        );
    }

    const documentCategory = category;

    const resolvedEmbeddingIndexKey =
        embeddingIndexKey ?? (await resolveIngestIndexKey(user.companyId)) ?? undefined;

    console.log(`[DocumentUpload] Video URL detected: ${videoUrl}, downloading & transcribing...`);

    // 1. Transcribe via the self-hosted sidecar (downloads audio with yt-dlp)
    const transcriptionResult = await transcribeVideoFromUrl(videoUrl);

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty titles must fall back to a usable title.
    const documentName = title || transcriptionResult.title || "Video Transcription";

    // 2. Store the transcript as a text file in blob storage
    const textBlob = await putFile({
        filename: `${documentName}-transcription.txt`,
        data: Buffer.from(transcriptionResult.text, "utf-8"),
        contentType: "text/plain",
    });

    const transcriptionMetadata = {
        source: "sidecar-ytdlp",
        videoTitle: transcriptionResult.title,
        videoDuration: transcriptionResult.duration,
        videoUrl,
        language: transcriptionResult.language,
        confidence: transcriptionResult.confidence,
        transcribedAt: new Date().toISOString(),
    };

    const transcriptName = `${documentName} (Transcription)`;

    // Initialize the configured dispatcher before the lifecycle dispatch.
    getEngine();

    // 3. Create the transcript document record and dispatch its processing job.
    const transcriptLifecycle = await createDocumentLifecycle({
        companyId: user.companyId,
        userId: user.userId,
        title: transcriptName,
        category: documentCategory,
        url: textBlob.url,
        processingUrl: textBlob.url,
        creationKey: creationKey ?? `video:${videoUrl}:transcript`,
        mimeType: "text/plain",
        ocrEnabled: true,
        ocrProcessed: false,
        ocrMetadata: transcriptionMetadata,
        processing: {
            preferredProvider,
            originalFilename: `${documentName}-transcription.txt`,
            transcriptionMetadata,
            embeddingIndexKey: resolvedEmbeddingIndexKey,
        },
    });

    console.log(
        `[DocumentUpload] Video transcript saved: docId=${transcriptLifecycle.document.id}, title="${documentName}"`
    );

    return toDocumentUploadResult(
        transcriptLifecycle,
        detectStorageType(textBlob.url),
        textBlob.url
    );
}
