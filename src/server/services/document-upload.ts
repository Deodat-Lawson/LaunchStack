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

  // Check if this is an audio file that needs transcription
  let transcriptionMetadata: object | null = null;
  let finalMimeType = mimeType ?? null;
  let finalDocumentName = documentName;
  let finalDocumentUrl = resolvedDocumentUrl;

  if (shouldTranscribeFile(mimeType, originalFilename)) {
    console.log(`[DocumentUpload] Audio file detected: ${documentName}, transcribing...`);

    try {
      const transcriptionResult = await transcribeAudioFromUrl(
        resolvedDocumentUrl,
        originalFilename || documentName
      );

      // Upload the transcribed text as a .txt file so the pipeline can process it
      const textBlob = await putFile({
        filename: `${documentName}-transcription.txt`,
        data: Buffer.from(transcriptionResult.text, "utf-8"),
        contentType: "text/plain",
      });
      finalDocumentUrl = textBlob.url;

      transcriptionMetadata = {
        source: "whisper",
        audioFilename: originalFilename || documentName,
        audioUrl: resolvedDocumentUrl,
        language: transcriptionResult.language,
        confidence: transcriptionResult.confidence,
        transcribedAt: new Date().toISOString(),
      };

      // Update the document name to indicate it's a transcription
      finalDocumentName = `${documentName} (Transcription)`;

      // Mark as text for processing
      finalMimeType = "text/plain";

      console.log(`[DocumentUpload] Successfully transcribed audio: ${documentName}, text stored at ${textBlob.url}`);
    } catch (error) {
      console.error(`[DocumentUpload] Audio transcription failed for ${documentName}:`, error);
      transcriptionMetadata = {
        source: "whisper",
        audioFilename: originalFilename || documentName,
        error: error instanceof Error ? error.message : "Unknown error",
        failedAt: new Date().toISOString(),
      };
    }
  }

  const [newDocument] = await db
    .insert(document)
    .values({
      url: finalDocumentUrl,
      title: finalDocumentName,
      mimeType: finalMimeType,
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

  if (!newDocument) {
    throw new Error("Failed to create document record");
  }

  const { jobId, eventIds } = await triggerDocumentProcessing(
    finalDocumentUrl,
    finalDocumentName,
    companyIdString,
    user.userId,
    newDocument.id,
    documentCategory,
    {
      preferredProvider: parseProvider(preferredProvider),
      mimeType: finalMimeType,
      originalFilename: finalMimeType === "text/plain" && shouldTranscribeFile(mimeType, originalFilename)
        ? `${documentName}-transcription.txt`
        : originalFilename,
      transcriptionMetadata,
    }
  );

  await db.insert(ocrJobs).values({
    id: jobId,
    companyId: user.companyId,
    userId: user.userId,
    status: "queued",
    documentUrl: finalDocumentUrl,
    documentName: finalDocumentName,
  });

  return {
    jobId,
    eventIds,
    storageType,
    document: newDocument,
    resolvedDocumentUrl,
  };
}
