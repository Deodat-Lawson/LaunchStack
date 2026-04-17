import {
  shouldTranscribeFile,
  transcribeAudioFromUrl,
} from "~/lib/audio/transcription";
import { putFile } from "~/server/storage/vercel-blob";
import {
  detectStorageType,
  toAbsoluteUrl,
  type StorageType,
} from "./detect-storage-type";
import { createDocumentRecord } from "./create-document";
import { triggerJob } from "./trigger-job";
import { hasTokens } from "~/lib/credits";
import { isCloudMode } from "~/lib/providers/registry";

export type { StorageType } from "./detect-storage-type";
export { detectStorageType, toAbsoluteUrl } from "./detect-storage-type";

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
}: DocumentUploadParams): Promise<DocumentUploadResult> {
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
    });

    try {
      const transcriptionResult = await transcribeAudioFromUrl(
        resolvedDocumentUrl,
        originalFilename || documentName,
        user.companyId,
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

      const transcriptDocument = await createDocumentRecord({
        url: textBlob.url,
        title: transcriptName,
        mimeType: "text/plain",
        category: documentCategory,
        companyId: user.companyId,
        ocrEnabled: true,
        ocrProcessed: false,
        ocrMetadata: transcriptionMetadata,
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
  const newDocument = await createDocumentRecord({
    url: rawDocumentUrl,
    title: documentName,
    mimeType,
    category: documentCategory,
    companyId: user.companyId,
    ocrEnabled: true,
    ocrProcessed: false,
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
  });

  return {
    jobId,
    eventIds,
    storageType,
    document: newDocument,
    resolvedDocumentUrl,
  };
}
