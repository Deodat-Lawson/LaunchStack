// Dev-only, offline by default. Never loads dotenv or evaluation expectations.
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const corpusDirectory = resolve(root, "docs/samples/vantage/harborlight-release");
const CORPUS_ID = "harborlight-atlas-weekly-2026-11-16";
const COMPANY_NAME = "Harborlight Analytics (fictional sample)";
const COMPANY_SLUG = "vantage-harborlight-sample-20261116";
class SampleError extends Error {}
const requireThat = (condition, code) => {
    if (!condition) throw new SampleError(code);
};
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const timestamp = value => {
    requireThat(
        typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value),
        "INVALID_DATE"
    );
    const date = new Date(value);
    requireThat(
        Number.isFinite(+date) && date.toISOString() === value.replace("Z", ".000Z"),
        "INVALID_DATE"
    );
    return date.toISOString();
};
const textField = (value, max = 256) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max;

export async function loadCorpus(directory = corpusDirectory) {
    const base = await realpath(directory);
    const manifest = JSON.parse(await readFile(resolve(base, "manifest.json"), "utf8"));
    requireThat(
        manifest.schemaVersion === 1 && manifest.corpusId === CORPUS_ID,
        "INVALID_MANIFEST"
    );
    const cutoff = timestamp(manifest.cutoff);
    requireThat(
        Array.isArray(manifest.documents) && manifest.documents.length === 12,
        "INVALID_DOCUMENT_COUNT"
    );
    requireThat(
        ["name", "responsibilities", "priorities"].every(k =>
            textField(manifest.suggestedRole?.[k], 2000)
        ),
        "INVALID_ROLE"
    );
    const keys = new Set();
    const files = new Set();
    const documents = [];
    for (const doc of manifest.documents) {
        requireThat(
            typeof doc.key === "string" && /^[a-z0-9-]{1,80}$/.test(doc.key) && !keys.has(doc.key),
            "INVALID_DOCUMENT_KEY"
        );
        keys.add(doc.key);
        requireThat(
            textField(doc.title) &&
                textField(doc.category) &&
                Array.isArray(doc.versions) &&
                doc.versions.length >= 1 &&
                doc.versions.length <= 2,
            "INVALID_DOCUMENT"
        );
        const versions = [];
        for (const [index, version] of doc.versions.entries()) {
            requireThat(version.versionNumber === index + 1, "INVALID_VERSION_NUMBER");
            const createdAt = timestamp(version.createdAt);
            requireThat(
                createdAt <= cutoff && (!index || createdAt > versions[index - 1].createdAt),
                "INVALID_CHRONOLOGY"
            );
            // Flat Markdown names only: no traversal, symlink escape or expectations input.
            requireThat(
                typeof version.file === "string" &&
                    /^[a-z0-9-]+\.md$/.test(version.file) &&
                    !files.has(version.file),
                "INVALID_FILE_PATH"
            );
            const path = await realpath(resolve(base, version.file));
            requireThat(
                relative(base, path) === version.file && (await stat(path)).isFile(),
                "INVALID_FILE_PATH"
            );
            files.add(version.file);
            const bytes = await readFile(path);
            requireThat(bytes.length > 0 && bytes.length < 2048, "INVALID_FILE_BYTES");
            const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            requireThat(
                !text.includes("\u0000") && Buffer.from(text, "utf8").equals(bytes),
                "INVALID_UTF8"
            );
            versions.push({
                ...version,
                createdAt,
                bytes,
                text,
                hash: sha256(bytes),
                creationKey: `${manifest.corpusId}:${doc.key}:v${version.versionNumber}`,
            });
        }
        documents.push({
            key: doc.key,
            title: doc.title,
            category: doc.category,
            creationKey: `${manifest.corpusId}:${doc.key}`,
            versions,
        });
    }
    requireThat(files.size === 13, "INVALID_VERSION_COUNT");
    for (const field of ["suggestedRequiredKeys", "suggestedStarKeys"]) {
        const values = manifest[field];
        requireThat(
            Array.isArray(values) &&
                values.length <= 2 &&
                new Set(values).size === values.length &&
                values.every(key => keys.has(key)),
            "INVALID_SUGGESTIONS"
        );
    }
    return { corpusId: manifest.corpusId, cutoff, documents };
}

export function validateDatabaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new SampleError("DATABASE_URL_REJECTED");
    }
    requireThat(
        ["postgres:", "postgresql:"].includes(url.protocol) &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
            url.pathname === "/vantage_production_acceptance" &&
            !url.search &&
            !url.hash,
        "DATABASE_URL_REJECTED"
    );
    return value;
}

