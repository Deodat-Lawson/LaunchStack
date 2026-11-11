import { inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
    document,
    documentVersions,
    fileUploads,
    ocrJobs,
    uploadBatchFiles,
} from "@launchstack/store/schema";

import { brandChannels, brandMedia } from "~/server/db/schema/brand";
import { collabAgentPersona } from "~/server/db/schema/collab";
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema/workspace-sessions";
import type { Executor } from "~/server/workspace/db-types";
import { refIdentity, type ObjectRef } from "../object-ref";
import { refFromStoredUrl } from "../stored-url";

interface ProtectedReferenceSource {
    from: SQL;
    column: SQLWrapper;
    guard?: SQL;
    aliasFrom?: SQL;
    exactJson?: (url: SQL) => SQL;
}

/** Single global ownership definition for the worker and bounded orphan audit. */
function protectedStorageReferenceSources(): ProtectedReferenceSource[] {
    return [
        { column: document.url, from: sql`${document}` },
        { column: sql`${document.ocrMetadata}->'websitePreview'->>'url'`, from: sql`${document}` },
        { column: sql`${document.ocrMetadata}->>'audioUrl'`, from: sql`${document}` },
        { column: documentVersions.url, from: sql`${documentVersions}` },
        {
            column: sql`${documentVersions.ocrMetadata}->'websitePreview'->>'url'`,
            from: sql`${documentVersions}`,
        },
        {
            column: sql`${documentVersions.ocrMetadata}->>'audioUrl'`,
            from: sql`${documentVersions}`,
        },
        {
            column: ocrJobs.documentUrl,
            from: sql`${ocrJobs} INNER JOIN ${document} ON ${ocrJobs.documentId} = ${document.id}`,
            guard: inArray(ocrJobs.status, ["queued", "processing"]),
        },
        {
            column: uploadBatchFiles.storageUrl,
            from: sql`${uploadBatchFiles}`,
            guard: inArray(uploadBatchFiles.status, ["queued", "uploaded", "processing", "failed"]),
        },
        { column: brandMedia.storageUrl, from: sql`${brandMedia}` },
        { column: brandChannels.avatarUrl, from: sql`${brandChannels}` },
        { column: collabAgentPersona.avatarUrl, from: sql`${collabAgentPersona}` },
        {
            column: sql`attachment->>'url'`,
            from: sql`${workspaceSessionMessages}`,
            aliasFrom: sql`${workspaceSessionMessages}, LATERAL jsonb_array_elements(${workspaceSessionMessages.attachments}) AS attachment`,
            exactJson: url =>
                sql`${workspaceSessionMessages.attachments} @> jsonb_build_array(jsonb_build_object('url', ${url}))`,
        },
        {
            column: sql`attachment->>'url'`,
            from: sql`${workspaceSessionMessages}`,
            aliasFrom: sql`${workspaceSessionMessages}, LATERAL jsonb_array_elements(${workspaceSessionMessages.metadata}->'send'->'attachments') AS attachment`,
            exactJson: url =>
                sql`${workspaceSessionMessages.metadata} @> jsonb_build_object('send', jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('url', ${url}))))`,
        },
        {
            column: sql`attachment->>'url'`,
            from: sql`${workspaceSessions}`,
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

async function findDirectReferences(
    tx: Executor,
    candidates: readonly StorageReferenceCandidate[]
): Promise<Set<string>> {
    const referenced = new Set<string>();
    if (!candidates.length) return referenced;
    const sources = protectedStorageReferenceSources();
    const values = candidates.flatMap(candidate =>
        [...new Set(candidate.urls)].map(url => sql`(${candidate.id}::text, ${url}::text)`)
    );
    if (values.length) {
        const exact = await tx.execute<{ id: string }>(sql`
            WITH candidates (id, source_url) AS (VALUES ${sql.join(values, sql`, `)})
            ${sql.join(
                sources.map(
                    source => sql`
                SELECT candidate.id FROM ${source.from}
                INNER JOIN candidates AS candidate ON ${source.exactJson ? source.exactJson(sql`candidate.source_url`) : sql`${source.column} = candidate.source_url`}
                ${source.guard ? sql`WHERE ${source.guard}` : sql``}
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
        // Chat uploads are S3-only today; historical database attachments alone
        // retain JSON-array scans. Scalar paths use concurrent expression indexes.
        const rows = await tx.execute<{ id: string }>(sql`
            WITH candidates (id, file_id) AS (VALUES ${sql.join(databaseValues, sql`, `)})
            ${sql.join(
                sources.map(
                    source => sql`
                SELECT candidate.id FROM ${source.aliasFrom ?? source.from}
                INNER JOIN candidates AS candidate ON (regexp_match(${source.column}, '/api/files/0*([0-9]+)([/?#]|$)'))[1] = candidate.file_id
                ${source.guard ? sql`WHERE ${source.guard}` : sql``}
            `
                ),
                sql` UNION ALL `
            )}
        `);
        for (const row of rows) referenced.add(row.id);
    }
    const providers = aliases.filter(candidate => candidate.ref.adapter !== "database");
    if (!providers.length) return referenced;
    const aliasValues = providers.map(
        candidate => sql`(${candidate.id}::text, ${encodedKeyPattern(candidate.ref.key)}::text)`
    );
    // One legacy scan for the entire request, never one scan per item.
    const rows = await tx.execute<{ id: string; url: string | null }>(sql`
        WITH candidates (id, key_pattern) AS (VALUES ${sql.join(aliasValues, sql`, `)})
        ${sql.join(
            sources.map(
                source => sql`
            SELECT candidate.id, ${source.column} AS url FROM ${source.aliasFrom ?? source.from}
            INNER JOIN candidates AS candidate ON ${source.column} ~* candidate.key_pattern
            ${source.guard ? sql`WHERE ${source.guard}` : sql``}
        `
            ),
            sql` UNION `
        )}
    `);
    const byId = new Map(providers.map(candidate => [candidate.id, candidate]));
    for (const row of rows) {
        if (referenced.has(row.id) || row.url === null) continue;
        const parsed = refFromStoredUrl(row.url);
        if (parsed.ok && refIdentity(parsed.ref) === refIdentity(byId.get(row.id)!.ref))
            referenced.add(row.id);
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
    candidates: readonly StorageReferenceCandidate[]
): Promise<StorageObjectPointer[]> {
    const providers = candidates.filter(candidate => candidate.ref.adapter !== "database");
    if (!providers.length) return [];
    const values = providers.flatMap(candidate =>
        [...new Set(candidate.urls)].map(url => sql`(${candidate.id}::text, ${url}::text)`)
    );
    const legacy = providers.filter(candidate => !candidate.ledgered);
    const arms: SQL[] = [];
    if (values.length)
        arms.push(sql`
        SELECT candidate.id, ${fileUploads.id} AS pointer_id, ${fileUploads.storageUrl} AS url, ${fileUploads.companyId} AS company_id
        FROM ${fileUploads} INNER JOIN (VALUES ${sql.join(values, sql`, `)}) AS candidate(id, source_url)
            ON ${fileUploads.storageUrl} = candidate.source_url
        WHERE ${fileUploads.storageProvider} <> 'database'
    `);
    if (legacy.length)
        arms.push(sql`
        SELECT candidate.id, ${fileUploads.id} AS pointer_id, ${fileUploads.storageUrl} AS url, ${fileUploads.companyId} AS company_id
        FROM ${fileUploads} INNER JOIN (VALUES ${sql.join(
            legacy.map(
                candidate =>
                    sql`(${candidate.id}::text, ${encodedKeyPattern(candidate.ref.key)}::text)`
            ),
            sql`, `
        )}) AS candidate(id, key_pattern)
            ON ${fileUploads.storageUrl} ~* candidate.key_pattern
        WHERE ${fileUploads.storageProvider} <> 'database'
    `);
    if (!arms.length) return [];
    const byId = new Map(providers.map(candidate => [candidate.id, candidate]));
    const rows = await tx.execute<StorageObjectPointer>(sql.join(arms, sql` UNION `));
    return rows.filter(pointer => {
        const candidate = byId.get(pointer.id)!;
        if (candidate.urls.includes(pointer.url)) return true;
        const parsed = refFromStoredUrl(pointer.url);
        return parsed.ok && refIdentity(parsed.ref) === refIdentity(candidate.ref);
    });
}

/** A live /api/files pointer protects its provider target too. */
export async function findReferencedStorageObjects(
    tx: Executor,
    candidates: readonly StorageReferenceCandidate[],
    knownPointers?: readonly StorageObjectPointer[]
): Promise<Set<string>> {
    const referenced = await findDirectReferences(tx, candidates);
    const pointers = knownPointers ?? (await findStorageObjectPointers(tx, candidates));
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
        }))
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
