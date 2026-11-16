import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
    loadCorpus,
    sha256,
    validateDatabaseUrl,
    planImport,
    main,
} from "./vantage-sample-documents.mjs";

const script = fileURLToPath(new URL("./vantage-sample-documents.mjs", import.meta.url));
const source = resolve(dirname(script), "../../docs/samples/vantage/harborlight-release");
const empty = () => ({ documents: [], versions: [], files: [], chunks: [] });

async function alteredManifest(change, work) {
    const directory = await mkdtemp(resolve(tmpdir(), "vantage-sample-test-"));
    try {
        await cp(source, directory, { recursive: true });
        const path = resolve(directory, "manifest.json");
        const manifest = JSON.parse(await readFile(path, "utf8"));
        change(manifest);
        await writeFile(path, JSON.stringify(manifest));
        await work(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

// Simulates the DB read boundary; tests mutate independent stored fields afterwards.
function storedSnapshot(corpus) {
    const state = empty();
    let id = 100;
    for (const expected of corpus.documents) {
        const documentId = String(id++);
        const doc = {
            id: documentId,
            creation_key: expected.creationKey,
            title: expected.title,
            category: expected.category,
            mime_type: "text/plain",
            ocr_processed: true,
            created_at: new Date(expected.versions[0].createdAt),
            updated_at: new Date(expected.versions.at(-1).createdAt),
        };
        state.documents.push(doc);
        for (const v of expected.versions) {
            const fileId = String(id++);
            const versionId = String(id++);
            const url = `/api/files/${fileId}`;
            state.versions.push({
                id: versionId,
                document_id: documentId,
                creation_key: v.creationKey,
                version_number: v.versionNumber,
                url,
                mime_type: "text/plain",
                ocr_processed: true,
                file_size: String(v.bytes.length),
                created_at: new Date(v.createdAt),
            });
            state.files.push({
                id: fileId,
                user_id: "sample-owner",
                filename: v.file,
                mime_type: "text/plain",
                file_data: v.bytes.toString("base64"),
                file_size: v.bytes.length,
                storage_provider: "database",
                blob_checksum: v.hash,
                created_at: new Date(v.createdAt),
            });
            state.chunks.push({
                document_id: documentId,
                version_id: versionId,
                content: v.text,
                content_hash: v.hash,
                page_number: 1,
                line_start: 1,
                created_at: new Date(v.createdAt),
            });
            doc.current_version_id = versionId;
            doc.url = url;
        }
    }
    return state;
}

test("bounded corpus preserves exact bytes and known SHA-256", async () => {
    assert.equal(
        sha256(Buffer.from("abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    const corpus = await loadCorpus();
    assert.equal(corpus.documents.length, 12);
    const versions = corpus.documents.flatMap(d => d.versions);
    assert.equal(versions.length, 13);
    for (const v of versions) {
        assert.ok(v.bytes.length < 2048);
        assert.deepEqual(v.bytes, await readFile(resolve(source, v.file)));
        assert.equal(v.hash, sha256(Buffer.from(v.text, "utf8")));
    }
});

test("rejects traversal, absolute paths and expectations as ingestion inputs", async () => {
    for (const file of [
        "../weekly-priorities.md",
        "/tmp/a.md",
        "C:\\temp\\a.md",
        "expectations.json",
    ]) {
        await alteredManifest(
            m => {
                m.documents[0].versions[0].file = file;
            },
            dir => assert.rejects(loadCorpus(dir), /INVALID_FILE_PATH/)
        );
    }
});

test("rejects calendar normalization, future dates and reversed chronology", async () => {
    for (const createdAt of ["2026-02-30T14:00:00Z", "2026-11-17T00:00:00Z", "2026-11-09"]) {
        await alteredManifest(
            m => {
                m.documents[0].versions[0].createdAt = createdAt;
            },
            dir => assert.rejects(loadCorpus(dir), /INVALID_DATE|INVALID_CHRONOLOGY/)
        );
    }
    await alteredManifest(
        m => {
            m.documents[1].versions[1].createdAt = m.documents[1].versions[0].createdAt;
        },
        dir => assert.rejects(loadCorpus(dir), /INVALID_CHRONOLOGY/)
    );
});

test("rejects changed count, duplicates and oversize files", async () => {
    await alteredManifest(
        m => {
            m.documents.pop();
        },
        dir => assert.rejects(loadCorpus(dir), /INVALID_DOCUMENT_COUNT/)
    );
    await alteredManifest(
        m => {
            m.documents[1].key = m.documents[0].key;
        },
        dir => assert.rejects(loadCorpus(dir), /INVALID_DOCUMENT_KEY/)
    );
    await alteredManifest(
        () => {},
        async dir => {
            await writeFile(resolve(dir, "weekly-priorities.md"), Buffer.alloc(2048, 97));
            await assert.rejects(loadCorpus(dir), /INVALID_FILE_BYTES/);
        }
    );
});

test("database allowlist rejects remote hosts, query overrides and other databases", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        const url = `postgres://sample:placeholder@${host}:5432/vantage_production_acceptance`;
        assert.equal(validateDatabaseUrl(url), url);
    }
    for (const url of [
        "postgres://remote.invalid/vantage_production_acceptance",
        "postgres://127.0.0.1/production",
        "postgres://localhost/vantage_production_acceptance?host=remote.invalid",
        "postgres://localhost/vantage_production_acceptance#fragment",
        "https://localhost/vantage_production_acceptance",
        "invalid",
    ]) {
        assert.throws(() => validateDatabaseUrl(url), /DATABASE_URL_REJECTED/);
    }
});

test("plan permits empty create and complete reuse without mutating snapshots", async () => {
    const corpus = await loadCorpus();
    assert.equal(planImport(corpus, empty(), "sample-owner"), "create");
    const stored = storedSnapshot(corpus);
    const before = structuredClone(stored);
    assert.equal(planImport(corpus, stored, "sample-owner"), "reuse");
    assert.equal(planImport(corpus, stored, "sample-owner"), "reuse");
    assert.deepEqual(stored, before);
});

test("plan fails closed for partial import, unrelated content and stored drift", async () => {
    const corpus = await loadCorpus();
    const mutations = [
        s => s.documents.pop(),
        s => s.documents.push({ id: "unrelated", title: "Existing work" }),
        s => {
            s.files[0].file_data = Buffer.from("altered").toString("base64");
        },
        s => {
            s.files[0].blob_checksum = "0".repeat(64);
        },
        s => {
            s.chunks[0].content += "altered";
        },
        s => {
            s.versions[0].created_at = new Date("2026-01-01");
        },
        s => {
            s.documents[1].current_version_id = s.versions[1].id;
        },
        s => {
            s.versions[0].creation_key = "another-corpus";
        },
        s => {
            s.chunks[0].document_id = s.documents[1].id;
        },
        s => {
            s.files[0].user_id = "another-owner";
        },
    ];
    for (const mutate of mutations) {
        const stored = storedSnapshot(corpus);
        mutate(stored);
        assert.throws(
            () => planImport(corpus, stored, "sample-owner"),
            /EXISTING_CONTENT_OR_DRIFT/
        );
    }
});

test("CLI defaults to pure dry-run even with unusable database env", () => {
    const result = spawnSync(process.execPath, [script], {
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: "do-not-connect-or-print-this" },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "dry-run");
    assert.equal(output.documentCount, 12);
    assert.equal(output.versionCount, 13);
    assert.ok(
        output.documents.every(d => d.id === null && d.versions.every(v => v.fileUrl === null))
    );
    assert.ok(!result.stdout.includes("do-not-connect-or-print-this"));
});

test("CLI apply requires explicit company, exact actor and safe database; errors stay bounded", async () => {
    await assert.rejects(main(["--apply"], {}), /INVALID_ARGUMENTS/);
    await assert.rejects(
        main(["--apply", "--company-id", "1", "--actor-email", "other@test.com"], {}),
        /INVALID_ARGUMENTS/
    );
    await assert.rejects(
        main(["--apply", "--company-id", "1", "--actor-email", "vantage@test.com"], {}),
        /DATABASE_URL_REQUIRED/
    );
    const result = spawnSync(
        process.execPath,
        [script, "--apply", "--company-id", "1", "--actor-email", "vantage@test.com"],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                DATABASE_URL: "postgres://private-password@remote.invalid/production",
            },
        }
    );
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), { error: "DATABASE_URL_REJECTED" });
    assert.equal(result.stdout, "");
});
