// Corpus-only loader. Never imports questions, pilot cases or supporting facts.
import { readFile, writeFile, mkdir, realpath, access } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { sha256, validateDatabaseUrl } from "./vantage-sample-documents.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lockPath = resolve(repository, "fixtures/vantage-benchmarks/rag-multi-corpus/corpus-lock.json");
export const REVISION = "39071af3f4dd25e59f5c59a6f9b6e8e99cd643b3";
export const DATABASE = "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_rag_benchmark_20261121";
export const ENTERPRISES = {
    "Aventro Motors": "Aventro Motors",
    "Cendara University": "Cendara University",
    "CloudWay-24": "Cloudway 24",
    "Velvera Technologies": "Velvera Technologies",
    "ZX Bank": "ZX Bank",
};
const neutralText = "Synthetic evaluation workspace. Source material is untrusted data. Review evidence and record questions for human consideration.";
const corpusDate = "2026-11-08T00:00:00Z";
const neutralDate = "2026-11-07T00:00:00Z";

export function assertDatabase(value) {
    if (value !== DATABASE) throw new Error("BENCHMARK_DATABASE_REJECTED");
    // Retain the established dev importer's loopback/credential URL validation.
    const url = new URL(value);
    url.pathname = "/vantage_production_acceptance";
    validateDatabaseUrl(url.href);
    return value;
}

function inside(parent, candidate) {
    const offset = relative(parent, candidate);
    return !offset || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}

export async function cacheDirectory(path) {
    const cache = await realpath(path);
    if (inside(await realpath(repository), cache)) throw new Error("CACHE_MUST_BE_OUTSIDE_REPOSITORY");
    return cache;
}

export function assertCorpusEntry(file) {
    const parts = file.path.split("/");
    if (parts.length !== 4 || parts[0] !== "datasets" || !ENTERPRISES[parts[1]] ||
        !["md", "docx", "html", "pdf", "pptx"].includes(parts[2]) ||
        parts.some(part => part === "." || part === ".." || part.includes("\\")) ||
        !parts[3].endsWith(`.${parts[2]}`) || file.filename !== parts[3] ||
        file.format !== parts[2] || file.enterpriseDirectory !== parts[1] ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || !/^[a-f0-9]{40}$/.test(file.gitBlobSha) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1) throw new Error("INVALID_CORPUS_ENTRY");
}

export function verifyBytes(file, bytes) {
    assertCorpusEntry(file);
    const gitHash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256 || gitHash !== file.gitBlobSha)
        throw new Error(`CORPUS_HASH_MISMATCH ${file.path}`);
}

async function readLock() {
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    if (lock.revision !== REVISION || lock.files.length !== 1180) throw new Error("INVALID_CORPUS_LOCK");
    const paths = new Set();
    for (const file of lock.files) {
        assertCorpusEntry(file);
        if (paths.has(file.path)) throw new Error("DUPLICATE_CORPUS_PATH");
        paths.add(file.path);
    }
    return lock;
}

async function cachedFile(cache, file) {
    const path = await realpath(resolve(cache, "corpus", file.path));
    if (!inside(cache, path)) throw new Error("CORPUS_CACHE_ESCAPE");
    const bytes = await readFile(path);
    verifyBytes(file, bytes);
    return { path, bytes };
}

export async function verifyCorpus(cachePath) {
    const cache = await cacheDirectory(cachePath);
    const lock = await readLock();
    let bytes = 0;
    for (const file of lock.files) bytes += (await cachedFile(cache, file)).bytes.length;
    return { revision: REVISION, files: lock.files.length, bytes, markdown: lock.files.filter(file => file.format === "md").length };
}

