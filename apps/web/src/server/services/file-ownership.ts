/**
 * B8 — tenant auth before resolving or serving any manifest ref.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE
 * --------------------------------
 * A normal tenant check is "does this row's company match the caller's".
 * file_uploads can't answer that: it records only the userId of whoever
 * uploaded the bytes, never a company (see its schema — user_id, no
 * company_id). And a user can belong to several companies
 * (user_company_memberships), so "the uploader's company" is not the same
 * question as "the company that owns this file".
 *
 * So ownership is derived indirectly, from four sources, strongest first.
 * The resolution reports WHICH source answered, because they are not equally
 * good evidence and a caller enforcing on "uploader" is standing on much
 * thinner ground than one enforcing on "manifest":
 *
 *   manifest          storage_objects row for (database, <fileId>). This is
 *                     the record the whole project exists to create, and it
 *                     carries a real companyId FK. Definitive.
 *   document          a document whose url IS this file. The url is the
 *                     canonical stored address, so this is strong.
 *   document_version  same, via a version row; slightly weaker only because
 *                     the company comes from the parent document.
 *   uploader          file_uploads.userId -> users.companyId. Weakest: it
 *                     names a person, not a tenant, and that person's company
 *                     can change after the upload.
 *
 * Nothing here deletes or serves anything — it answers "who owns this", and
 * checkFileUploadTenantAccess turns that into an allow/deny that the route
 * can apply or merely observe.
 */

import { and, eq } from "drizzle-orm";
import {
  document,
  documentVersions,
  fileUploads,
  storageObjects,
  userCompanyMemberships,
  users,
} from "@launchstack/core/db/schema";

import { db } from "~/server/db";

export type FileOwnerSource = "manifest" | "document" | "document_version" | "uploader";

/** How much the answering source is actually worth as evidence. */
export type FileOwnerConfidence = "high" | "medium" | "low";

export interface FileOwnerResolution {
  companyId: number;
  source: FileOwnerSource;
  confidence: FileOwnerConfidence;
}

const CONFIDENCE_BY_SOURCE: Record<FileOwnerSource, FileOwnerConfidence> = {
  manifest: "high",
  document: "high",
  document_version: "medium",
  uploader: "low",
};

function resolution(companyId: bigint | number, source: FileOwnerSource): FileOwnerResolution {
  return {
    companyId: Number(companyId),
    source,
    confidence: CONFIDENCE_BY_SOURCE[source],
  };
}

/**
 * Which company owns the bytes behind a file_uploads row, and on what
 * evidence. Returns null when none of the four sources can answer — a real
 * outcome for genuinely orphaned rows, not an error.
 */
export async function resolveFileUploadOwner(
  fileId: number,
): Promise<FileOwnerResolution | null> {
  // 1. The manifest. Database-adapter refs use the file_uploads id as their
  //    opaque key (see B1/B2), so this is an exact lookup, not a guess.
  const [manifestRow] = await db
    .select({ companyId: storageObjects.companyId })
    .from(storageObjects)
    .where(
      and(eq(storageObjects.adapter, "database"), eq(storageObjects.key, String(fileId))),
    );
  if (manifestRow) return resolution(manifestRow.companyId, "manifest");

  // The two url-based sources below need every name this file goes by: the
  // canonical relative form written at creation, and whatever external url
  // the row carries if the bytes actually live in S3/Blob.
  const [file] = await db
    .select({ userId: fileUploads.userId, storageUrl: fileUploads.storageUrl })
    .from(fileUploads)
    .where(eq(fileUploads.id, fileId));
  if (!file) return null;

  const urls = [`/api/files/${fileId}`, file.storageUrl].filter(
    (url): url is string => Boolean(url),
  );

  // 2. A document pointing at this file.
  for (const url of urls) {
    const [doc] = await db
      .select({ companyId: document.companyId })
      .from(document)
      .where(eq(document.url, url));
    if (doc) return resolution(doc.companyId, "document");
  }

  // 3. A version pointing at this file — company comes from its parent.
  for (const url of urls) {
    const [row] = await db
      .select({ companyId: document.companyId })
      .from(documentVersions)
      .innerJoin(document, eq(documentVersions.documentId, document.id))
      .where(eq(documentVersions.url, url));
    if (row) return resolution(row.companyId, "document_version");
  }

  // 4. The uploader's company. Deliberately last: this names a person, and
  //    people move between companies.
  const [uploader] = await db
    .select({ companyId: users.companyId })
    .from(users)
    .where(eq(users.userId, file.userId));
  if (uploader) return resolution(uploader.companyId, "uploader");

  return null;
}

