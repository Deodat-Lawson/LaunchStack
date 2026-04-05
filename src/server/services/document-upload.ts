import { db } from "~/server/db";
import { document, ocrJobs } from "~/server/db/schema";
import { parseProvider, triggerDocumentProcessing } from "~/lib/ocr/trigger";
import {
  shouldTranscribeFile,
  transcribeAudioFromUrl,
} from "~/lib/audio/transcription";
import { putFile } from "~/server/storage/vercel-blob";

export type StorageType = "cloud" | "database";

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
 */
export function detectStorageType(url: string): StorageType {
  if (url.startsWith("/api/files/")) {
    return "database";
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
}: DocumentUploadParams): Promise<DocumentUploadResult> {
  const storageType = explicitStorageType ?? detectStorageType(rawDocumentUrl);
  const resolvedDocumentUrl =
    storageType === "database" ? toAbsoluteUrl(rawDocumentUrl, requestUrl) : rawDocumentUrl;

  const documentCategory = category ?? "Uncategorized";
  const companyIdString = user.companyId.toString();

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

    // 2. Transcribe and create a separate transcript document
    try {
      const transcriptionResult = await transcribeAudioFromUrl(
        resolvedDocumentUrl,
        originalFilename || documentName
      );

      const textBlob = await putFile({
        filename: `${documentName}-transcription.txt`,
        data: Buffer.from(transcriptionResult.text, "utf-8"),
        contentType: "text/plain",
      });

      const transcriptionMetadata = {
        source: "whisper",
        audioFilename: originalFilename || documentName,
        audioDocumentId: audioDocument.id,
        audioUrl: resolvedDocumentUrl,
        language: transcriptionResult.language,
        confidence: transcriptionResult.confidence,
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