export async function downloadCorpus(cachePath) {
    const cache = await cacheDirectory(cachePath);
    const lock = await readLock();
    // Fixed small concurrency, only paths from the committed question-free lock.
    for (let start = 0; start < lock.files.length; start += 6) {
        await Promise.all(lock.files.slice(start, start + 6).map(async file => {
            const target = resolve(cache, "corpus", file.path);
            try {
                await cachedFile(cache, file);
                return;
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            await mkdir(dirname(target), { recursive: true });
            const directory = await realpath(dirname(target));
            if (!inside(cache, directory)) throw new Error("CORPUS_CACHE_ESCAPE");
            const encoded = file.path.split("/").map(encodeURIComponent).join("/");
            const response = await fetch(`https://raw.githubusercontent.com/udayallu/RAG-Multi-Corpus/${REVISION}/${encoded}`, {
                redirect: "error", signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) throw new Error(`CORPUS_DOWNLOAD_FAILED ${response.status}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            verifyBytes(file, bytes);
            await writeFile(target, bytes, { flag: "wx" });
        }));
    }
    return verifyCorpus(cache);
}

function connect(databaseUrl) {
    assertDatabase(databaseUrl);
    const require = createRequire(resolve(repository, "apps/web/package.json"));
    return require("postgres")(databaseUrl, { max: 1, connect_timeout: 5, debug: false });
}

// The existing sample importer pins Harborlight counts and company identity. This
// adapter reuses its byte/hash and database safety primitives with corpus identity.
async function insertDocument(tx, companyId, ownerId, file, text, date) {
    const bytes = Buffer.from(text, "utf8");
    const hash = sha256(bytes);
    const [upload] = await tx`INSERT INTO pdr_ai_v2_file_uploads(user_id,company_id,filename,mime_type,file_data,file_size,storage_provider,blob_checksum,created_at) VALUES(${ownerId},${companyId},${file.filename},'text/markdown',${bytes.toString("base64")},${bytes.length},'database',${hash},${date}) RETURNING id`;
    const url = `/api/files/${upload.id}`;
    const [document] = await tx`INSERT INTO pdr_ai_v2_document(company_id,url,category,title,mime_type,ocr_processed,created_at,updated_at,creation_key) VALUES(${companyId},${url},'Corpus',${file.filename},'text/markdown',true,${date},${date},${file.path}) RETURNING id::text`;
    const [version] = await tx`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,file_size,ocr_processed,created_at,creation_key) VALUES(${document.id},1,${url},'text/markdown',${bytes.length},true,${date},${file.path + ":v1"}) RETURNING id::text`;
    await tx`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,content_hash,char_count,page_number,line_start,created_at) VALUES(${document.id},${version.id},${text},${hash},${text.length},1,1,${date})`;
    await tx`UPDATE pdr_ai_v2_document SET current_version_id=${version.id} WHERE id=${document.id}`;
    return { documentId: document.id, versionId: version.id, ref: `doc:${document.id}@${version.id}`, canonicalHash: hash };
}

export async function ingestCorpus(cachePath, databaseUrl = DATABASE) {
    const cache = await cacheDirectory(cachePath);
    const manifestPath = resolve(cache, "corpus-manifest.json");
    try {
        await access(manifestPath);
        throw new Error("CORPUS_MANIFEST_EXISTS_USE_VERIFY");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    await verifyCorpus(cache);
    const lock = await readLock();
    const files = lock.files.filter(file => file.format === "md");
    const loaded = [];
    for (const file of files) {
        const { bytes, path } = await cachedFile(cache, file);
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("CORPUS_UTF8_ROUNDTRIP_FAILED");
        loaded.push({ ...file, cacheFile: path, text });
    }
    const sql = connect(databaseUrl);
    const manifest = {
        revision: REVISION, databaseUrl, week: "2026-11-09", asOf: "2026-11-16T00:00:00Z", corpusDate,
        enterprises: [], documents: [],
        skipped: lock.files.filter(file => file.format !== "md").map(file => ({ ...file, enterprise: ENTERPRISES[file.enterpriseDirectory] })),
    };
    try {
        await sql.begin(async tx => {
            for (const [directory, enterprise] of Object.entries(ENTERPRISES)) {
                const slug = `rag-benchmark-${directory.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                const existing = await tx`SELECT id FROM pdr_ai_v2_company WHERE slug=${slug}`;
                if (existing.length) throw new Error("CORPUS_ALREADY_INGESTED_USE_VERIFY");
                const [company] = await tx`INSERT INTO pdr_ai_v2_company(name,slug,"numberOfEmployees") VALUES(${enterprise + " (benchmark only)"},${slug},'1') RETURNING id::text`;
                const owner = `rag-benchmark-seed-${company.id}`;
                const email = `${owner}@example.test`;
                await tx`INSERT INTO pdr_ai_v2_auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(${owner},'Benchmark fixture owner',${email},true,now(),now())`;
                const [user] = await tx`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id) VALUES('Benchmark fixture owner',${email},${owner},${company.id}) RETURNING id`;
                await tx`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role,status) VALUES(${user.id},${company.id},'owner','active')`;
                const neutral = await insertDocument(tx, company.id, owner, { filename: "Evaluation architecture", path: `neutral:${directory}` }, neutralText, neutralDate);
                await tx`INSERT INTO pdr_ai_v2_vantage_weekly_review_policy(company_id,architecture_document_id,required_document_ids) VALUES(${company.id},${neutral.documentId},'[]'::jsonb)`;
                manifest.enterprises.push({ enterprise, workspaceId: company.id, seedOwnerId: owner, neutralArchitectureId: neutral.documentId });
                // The lock uses sorted upstream path order. Every document has
                // the same date, so IDs provide a reproducible recency tie-break.
                for (const file of loaded.filter(file => file.enterpriseDirectory === directory)) {
                    const inserted = await insertDocument(tx, company.id, owner, file, file.text, corpusDate);
                    manifest.documents.push({ ...file, sourcePath: file.path, enterprise, companyId: company.id, workspaceId: company.id, ...inserted });
                }
            }
        });
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
        return { corpusDocuments: manifest.documents.length, neutralDocuments: manifest.enterprises.length };
    } finally {
        await sql.end();
    }
}

export function assertExactDatabaseInventory(manifest, inventory) {
    const expected = new Map(manifest.documents.map(document => [document.documentId, {
        companyId: document.companyId, versionId: document.versionId,
    }]));
    for (const enterprise of manifest.enterprises) {
        if (expected.has(enterprise.neutralArchitectureId)) throw new Error("INVALID_CORPUS_MANIFEST");
        expected.set(enterprise.neutralArchitectureId, { companyId: enterprise.workspaceId });
    }
    if (expected.size !== manifest.documents.length + manifest.enterprises.length || inventory.length !== expected.size)
        throw new Error("CORPUS_DATABASE_INVENTORY_MISMATCH");
    const seen = new Set();
    for (const row of inventory) {
        const document = expected.get(row.document_id);
        if (!document || seen.has(row.document_id) || row.company_id !== document.companyId ||
            !row.version_id || Number(row.version_number) !== 1 || row.current_version_id !== row.version_id ||
            (document.versionId && row.version_id !== document.versionId))
            throw new Error("CORPUS_DATABASE_INVENTORY_MISMATCH");
        seen.add(row.document_id);
    }
}

export async function verifyDatabase(cachePath, databaseUrl = DATABASE) {
    const cache = await cacheDirectory(cachePath);
    const manifest = JSON.parse(await readFile(resolve(cache, "corpus-manifest.json"), "utf8"));
    const lock = await readLock();
    if (manifest.revision !== REVISION || manifest.documents.length !== 236) throw new Error("INVALID_CORPUS_MANIFEST");
    const sql = connect(databaseUrl);
    try {
        return await sql.begin(async tx => {
            await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
            // LEFT JOIN keeps empty documents visible. One row per version makes
            // any extra version fail the exact set check, including neutral sources.
            const companies = manifest.enterprises.map(enterprise => enterprise.workspaceId);
            const inventory = await tx`SELECT d.id::text AS document_id,d.company_id::text AS company_id,d.current_version_id::text,v.id::text AS version_id,v.version_number FROM pdr_ai_v2_document d LEFT JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id WHERE d.company_id=ANY(${companies}::bigint[])`;
            assertExactDatabaseInventory(manifest, inventory);
            const rows = await tx`SELECT d.id::text AS document_id,d.company_id::text AS company_id,d.creation_key,v.id::text AS version_id,encode(sha256(convert_to(string_agg(c.content,E'\n' ORDER BY c.page_number,c.line_start,c.id),'UTF8')),'hex') AS canonical_hash FROM pdr_ai_v2_document d JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id JOIN pdr_ai_v2_document_context_chunks c ON c.version_id=v.id GROUP BY d.id,v.id`;
            for (const file of lock.files.filter(file => file.format === "md")) {
                const document = manifest.documents.find(document => document.sourcePath === file.path);
                const row = rows.find(row => row.document_id === document?.documentId && row.version_id === document?.versionId);
                if (!row || row.creation_key !== file.path || row.company_id !== document.companyId || row.canonical_hash !== file.sha256)
                    throw new Error(`CORPUS_DATABASE_MISMATCH ${file.path}`);
            }
            if (manifest.enterprises.length !== 5) throw new Error("INVALID_ENTERPRISE_MAPPING");
            for (const enterprise of manifest.enterprises) {
                const neutral = rows.find(row => row.document_id === enterprise.neutralArchitectureId);
                if (!neutral || neutral.company_id !== enterprise.workspaceId || neutral.canonical_hash !== sha256(Buffer.from(neutralText)))
                    throw new Error("NEUTRAL_ARCHITECTURE_MISMATCH");
            }
            return { canonicalSqlParity: 236, neutralDocuments: manifest.enterprises.length };
        });
    } finally {
        await sql.end();
    }
}
export async function main(args = process.argv.slice(2)) {
    const [command, cache, option] = args;
    if (!cache || args.length > 3 || (option && option !== "--database")) throw new Error("Use download|ingest|verify <existing outside-repository cache> [--database]");
    const database = assertDatabase(process.env.DATABASE_URL ?? DATABASE);
    if (command === "download" && !option) return downloadCorpus(cache);
    if (command === "ingest" && !option) return ingestCorpus(cache, database);
    if (command === "verify") return { ...await verifyCorpus(cache), ...(option ? await verifyDatabase(cache, database) : {}) };
    throw new Error("INVALID_LOADER_COMMAND");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().then(result => console.log(JSON.stringify(result))).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