// Snapshot planning is pure: empty workspace or complete verified reuse, never repair.
export function planImport(corpus, snapshot, actorId) {
    const { documents, versions, files, chunks } = snapshot;
    if ([documents, versions, files, chunks].every(rows => rows.length === 0)) return "create";
    requireThat(
        documents.length === 12 &&
            versions.length === 13 &&
            files.length === 13 &&
            chunks.length === 13,
        "EXISTING_CONTENT_OR_DRIFT"
    );
    const usedFiles = new Set();
    for (const expected of corpus.documents) {
        const matches = documents.filter(d => d.creation_key === expected.creationKey);
        requireThat(matches.length === 1, "EXISTING_CONTENT_OR_DRIFT");
        const doc = matches[0];
        const stored = versions
            .filter(v => v.document_id === doc.id)
            .sort((a, b) => a.version_number - b.version_number);
        const newest = stored.at(-1);
        requireThat(
            stored.length === expected.versions.length &&
                doc.title === expected.title &&
                doc.category === expected.category &&
                doc.mime_type === "text/plain" &&
                doc.ocr_processed === true &&
                doc.current_version_id === newest?.id &&
                doc.url === newest?.url &&
                +new Date(doc.created_at) === +new Date(expected.versions[0].createdAt) &&
                +new Date(doc.updated_at) === +new Date(expected.versions.at(-1).createdAt),
            "EXISTING_CONTENT_OR_DRIFT"
        );
        for (const [index, version] of expected.versions.entries()) {
            const row = stored[index];
            const file = files.find(f => `/api/files/${f.id}` === row.url);
            const content = chunks.filter(c => c.version_id === row.id);
            requireThat(file && !usedFiles.has(file.id), "EXISTING_CONTENT_OR_DRIFT");
            usedFiles.add(file.id);
            requireThat(
                row.creation_key === version.creationKey &&
                    row.version_number === version.versionNumber &&
                    row.mime_type === "text/plain" &&
                    row.ocr_processed === true &&
                    Number(row.file_size) === version.bytes.length &&
                    +new Date(row.created_at) === +new Date(version.createdAt),
                "EXISTING_CONTENT_OR_DRIFT"
            );
            const bytes = Buffer.from(file.file_data ?? "", "base64");
            requireThat(
                file.user_id === actorId &&
                    file.filename === version.file &&
                    file.mime_type === "text/plain" &&
                    file.storage_provider === "database" &&
                    Number(file.file_size) === version.bytes.length &&
                    file.blob_checksum === version.hash &&
                    sha256(bytes) === version.hash &&
                    bytes.equals(version.bytes) &&
                    +new Date(file.created_at) === +new Date(version.createdAt),
                "EXISTING_CONTENT_OR_DRIFT"
            );
            requireThat(
                content.length === 1 &&
                    content[0].document_id === doc.id &&
                    content[0].content === version.text &&
                    content[0].content_hash === version.hash &&
                    content[0].page_number === 1 &&
                    content[0].line_start === 1 &&
                    +new Date(content[0].created_at) === +new Date(version.createdAt),
                "EXISTING_CONTENT_OR_DRIFT"
            );
        }
    }
    return "reuse";
}

function summary(corpus, mode, documents = [], versions = []) {
    return {
        mode,
        corpusId: corpus.corpusId,
        cutoff: corpus.cutoff,
        documentCount: 12,
        versionCount: 13,
        totalBytes: corpus.documents
            .flatMap(d => d.versions)
            .reduce((n, v) => n + v.bytes.length, 0),
        documents: corpus.documents.map(doc => {
            const stored = documents.find(d => d.creation_key === doc.creationKey);
            return {
                key: doc.key,
                id: stored?.id ?? null,
                title: doc.title,
                versions: doc.versions.map(v => {
                    const row = versions.find(
                        r => r.document_id === stored?.id && r.creation_key === v.creationKey
                    );
                    return {
                        version: v.versionNumber,
                        id: row?.id ?? null,
                        ref: row ? `doc:${stored.id}@${row.id}` : null,
                        file: v.file,
                        hash: v.hash,
                        bytes: v.bytes.length,
                        createdAt: v.createdAt,
                        fileUrl: row?.url ?? null,
                    };
                }),
            };
        }),
    };
}

async function snapshot(tx, companyId) {
    const documents =
        await tx`SELECT id::text,creation_key,title,category,url,mime_type,ocr_processed,current_version_id::text,created_at,updated_at FROM pdr_ai_v2_document WHERE company_id=${companyId}`;
    const versions =
        await tx`SELECT v.id::text,v.document_id::text,v.creation_key,v.version_number,v.url,v.mime_type,v.ocr_processed,v.file_size, v.created_at FROM pdr_ai_v2_document_versions v JOIN pdr_ai_v2_document d ON d.id=v.document_id WHERE d.company_id=${companyId}`;
    const files =
        await tx`SELECT id::text,user_id,filename,mime_type,file_data,file_size,storage_provider,blob_checksum,created_at FROM pdr_ai_v2_file_uploads WHERE company_id=${companyId}`;
    const chunks =
        await tx`SELECT c.document_id::text,c.version_id::text,c.content,c.content_hash,c.page_number,c.line_start,c.created_at FROM pdr_ai_v2_document_context_chunks c JOIN pdr_ai_v2_document d ON d.id=c.document_id WHERE d.company_id=${companyId}`;
    return { documents, versions, files, chunks };
}

