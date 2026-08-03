/**
 * Authorization for internal `/api/files/{id}` references at upload ingress.
 *
 * `documentUrl` arrives from the client on every upload path. When it points
 * at an internal file row, the pipeline later hands that URL to the OCR
 * worker with a signed token attached — a token that bypasses the file
 * route's session check by design. So the workspace has to be proven to own
 * the row *before* a document or job exists, and the check cannot rely on
 * the caller-declared `storageType`: claiming `"s3"` used to be enough to
 * keep a foreign internal path intact all the way to the signer.
 */

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { fileUploads } from "@launchstack/core/db/schema";
import { getOcrConfig } from "@launchstack/core/ocr/config";

const INTERNAL_FILE_PATH = /^\/api\/files\/(\d+)\/?$/;

/** Origin used only to give relative URLs a parseable base. */
const PARSE_BASE = "http://internal.invalid";

/**
 * Thrown when an upload references a file the workspace may not read, or an
 * internal file that cannot be processed in the current configuration.
 * Callers map this onto an HTTP response instead of a generic 500.
 */
export class UploadAuthorizationError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "UploadAuthorizationError";
    this.status = status;
  }
}

/**
 * Returns the file id when `url` addresses `/api/files/{id}`, whether it was
 * given as a relative path or an absolute URL on any origin. Storage type
 * declared by the caller is irrelevant here — the path is what matters.
 */
export function parseInternalFileId(url: string): number | null {
  let pathname: string;
  try {
    pathname = new URL(url, PARSE_BASE).pathname;
  } catch {
    return null;
  }

  const id = INTERNAL_FILE_PATH.exec(pathname)?.[1];
  if (!id) return null;

  const parsed = Number(id);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Authorize an upload's `documentUrl` against the active workspace.
 *
 * Returns the file id for an internal reference the company owns, or null
 * when the URL is external. Throws `UploadAuthorizationError` when the row
 * belongs to another tenant, has no tenant stamp, or does not exist — all
 * reported identically so the caller cannot probe for file ids.
 */
export async function authorizeInternalFileRef(
  url: string,
  companyId: bigint,
): Promise<number | null> {
  const fileId = parseInternalFileId(url);
  if (fileId === null) return null;

  const [file] = await db
    .select({ companyId: fileUploads.companyId })
    .from(fileUploads)
    .where(eq(fileUploads.id, fileId));

  if (!file || file.companyId == null || file.companyId !== companyId) {
    throw new UploadAuthorizationError("File not found in this workspace", 404);
  }

  // The OSS worker fetches internal URLs over HTTP with no Clerk session, so
  // it needs a signed token. Failing here keeps the client from receiving a
  // 202 for a job that can only end in a 401 at fetch time.
  if (isOssWorkerConfigured() && !getOcrConfig().fileAccessTokenSecret) {
    throw new UploadAuthorizationError(
      "FILE_ACCESS_TOKEN_SECRET is not configured; the OCR worker cannot read database-backed documents.",
      503,
    );
  }

  return fileId;
}

function isOssWorkerConfigured(): boolean {
  const cfg = getOcrConfig();
  return Boolean(
    cfg.workerUrl ||
      cfg.defaultProvider === "MARKER" ||
      cfg.defaultProvider === "DOCLING",
  );
}
