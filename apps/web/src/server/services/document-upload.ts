import { and, eq } from "drizzle-orm";

import type { ObjectRef } from "@launchstack/core/storage";
import { db } from "~/server/db";
import { document, documentVersions, storageObjects } from "@launchstack/core/db/schema";
import { resolveIngestIndexKey } from "@launchstack/core/embeddings";
import {
  shouldTranscribeFile,
  transcribeAudioFromUrl,
  isVideoUrl,
  transcribeVideoFromUrl,
} from "@launchstack/features/voice";
import { getEngine } from "~/server/engine";
import { uploadFile } from "~/lib/storage";
import {
  detectStorageType,
  toAbsoluteUrl,
  type StorageType,
} from "./detect-storage-type";
import { createDocumentRecord } from "./create-document";
import { triggerJob } from "./trigger-job";
import { hasTokens } from "~/lib/credits";
import { isCloudMode } from "@launchstack/core/providers/registry";

export type { StorageType } from "./detect-storage-type";
export { detectStorageType, toAbsoluteUrl } from "./detect-storage-type";

export interface DocumentUploadUserContext {
  userId: string;
  companyId: bigint;
}

const isUploadThingUrl = (value: string): boolean =>
  /\/f\//.test(value) && /uploadthing\.com|ufs\.sh|utfs\.io/i.test(value);

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
  embeddingIndexKey?: string;
  /** ObjectRef minted by the adapter that wrote rawDocumentUrl. */
  storageRef?: ObjectRef;
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

function resolveStorageRef(rawDocumentUrl: string, supplied?: ObjectRef): ObjectRef | undefined {
  if (supplied) return supplied;

  if (isUploadThingUrl(rawDocumentUrl)) {
    throw new Error(
      "Document upload requires an adapter ObjectRef for UploadThing URLs.",
    );
  }

  const dbMatch = /^(?:https?:\/\/[^/]+)?\/api\/files\/(\d+)$/.exec(rawDocumentUrl);
  if (dbMatch?.[1]) {
    return {
      adapter: "database",
      storageLocationId: "database:pdr_file_uploads_v1",
      key: dbMatch[1],
    };
  }

  const s3Endpoint = process.env.NEXT_PUBLIC_S3_ENDPOINT?.replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET_NAME;
  if (s3Endpoint && rawDocumentUrl.startsWith(`${s3Endpoint}/`)) {
    const suffix = rawDocumentUrl.slice(s3Endpoint.length + 1);
    const key = bucket && suffix.startsWith(`${bucket}/`) ? suffix.slice(bucket.length + 1) : suffix;
    if (key) {
      return {
        adapter: "s3",
        storageLocationId: bucket ? `s3:${s3Endpoint}@${bucket}` : `s3:${s3Endpoint}`,
        key,
      };
    }
  }

  return undefined;
}

async function findManifestObjectIdForRef(
  ref: ObjectRef,
  companyId: bigint,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: storageObjects.id, ownerCompanyId: storageObjects.companyId })
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.adapter, ref.adapter),
        eq(storageObjects.storageLocationId, ref.storageLocationId),
        eq(storageObjects.key, ref.key),
      ),
    );

  if (!row || row.ownerCompanyId !== companyId) {
    return undefined;
  }

  return row.id;
}

/**
 * Create the initial (version 1) row in `document_versions` for a freshly-inserted
 * document, point the document at it via `currentVersionId`, and lock in `fileType`.
 *
 * This is the authoritative path for new uploads. Every document created after
 * Step 2 of the versioning rollout will have a v1 row from the start — the
 * backfill script is only for documents that existed before this change.
 *
 * Runs as a single transaction so the document row and its v1 version are
 * always consistent with each other.
 */
