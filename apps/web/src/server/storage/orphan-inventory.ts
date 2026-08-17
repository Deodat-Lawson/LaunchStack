import "server-only";

import type { ObjectRef } from "@launchstack/core/storage";
import {
    document,
    documentVersions,
    fileUploads,
    ocrJobs,
    storageObjects,
    uploadBatchFiles,
} from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { listObjectsPrivileged, type PrivilegedInventoryObject } from "~/server/storage/inventory";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";
import {
    classifyInventoryObject,
    objectRefKey,
    type InventoryClassification,
} from "~/server/storage/orphan-audit";
import { registerObject } from "~/server/services/storage-manifest";
import { resolveStorageLocationId, type StorageAdapter } from "~/lib/storage-location-id";

export interface OrphanInventoryInput {
    adapter: StorageAdapter;
    storageLocationId?: string;
    prefix?: string;
    pageLimit?: number;
}

export interface OrphanInventoryObject {
    ref: ObjectRef;
    sizeBytes?: number;
    classification: InventoryClassification;
    evidence: string[];
}

interface OrphanBackfillBase {
    ref: ObjectRef;
    companyId: bigint;
    source: string;
}

export type OrphanBackfillCandidate =
    | (OrphanBackfillBase & { documentId: number; documentVersionId?: never })
    | (OrphanBackfillBase & { documentVersionId: number; documentId?: never });

export interface OrphanInventoryReport {
    adapter: StorageAdapter;
    storageLocationId: string;
    listing: {
        available: boolean;
        error?: { kind: string; code: string; message: string };
    };
    counts: Record<InventoryClassification, number>;
    bytes: Record<InventoryClassification, number>;
    objects: OrphanInventoryObject[];
    backfillCandidates: OrphanBackfillCandidate[];
}

interface Evidence {
    ref: ObjectRef;
    confidence: "high" | "medium";
    source: string;
    companyId?: bigint;
    documentId?: number;
    documentVersionId?: number;
}

interface MutableEvidence {
    ref: ObjectRef;
    high: boolean;
    sources: Set<string>;
    companyId?: bigint;
    documentId?: number;
    documentVersionId?: number;
}

function asNumber(value: number | bigint | null | undefined): number | undefined {
    if (value == null) return undefined;
    const result = typeof value === "bigint" ? Number(value) : value;
    return Number.isSafeInteger(result) ? result : undefined;
}

function asObjectRef(value: unknown): ObjectRef | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<ObjectRef>;
    if (
        (candidate.adapter !== "s3" &&
            candidate.adapter !== "vercel-blob" &&
            candidate.adapter !== "database" &&
            candidate.adapter !== "uploadthing") ||
        typeof candidate.storageLocationId !== "string" ||
        typeof candidate.key !== "string"
    ) {
        return undefined;
    }
    return {
        adapter: candidate.adapter,
        storageLocationId: candidate.storageLocationId,
        key: candidate.key,
    };
}

function parseMetadataRef(value: unknown): ObjectRef | undefined {
    if (!value || typeof value !== "object") return undefined;
    const metadata = value as Record<string, unknown>;
    return asObjectRef(metadata.storageRef) ?? asObjectRef(metadata.ref);
}

function addEvidence(map: Map<string, MutableEvidence>, evidence: Evidence): void {
    const key = objectRefKey(evidence.ref);
    const existing = map.get(key);
    if (existing) {
        existing.high ||= evidence.confidence === "high";
        existing.sources.add(evidence.source);
        existing.companyId ??= evidence.companyId;
        existing.documentId ??= evidence.documentId;
        existing.documentVersionId ??= evidence.documentVersionId;
        return;
    }

    map.set(key, {
        ref: evidence.ref,
        high: evidence.confidence === "high",
        sources: new Set([evidence.source]),
        companyId: evidence.companyId,
        documentId: evidence.documentId,
        documentVersionId: evidence.documentVersionId,
    });
}

function addPromotedEvidence(
    map: Map<string, MutableEvidence>,
    value: string | null | undefined,
    owner: Omit<Evidence, "ref" | "confidence" | "source">,
    source: string
): void {
    if (!value) return;
    const promoted = promoteLegacyUrlToRef({ value });
    if (!promoted.ok) return;
    addEvidence(map, {
        ref: promoted.ref,
        confidence: "medium",
        source,
        ...owner,
    });
}

