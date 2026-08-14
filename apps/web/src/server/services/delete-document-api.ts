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

export interface DeleteDocumentApiResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Matches the raw-env-var pattern the existing A6a test already expects
 * (STORAGE_DELETION_LIFECYCLE_ENABLED) — no formal env.ts entry yet,
 * that's Dev C's flag to own/wire up properly.
 */
export function isLifecycleEnabled(): boolean {
  const raw = process.env.STORAGE_DELETION_LIFECYCLE_ENABLED;
  return raw === "true" || raw === "1";
}

/**
 * Everything the route does after authentication/role checks: flag gate,
 * call the coordinator, map the result (or a thrown error) to an HTTP
 * status + body. Never reports "deleted successfully" on SQL alone — see
 * Decision 6/6a in the design doc.
 */
export async function handleDeleteDocumentRequest(params: {
  documentId: number;
  companyId: number;
  actorId: string;
}): Promise<DeleteDocumentApiResult> {
  if (!isLifecycleEnabled()) {
    // Flag off never falls back to the old direct-delete path — that path
    // is removed, not bypassed (Decision 7).
    return {
      status: 503,
      body: { success: false, error: "Document deletion is not currently enabled." },
    };
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
      return { status: 404, body: { success: false, error: "Document not found." } };
    }
    if (err instanceof TenantMismatchError) {
      return { status: 403, body: { success: false, error: "Unauthorized" } };
    }
    // Anything else — including DispatchFailedError (the worker couldn't
    // be notified) — is a genuine hard failure. Let it bubble up to the
    // route's outer catch, which returns 500.
    throw err;
  }

  if (result.kind === "already-completed") {
    // Idempotent re-delete (design doc B3 item 8): nothing new happened,
    // this document was already fully processed before.
    return {
      status: 200,
      body: {
        success: true,
        status: result.tombstone.finalStatus,
        documentId: params.documentId,
        message:
          result.tombstone.finalStatus === "completed"
            ? "This document was already deleted."
            : "This document's deletion was already quarantined and needs manual review.",
      },
    };
  }

  // A new request was created — accepted, but not yet complete.
  return {
    status: 202,
    body: {
      success: true,
      status: result.request.status,
      requestId: result.request.id,
      documentId: params.documentId,
      message:
        result.request.status === "quarantined"
          ? "Deletion accepted, but some files could not be confidently identified and require manual review."
          : "Deletion request accepted and is now in progress.",
    },
  };
}
