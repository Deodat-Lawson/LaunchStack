/**
 * Core logic for B5 (batch document delete API), pulled out of the route
 * handler so it's directly testable — Clerk auth can't be exercised from a
 * plain script, but everything after auth can be. Mirrors the structure of
 * delete-document-api.ts (B4).
 *
 * Statuses follow Decision 6a's batch rule: the batch is "partial" when at
 * least one document completed and at least one did not. See rollUpBatchStatus.
 */

import {
  requestBatchDocumentDeletionAndDispatch,
  DocumentNotFoundError,
  TenantMismatchError,
} from "./storage-deletion-coordinator";
import { isLifecycleEnabled } from "./delete-document-api";
import {
  BatchDeleteDocumentsResponseSchema,
  validateApiResponse,
} from "~/lib/api-response-schemas";

/** Per-document status, drawn from the frozen deletion status enum. */
export type DeletionStatus =
  | "queued"
  | "completed"
  | "partial"
  | "manual_review"
  | "quarantined";

export interface BatchDeleteDocumentEntry {
  documentId: number;
  status: DeletionStatus;
  /** Absent for documents answered from an existing tombstone. */
  requestId?: number;
  /** Files this document shares with an earlier document in the same batch. */
  linkedItemCount?: number;
}

export interface BatchDeleteDocumentsApiResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Decision 6a's batch rule, applied to the per-document statuses.
 *
 *   - every document completed          -> "completed"
 *   - >=1 completed AND >=1 not         -> "partial"
 *   - otherwise, nothing completed      -> the most severe status present,
 *                                          with "quarantined" dominating
 *                                          "manual_review" (Decision 6)
 *
 * Note this describes the batch as it stands *at accept time*: most
 * documents will read "queued", because the actual provider deletes happen
 * asynchronously in the worker. "completed" here only ever comes from a
 * document that was already fully deleted before this request arrived.
 */
export function rollUpBatchStatus(statuses: DeletionStatus[]): DeletionStatus {
  if (statuses.length === 0) return "completed";

  const completed = statuses.filter((s) => s === "completed").length;
  if (completed === statuses.length) return "completed";
  if (completed > 0) return "partial";

  if (statuses.includes("quarantined")) return "quarantined";
  if (statuses.includes("manual_review")) return "manual_review";
  if (statuses.includes("partial")) return "partial";
  return "queued";
}

/**
 * Everything the route does after authentication/role/company checks: flag
 * gate, call the batch coordinator, map the result (or a thrown error) to an
 * HTTP status + body.
 *
 * Deliberate difference from B4: a tenant mismatch maps to 404, not 403.
 * The pre-existing batch route answered "One or more documents not found"
 * for a cross-company id specifically so it can't be used to probe which
 * document ids exist in other companies, and the design doc says the
 * auth/company checks are preserved. B4's 403 is fine there because the
 * caller already named a single document they can see.
 *
 * There is no cross-provider atomic rollback promise here (design doc B5):
 * the *plan* for all documents is written in one transaction, but the actual
 * provider deletes happen per item in the worker, and a file already removed
 * from S3 is not un-removable if a later one fails.
 */
/** B8: check the declared response shape on the way out (dev/test only). */
function checked(
  status: number,
  body: Record<string, unknown>,
): BatchDeleteDocumentsApiResult {
  return {
    status,
    body: validateApiResponse(BatchDeleteDocumentsResponseSchema, body, "batch delete response"),
  };
}

export async function handleBatchDeleteDocumentsRequest(params: {
  documentIds: number[];
  companyId: number;
  actorId: string;
}): Promise<BatchDeleteDocumentsApiResult> {
  if (!isLifecycleEnabled()) {
    // Flag off never falls back to the old direct-delete path — that path
    // is removed, not bypassed (Decision 7).
    return checked(503, {
      success: false,
      error: "Document deletion is not currently enabled.",
    });
  }

  let results;
  try {
    results = await requestBatchDocumentDeletionAndDispatch({
      docIds: params.documentIds,
      companyId: params.companyId,
      actorId: params.actorId,
    });
  } catch (err) {
    // Typed errors, checked by type — never by substring-matching a message.
    if (err instanceof DocumentNotFoundError) {
      return checked(404, { success: false, error: "One or more documents not found" });
    }
    if (err instanceof TenantMismatchError) {
      return checked(404, { success: false, error: "One or more documents not found" });
    }
    // Anything else — including DispatchFailedError, where the whole batch
    // was written and then rolled back — is a genuine hard failure. Let it
    // bubble to the route's outer catch, which returns 500.
    throw err;
  }

  const documents: BatchDeleteDocumentEntry[] = results.map((result) =>
    result.kind === "already-completed"
      ? {
          documentId: result.docId,
          status: result.tombstone.finalStatus as DeletionStatus,
        }
      : {
          documentId: result.docId,
          status: result.request.status as DeletionStatus,
          requestId: result.request.id,
          linkedItemCount: result.linkedItemCount,
        },
  );

  const createdCount = results.filter((r) => r.kind === "created").length;
  const batchStatus = rollUpBatchStatus(documents.map((d) => d.status));
  const dedupedFileCount = documents.reduce(
    (total, doc) => total + (doc.linkedItemCount ?? 0),
    0,
  );

  // 202 whenever real work was accepted but isn't done yet; 200 only when
  // every document in the batch was already fully deleted beforehand, so
  // nothing new was queued.
  return checked(createdCount > 0 ? 202 : 200, {
    success: true,
    status: batchStatus,
    accepted: createdCount,
    alreadyCompleted: documents.length - createdCount,
    // Files that more than one document in this batch pointed at, and so
    // will be deleted exactly once rather than once per document.
    dedupedFileCount,
    documents,
    message:
      createdCount > 0
        ? `Deletion accepted for ${createdCount} document${createdCount === 1 ? "" : "s"} and is now in progress.`
        : "All requested documents were already deleted.",
  });
}