function emptyCounts(): Record<InventoryClassification, number> {
    return {
        manifested: 0,
        referenced_high_confidence: 0,
        referenced_legacy: 0,
        confirmed_orphan: 0,
        unknown: 0,
    };
}

function emptyBytes(): Record<InventoryClassification, number> {
    return {
        manifested: 0,
        referenced_high_confidence: 0,
        referenced_legacy: 0,
        confirmed_orphan: 0,
        unknown: 0,
    };
}

async function collectRelationalEvidence(
    adapter: StorageAdapter,
    storageLocationId: string
): Promise<Map<string, MutableEvidence>> {
    const evidence = new Map<string, MutableEvidence>();

    const documents = await db
        .select({ id: document.id, companyId: document.companyId, url: document.url })
        .from(document);
    const companyByDocumentId = new Map<number, bigint>();
    for (const row of documents) {
        const documentId = asNumber(row.id);
        if (documentId === undefined) continue;
        companyByDocumentId.set(documentId, row.companyId);
        addPromotedEvidence(
            evidence,
            row.url,
            { companyId: row.companyId, documentId },
            "document.url"
        );
    }

    const versions = await db
        .select({
            id: documentVersions.id,
            documentId: documentVersions.documentId,
            url: documentVersions.url,
        })
        .from(documentVersions);
    for (const row of versions) {
        const documentVersionId = asNumber(row.id);
        const documentId = asNumber(row.documentId);
        if (documentVersionId === undefined || documentId === undefined) continue;
        addPromotedEvidence(
            evidence,
            row.url,
            {
                companyId: companyByDocumentId.get(documentId),
                documentId,
                documentVersionId,
            },
            "document_versions.url"
        );
    }

    const jobs = await db
        .select({
            documentId: ocrJobs.documentId,
            companyId: ocrJobs.companyId,
            documentUrl: ocrJobs.documentUrl,
        })
        .from(ocrJobs);
    for (const row of jobs) {
        addPromotedEvidence(
            evidence,
            row.documentUrl,
            {
                companyId: row.companyId,
                documentId: asNumber(row.documentId),
            },
            "ocr_jobs.document_url"
        );
    }

    const batchFiles = await db
        .select({
            metadata: uploadBatchFiles.metadata,
            storageUrl: uploadBatchFiles.storageUrl,
            companyId: uploadBatchFiles.companyId,
            documentId: uploadBatchFiles.documentId,
        })
        .from(uploadBatchFiles);
    for (const row of batchFiles) {
        const documentId = asNumber(row.documentId);
        const explicitRef = parseMetadataRef(row.metadata);
        if (explicitRef) {
            addEvidence(evidence, {
                ref: explicitRef,
                confidence: "high",
                source: "upload_batch_files.metadata",
                companyId: row.companyId,
                documentId,
            });
        }
        addPromotedEvidence(
            evidence,
            row.storageUrl,
            { companyId: row.companyId, documentId },
            "upload_batch_files.storage_url"
        );
    }

    const uploads = await db
        .select({
            id: fileUploads.id,
            storageProvider: fileUploads.storageProvider,
            storageUrl: fileUploads.storageUrl,
            storagePathname: fileUploads.storagePathname,
        })
        .from(fileUploads);
    for (const row of uploads) {
        const key = adapter === "database" ? String(row.id) : row.storagePathname;
        if (row.storageProvider === adapter && adapter !== "uploadthing" && key) {
            addEvidence(evidence, {
                ref: {
                    adapter,
                    storageLocationId,
                    key,
                },
                confidence: "high",
                source: "file_uploads.storage_identity",
            });
        }
        addPromotedEvidence(evidence, row.storageUrl, {}, "file_uploads.storage_url");
    }

    return evidence;
}

async function listAllObjects(input: {
    adapter: StorageAdapter;
    storageLocationId: string;
    prefix?: string;
    pageLimit?: number;
}): Promise<
    | { available: true; objects: PrivilegedInventoryObject[] }
    | { available: false; error: { kind: string; code: string; message: string } }
