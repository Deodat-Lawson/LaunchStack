import { and, asc, eq, inArray } from "drizzle-orm";
import {
    document,
    documentVersions,
    fileUploads,
    ocrJobs,
    uploadBatchFiles,
} from "@launchstack/store/schema";
import { enqueueOutboxEventsWithRevive } from "@launchstack/orchestration";
import { eventIds, PROTOCOL_VERSION } from "@launchstack/orchestration/pipeline-events";

import { storageDeletionItems, storageDeletionRequests } from "~/server/db/schema/storage";
import type { Tx } from "~/server/workspace/db-types";
import { findStoredObjectsByRefs, findStoredObjectsByUrls, storedObjectRef } from "../ledger";
import { refIdentity, type ObjectRef } from "../object-ref";
import { refFromStoredUrl } from "../stored-url";

export interface DeletionContext {
    requestedBy: string;
    reason: string;
    traceId: string;
}

function metadataAudioUrls(metadata: unknown): string[] {
    if (!metadata || typeof metadata !== "object") return [];
    const audioUrl = (metadata as Record<string, unknown>).audioUrl;
    return typeof audioUrl === "string" ? [audioUrl] : [];
}

/** Snapshot candidates, including shared audio; the worker decides whether bytes are live. */
export function metadataStorageUrls(metadata: unknown): string[] {
    if (!metadata || typeof metadata !== "object") return [];
    const record = metadata as Record<string, unknown>;
    const urls = metadataAudioUrls(metadata);
    const preview = record.websitePreview;
    if (
        preview &&
        typeof preview === "object" &&
        "url" in preview &&
        typeof preview.url === "string"
    )
        urls.push(preview.url);
    return urls;
}

