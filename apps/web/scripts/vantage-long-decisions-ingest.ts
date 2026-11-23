/** Label-free, task-local importer. Never opens the specification or private validation files. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import type { DocumentScope } from "../src/lib/authz/scope-types";

export const LONG_DECISIONS_DATABASE =
    "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_rag_benchmark_20261121";
export const LONG_DECISIONS_DATABASE_URL = LONG_DECISIONS_DATABASE;
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export type LongDecisionsRevision = "v1" | "v2";
const defaultLock = (revision: LongDecisionsRevision) =>
    resolve(
        repository,
        "fixtures/vantage-benchmarks/long-decisions",
        revision === "v2" ? "corpus-lock-v2.json" : "corpus-lock.json"
    );
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
function manifestSchema(revision: LongDecisionsRevision) {
    const id = z
        .string()
        .regex(revision === "v2" ? /^D\d{3}(?:_V\d{2})?$/ : /^D\d{2}(?:_V\d{2})?$/);
    const version = z
        .object({
            id,
            publishedAt: z.string().datetime(),
            file: z
                .string()
                .regex(revision === "v2" ? /^D\d{3}_V\d{2}\.md$/ : /^D\d{2}_V\d{2}\.md$/),
            sha256: digest,
            bytes: z
                .number()
                .int()
                .min(25000)
                .max(revision === "v2" ? 32000 : 35000),
        })
        .strict();
    return z
        .object({
            schemaVersion: z.literal(
                revision === "v2"
                    ? "vantage-long-decisions-input/2"
                    : "vantage-long-decisions-input/1"
            ),
            specSha256: digest,
            company: z
                .object({
                    id: z.string(),
                    name: z.string(),
                    fictional: z.literal(true),
                    domain: z.string(),
                })
                .strict(),
            weeks: z
                .array(
                    z
                        .object({
                            id: z.string(),
                            weekStart: z.string(),
                            cutoff: z.string().datetime(),
                        })
                        .strict()
                )
                .length(3),
            actors: z
                .array(
                    z
                        .object({
                            id: z.string(),
                            role: z.string(),
                            canRead: z.boolean(),
                            canMutate: z.boolean(),
                            readableDocumentIds: z.array(id),
                            deniedDocumentIds: z.array(id),
                        })
                        .strict()
                )
                .length(1),
            fixedSources: z
                .array(
                    z
                        .object({
                            scopeId: z.string(),
                            documentId: id,
                            versionId: id,
                            purpose: z.string(),
                            required: z.literal(true),
                            scope: z.literal("anchor_text_only"),
                            sameAcrossArms: z.literal(true),
                            textStart: z.number().int().nonnegative(),
                            textEnd: z.number().int().positive(),
                            textSha256: digest,
                            canonicalTextSha256: digest,
                        })
                        .strict()
                )
                .length(2),
            documents: z
                .array(
                    z
                        .object({
                            id,
                            kind: z.string(),
                            title: z.string(),
                            visibility: z.enum(["actor_readable", "denied"]),
                            versions: z
                                .array(version)
                                .min(1)
                                .max(revision === "v2" ? 3 : 2),
                        })
                        .strict()
                )
                .length(revision === "v2" ? 150 : 50),
            groups: z
                .array(
                    z
                        .object({
                            id: z.string(),
                            split: z.enum(["dev", "heldout"]),
                            size: z.union([z.literal(3), z.literal(5)]),
                            weekId: z.string(),
                            topics: z.array(
                                z.object({ caseId: z.string(), question: z.string() }).strict()
                            ),
                        })
                        .strict()
                )
                .length(revision === "v2" ? 18 : 8),
        })
        .strict();
}
export type LongDecisionsPublicManifest = z.infer<ReturnType<typeof manifestSchema>>;
type LoadedVersion = LongDecisionsPublicManifest["documents"][number]["versions"][number] & {
    text: string;
};
export type LongDecisionsCorpus = {
    publicManifest: LongDecisionsPublicManifest;
    manifestSha256: string;
    documents: (Omit<LongDecisionsPublicManifest["documents"][number], "versions"> & {
        versions: LoadedVersion[];
    })[];
};
type MappingDocument = {
    stableId: string;
    documentId: string;
    visibility: "actor_readable" | "denied";
    versions: { stableId: string; versionId: string; canonicalHash: string }[];
};
export type LongDecisionsWorkspace = {
    companyId: string;
    workspaceId: string;
    seedOwnerId: string;
    publicManifest: LongDecisionsPublicManifest;
    documents: MappingDocument[];
    readableDocumentIds: string[];
    deniedDocumentIds: string[];
    documentScope: DocumentScope;
    requiredSourceScopes: Record<
        string,
        {
            version: string;
            expectedParentHash: string;
            qualification: string;
            requiredUnits: { id: string; start: number; end: number; excerptHash: string }[];
        }
    >;
};

export function assertLongDecisionsDatabase(value: string) {
    if (value !== LONG_DECISIONS_DATABASE) throw Error("long_ingest_database_rejected");
    return value;
}
function inside(parent: string, candidate: string) {
    const offset = relative(parent, candidate);
    return !offset || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}
export async function loadLongDecisionsWorkspace(options: {
    cache: string;
    lockPath?: string;
    revision?: LongDecisionsRevision;
}): Promise<LongDecisionsCorpus> {
    const revision = options.revision ?? "v1";
    if (!["v1", "v2"].includes(revision)) throw Error("long_ingest_revision_invalid");
    const v2 = revision === "v2";
    const expectedDocuments = v2 ? 150 : 50;
    const cache = await realpath(options.cache);
    if (inside(await realpath(repository), cache))
        throw Error("long_ingest_cache_inside_repository");
    const lock = JSON.parse(await readFile(options.lockPath ?? defaultLock(revision), "utf8")) as {
        schemaVersion: string;
        specSha256: string;
        documents: number;
        versions: number;
        files: { file: string; bytes: number; sha256: string }[];
    };
    if (
        lock.schemaVersion !== (v2 ? "long-decisions-lock/2" : "long-decisions-lock/1") ||
        lock.documents !== expectedDocuments ||
        !Number.isSafeInteger(lock.versions) ||
        (v2 ? lock.versions < 150 || lock.versions > 450 : lock.versions !== 62) ||
        !digest.safeParse(lock.specSha256).success ||
        !Array.isArray(lock.files)
    )
        throw Error("long_ingest_lock_invalid");
    const files = new Map(lock.files.map(file => [file.file, file]));
    if (files.size !== lock.files.length) throw Error("long_ingest_lock_duplicate");
    const verified = async (name: string) => {
        const entry = files.get(name);
        if (!entry || !digest.safeParse(entry.sha256).success || !Number.isSafeInteger(entry.bytes))
            throw Error("long_ingest_lock_missing_file");
        const file = await realpath(resolve(cache, name));
        if (!inside(cache, file)) throw Error("long_ingest_cache_escape");
        const bytes = await readFile(file);
        if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
            throw Error("long_ingest_file_hash_mismatch");
        return bytes;
    };
    const manifestBytes = await verified("long-decisions-manifest.json");
    const manifest = manifestSchema(revision).parse(JSON.parse(manifestBytes.toString("utf8")));
    if (manifest.specSha256 !== lock.specSha256) throw Error("long_ingest_spec_binding_mismatch");
    const seen = new Set<string>();
    const documents = [];
    for (const [index, document] of manifest.documents.entries()) {
        if (document.id !== `D${String(index + 1).padStart(v2 ? 3 : 2, "0")}`)
            throw Error("long_ingest_document_order_invalid");
        const loaded = [];
        for (const [vi, v] of document.versions.entries()) {
            if (
                v.id !== `${document.id}_V${String(vi + 1).padStart(2, "0")}` ||
                v.file !== `${v.id}.md` ||
                seen.has(v.id)
            )
                throw Error("long_ingest_version_invalid");
            if (
                vi &&
                Date.parse(v.publishedAt) <= Date.parse(document.versions[vi - 1]!.publishedAt)
            )
                throw Error("long_ingest_version_order_invalid");
            seen.add(v.id);
            const bytes = await verified(v.file);
            const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            if (
                bytes.length !== v.bytes ||
                hash(bytes) !== v.sha256 ||
                !Buffer.from(text, "utf8").equals(bytes) ||
                text.includes("[[ANCHOR_") ||
                text.includes("\r")
            )
                throw Error("long_ingest_canonical_text_invalid");
            loaded.push({ ...v, text });
        }
        documents.push({ ...document, versions: loaded });
    }
    if (
        seen.size !== lock.versions ||
        [...files.keys()].filter(name => name.endsWith(".md")).length !== lock.versions
    )
        throw Error("long_ingest_version_inventory_invalid");
    const actor = manifest.actors[0]!;
    if (
        !actor.canRead ||
        !actor.canMutate ||
        new Set([...actor.readableDocumentIds, ...actor.deniedDocumentIds]).size !==
            expectedDocuments ||
        actor.readableDocumentIds.length !== (v2 ? 144 : 46) ||
        actor.deniedDocumentIds.length !== (v2 ? 6 : 4)
    )
        throw Error("long_ingest_actor_invalid");
    for (const d of documents)
        if (
            (d.visibility === "actor_readable") !== actor.readableDocumentIds.includes(d.id) ||
            (d.visibility === "denied") !== actor.deniedDocumentIds.includes(d.id)
        )
            throw Error("long_ingest_actor_visibility_mismatch");
    if (
        manifest.fixedSources[0]!.documentId !== (v2 ? "D139" : "D49") ||
        manifest.fixedSources[1]!.documentId !== (v2 ? "D140" : "D50")
    )
        throw Error("long_ingest_fixed_identity_invalid");
    for (const fixed of manifest.fixedSources) {
        const d = documents.find(d => d.id === fixed.documentId),
            v = d?.versions.find(v => v.id === fixed.versionId);
        if (
            !v ||
            d?.visibility !== "actor_readable" ||
            v.sha256 !== fixed.canonicalTextSha256 ||
            fixed.textEnd > v.text.length ||
            fixed.textEnd - fixed.textStart < 200 ||
            fixed.textEnd - fixed.textStart > 6000 ||
            hash(v.text.slice(fixed.textStart, fixed.textEnd)) !== fixed.textSha256
        )
            throw Error("long_ingest_fixed_scope_invalid");
        if (
            v2 &&
            manifest.weeks.some(
                week =>
                    Date.parse(v.publishedAt) >= Date.parse(week.cutoff) ||
                    d.versions.some(
                        candidate =>
                            Date.parse(candidate.publishedAt) < Date.parse(week.cutoff) &&
                            Date.parse(candidate.publishedAt) > Date.parse(v.publishedAt)
                    )
            )
        )
            throw Error("long_ingest_fixed_temporal_invalid");
    }
    if (v2) {
        if (
            new Set(manifest.groups.map(group => group.id)).size !== 18 ||
            new Set(manifest.weeks.map(week => week.id)).size !== 3
        )
            throw Error("long_ingest_group_roster_invalid");
        const questions = new Map<string, string>();
        for (const group of manifest.groups) {
            if (
                !manifest.weeks.some(week => week.id === group.weekId) ||
                group.topics.length !== group.size ||
                new Set(group.topics.map(topic => topic.caseId)).size !== group.size
            )
                throw Error("long_ingest_group_roster_invalid");
            for (const topic of group.topics) {
                if (
                    !/^C\d{2}$/.test(topic.caseId) ||
                    !topic.question.trim() ||
                    topic.question.length > 400 ||
                    (questions.has(topic.caseId) && questions.get(topic.caseId) !== topic.question)
                )
                    throw Error("long_ingest_group_question_invalid");
                questions.set(topic.caseId, topic.question);
            }
        }
        if (
            questions.size !== 30 ||
            ["dev", "heldout"].some(
                split =>
                    new Set(
                        manifest.groups
                            .filter(group => group.split === split)
                            .flatMap(group => group.topics.map(topic => topic.caseId))
                    ).size !== 15
            )
        )
            throw Error("long_ingest_group_roster_invalid");
    }
    return { publicManifest: manifest, manifestSha256: hash(manifestBytes), documents };
}

type Query = (sql: string, parameters?: unknown[]) => Promise<Record<string, unknown>[]>;
const category = (visibility: string) =>
    visibility === "denied" ? "LongDecisions/Restricted" : "LongDecisions/Readable";
const creation = (sha: string, stableId: string) => `long-decisions:${sha}:${stableId}`;

/** Verify exact inventory in one read-only snapshot, including restrictions and policy. */
export async function verifyLongDecisionsInventory(
    corpus: LongDecisionsCorpus,
    query: Query
): Promise<LongDecisionsWorkspace> {
    const slug = `long-decisions-${corpus.publicManifest.specSha256.slice(0, 16)}`;
    const companies = await query("SELECT id::text,name FROM pdr_ai_v2_company WHERE slug=$1", [
        slug,
    ]);
    if (
        companies.length !== 1 ||
        companies[0]!.name !== corpus.publicManifest.company.name + " (benchmark only)"
    )
        throw Error("long_ingest_company_mismatch");
    const companyId = String(companies[0]!.id),
        seedOwnerId = `long-decisions-seed-${companyId}`;
    const inventory = await query(
        `SELECT d.id::text AS document_id,d.creation_key AS document_key,d.category,d.title,d.current_version_id::text,COALESCE(s.restricted,false) AS restricted,v.id::text AS version_id,v.creation_key AS version_key,v.version_number,v.created_at,encode(sha256(convert_to(string_agg(c.content,E'\\n' ORDER BY c.page_number,c.line_start,c.id),'UTF8')),'hex') AS canonical_hash FROM pdr_ai_v2_document d LEFT JOIN pdr_ai_v2_document_settings s ON s.document_id=d.id LEFT JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id LEFT JOIN pdr_ai_v2_document_context_chunks c ON c.version_id=v.id WHERE d.company_id=$1::bigint GROUP BY d.id,s.restricted,v.id`,
        [companyId]
    );
    if (
        inventory.length !==
            corpus.documents.reduce((total, document) => total + document.versions.length, 0) ||
        new Set(inventory.map(r => r.document_id)).size !== corpus.documents.length
    )
        throw Error("long_ingest_database_inventory_mismatch");
    const documents: MappingDocument[] = [];
    for (const d of corpus.documents) {
        const rows = inventory.filter(
            r => r.document_key === creation(corpus.publicManifest.specSha256, d.id)
        );
        if (rows.length !== d.versions.length || new Set(rows.map(r => r.document_id)).size !== 1)
            throw Error("long_ingest_document_mapping_mismatch");
        const mapped: MappingDocument = {
            stableId: d.id,
            documentId: String(rows[0]!.document_id),
            visibility: d.visibility,
            versions: [],
        };
        for (const [index, v] of d.versions.entries()) {
            const matches = rows.filter(
                r => r.version_key === creation(corpus.publicManifest.specSha256, v.id)
            );
            const r = matches[0]!;
            if (
                matches.length !== 1 ||
                r.category !== category(d.visibility) ||
                r.title !== d.title ||
                r.restricted !== (d.visibility === "denied") ||
                Number(r.version_number) !== index + 1 ||
                new Date(String(r.created_at)).toISOString() !==
                    new Date(v.publishedAt).toISOString() ||
                r.canonical_hash !== v.sha256
            )
                throw Error("long_ingest_version_database_mismatch");
            mapped.versions.push({
                stableId: v.id,
                versionId: String(r.version_id),
                canonicalHash: v.sha256,
            });
        }
        if (rows.some(r => String(r.current_version_id) !== mapped.versions.at(-1)!.versionId))
            throw Error("long_ingest_current_version_mismatch");
        documents.push(mapped);
    }
    const readableDocumentIds = documents
            .filter(d => d.visibility === "actor_readable")
            .map(d => d.documentId),
        deniedDocumentIds = documents.filter(d => d.visibility === "denied").map(d => d.documentId);
    const requiredSourceScopes: LongDecisionsWorkspace["requiredSourceScopes"] = {};
    for (const fixed of corpus.publicManifest.fixedSources) {
        const d = documents.find(d => d.stableId === fixed.documentId)!,
            v = d.versions.find(v => v.stableId === fixed.versionId)!;
        const text = corpus.documents
            .find(d => d.id === fixed.documentId)!
            .versions.find(v => v.id === fixed.versionId)!.text;
        requiredSourceScopes[d.documentId] = {
            version: v.versionId,
            expectedParentHash: v.canonicalHash,
            qualification: "Required bounded company context from the locked fixture version.",
            requiredUnits: [
                {
                    id: "fixed-context",
                    start: fixed.textStart,
                    end: fixed.textEnd,
                    excerptHash: hash(text.slice(fixed.textStart, fixed.textEnd)),
                },
            ],
        };
    }
    const policy = await query(
        "SELECT architecture_document_id::text,required_document_ids,required_source_scopes FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=$1::bigint",
        [companyId]
    );
    const fixedDocuments = corpus.publicManifest.fixedSources.map(
        fixed => documents.find(document => document.stableId === fixed.documentId)!
    );
    if (
        policy.length !== 1 ||
        policy[0]!.architecture_document_id !== fixedDocuments[0]!.documentId
    )
        throw Error("long_ingest_policy_architecture_mismatch");
    if (
        JSON.stringify(policy[0]!.required_document_ids) !==
        JSON.stringify([fixedDocuments[1]!.documentId])
    )
        throw Error("long_ingest_policy_required_ids_mismatch");
    if (
        JSON.stringify(sortObject(policy[0]!.required_source_scopes)) !==
        JSON.stringify(sortObject(requiredSourceScopes))
    )
        throw Error("long_ingest_policy_scopes_mismatch");
    const members = await query(
        `SELECT a.id FROM pdr_ai_v2_auth_user a JOIN pdr_ai_v2_users u ON u."userId"=a.id JOIN pdr_ai_v2_user_company_memberships m ON m.user_id=u.id AND m.company_id=u.company_id WHERE u.company_id=$1::bigint AND a.id=$2 AND m.role='owner' AND m.status='active'`,
        [companyId, seedOwnerId]
    );
    if (members.length !== 1) throw Error("long_ingest_owner_mismatch");
    return {
        companyId,
        workspaceId: companyId,
        seedOwnerId,
        publicManifest: corpus.publicManifest,
        documents,
        readableDocumentIds,
        deniedDocumentIds,
        requiredSourceScopes,
        documentScope: {
            kind: "only",
            allowedCategories: [],
            deniedDocumentIds: [],
            allowedDocumentIds: readableDocumentIds.map(Number),
        },
    };
}
function sortObject(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortObject);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, sortObject(v)])
        );
    return value;
}

