import { db } from "~/server/db";
import { document } from "@launchstack/core/db/schema";

export interface CreateDocumentParams {
  url: string;
  title: string;
  mimeType?: string | null;
  category: string;
  companyId: bigint;
  ocrEnabled: boolean;
  ocrProcessed: boolean;
  ocrMetadata?: Record<string, unknown>;
}

export interface CreatedDocument {
  id: number;
  url: string;
  title: string;
  category: string;
}

/**
 * Inserts a document record into the database and returns the minimal fields
 * used by the upload pipeline.
 */
export async function createDocumentRecord(
  params: CreateDocumentParams,
): Promise<CreatedDocument> {
  const [row] = await db
    .insert(document)
    .values({
      url: params.url,
      title: params.title,
      mimeType: params.mimeType ?? null,
      category: params.category,
      companyId: params.companyId,
      ocrEnabled: params.ocrEnabled,
      ocrProcessed: params.ocrProcessed,
      ...(params.ocrMetadata ? { ocrMetadata: params.ocrMetadata } : {}),
    })
    .returning({
      id: document.id,
      url: document.url,
      title: document.title,
      category: document.category,
    });

  if (!row) {
    throw new Error("Failed to create document record");
  }

  return row;
}
