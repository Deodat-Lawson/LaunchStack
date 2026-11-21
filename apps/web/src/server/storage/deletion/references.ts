import { inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { parseInternalFileId } from "@launchstack/store/crypto";
import {
    document,
    documentVersions,
    fileUploads,
    ocrJobs,
    uploadBatchFiles,
} from "@launchstack/store/schema";

import { env } from "~/env";
import { brandChannels, brandMedia } from "~/server/db/schema/brand";
import { collabAgentPersona } from "~/server/db/schema/collab";
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema/workspace-sessions";
import type { Executor } from "~/server/workspace/db-types";
import { refIdentity, type ObjectRef } from "../object-ref";
import { refFromStoredUrl } from "../stored-url";

interface ProtectedReferenceSource {
    from: SQL;
    column: SQLWrapper;
    companyId: SQLWrapper;
    guard?: SQL;
    aliasFrom?: SQL;
    exactJson?: (url: SQL) => SQL;
}

/** Single global ownership definition for the worker and bounded orphan audit. */
function protectedStorageReferenceSources(): ProtectedReferenceSource[] {
    const versions = sql`${documentVersions} INNER JOIN ${document} ON ${documentVersions.documentId} = ${document.id}`;
    const messages = sql`${workspaceSessionMessages} INNER JOIN ${workspaceSessions} ON ${workspaceSessionMessages.sessionId} = ${workspaceSessions.id}`;
    return [
        { column: document.url, from: sql`${document}`, companyId: document.companyId },
        {
            column: sql`${document.ocrMetadata}->'websitePreview'->>'url'`,
            from: sql`${document}`,
            companyId: document.companyId,
        },
        {
            column: sql`${document.ocrMetadata}->>'audioUrl'`,
            from: sql`${document}`,
            companyId: document.companyId,
        },
        { column: documentVersions.url, from: versions, companyId: document.companyId },
        {
            column: sql`${documentVersions.ocrMetadata}->'websitePreview'->>'url'`,
            from: versions,
            companyId: document.companyId,
        },
        {
            column: sql`${documentVersions.ocrMetadata}->>'audioUrl'`,
            from: versions,
            companyId: document.companyId,
        },
        {
            column: ocrJobs.documentUrl,
            from: sql`${ocrJobs} INNER JOIN ${document} ON ${ocrJobs.documentId} = ${document.id}`,
            companyId: ocrJobs.companyId,
            guard: inArray(ocrJobs.status, ["queued", "processing"]),
        },
        {
            column: uploadBatchFiles.storageUrl,
            from: sql`${uploadBatchFiles}`,
            companyId: uploadBatchFiles.companyId,
            guard: inArray(uploadBatchFiles.status, ["queued", "uploaded", "processing", "failed"]),
        },
        {
            column: brandMedia.storageUrl,
            from: sql`${brandMedia}`,
            companyId: brandMedia.companyId,
        },
        {
            column: brandChannels.avatarUrl,
            from: sql`${brandChannels}`,
            companyId: brandChannels.companyId,
        },
        {
            column: collabAgentPersona.avatarUrl,
            from: sql`${collabAgentPersona}`,
            companyId: collabAgentPersona.companyId,
        },
        {
            column: sql`attachment->>'url'`,
            from: messages,
            companyId: workspaceSessions.companyId,
            aliasFrom: sql`${messages}, LATERAL jsonb_array_elements(${workspaceSessionMessages.attachments}) AS attachment`,
            exactJson: url =>
                sql`${workspaceSessionMessages.attachments} @> jsonb_build_array(jsonb_build_object('url', ${url}))`,
        },
        {
            column: sql`attachment->>'url'`,
            from: messages,
            companyId: workspaceSessions.companyId,
            aliasFrom: sql`${messages}, LATERAL jsonb_array_elements(${workspaceSessionMessages.metadata}->'send'->'attachments') AS attachment`,
            exactJson: url =>
                sql`${workspaceSessionMessages.metadata} @> jsonb_build_object('send', jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('url', ${url}))))`,
        },
        {
            column: sql`attachment->>'url'`,
            from: sql`${workspaceSessions}`,
            companyId: workspaceSessions.companyId,
            aliasFrom: sql`${workspaceSessions}, LATERAL jsonb_array_elements(${workspaceSessions.queuedMessages}) AS queued, LATERAL jsonb_array_elements(queued->'send'->'attachments') AS attachment`,
            exactJson: url =>
                sql`${workspaceSessions.queuedMessages} @> jsonb_build_array(jsonb_build_object('send', jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('url', ${url})))))`,
        },
    ];
}

export interface StorageReferenceCandidate {
    id: string;
    urls: readonly string[];
    ref: ObjectRef;
    ledgered?: boolean;
}

/** Match decoded characters or their UTF-8 percent encodings, including mixed spellings. */
function encodedKeyPattern(key: string): string {
    return Array.from(key, character => {
        const literal = character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const encoded = Array.from(
            Buffer.from(character),
            byte => `%${byte.toString(16).padStart(2, "0")}`
        ).join("");
        return `(${literal}|${encoded})`;
    }).join("");
}

/** A constant pattern per scan avoids a candidate × table regex join/cache churn. */
function legacyPatterns(candidates: readonly StorageReferenceCandidate[]): string[] {
    const patterns = [
        ...new Set(
            candidates.map(candidate => encodedKeyPattern(candidate.ref.key.split("/").at(-1)!))
        ),
    ];
    const batches: string[] = [];
    for (let index = 0; index < patterns.length; index += 64) {
        batches.push(
            patterns
                .slice(index, index + 64)
                .map(pattern => `(${pattern})`)
                .join("|")
        );
    }
    return batches;
}

function candidatesByIdentity(candidates: readonly StorageReferenceCandidate[]) {
    const byIdentity = new Map<string, StorageReferenceCandidate[]>();
    for (const candidate of candidates) {
        const identity = refIdentity(candidate.ref);
        const existing = byIdentity.get(identity);
        if (existing) existing.push(candidate);
        else byIdentity.set(identity, [candidate]);
    }
    return byIdentity;
}

function appOrigin(): string {
    return new URL(env.server.APP_PUBLIC_URL ?? "http://app:3000").origin;
}

/** Only canonical internal URLs are unconditional global references. */
function databaseOwnerGuard(source: ProtectedReferenceSource, url: SQL, fileId: SQL): SQL {
    return sql`(${url} = '/api/files/' || ${fileId} OR ${url} = ${appOrigin() + "/api/files/"} || ${fileId} OR ${source.companyId} = candidate.file_company_id)`;
}

/**
 * Exact-match inputs. A database candidate also matches its canonical
 * spellings, which is what every current writer persists, whatever URL the
 * deleted row happened to hold.
 */
function exactUrls(candidate: StorageReferenceCandidate): string[] {
    if (candidate.ref.adapter !== "database" || !/^\d+$/.test(candidate.ref.key))
        return [...new Set(candidate.urls)];
    const canonical = `/api/files/${BigInt(candidate.ref.key).toString()}`;
    return [...new Set([...candidate.urls, canonical, appOrigin() + canonical])];
}

async function findDirectReferences(
    tx: Executor,
    candidates: readonly StorageReferenceCandidate[],
    indexedOnly: boolean
): Promise<Set<string>> {
    const referenced = new Set<string>();
    if (!candidates.length) return referenced;
    const sources = protectedStorageReferenceSources();
    const values = candidates.flatMap(candidate =>
        exactUrls(candidate).map(
            url =>
                sql`(${candidate.id}::text, ${url}::text, ${candidate.ref.adapter === "database" ? candidate.ref.key : null}::text)`
        )
    );
    if (values.length) {
        const exact = await tx.execute<{ id: string }>(sql`
            WITH candidates AS (
                SELECT input.*, referenced_file.company_id AS file_company_id
                FROM (VALUES ${sql.join(values, sql`, `)}) AS input(id, source_url, file_id)
                LEFT JOIN ${fileUploads} AS referenced_file ON referenced_file.id = input.file_id::bigint
            )
            ${sql.join(
                sources.map(
                    source => sql`
                SELECT candidate.id FROM ${source.from}
                INNER JOIN candidates AS candidate ON ${source.exactJson ? source.exactJson(sql`candidate.source_url`) : sql`${source.column} = candidate.source_url`}
                WHERE (candidate.file_id IS NULL OR ${databaseOwnerGuard(source, sql`candidate.source_url`, sql`candidate.file_id`)})
                ${source.guard ? sql`AND ${source.guard}` : sql``}
            `
                ),
                sql` UNION ALL `
            )}
        `);
        for (const row of exact) referenced.add(row.id);
    }
    const aliases = candidates.filter(
        candidate =>
            !referenced.has(candidate.id) &&
            (!candidate.ledgered || candidate.ref.adapter === "database")
    );
    const databases = aliases.filter(
        candidate => candidate.ref.adapter === "database" && /^\d+$/.test(candidate.ref.key)
    );
    if (databases.length) {
        const databaseValues = databases.map(
            candidate => sql`(${candidate.id}::text, ${BigInt(candidate.ref.key).toString()}::text)`
        );
        const rows = await tx.execute<{ id: string }>(sql`
            WITH candidates AS (
                SELECT input.*, referenced_file.company_id AS file_company_id
                FROM (VALUES ${sql.join(databaseValues, sql`, `)}) AS input(id, file_id)
                LEFT JOIN ${fileUploads} AS referenced_file ON referenced_file.id = input.file_id::bigint
            )
            ${sql.join(
                sources
                    .filter(source => !indexedOnly || !source.aliasFrom)
                    .map(
                        source => sql`
                SELECT candidate.id FROM ${source.aliasFrom ?? source.from}
                INNER JOIN candidates AS candidate ON (regexp_match(${source.column}, '/api/files/0*([0-9]+)([/?#]|$)'))[1] = candidate.file_id
                WHERE ${databaseOwnerGuard(source, sql`${source.column}`, sql`candidate.file_id`)}
                ${source.guard ? sql`AND ${source.guard}` : sql``}
            `
                    ),
                sql` UNION ALL `
            )}
        `);
        for (const row of rows) referenced.add(row.id);
        if (!indexedOnly && databases.some(candidate => !referenced.has(candidate.id))) {
            // Path-relative and normalization-suspicious aliases can be invisible
            // to extracted-id matching. Only historical rows hold them (ingress now
            // persists canonical URLs), so this scan stays request-wide; the
            // per-item refresh only needs the indexed arms.
            const normalizedAliases = await tx.execute<{ url: string; company_id: bigint }>(sql`
                ${sql.join(
                    sources.map(
                        source => sql`
                    SELECT ${source.column} AS url, ${source.companyId} AS company_id FROM ${source.aliasFrom ?? source.from}
                    WHERE (${source.column} LIKE '%/api/files/%' OR ${source.column} LIKE '%files%' OR ${source.column} ~ '[[:space:][:cntrl:]]')
                      AND ((${source.column} NOT LIKE '/%' AND ${source.column} !~* '^https?://') OR ${source.column} LIKE '%..%' OR ${source.column} LIKE '%/./%' OR position('%' in ${source.column}) > 0 OR position(chr(92) in ${source.column}) > 0 OR ${source.column} ~ '[[:space:][:cntrl:]]')
                      ${source.guard ? sql`AND ${source.guard}` : sql``}
                `
                    ),
                    sql` UNION `
                )}
            `);
            const files = await tx
                .select({ id: fileUploads.id, companyId: fileUploads.companyId })
                .from(fileUploads)
                .where(
                    inArray(
                        fileUploads.id,
                        databases.map(candidate => Number(candidate.ref.key))
                    )
                );
            const fileOwners = new Map(files.map(file => [file.id, file.companyId]));
            const idsByFile = new Map<number, string[]>();
            for (const candidate of databases) {
                const id = Number(candidate.ref.key);
                const existing = idsByFile.get(id);
                if (existing) existing.push(candidate.id);
                else idsByFile.set(id, [candidate.id]);
            }
            for (const row of normalizedAliases) {
                const id = parseInternalFileId(row.url);
                if (
                    id === null ||
                    fileOwners.get(id) == null ||
                    BigInt(row.company_id) !== fileOwners.get(id)
                )
                    continue;
                for (const candidateId of idsByFile.get(id) ?? []) referenced.add(candidateId);
            }
        }
    }
    if (indexedOnly) return referenced;
    const providers = aliases.filter(candidate => candidate.ref.adapter !== "database");
    const byIdentity = candidatesByIdentity(providers);
    for (const pattern of legacyPatterns(providers)) {
        const rows = await tx.execute<{ url: string }>(sql`
            /* storage-reference legacy batch */
            ${sql.join(
                sources.map(
                    source => sql`
                SELECT ${source.column} AS url FROM ${source.aliasFrom ?? source.from}
                WHERE ${source.column} ~* ${pattern}
                ${source.guard ? sql`AND ${source.guard}` : sql``}
            `
                ),
                sql` UNION `
            )}
        `);
        for (const row of rows) {
            const parsed = refFromStoredUrl(row.url);
            if (parsed.ok)
                for (const candidate of byIdentity.get(refIdentity(parsed.ref)) ?? [])
                    referenced.add(candidate.id);
        }
    }
    return referenced;
}

export interface StorageObjectPointer extends Record<string, unknown> {
    id: string;
    pointer_id: number;
    url: string;
    company_id: bigint | null;
}

/** Exact indexed pointer arm; only unledgered objects need the legacy alias scan. */
export async function findStorageObjectPointers(
    tx: Executor,
    candidates: readonly StorageReferenceCandidate[],
    indexedOnly = false
): Promise<StorageObjectPointer[]> {
    const providers = candidates.filter(candidate => candidate.ref.adapter !== "database");
    if (!providers.length) return [];
    const values = providers.flatMap(candidate =>
        [...new Set(candidate.urls)].map(url => sql`(${candidate.id}::text, ${url}::text)`)
    );
    const pointers: StorageObjectPointer[] = [];
    if (values.length) {
        pointers.push(
            ...(await tx.execute<StorageObjectPointer>(sql`
            SELECT candidate.id, ${fileUploads.id} AS pointer_id, ${fileUploads.storageUrl} AS url, ${fileUploads.companyId} AS company_id
            FROM ${fileUploads} INNER JOIN (VALUES ${sql.join(values, sql`, `)}) AS candidate(id, source_url)
                ON ${fileUploads.storageUrl} = candidate.source_url
            WHERE ${fileUploads.storageProvider} <> 'database'
        `))
        );
    }
    if (indexedOnly) return pointers;
    const legacy = providers.filter(candidate => !candidate.ledgered);
    const byIdentity = candidatesByIdentity(legacy);
    for (const pattern of legacyPatterns(legacy)) {
        const rows = await tx.execute<{
            pointer_id: number;
            url: string;
            company_id: bigint | null;
        }>(sql`
            /* storage-pointer legacy batch */
            SELECT ${fileUploads.id} AS pointer_id, ${fileUploads.storageUrl} AS url, ${fileUploads.companyId} AS company_id
            FROM ${fileUploads} WHERE ${fileUploads.storageProvider} <> 'database' AND ${fileUploads.storageUrl} ~* ${pattern}
        `);
        for (const row of rows) {
            const parsed = refFromStoredUrl(row.url);
            if (parsed.ok)
                for (const candidate of byIdentity.get(refIdentity(parsed.ref)) ?? [])
                    pointers.push({ ...row, id: candidate.id });
        }
    }
    const unique = new Map(
        pointers.map(pointer => [`${pointer.id}:${pointer.pointer_id}`, pointer])
    );
    return [...unique.values()];
}

/** A live /api/files pointer protects its provider target too. */
export async function findReferencedStorageObjects(
    tx: Executor,
    candidates: readonly StorageReferenceCandidate[],
    knownPointers?: readonly StorageObjectPointer[],
    indexedOnly = false
): Promise<Set<string>> {
    const referenced = await findDirectReferences(tx, candidates, indexedOnly);
    const pointers =
        knownPointers ?? (await findStorageObjectPointers(tx, candidates, indexedOnly));
    if (!pointers.length) return referenced;
    const pointerIds = [...new Set(pointers.map(pointer => pointer.pointer_id))];
    const direct = await findDirectReferences(
        tx,
        pointerIds.map(id => ({
            id: String(id),
            ref: {
                adapter: "database",
                storageLocationId: "database:file_uploads",
                key: String(id),
            },
            ledgered: true,
            urls: [`/api/files/${id}`],
        })),
        indexedOnly
    );
    for (const pointer of pointers)
        if (direct.has(String(pointer.pointer_id))) referenced.add(pointer.id);
    return referenced;
}

export async function isReferenced(
    tx: Executor,
    input: { urls: string[]; ref: ObjectRef; ledgered: boolean }
): Promise<boolean> {
    return (await findReferencedStorageObjects(tx, [{ id: "object", ...input }])).has("object");
}