async function insertPlan(
    tx: Tx,
    input: DeletionContext & {
        companyId: bigint | number;
        scope: "document" | "version" | "object";
        documentId?: number;
        documentVersionId?: number;
        urls: readonly (string | null)[];
    }
): Promise<number | null> {
    const urls = [
        ...new Set(
            input.urls.filter((url): url is string => typeof url === "string" && url.length > 0)
        ),
    ];
    if (!urls.length) return null;
    type Candidate = {
        sourceUrl: string;
        ref?: ObjectRef;
        reason?: "ambiguous" | "unrecognized";
        foreign?: boolean;
    };
    const resolve = async (sources: readonly string[]): Promise<Candidate[]> => {
        const parsedUrls = sources.map(sourceUrl => ({
            sourceUrl,
            parsed: refFromStoredUrl(sourceUrl),
        }));
        const ledger = await findStoredObjectsByUrls(
            tx,
            parsedUrls
                .filter(candidate => !candidate.parsed.ok)
                .map(candidate => candidate.sourceUrl)
        );
        return parsedUrls.map<Candidate>(({ sourceUrl, parsed }) => {
            if (parsed.ok) return { sourceUrl, ref: parsed.ref };
            // Historical absolute file URLs on every candidate column retain
            // their original spelling; worker provenance authorizes the bytes.
            const databaseId = /^https?:\/\/[^/]+\/api\/files\/0*([0-9]+)(?:[/?#]|$)/.exec(
                sourceUrl
            )?.[1];
            if (
                parsed.reason === "unrecognized" &&
                databaseId &&
                Number.isSafeInteger(Number(databaseId))
            ) {
                return {
                    sourceUrl,
                    ref: {
                        adapter: "database",
                        storageLocationId: "database:file_uploads",
                        key: BigInt(databaseId).toString(),
                    },
                };
            }
            const rows = ledger.filter(row => row.url === sourceUrl);
            if (rows.length === 1) return { sourceUrl, ref: storedObjectRef(rows[0]!) };
            return { sourceUrl, reason: rows.length > 1 ? "ambiguous" : parsed.reason };
        });
    };
    const direct = await resolve(urls);
    const pointerIds = direct.flatMap(candidate =>
        candidate.ref?.adapter === "database" &&
        /^\d+$/.test(candidate.ref.key) &&
        Number.isSafeInteger(Number(candidate.ref.key))
            ? [Number(candidate.ref.key)]
            : []
    );
    const pointers = pointerIds.length
        ? await tx.select().from(fileUploads).where(inArray(fileUploads.id, pointerIds))
        : [];
    const external = new Map<string, boolean>();
    for (const pointer of pointers) {
        if (pointer.storageProvider === "database" || !pointer.storageUrl) continue;
        external.set(
            pointer.storageUrl,
            external.get(pointer.storageUrl) === true ||
                pointer.companyId !== BigInt(input.companyId)
        );
    }
    const expanded = (await resolve([...external.keys()])).map(candidate => ({
        ...candidate,
        foreign: external.get(candidate.sourceUrl) === true,
    }));
    // Check provider bytes while their pointer rows still exist. A foreign/null
    // pointer's block is durable even if its row disappears before delivery.
    const candidates = [
        ...expanded,
        ...direct.filter(candidate => !external.has(candidate.sourceUrl)),
    ];
    const refs = candidates.flatMap(candidate => (candidate.ref ? [candidate.ref] : []));
    const byRef = await findStoredObjectsByRefs(tx, refs);
    const refRows = new Map(byRef.map(row => [refIdentity(storedObjectRef(row)), row]));
    const [request] = await tx
        .insert(storageDeletionRequests)
        .values({
            companyId: BigInt(input.companyId),
            scope: input.scope,
            documentId: input.documentId,
            documentVersionId: input.documentVersionId,
            requestedBy: input.requestedBy,
            reason: input.reason,
            traceId: input.traceId,
        })
        .returning({ id: storageDeletionRequests.id });
    if (!request) throw new Error("Storage deletion request insert returned no id");
    await tx.insert(storageDeletionItems).values(
        candidates.map(candidate => {
            const ref: ObjectRef | undefined = candidate.ref;
            return {
                requestId: request.id,
                sourceUrl: candidate.sourceUrl,
                storedObjectId: ref ? refRows.get(refIdentity(ref))?.id : null,
                adapter: ref?.adapter,
                storageLocationId: ref?.storageLocationId,
                objectKey: ref?.key,
                state:
                    candidate.foreign && ref
                        ? ("blocked" as const)
                        : ref
                          ? ("pending" as const)
                          : candidate.reason === "ambiguous"
                            ? ("quarantined" as const)
                            : ("skipped" as const),
                errorCode: candidate.foreign && ref ? "foreign_object" : (candidate.reason ?? null),
            };
        })
    );
    await enqueueOutboxEventsWithRevive(tx, [
        {
            eventId: eventIds.storageDeletionRequested(request.id),
            eventType: "storage.deletion.requested",
            schemaVersion: PROTOCOL_VERSION,
            occurredAt: new Date().toISOString(),
            traceId: input.traceId,
            companyId: Number(input.companyId),
            payload: { requestId: request.id },
        },
    ]);
    return request.id;
}

export async function planDocumentDeletion(
    tx: Tx,
    input: DeletionContext & { documentIds: readonly number[] }
): Promise<number[]> {
    if (!input.documentIds.length) return [];
    // Stable lock ordering also makes batch deletes safe under overlapping commands.
    const docs = await tx
        .select()
        .from(document)
        .where(inArray(document.id, [...new Set(input.documentIds)]))
        .orderBy(asc(document.id))
        .for("update");
    const ids: number[] = [];
    for (const doc of docs) {
        const versions = await tx
            .select({ url: documentVersions.url, metadata: documentVersions.ocrMetadata })
            .from(documentVersions)
            .where(eq(documentVersions.documentId, BigInt(doc.id)));
        const jobs = await tx
            .select({ url: ocrJobs.documentUrl })
            .from(ocrJobs)
            .where(eq(ocrJobs.documentId, BigInt(doc.id)));
        const files = await tx
            .select({ url: uploadBatchFiles.storageUrl })
            .from(uploadBatchFiles)
            .where(eq(uploadBatchFiles.documentId, BigInt(doc.id)));
        const id = await insertPlan(tx, {
            ...input,
            companyId: doc.companyId,
            scope: "document",
            documentId: doc.id,
            urls: [
                doc.url,
                ...metadataStorageUrls(doc.ocrMetadata),
                ...versions.flatMap(version => [
                    version.url,
                    ...metadataStorageUrls(version.metadata),
                ]),
                ...jobs.map(job => job.url),
                ...files.map(file => file.url),
            ],
        });
        if (id !== null) ids.push(id);
    }
    return ids;
}

export async function planVersionDeletion(
    tx: Tx,
    input: DeletionContext & { documentId: number; versionId: number }
): Promise<number | null> {
    const [doc] = await tx
        .select({ companyId: document.companyId })
        .from(document)
        .where(eq(document.id, input.documentId))
        .for("update");
    if (!doc) return null;
    const [version] = await tx
        .select()
        .from(documentVersions)
        .where(
            and(
                eq(documentVersions.id, input.versionId),
                eq(documentVersions.documentId, BigInt(input.documentId))
            )
        )
        .for("update");
    if (!version) return null;
    const jobs = await tx
        .select({ url: ocrJobs.documentUrl })
        .from(ocrJobs)
        .where(eq(ocrJobs.versionId, BigInt(input.versionId)));
    return insertPlan(tx, {
        ...input,
        companyId: doc.companyId,
        scope: "version",
        documentVersionId: version.id,
        urls: [
            version.url,
            ...metadataStorageUrls(version.ocrMetadata),
            ...jobs.map(job => job.url),
        ],
    });
}

export async function planObjectDeletion(
    tx: Tx,
    input: DeletionContext & { companyId: bigint | number; urls: readonly string[] }
): Promise<number | null> {
    return insertPlan(tx, { ...input, scope: "object" });
}
