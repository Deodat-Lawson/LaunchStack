/**
 * Manifest registration API — the "front door" to `storage_objects`.
 *
 * Every successful object write must call `registerObject` before the
 * owning document/version becomes active, so the deletion coordinator (B2)
 * can always discover exactly what a document owns via `listOwnedRefs`
 * instead of parsing URLs.
 *
 * Note: `RegisterObjectInput` mirrors the `ObjectRef` shape
 * (`{ adapter, storageLocationId, key }`) described in the design doc, but
 * is defined locally for now — @launchstack/core/storage hasn't shipped a
 * real `ObjectRef` type yet (Dev A's A0 contract-freeze work). Once it
 * does, this should import that type instead of redefining it.
 */

import { eq } from "drizzle-orm";
import { storageObjects } from "@launchstack/core/db/schema";
import type { StorageObject } from "@launchstack/core/db/schema";
import type { db as DbType } from "~/server/db";

type Tx = Parameters<Parameters<(typeof DbType)["transaction"]>[0]>[0];

/** The three storage adapters currently defined on `storage_objects.adapter`. */
export type StorageAdapter = "s3" | "vercel-blob" | "database" | "uploadthing";

export interface RegisterObjectInput {
  adapter: StorageAdapter;
  storageLocationId: string;
  key: string;
  companyId: number;
  /** Exactly one of these three must be set. */
  documentId?: number;
  documentVersionId?: number;
  artifactId?: number;
  contentType?: string;
  sizeBytes?: number;
  checksum?: string;
  sourceOperation?: string;
}

/** One of the two owner shapes `listOwnedRefs` / `hasManifest` accept. */
export type ManifestOwner =
  | { documentId: number; documentVersionId?: never }
  | { documentVersionId: number; documentId?: never };

/**
 * Insert a manifest row for a newly-written object. Call this before the
 * owning document/version is considered active — a write with no manifest
 * entry is invisible to deletion and becomes an orphan by definition.
 *
 * Exactly one of documentId / documentVersionId / artifactId must be set;
 * the DB CHECK constraint enforces this too, but we validate here first for
 * a clearer error than a raw constraint-violation message.
 */
export async function registerObject(
  tx: Tx,
  input: RegisterObjectInput,
): Promise<StorageObject> {
  const ownerCount = [
    input.documentId,
    input.documentVersionId,
    input.artifactId,
  ].filter((v) => v !== undefined).length;

  if (ownerCount !== 1) {
    throw new Error(
      `registerObject: exactly one of documentId/documentVersionId/artifactId ` +
        `must be set (got ${ownerCount}).`,
    );
  }

  const [row] = await tx
    .insert(storageObjects)
    .values({
      adapter: input.adapter,
      storageLocationId: input.storageLocationId,
      key: input.key,
      companyId: BigInt(input.companyId),
      documentId: input.documentId !== undefined ? BigInt(input.documentId) : undefined,
      documentVersionId:
        input.documentVersionId !== undefined
          ? BigInt(input.documentVersionId)
          : undefined,
      artifactId: input.artifactId !== undefined ? BigInt(input.artifactId) : undefined,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes !== undefined ? BigInt(input.sizeBytes) : undefined,
      checksum: input.checksum,
      sourceOperation: input.sourceOperation,
    })
    .returning();

  if (!row) {
    throw new Error("registerObject: insert returned no row");
  }
  return row;
}

/**
 * Snapshot every manifest row a document (or a single version) owns.
 * This is what the deletion coordinator calls to figure out what to delete
 * — always call this *before* triggering any relational cascade.
 */
export async function listOwnedRefs(
  tx: Tx,
  owner: ManifestOwner,
): Promise<StorageObject[]> {
  if ("documentId" in owner && owner.documentId !== undefined) {
    return tx
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.documentId, BigInt(owner.documentId)));
  }
  if ("documentVersionId" in owner && owner.documentVersionId !== undefined) {
    return tx
      .select()
      .from(storageObjects)
      .where(eq(storageObjects.documentVersionId, BigInt(owner.documentVersionId)));
  }
  throw new Error("listOwnedRefs: owner must specify documentId or documentVersionId");
}

/**
 * Quick existence check: does this document/version have real manifest
 * rows, or is it a pre-manifest document that needs the legacy-promotion
 * fallback? Used by the deletion coordinator (B2) to pick a path.
 */
export async function hasManifest(tx: Tx, owner: ManifestOwner): Promise<boolean> {
  const refs = await listOwnedRefs(tx, owner);
  return refs.length > 0;
}