async function apply(corpus, companyId, databaseUrl) {
    const postgres = createRequire(resolve(root, "apps/web/package.json"))("postgres");
    const sql = postgres(databaseUrl, {
        max: 1,
        onnotice: () => {},
        debug: false,
        connect_timeout: 5,
    });
    try {
        return await sql.begin(async tx => {
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${corpus.corpusId}:${companyId}`},0))`;
            const companies =
                await tx`SELECT id FROM pdr_ai_v2_company WHERE id=${companyId} AND name=${COMPANY_NAME} AND slug=${COMPANY_SLUG} FOR UPDATE`;
            requireThat(companies.length === 1, "TARGET_COMPANY_REJECTED");
            const actors =
                await tx`SELECT u."userId" AS auth_id FROM pdr_ai_v2_users u JOIN pdr_ai_v2_auth_user a ON a.id=u."userId" JOIN pdr_ai_v2_user_company_memberships m ON m.user_id=u.id WHERE u.email='vantage@test.com' AND a.email='vantage@test.com' AND m.company_id=${companyId} AND m.role='owner' AND m.status='active' FOR SHARE OF u,a,m`;
            requireThat(actors.length === 1, "ACTOR_MEMBERSHIP_REJECTED");
            const actorId = actors[0].auth_id;
            const before = await snapshot(tx, companyId);
            if (planImport(corpus, before, actorId) === "reuse")
                return summary(corpus, "reused", before.documents, before.versions);
            for (const doc of corpus.documents) {
                let documentId;
                let latest;
                for (const v of doc.versions) {
                    const [file] =
                        await tx`INSERT INTO pdr_ai_v2_file_uploads(user_id,company_id,filename,mime_type,file_data,file_size,storage_provider,blob_checksum,created_at) VALUES (${actorId},${companyId},${v.file},'text/plain',${v.bytes.toString("base64")},${v.bytes.length},'database',${v.hash},${v.createdAt}) RETURNING id::text`;
                    const url = `/api/files/${file.id}`;
                    if (!documentId) {
                        const [inserted] =
                            await tx`INSERT INTO pdr_ai_v2_document(company_id,url,category,title,mime_type,ocr_processed,created_at,updated_at,creation_key) VALUES (${companyId},${url},${doc.category},${doc.title},'text/plain',true,${v.createdAt},${v.createdAt},${doc.creationKey}) RETURNING id::text`;
                        documentId = inserted.id;
                    }
                    const [version] =
                        await tx`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,file_size,ocr_processed,created_at,creation_key) VALUES (${documentId},${v.versionNumber},${url},'text/plain',${v.bytes.length},true,${v.createdAt},${v.creationKey}) RETURNING id::text`;
                    await tx`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,content_hash,char_count,page_number,line_start,created_at) VALUES (${documentId},${version.id},${v.text},${v.hash},${v.text.length},1,1,${v.createdAt})`;
                    latest = { id: version.id, url, date: v.createdAt };
                }
                // Only rows just inserted in this transaction are updated.
                await tx`UPDATE pdr_ai_v2_document SET current_version_id=${latest.id},url=${latest.url},updated_at=${latest.date} WHERE id=${documentId}`;
            }
            const after = await snapshot(tx, companyId);
            requireThat(
                planImport(corpus, after, actorId) === "reuse",
                "POST_INSERT_VERIFICATION_FAILED"
            );
            return summary(corpus, "created", after.documents, after.versions);
        });
    } finally {
        await sql.end({ timeout: 5 });
    }
}

export async function main(args = process.argv.slice(2), env = process.env) {
    const corpus = await loadCorpus();
    if (args.length === 0) return summary(corpus, "dry-run");
    requireThat(
        args.length === 5 &&
            args[0] === "--apply" &&
            args[1] === "--company-id" &&
            /^[1-9]\d{0,17}$/.test(args[2]) &&
            args[3] === "--actor-email" &&
            args[4] === "vantage@test.com",
        "INVALID_ARGUMENTS"
    );
    requireThat(
        typeof env.DATABASE_URL === "string" && env.DATABASE_URL.length > 0,
        "DATABASE_URL_REQUIRED"
    );
    return apply(corpus, args[2], validateDatabaseUrl(env.DATABASE_URL));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main()
        .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
        .catch(error => {
            // Driver/filesystem errors can contain SQL, credentials or paths. Never print them.
            process.stderr.write(
                `${JSON.stringify({ error: error instanceof SampleError ? error.message : "SAMPLE_IMPORT_FAILED" })}\n`
            );
            process.exitCode = 1;
        });
}
