/**
 * Relationship checks for the document a note is anchored to.
 *
 * `documentId` and `versionId` arrive from the client on note creation and
 * are stored verbatim, so both have to be proven: the document must be one
 * the caller may read in the active workspace, and the version must belong
 * to that document. Otherwise a note can be filed against another tenant's
 * (or a restricted) document and shows up in that document's note list for
 * anyone able to name the id. A document outside the caller's scope reads
 * as missing — 404, never 403.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { document, documentVersions } from "@launchstack/store/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";

type TargetResult = { ok: true } | { ok: false; response: NextResponse };

const invalid = (message: string, status: number): TargetResult => ({
  ok: false,
  response: NextResponse.json({ error: message }, { status }),
});

export async function validateNoteTarget(params: {
  documentId: string | null | undefined;
  versionId: number | string | bigint | null | undefined;
  companyId: bigint;
  /** The caller's document scope, resolved once by the route (`ctx.data.documentScope()`). */
  scope: DocumentScope;
}): Promise<TargetResult> {
  const { documentId, versionId, companyId, scope } = params;

  if (documentId == null || documentId === "") {
    // Freeform note. A version only means something relative to a document.
    if (versionId != null) {
      return invalid("versionId requires documentId", 400);
    }
    return { ok: true };
  }

  const numericDocumentId = Number(documentId);
  if (!Number.isSafeInteger(numericDocumentId) || numericDocumentId <= 0) {
    return invalid("Invalid documentId", 400);
  }

  const [doc] = await db
    .select({ id: document.id })
    .from(document)
    .where(
      and(
        eq(document.id, numericDocumentId),
        scopedDocumentWhere(companyId, scope),
      ),
    );

  if (!doc) return invalid("Document not found", 404);

  if (versionId == null) return { ok: true };

  const numericVersionId = Number(versionId);
  if (!Number.isSafeInteger(numericVersionId) || numericVersionId <= 0) {
    return invalid("Invalid versionId", 400);
  }

  const [version] = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, numericVersionId),
        eq(documentVersions.documentId, BigInt(numericDocumentId)),
      ),
    );

  if (!version) return invalid("Document version not found", 404);

  return { ok: true };
}
