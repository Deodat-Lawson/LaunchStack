import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { document, documentVersions, ocrJobs } from "~/server/db/schema";
import { parseProvider, triggerDocumentProcessing } from "~/lib/ocr/trigger";
import { resolveIngestIndexKey } from "~/lib/ai/company-reindex-state";
import {
  shouldTranscribeFile,
  transcribeAudioFromUrl,
  isVideoUrl,
  transcribeVideoFromUrl,
} from "~/lib/audio/transcription";
import { uploadFile } from "~/lib/storage";

export type StorageType = "cloud" | "database" | "local";

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
 * Determines the storage type from the URL. Relative URLs are treated as database storage.
 * Local S3 URLs (matching NEXT_PUBLIC_S3_ENDPOINT) are treated as local storage.
 */
export function detectStorageType(url: string): StorageType {
  if (url.startsWith("/api/files/")) {
    return "database";
  }
  const s3Endpoint = process.env.NEXT_PUBLIC_S3_ENDPOINT;
  if (s3Endpoint && url.startsWith(s3Endpoint)) {
    return "local";
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return "cloud";
  }
  return "database";
}

/**
 * Converts a relative URL to an absolute URL using the current request origin.
 */
export function toAbsoluteUrl(url: string, requestUrl: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  const parsedUrl = new URL(requestUrl);
  const origin = parsedUrl.origin;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
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
}): Promise<number> {
  const { documentId, url, mimeType, uploadedBy, ocrProcessed, ocrMetadata } = params;

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
  embeddingIndexKey,
}: DocumentUploadParams): Promise<DocumentUploadResult> {
  const storageType = explicitStorageType ?? detectStorageType(rawDocumentUrl);
  const resolvedDocumentUrl =
    storageType === "database" ? toAbsoluteUrl(rawDocumentUrl, requestUrl) : rawDocumentUrl;

  const documentCategory = category ?? "Uncategorized";
  const companyIdString = user.companyId.toString();
  // Resolve the index key ONCE at enqueue time and thread it through the
  // Inngest event payload. The worker must never re-resolve from DB — that
  // would race against a mid-flight `updateCompany` index switch and
  // produce embeddings under the wrong index_key. Prefer `pending` during
  // an active reindex so new docs end up in the in-flight target.
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

    // 1. Save the original audio file as a document (marked as processed — nothing more to do)
    const [audioDocument] = await db
      .insert(document)
      .values({
        url: rawDocumentUrl,
        title: documentName,
        mimeType: mimeType ?? null,
        category: documentCategory,
        companyId: user.companyId,
        ocrEnabled: false,
        ocrProcessed: true,
      })
      .returning({
        id: document.id,
        url: document.url,
        title: document.title,
        category: document.category,
      });

    if (!audioDocument) {
      throw new Error("Failed to create audio document record");
    }

    // The original audio file is its own v1. Embeddings are generated from the
    // transcript document (below), not the audio itself — but we still create
    // a version row so delete/revert works consistently across file types.
    await createInitialVersion({
      documentId: audioDocument.id,
      url: rawDocumentUrl,
      mimeType: mimeType ?? null,
      uploadedBy: user.userId,
      ocrProcessed: true,
    });

    // 2. Transcribe and create a separate transcript document
    try {
      const transcriptionResult = await transcribeAudioFromUrl(
        resolvedDocumentUrl,
        originalFilename || documentName
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

      const [transcriptDocument] = await db
        .insert(document)
        .values({
          url: textBlob.url,
          title: transcriptName,
          mimeType: "text/plain",
          category: documentCategory,
          companyId: user.companyId,
          ocrEnabled: true,
          ocrProcessed: false,
          ocrMetadata: transcriptionMetadata,
        })
        .returning({
          id: document.id,
          url: document.url,
          title: document.title,
          category: document.category,
        });

      if (!transcriptDocument) {
        throw new Error("Failed to create transcript document record");
      }

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
      });

      const { jobId, eventIds } = await triggerDocumentProcessing(
        textBlob.url,
        transcriptName,
        companyIdString,
        user.userId,
        transcriptDocument.id,
        documentCategory,
        {
          preferredProvider: parseProvider(preferredProvider),
          mimeType: "text/plain",
          originalFilename: `${documentName}-transcription.txt`,
          transcriptionMetadata,
          versionId: transcriptVersionId,
          embeddingIndexKey: resolvedEmbeddingIndexKey,
        }
      );

      await db.insert(ocrJobs).values({
        id: jobId,
        companyId: user.companyId,
        userId: user.userId,
        status: "queued",
        documentUrl: textBlob.url,
        documentName: transcriptName,
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
      // Transcription failed but the audio document is still saved
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
  const [newDocument] = await db
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

  if (!newDocument) {
    throw new Error("Failed to create document record");
  }

  // Create the v1 row for this document and lock in its file type. The
  // returned versionId is forwarded to the OCR-to-Vector pipeline so every
  // embedding/structure/metadata row gets tagged with the version it came from.
  const versionId = await createInitialVersion({
    documentId: newDocument.id,
    url: rawDocumentUrl,
    mimeType,
    uploadedBy: user.userId,
  });

  const { jobId, eventIds } = await triggerDocumentProcessing(
    resolvedDocumentUrl,
    documentName,
    companyIdString,
    user.userId,
    newDocument.id,
    documentCategory,
    {
      preferredProvider: parseProvider(preferredProvider),
      mimeType,
      originalFilename,
      versionId,
      embeddingIndexKey: resolvedEmbeddingIndexKey,
    }
  );

  await db.insert(ocrJobs).values({
    id: jobId,
    companyId: user.companyId,
    userId: user.userId,
    status: "queued",
    documentUrl: resolvedDocumentUrl,
    documentName,
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
}

export async function processVideoUrlUpload({
  user,
  videoUrl,
  requestUrl,
  category,
  title,
  preferredProvider,
}: VideoUrlUploadParams): Promise<DocumentUploadResult> {
  if (!isVideoUrl(videoUrl)) {
    throw new Error("Unsupported video URL. Supported platforms include YouTube, Vimeo, TikTok, Twitter/X, and more.");
  }

  const documentCategory = category;
  const companyIdString = user.companyId.toString();

  console.log(`[DocumentUpload] Video URL detected: ${videoUrl}, downloading & transcribing...`);

  // 1. Transcribe via sidecar (downloads audio with yt-dlp, then runs Whisper)
  const transcriptionResult = await transcribeVideoFromUrl(videoUrl);

  const documentName = title || transcriptionResult.title || "Video Transcription";

  // 2. Store the transcript as a text file in blob storage
  const textBlob = await putFile({
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

  // 3. Create the transcript document record
  const [transcriptDocument] = await db
    .insert(document)
    .values({
      url: textBlob.url,
      title: transcriptName,
      mimeType: "text/plain",
      category: documentCategory,
      companyId: user.companyId,
      ocrEnabled: true,
      ocrProcessed: false,
      ocrMetadata: transcriptionMetadata,
    })
    .returning({
      id: document.id,
      url: document.url,
      title: document.title,
      category: document.category,
    });

  if (!transcriptDocument) {
    throw new Error("Failed to create transcript document record");
  }

  // 4. Trigger embedding pipeline
  const { jobId, eventIds } = await triggerDocumentProcessing(
    textBlob.url,
    transcriptName,
    companyIdString,
    user.userId,
    transcriptDocument.id,
    documentCategory,
    {
      preferredProvider: parseProvider(preferredProvider),
      mimeType: "text/plain",
      originalFilename: `${documentName}-transcription.txt`,
      transcriptionMetadata,
    }
  );

  await db.insert(ocrJobs).values({
    id: jobId,
    companyId: user.companyId,
    userId: user.userId,
    status: "queued",
    documentUrl: textBlob.url,
    documentName: transcriptName,
  });

  console.log(`[DocumentUpload] Video transcript saved: docId=${transcriptDocument.id}, title="${documentName}"`);

  return {
    jobId,
    eventIds,
    storageType: "cloud",
    document: transcriptDocument,
    resolvedDocumentUrl: textBlob.url,
  };
}