export async function ingestLongDecisionsWorkspace(options: {
    cache: string;
    databaseUrl?: string;
    lockPath?: string;
    revision?: LongDecisionsRevision;
}): Promise<LongDecisionsWorkspace> {
    const databaseUrl = assertLongDecisionsDatabase(options.databaseUrl ?? LONG_DECISIONS_DATABASE);
    const corpus = await loadLongDecisionsWorkspace(options);
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, debug: false });
    const slug = `long-decisions-${corpus.publicManifest.specSha256.slice(0, 16)}`;
    try {
        const existing = await sql`SELECT id FROM pdr_ai_v2_company WHERE slug=${slug}`;
        if (existing.length)
            return await sql.begin(async tx => {
                await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
                return verifyLongDecisionsInventory(corpus, (s, p = []) =>
                    tx.unsafe(s, p as never[])
                );
            });
        return await sql.begin(async tx => {
            const q: Query = (s, p = []) => tx.unsafe(s, p as never[]);
            const [company] = await q(
                "INSERT INTO pdr_ai_v2_company(name,slug,\"numberOfEmployees\") VALUES($1,$2,'1') RETURNING id::text",
                [corpus.publicManifest.company.name + " (benchmark only)", slug]
            );
            const companyId = String(company!.id),
                owner = `long-decisions-seed-${companyId}`,
                email = `${owner}@example.test`;
            await q(
                "INSERT INTO pdr_ai_v2_auth_user(id,name,email,email_verified,created_at,updated_at) VALUES($1,'Long fixture owner',$2,true,now(),now())",
                [owner, email]
            );
            const [user] = await q(
                "INSERT INTO pdr_ai_v2_users(name,email,\"userId\",company_id) VALUES('Long fixture owner',$1,$2,$3::bigint) RETURNING id",
                [email, owner, companyId]
            );
            await q(
                "INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status) VALUES($1,$2::bigint,'owner','active')",
                [user!.id, companyId]
            );
            const mapping = new Map<string, { documentId: string; versionId: string }>();
            for (const d of corpus.documents) {
                let documentId = "";
                for (const [index, v] of d.versions.entries()) {
                    const bytes = Buffer.from(v.text, "utf8");
                    const [file] = await q(
                        "INSERT INTO pdr_ai_v2_file_uploads(user_id,company_id,filename,mime_type,file_data,file_size,storage_provider,blob_checksum,created_at) VALUES($1,$2::bigint,$3,'text/markdown',$4,$5,'database',$6,$7) RETURNING id",
                        [
                            owner,
                            companyId,
                            v.file,
                            bytes.toString("base64"),
                            bytes.length,
                            v.sha256,
                            v.publishedAt,
                        ]
                    );
                    const url = `/api/files/${String(file!.id)}`;
                    if (!documentId) {
                        const [row] = await q(
                            "INSERT INTO pdr_ai_v2_document(company_id,url,category,title,mime_type,ocr_processed,created_at,updated_at,creation_key) VALUES($1::bigint,$2,$3,$4,'text/markdown',true,$5,$5,$6) RETURNING id::text",
                            [
                                companyId,
                                url,
                                category(d.visibility),
                                d.title,
                                v.publishedAt,
                                creation(corpus.publicManifest.specSha256, d.id),
                            ]
                        );
                        documentId = String(row!.id);
                    }
                    const [row] = await q(
                        "INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,file_size,ocr_processed,created_at,creation_key) VALUES($1::bigint,$2,$3,'text/markdown',$4,true,$5,$6) RETURNING id::text",
                        [
                            documentId,
                            index + 1,
                            url,
                            bytes.length,
                            v.publishedAt,
                            creation(corpus.publicManifest.specSha256, v.id),
                        ]
                    );
                    const versionId = String(row!.id);
                    await q(
                        "INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,content_hash,char_count,page_number,line_start,created_at) VALUES($1::bigint,$2::bigint,$3,$4,$5,1,1,$6)",
                        [documentId, versionId, v.text, v.sha256, v.text.length, v.publishedAt]
                    );
                    await q(
                        "UPDATE pdr_ai_v2_document SET current_version_id=$2::bigint,url=$3,updated_at=$4 WHERE id=$1::bigint",
                        [documentId, versionId, url, v.publishedAt]
                    );
                    mapping.set(v.id, { documentId, versionId });
                }
                if (d.visibility === "denied")
                    await q(
                        "INSERT INTO pdr_ai_v2_document_settings(document_id,company_id,restricted,updated_by) VALUES($1::bigint,$2::bigint,true,$3)",
                        [documentId, companyId, owner]
                    );
            }
            const scopes: LongDecisionsWorkspace["requiredSourceScopes"] = {};
            for (const f of corpus.publicManifest.fixedSources) {
                const mapped = mapping.get(f.versionId)!,
                    v = corpus.documents
                        .find(d => d.id === f.documentId)!
                        .versions.find(v => v.id === f.versionId)!;
                scopes[mapped.documentId] = {
                    version: mapped.versionId,
                    expectedParentHash: v.sha256,
                    qualification:
                        "Required bounded company context from the locked fixture version.",
                    requiredUnits: [
                        {
                            id: "fixed-context",
                            start: f.textStart,
                            end: f.textEnd,
                            excerptHash: hash(v.text.slice(f.textStart, f.textEnd)),
                        },
                    ],
                };
            }
            await q(
                "INSERT INTO pdr_ai_v2_vantage_weekly_review_policy(company_id,architecture_document_id,required_document_ids,required_source_scopes) VALUES($1::bigint,$2::bigint,$3::text::jsonb,$4::text::jsonb)",
                [
                    companyId,
                    mapping.get(corpus.publicManifest.fixedSources[0]!.versionId)!.documentId,
                    JSON.stringify([
                        mapping.get(corpus.publicManifest.fixedSources[1]!.versionId)!.documentId,
                    ]),
                    JSON.stringify(scopes),
                ]
            );
            return verifyLongDecisionsInventory(corpus, q);
        });
    } finally {
        await sql.end({ timeout: 5 });
    }
}