> {
    const objects: PrivilegedInventoryObject[] = [];
    let cursor: string | undefined;

    do {
        const page = await listObjectsPrivileged({
            adapter: input.adapter,
            storageLocationId: input.storageLocationId,
            prefix: input.prefix,
            cursor,
            limit: input.pageLimit,
        });
        if (!page.ok) return { available: false, error: page.error };
        objects.push(...page.objects);
        cursor = page.nextCursor;
    } while (cursor);

    return { available: true, objects };
}

export async function buildOrphanInventoryReport(
    input: OrphanInventoryInput
): Promise<OrphanInventoryReport> {
    const storageLocationId = input.storageLocationId ?? resolveStorageLocationId(input.adapter);
    const [listing, evidence] = await Promise.all([
        listAllObjects({ ...input, storageLocationId }),
        collectRelationalEvidence(input.adapter, storageLocationId),
    ]);

    const manifestRows = await db
        .select({
            adapter: storageObjects.adapter,
            storageLocationId: storageObjects.storageLocationId,
            key: storageObjects.key,
        })
        .from(storageObjects)
        .where(eq(storageObjects.storageLocationId, storageLocationId));
    const manifestRefs = new Set(
        manifestRows
            .filter(row => row.adapter === input.adapter)
            .map(row =>
                objectRefKey({
                    adapter: row.adapter,
                    storageLocationId: row.storageLocationId,
                    key: row.key,
                })
            )
    );

    const context = {
        listingAvailable: listing.available,
        manifestRefs,
        highConfidenceRefs: new Set(
            [...evidence.entries()].filter(([, value]) => value.high).map(([key]) => key)
        ),
        mediumConfidenceRefs: new Set(
            [...evidence.entries()].filter(([, value]) => !value.high).map(([key]) => key)
        ),
    };
    const counts = emptyCounts();
    const bytes = emptyBytes();
    const objects: OrphanInventoryObject[] = listing.available
        ? listing.objects.map(object => {
              const classification = classifyInventoryObject(object, context);
              const sizeBytes = object.size;
              counts[classification] += 1;
              bytes[classification] += sizeBytes ?? 0;
              return {
                  ref: object.ref,
                  sizeBytes,
                  classification,
                  evidence: [...(evidence.get(objectRefKey(object.ref))?.sources ?? [])],
              };
          })
        : [];

    const backfillCandidates: OrphanBackfillCandidate[] = [];
    const evidenceEntries = listing.available ? evidence.entries() : [];
    for (const [key, item] of evidenceEntries) {
        if (
            item.ref.adapter !== input.adapter ||
            item.ref.storageLocationId !== storageLocationId
        ) {
            continue;
        }
        if (!item.high || manifestRefs.has(key) || !item.companyId) continue;
        if (item.documentId === undefined && item.documentVersionId === undefined) continue;
        if (item.documentVersionId !== undefined) {
            backfillCandidates.push({
                ref: item.ref,
                companyId: item.companyId,
                documentVersionId: item.documentVersionId,
                source: [...item.sources].join(","),
            });
        } else if (item.documentId !== undefined) {
            backfillCandidates.push({
                ref: item.ref,
                companyId: item.companyId,
                documentId: item.documentId,
                source: [...item.sources].join(","),
            });
        }
    }

    return {
        adapter: input.adapter,
        storageLocationId,
        listing: listing.available
            ? { available: true }
            : { available: false, error: listing.error },
        counts,
        bytes,
        objects,
        backfillCandidates,
    };
}

export async function backfillHighConfidenceManifest(
    candidates: readonly OrphanBackfillCandidate[]
): Promise<{ registered: number; skipped: number }> {
    let registered = 0;
    let skipped = 0;

    for (const candidate of candidates) {
        try {
            await db.transaction(async tx => {
                await registerObject(tx, {
                    ref: candidate.ref,
                    companyId: candidate.companyId,
                    documentId: candidate.documentId,
                    documentVersionId: candidate.documentVersionId,
                    sourceOperation: "orphan-audit-backfill",
                });
            });
            registered += 1;
        } catch {
            skipped += 1;
        }
    }

    return { registered, skipped };
}
