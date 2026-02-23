import { db } from "~/server/db";
import { document, ocrJobs } from "~/server/db/schema";
import { parseProvider, triggerDocumentProcessing } from "~/lib/ocr/trigger";

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
}: DocumentUploadParams): Promise<DocumentUploadResult> {
  const storageType = explicitStorageType ?? detectStorageType(rawDocumentUrl);
  const resolvedDocumentUrl =
    storageType === "database" ? toAbsoluteUrl(rawDocumentUrl, requestUrl) : rawDocumentUrl;

  const documentCategory = category ?? "Uncategorized";
  const companyIdString = user.companyId.toString();

  const [newDocument] = await db
    .insert(document)
    .values({
      url: rawDocumentUrl,
      title: documentName,
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