async function createInitialVersion(params: {
  documentId: number;
  url: string;
  mimeType: string | null | undefined;
  uploadedBy: string;
  ocrProcessed?: boolean;
  ocrMetadata?: Record<string, unknown>;
  storageObjectId?: number;
}): Promise<number> {
  const {
    documentId,
    url,
    mimeType,
    uploadedBy,
    ocrProcessed,
    ocrMetadata,
    storageObjectId,
  } = params;

  // Fall back to application/octet-stream only if the caller genuinely has no
  // MIME info. This matches the backfill script's behavior so old and new rows
  // look the same.
  const resolvedMime = mimeType ?? "application/octet-stream";

  return db.transaction(async (tx) => {
    const [version] = await tx
      .insert(documentVersions)
      .values({
        documentId: BigInt(documentId),
        versionNumber: 1,
        url,
        mimeType: resolvedMime,
        uploadedBy,
        ocrProcessed: ocrProcessed ?? false,
        ocrMetadata: ocrMetadata ?? null,
      })
      .returning({ id: documentVersions.id });

    if (!version) {
      throw new Error(
        `Failed to create initial document_versions row for document ${documentId}`
      );
    }

    await tx
      .update(document)
      .set({
        currentVersionId: BigInt(version.id),
        fileType: resolvedMime,
      })
      .where(eq(document.id, documentId));

    if (storageObjectId !== undefined) {
      await tx
        .update(storageObjects)
        .set({
          documentId: null,
          documentVersionId: BigInt(version.id),
        })
        .where(
          and(
            eq(storageObjects.id, storageObjectId),
            eq(storageObjects.documentId, BigInt(documentId)),
          ),
        );
    }

    return Number(version.id);
  });
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
  embeddingIndexKey,
  storageRef,
}: DocumentUploadParams): Promise<DocumentUploadResult> {
  const resolvedStorageRef = resolveStorageRef(rawDocumentUrl, storageRef);
  const storageType = explicitStorageType ?? detectStorageType(rawDocumentUrl);
  const resolvedDocumentUrl =
    storageType === "database" ? toAbsoluteUrl(rawDocumentUrl, requestUrl) : rawDocumentUrl;

  const documentCategory = category ?? "Uncategorized";

  // ------------------------------------------------------------------
  // Credit pre-check (cloud mode only)
  // ------------------------------------------------------------------
  if (isCloudMode()) {
    // Rough estimate: 20 credits covers a typical document (OCR + embeddings)
    const estimatedCredits = shouldTranscribeFile(mimeType, originalFilename) ? 30 : 20;
    const sufficient = await hasTokens(user.companyId, estimatedCredits);
    if (!sufficient) {
      throw new Error(
        "Insufficient credits to process this document. Please add more credits to continue."
      );
    }
  }

  // Resolve the embedding index key ONCE at enqueue time and thread it through
  // the Inngest event payload. The worker must never re-resolve from DB — that
  // would race against a mid-flight `updateCompany` index switch and produce
  // embeddings under the wrong index_key. Prefer `pending` during an active
  // reindex so new docs end up in the in-flight target.
  const resolvedEmbeddingIndexKey =
    embeddingIndexKey ??
    (await resolveIngestIndexKey(user.companyId)) ??
    undefined;

  // ------------------------------------------------------------------
  // Audio file: save the original audio as a document, then create a
  // separate transcript document that goes through the embedding pipeline.
  // ------------------------------------------------------------------
  if (shouldTranscribeFile(mimeType, originalFilename)) {
    console.log(`[DocumentUpload] Audio file detected: ${documentName}, transcribing...`);

    const audioDocument = await createDocumentRecord({
      url: rawDocumentUrl,
      title: documentName,
      mimeType,
      category: documentCategory,
      companyId: user.companyId,
      ocrEnabled: false,
      ocrProcessed: true,
      storageRef: resolvedStorageRef,
      sourceOperation: "audio-upload",
    });

    // transcript document (below), not the audio itself — but we still create
    // a version row so delete/revert works consistently across file types.
    await createInitialVersion({
      documentId: audioDocument.id,
      url: rawDocumentUrl,
      mimeType: mimeType ?? null,
      uploadedBy: user.userId,
      ocrProcessed: true,
      storageObjectId: audioDocument.storageObjectId ?? undefined,
    });

    try {
      getEngine();
      const transcriptionResult = await transcribeAudioFromUrl(
        resolvedDocumentUrl,
        originalFilename || documentName,
        user.companyId,
      );

      const textBlob = await uploadFile({
        filename: `${documentName}-transcription.txt`,
        data: Buffer.from(transcriptionResult.text, "utf-8"),
        contentType: "text/plain",
        userId: user.userId,
      });

      const transcriptionMetadata = {
        source: "whisper",
        audioFilename: originalFilename || documentName,
        audioDocumentId: audioDocument.id,
        audioUrl: resolvedDocumentUrl,
        language: transcriptionResult.language,
        confidence: transcriptionResult.confidence,
        segments: transcriptionResult.segments,
        transcribedAt: new Date().toISOString(),
      };

      const transcriptName = `${documentName} (Transcription)`;

      const transcriptDocument = await createDocumentRecord({
        url: textBlob.url,
        title: transcriptName,
        mimeType: "text/plain",
        category: documentCategory,
        companyId: user.companyId,
        ocrEnabled: true,
        ocrProcessed: false,
        ocrMetadata: transcriptionMetadata,
        storageRef: textBlob.ref,
        sourceOperation: "audio-transcription",
        parentObjectId: audioDocument.storageObjectId ?? undefined,
        parentEdgeType: "audio-transcript",
      });

      // The transcript document is what goes through the OCR-to-Vector pipeline,
      // so its v1 version is the one that will receive embeddings. We capture
      // the versionId and forward it to the pipeline so every chunk/structure/
      // metadata/preview row gets tagged with the correct version.
      const transcriptVersionId = await createInitialVersion({
        documentId: transcriptDocument.id,
        url: textBlob.url,
        mimeType: "text/plain",
        uploadedBy: user.userId,
        ocrProcessed: false,
        ocrMetadata: transcriptionMetadata,
        storageObjectId: transcriptDocument.storageObjectId ?? undefined,
      });

      const { jobId, eventIds } = await triggerJob({
        documentUrl: textBlob.url,
        documentName: transcriptName,
        companyId: user.companyId,
        userId: user.userId,
        documentId: transcriptDocument.id,
        category: documentCategory,
        preferredProvider,
        mimeType: "text/plain",
        originalFilename: `${documentName}-transcription.txt`,
        transcriptionMetadata,
        versionId: transcriptVersionId,
        embeddingIndexKey: resolvedEmbeddingIndexKey,
        storageRef: textBlob.ref,
        artifactGroupId: `document:${transcriptDocument.id}`,
      });

      console.log(`[DocumentUpload] Audio + transcript saved: audio docId=${audioDocument.id}, transcript docId=${transcriptDocument.id}`);

      return {
        jobId,
        eventIds,
        storageType,
        document: audioDocument,
        resolvedDocumentUrl,
      };
    } catch (error) {
      console.error(`[DocumentUpload] Audio transcription failed for ${documentName}:`, error);
      return {
        jobId: "",
        eventIds: [],
        storageType,
        document: audioDocument,
        resolvedDocumentUrl,
      };
    }
  }

  // ------------------------------------------------------------------
  // Normal (non-audio) document processing
  // ------------------------------------------------------------------
  if (!resolvedStorageRef) {
    const [legacyDocument] = await db
      .insert(document)
      .values({
        url: rawDocumentUrl,
        title: documentName,
        mimeType: mimeType ?? null,
        category: documentCategory,
        companyId: user.companyId,
        ocrEnabled: true,
        ocrProcessed: false,
      })
      .returning({
        id: document.id,
        url: document.url,
        title: document.title,
        category: document.category,
      });

    if (!legacyDocument) {
      throw new Error("Failed to create document record");
    }

    const { jobId, eventIds } = await triggerJob({
      documentUrl: resolvedDocumentUrl,
      documentName,
      companyId: user.companyId,
      userId: user.userId,
      documentId: legacyDocument.id,
      category: documentCategory,
      preferredProvider,
      mimeType,
      originalFilename,
      isWebsite,
      embeddingIndexKey: resolvedEmbeddingIndexKey,
      storageRef: undefined,
    });

    return {
      jobId,
      eventIds,
      storageType,
      document: legacyDocument,
      resolvedDocumentUrl,
    };
  }

  const newDocument = await createDocumentRecord({
    url: rawDocumentUrl,
    title: documentName,
    mimeType,
    category: documentCategory,
    companyId: user.companyId,
    ocrEnabled: true,
    ocrProcessed: false,
    storageRef: resolvedStorageRef,
    sourceOperation: "document-upload",
  });

  // Create the v1 row for this document and lock in its file type. The
  // returned versionId is forwarded to the OCR-to-Vector pipeline so every
  // embedding/structure/metadata row gets tagged with the version it came from.
  const versionId = await createInitialVersion({
    documentId: newDocument.id,
    url: rawDocumentUrl,
    mimeType,
    uploadedBy: user.userId,
    storageObjectId: newDocument.storageObjectId ?? undefined,
  });

  const { jobId, eventIds } = await triggerJob({
    documentUrl: resolvedDocumentUrl,
    documentName,
    companyId: user.companyId,
    userId: user.userId,
    documentId: newDocument.id,
    category: documentCategory,
    preferredProvider,
    mimeType,
    originalFilename,
    isWebsite,
    versionId,
    embeddingIndexKey: resolvedEmbeddingIndexKey,
    storageRef: resolvedStorageRef,
    artifactGroupId: `document:${newDocument.id}`,
  });

  return {
    jobId,
    eventIds,
    storageType,
    document: newDocument,
    resolvedDocumentUrl,
  };
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
  embeddingIndexKey?: string;
  /** ObjectRef minted by the adapter that wrote rawDocumentUrl. */
  storageRef?: ObjectRef;
}

