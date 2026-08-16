/**
 * Manifest registration API — the "front door" to `storage_objects`.
 *
 * Every successful object write must call `registerObject` before the owning
 * document/version becomes active. Object identity is always supplied by the
 * adapter as an opaque ObjectRef; this module never parses URLs.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import {
  documentVersions,
  storageArtifactEdges,
  storageObjects,
} from "@launchstack/core/db/schema";
import type {
  StorageArtifactEdge,
  StorageObject,
} from "@launchstack/core/db/schema";
import type { ObjectRef } from "@launchstack/core/storage";
import type { db as DbType } from "~/server/db";

type Tx = Parameters<Parameters<(typeof DbType)["transaction"]>[0]>[0];

export type StorageAdapter = ObjectRef["adapter"];

export interface RegisterObjectInput {
  /** Canonical identity minted by the storage adapter at write time. */
  ref?: ObjectRef;
  /** @deprecated Pass `ref`; retained for maintenance scripts during migration. */
  adapter?: StorageAdapter;
  /** @deprecated Pass `ref`; retained for maintenance scripts during migration. */
  storageLocationId?: string;
  /** @deprecated Pass `ref`; retained for maintenance scripts during migration. */
  key?: string;
  companyId: number | bigint;
  /** Exactly one of these three must be set. */
  documentId?: number;
  documentVersionId?: number;
  artifactId?: number;
  contentType?: string;
  sizeBytes?: number;
  checksum?: string;
  sourceOperation?: string;
}

/** One of the two document/version owner shapes accepted by manifest reads. */
export type ManifestOwner =
  | { documentId: number; documentVersionId?: never }
  | { documentVersionId: number; documentId?: never };

/**
 * Insert a manifest row for a newly-written object.
 *
 * The unique ObjectRef index makes registration idempotent across retries. If
 * a replay races with an existing row, the existing row is returned instead of
 * creating a second ownership record.
 */
export async function registerObject(
  tx: Tx,
  input: RegisterObjectInput,
): Promise<StorageObject> {
  const ref: ObjectRef = input.ref ??
    (input.adapter && input.storageLocationId && input.key
      ? {
          adapter: input.adapter,
          storageLocationId: input.storageLocationId,
          key: input.key,
        }
      : (() => {
          throw new Error("registerObject: ref is required");
        })());

  const ownerCount = [
    input.documentId,
    input.documentVersionId,
    input.artifactId,
  ].filter((value) => value !== undefined).length;

  if (ownerCount !== 1) {
    throw new Error(
      `registerObject: exactly one of documentId/documentVersionId/artifactId ` +
        `must be set (got ${ownerCount}).`,
    );
  }

  const [row] = await tx
    .insert(storageObjects)
    .values({
      adapter: ref.adapter,
      storageLocationId: ref.storageLocationId,
      key: ref.key,
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
    .onConflictDoNothing({
      target: [
        storageObjects.adapter,
        storageObjects.storageLocationId,
        storageObjects.key,
      ],
    })
    .returning();

  if (row) return row;

  const existing = await findObjectByRef(tx, ref);
  if (!existing) {
    throw new Error("registerObject: insert conflicted but existing row was not found");
  }

  if (existing.companyId !== BigInt(input.companyId)) {
    throw new Error("registerObject: ObjectRef is already owned by another company");
  }

  return existing;
}

/** Find a manifest row by its immutable ObjectRef identity. */
export async function findObjectByRef(
  tx: Tx,
  ref: ObjectRef,
): Promise<StorageObject | undefined> {
  const [row] = await tx
    .select()
    .from(storageObjects)
    .where(
      and(
        eq(storageObjects.adapter, ref.adapter),
        eq(storageObjects.storageLocationId, ref.storageLocationId),
        eq(storageObjects.key, ref.key),
      ),
    );
  return row;
}

/**
 * Record a derivation relationship between two manifest objects. Edge writes
 * are idempotent so Inngest replays cannot duplicate lineage rows.
 */
export async function registerArtifactEdge(
  tx: Tx,
  input: {
    parentObjectId: number | bigint;
    childObjectId: number | bigint;
    edgeType: string;
  },
): Promise<StorageArtifactEdge> {
  if (input.parentObjectId === input.childObjectId) {
    throw new Error("registerArtifactEdge: parent and child must be different objects");
  }
  if (!input.edgeType.trim()) {
    throw new Error("registerArtifactEdge: edgeType is required");
  }

  const [edge] = await tx
    .insert(storageArtifactEdges)
    .values({
      parentObjectId: BigInt(input.parentObjectId),
      childObjectId: BigInt(input.childObjectId),
      edgeType: input.edgeType,
    })
    .onConflictDoNothing({
      target: [
        storageArtifactEdges.parentObjectId,
        storageArtifactEdges.childObjectId,
      ],
    })
    .returning();

  if (edge) return edge;

  const [existing] = await tx
    .select()
    .from(storageArtifactEdges)
    .where(
      and(
        eq(storageArtifactEdges.parentObjectId, BigInt(input.parentObjectId)),
        eq(storageArtifactEdges.childObjectId, BigInt(input.childObjectId)),
      ),
    );
  if (!existing) {
    throw new Error("registerArtifactEdge: insert conflicted but existing edge was not found");
  }
  return existing;
}

/**
 * Snapshot every manifest row a document or single version owns.
 * Always call this before any relational cascade.
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
 * A document owns both document-level legacy rows and every row attached to
 * one of its versions. This keeps full-document deletion complete after new
 * uploads move their manifest ownership to the version row.
 */
export async function listDocumentOwnedRefs(
  tx: Tx,
  documentId: number,
): Promise<StorageObject[]> {
  const versions = await tx
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, BigInt(documentId)));

  const documentPredicate = eq(storageObjects.documentId, BigInt(documentId));
  if (versions.length === 0) {
    return tx.select().from(storageObjects).where(documentPredicate);
  }

  return tx
    .select()
    .from(storageObjects)
    .where(
      or(
        documentPredicate,
        inArray(
          storageObjects.documentVersionId,
          versions.map((version) => BigInt(version.id)),
        ),
      ),
    );
}

/** Quick existence check for a document or one version. */
export async function hasManifest(tx: Tx, owner: ManifestOwner): Promise<boolean> {
  const refs = await listOwnedRefs(tx, owner);
  return refs.length > 0;
}

/** Quick existence check covering a document and all of its versions. */
export async function hasDocumentManifest(tx: Tx, documentId: number): Promise<boolean> {
  const refs = await listDocumentOwnedRefs(tx, documentId);
  return refs.length > 0;
}