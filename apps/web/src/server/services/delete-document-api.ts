/**
 * Core logic for B4 (single document delete API), pulled out of the route
 * handler so it's directly testable — Clerk auth can't be exercised from a
 * plain script, but everything after auth can be.
 */

import {
  requestDocumentDeletionAndDispatch,
  DocumentNotFoundError,
  TenantMismatchError,
} from "./storage-deletion-coordinator";
import { isStorageDeletionLifecycleEnabled } from "./storage-deletion-flags";
import {
  DeleteDocumentResponseSchema,
  validateApiResponse,
} from "~/lib/api-response-schemas";

export interface DeleteDocumentApiResult {
  status: number;
  body: Record<string, unknown>;
}

export const isLifecycleEnabled = isStorageDeletionLifecycleEnabled;

/**
 * Everything the route does after authentication/role checks: flag gate,
 * call the coordinator, map the result (or a thrown error) to an HTTP
 * status + body. Never reports "deleted successfully" on SQL alone — see
 * Decision 6/6a in the design doc.
 */
/** B8: check the declared response shape on the way out (dev/test only). */
function checked(status: number, body: Record<string, unknown>): DeleteDocumentApiResult {
  return { status, body: validateApiResponse(DeleteDocumentResponseSchema, body, "single delete response") };
}

export async function handleDeleteDocumentRequest(params: {
  documentId: number;
  companyId: number;
  actorId: string;
}): Promise<DeleteDocumentApiResult> {
  if (!isLifecycleEnabled()) {
    // Flag off never falls back to the old direct-delete path — that path
    // is removed, not bypassed (Decision 7).
    return checked(503, {
      success: false,
      error: "Document deletion is not currently enabled.",
    });
  }

  let result;
  try {
    result = await requestDocumentDeletionAndDispatch({
      docId: params.documentId,
      companyId: params.companyId,
      actorId: params.actorId,
    });
  } catch (err) {
    // Typed errors, checked by type — not string-matching on the message.
    // (An unrelated error whose text happens to contain "not found", like
    // an Inngest "event key not found" failure, must never be confused
    // with a real document-not-found case.)
    if (err instanceof DocumentNotFoundError) {
      return checked(404, { success: false, error: "Document not found." });
    }
    if (err instanceof TenantMismatchError) {
      return checked(403, { success: false, error: "Unauthorized" });
    }
    // Anything else — including DispatchFailedError (the worker couldn't
    // be notified) — is a genuine hard failure. Let it bubble up to the
    // route's outer catch, which returns 500.
    throw err;
  }

  if (result.kind === "already-completed") {
    // Idempotent re-delete (design doc B3 item 8): nothing new happened,
    // this document was already fully processed before.
    return checked(200, {
      success: true,
      status: result.tombstone.finalStatus,
      documentId: params.documentId,
      message:
        result.tombstone.finalStatus === "completed"
          ? "This document was already deleted."
          : "This document's deletion was already quarantined and needs manual review.",
    });
  }

  // A new request was created — accepted, but not yet complete.
  return checked(202, {
    success: true,
    status: result.request.status,
    requestId: result.request.id,
    documentId: params.documentId,
    message:
      result.request.status === "quarantined"
        ? "Deletion accepted, but some files could not be confidently identified and require manual review."
        : "Deletion request accepted and is now in progress.",
  });
}
