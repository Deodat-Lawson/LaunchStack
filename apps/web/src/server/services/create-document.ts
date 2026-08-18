import type { ObjectRef } from "@launchstack/core/storage";
import { document } from "@launchstack/core/db/schema";

import { db } from "~/server/db";
import { registerArtifactEdge, claimObjectForDocument } from "./storage-manifest";

export interface CreateDocumentParams {
  url: string;
  title: string;
  mimeType?: string | null;
  category: string;
  companyId: bigint;
  ocrEnabled: boolean;
  ocrProcessed: boolean;
  ocrMetadata?: Record<string, unknown>;
  /** ObjectRef minted by the adapter that wrote the document bytes. */
  storageRef: ObjectRef;
  sizeBytes?: number;
  checksum?: string;
  sourceOperation?: string;
  /** Optional parent artifact for derived documents. */
  parentObjectId?: number;
  parentEdgeType?: string;
}

export interface CreatedDocument {
  id: number;
  url: string;
  title: string;
  category: string;
  /** Manifest row for the uploaded source object. */
  storageObjectId: number;
}

/**
 * Insert a document and its storage manifest row in one transaction. A
 * document is never returned as active unless deletion can later discover the
 * object through storage_objects.
 */
export async function createDocumentRecord(
  params: CreateDocumentParams,
): Promise<CreatedDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx
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

    const manifest = await claimObjectForDocument(tx, {
      ref: params.storageRef,
      companyId: params.companyId,
      documentId: row.id,
      contentType: params.mimeType ?? undefined,
      sizeBytes: params.sizeBytes,
      checksum: params.checksum,
      sourceOperation: params.sourceOperation ?? "document-create",
    });

    if (params.parentObjectId !== undefined) {
      await registerArtifactEdge(tx, {
        parentObjectId: params.parentObjectId,
        childObjectId: manifest.id,
        edgeType: params.parentEdgeType ?? "derived-document",
      });
    }

    return { ...row, storageObjectId: manifest.id };
  });
}