export async function processVideoUrlUpload({
  user,
  videoUrl,
  category,
  title,
  preferredProvider,
  embeddingIndexKey,
  storageRef,
}: VideoUrlUploadParams): Promise<DocumentUploadResult> {
  if (!isVideoUrl(videoUrl)) {
    throw new Error("Unsupported video URL. Supported platforms include YouTube, Vimeo, TikTok, Twitter/X, and more.");
  }

  const documentCategory = category;

  const resolvedEmbeddingIndexKey =
    embeddingIndexKey ??
    (await resolveIngestIndexKey(user.companyId)) ??
    undefined;

  console.log(`[DocumentUpload] Video URL detected: ${videoUrl}, downloading & transcribing...`);

  // 1. Transcribe via sidecar (downloads audio with yt-dlp, then runs Whisper)
  const transcriptionResult = await transcribeVideoFromUrl(videoUrl);

  const documentName = title || transcriptionResult.title || "Video Transcription";

  // 2. Store the transcript as a text file in blob storage
  const textBlob = await getEngine().storage
    .forAdapter("vercel-blob")
    .put({
      filename: `${documentName}-transcription.txt`,
      data: Buffer.from(transcriptionResult.text, "utf-8"),
      contentType: "text/plain",
    });

  const transcriptionMetadata = {
    source: "whisper-ytdlp",
    videoTitle: transcriptionResult.title,
    videoDuration: transcriptionResult.duration,
    videoUrl,
    language: transcriptionResult.language,
    confidence: transcriptionResult.confidence,
    transcribedAt: new Date().toISOString(),
  };

  const transcriptName = `${documentName} (Transcription)`;
  const sourceObjectId = storageRef
    ? await findManifestObjectIdForRef(storageRef, user.companyId)
    : undefined;

  // 3. Create the transcript document record
  const transcriptDocument = await createDocumentRecord({
    url: textBlob.url,
    title: transcriptName,
    mimeType: "text/plain",
    category: documentCategory,
    companyId: user.companyId,
    ocrEnabled: true,
    ocrProcessed: false,
    ocrMetadata: transcriptionMetadata,
    storageRef: textBlob.ref,
    sourceOperation: "video-transcription",
    parentObjectId: sourceObjectId,
    parentEdgeType: "video-transcript",
  });

  const transcriptVersionId = await createInitialVersion({
    documentId: transcriptDocument.id,
    url: textBlob.url,
    mimeType: "text/plain",
    uploadedBy: user.userId,
    ocrProcessed: false,
    ocrMetadata: transcriptionMetadata,
    storageObjectId: transcriptDocument.storageObjectId ?? undefined,
  });

  // 4. Trigger embedding pipeline
  const { jobId, eventIds } = await triggerJob({
    documentUrl: textBlob.url,
    documentName: transcriptName,
    companyId: user.companyId,
    userId: user.userId,
    documentId: transcriptDocument.id,
    category: documentCategory,
    preferredProvider,
    mimeType: "text/plain",
    originalFilename: `${documentName}-transcription.txt`,
    transcriptionMetadata,
    versionId: transcriptVersionId,
    embeddingIndexKey: resolvedEmbeddingIndexKey,
    storageRef: textBlob.ref,
    artifactGroupId: `document:${transcriptDocument.id}`,
  });

  console.log(`[DocumentUpload] Video transcript saved: docId=${transcriptDocument.id}, title="${documentName}"`);

  return {
    jobId,
    eventIds,
    storageType: detectStorageType(textBlob.url),
    document: transcriptDocument,
    resolvedDocumentUrl: textBlob.url,
  };
}