/**
 * Rollout switch (B8 judgment call). Default "log": the check runs and
 * reports what it *would* have refused, but refuses nothing.
 *
 *   off      — skip entirely, no lookup, no log
 *   log      — evaluate and log would-be blocks; always allow  (default)
 *   enforce  — actually refuse
 *
 * Why not enforce by default: the OCR/ingestion path fetches uploaded files
 * server-to-server, with no session cookie to authenticate. Flipping this on
 * blind risks silently breaking document processing, and that breakage would
 * surface as a failed upload rather than an auth error. Run in "log" first,
 * read the logs, then flip.
 */
export type FileTenantAuthMode = "off" | "log" | "enforce";

export function getFileTenantAuthMode(): FileTenantAuthMode {
  const value = process.env.STORAGE_FILE_TENANT_AUTH_MODE?.trim().toLowerCase();
  if (value === "off" || value === "enforce") return value;
  return "log";
}

export type FileTenantDenyReason =
  | "unauthenticated"
  | "owner_unresolved"
  | "company_mismatch";

export interface FileTenantDecision {
  mode: FileTenantAuthMode;
  /** What the route should actually do right now. */
  allowed: boolean;
  /** What "enforce" would have done — the number worth watching in "log". */
  wouldBlock: boolean;
  reason?: FileTenantDenyReason;
  owner?: FileOwnerResolution;
}

/**
 * Decide whether this caller may be served this file_uploads row.
 *
 * Fails closed on unresolved ownership on purpose: a file nobody can prove
 * ownership of is exactly the case a probing attacker would land on. That
 * costs nothing today because the default mode only logs — and the log is
 * how you find out how many real requests would break before enforcing.
 */
export async function checkFileUploadTenantAccess(params: {
  fileId: number;
  /** Clerk user id, or null when the request carries no session. */
  actorUserId: string | null;
  /** The company the actor is currently acting in, when already resolved. */
  actorCompanyId?: number | null;
}): Promise<FileTenantDecision> {
  const mode = getFileTenantAuthMode();
  if (mode === "off") return { mode, allowed: true, wouldBlock: false };

  const deny = (reason: FileTenantDenyReason, owner?: FileOwnerResolution): FileTenantDecision => ({
    mode,
    allowed: mode !== "enforce",
    wouldBlock: true,
    reason,
    ...(owner ? { owner } : {}),
  });

  if (!params.actorUserId) return deny("unauthenticated");

  const owner = await resolveFileUploadOwner(params.fileId);
  if (!owner) return deny("owner_unresolved");

  if (params.actorCompanyId != null && params.actorCompanyId === owner.companyId) {
    return { mode, allowed: true, wouldBlock: false, owner };
  }

  // The actor's *active* company isn't the owner — but they may still be a
  // member of the owning company and simply be working in another one.
  // Checking memberships avoids refusing a legitimate multi-company user.
  const [actor] = await db
    .select({ id: users.id, companyId: users.companyId })
    .from(users)
    .where(eq(users.userId, params.actorUserId));
  if (!actor) return deny("unauthenticated", owner);

  if (Number(actor.companyId) === owner.companyId) {
    return { mode, allowed: true, wouldBlock: false, owner };
  }

  const [membership] = await db
    .select({ id: userCompanyMemberships.id })
    .from(userCompanyMemberships)
    .where(
      and(
        eq(userCompanyMemberships.userId, BigInt(actor.id)),
        eq(userCompanyMemberships.companyId, BigInt(owner.companyId)),
      ),
    );
  if (membership) return { mode, allowed: true, wouldBlock: false, owner };

  return deny("company_mismatch", owner);
}

/**
 * One-line, greppable record of a would-be block. Deliberately logs the
 * evidence source too — "we would have refused 40 requests, all on
 * source=uploader" is a very different signal from "all on source=manifest".
 */
export function logFileTenantDecision(fileId: number, decision: FileTenantDecision): void {
  if (!decision.wouldBlock) return;
  console.warn(
    `[FileTenantAuth] ${decision.mode === "enforce" ? "blocked" : "would-block"} ` +
      `fileId=${fileId} reason=${decision.reason ?? "unknown"} ` +
      `ownerSource=${decision.owner?.source ?? "none"} ` +
      `ownerConfidence=${decision.owner?.confidence ?? "none"}`,
  );
}
