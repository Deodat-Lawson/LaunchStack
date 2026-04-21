/**
 * Shared document deletion helper.
 *
 * Extracted from /api/deleteDocument/route.ts so both single and batch delete
 * endpoints use the exact same cascade logic. Runs inside a caller-supplied
 * transaction so multi-doc batches are atomic.
 *
 * Order of operations matters: RLM tables reference each other via FKs, and
 * the final `document` row has cascading children across many tables.
 */

import { eq } from "drizzle-orm";
import {
  ChatHistory,
  document,
  documentMetadata,
  documentPreviews,
  documentReferenceResolution,
  documentRetrievalChunks,
  documentSections,
  documentStructure,
  documentViews,
  kgEntityMentions,
  predictiveDocumentAnalysisResults,
  workspaceResults,
} from "@launchstack/core/db/schema";
import type { db as DbType } from "~/server/db";

type Tx = Parameters<Parameters<(typeof DbType)["transaction"]>[0]>[0];

export async function deleteDocumentCore(tx: Tx, docId: number): Promise<void> {
  const docIdBig = BigInt(docId);

  await tx.delete(ChatHistory).where(eq(ChatHistory.documentId, docIdBig));
  await tx
    .delete(documentReferenceResolution)
    .where(eq(documentReferenceResolution.resolvedInDocumentId, docId));
  await tx
    .delete(predictiveDocumentAnalysisResults)
    .where(eq(predictiveDocumentAnalysisResults.documentId, docIdBig));
  await tx.delete(documentViews).where(eq(documentViews.documentId, docIdBig));

  // RLM tables — order matters: leaf tables before the tables they reference.
  // kgEntityMentions & workspaceResults & documentPreviews reference documentSections;
  // documentRetrievalChunks references documentSections and document.
  await tx.delete(kgEntityMentions).where(eq(kgEntityMentions.documentId, docIdBig));
  await tx.delete(workspaceResults).where(eq(workspaceResults.documentId, docIdBig));
  await tx.delete(documentPreviews).where(eq(documentPreviews.documentId, docIdBig));
  await tx
    .delete(documentRetrievalChunks)
    .where(eq(documentRetrievalChunks.documentId, docIdBig));
  await tx.delete(documentSections).where(eq(documentSections.documentId, docIdBig));
  await tx.delete(documentStructure).where(eq(documentStructure.documentId, docIdBig));
  await tx.delete(documentMetadata).where(eq(documentMetadata.documentId, docIdBig));

  await tx.delete(document).where(eq(document.id, docId));
}
