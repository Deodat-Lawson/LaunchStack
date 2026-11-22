import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assertDatabase, assertCorpusEntry, verifyBytes, cacheDirectory, DATABASE, REVISION,
    assertExactDatabaseInventory,
} from "./vantage-rag-multi-corpus-loader.mjs";

const bytes = Buffer.from("Source paragraph. 中文\n");
const file = {
    path: "datasets/Aventro Motors/md/example.md", enterpriseDirectory: "Aventro Motors",
    format: "md", filename: "example.md", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    gitBlobSha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
};

test("only the exact task database is accepted", () => {
    assert.equal(assertDatabase(DATABASE), DATABASE);
    for (const value of [DATABASE.replace("127.0.0.1", "example.com"), DATABASE.replace("55569", "5432"), DATABASE.replace("vantage_rag_benchmark_20261121", "postgres"), `${DATABASE}?sslmode=disable`]) {
        assert.throws(() => assertDatabase(value), /DATABASE_REJECTED/);
    }
});

test("corpus allowlist excludes labels, references, traversal and mismatched formats", () => {
    assert.doesNotThrow(() => assertCorpusEntry(file));
    for (const path of ["datasets/queries.csv", "bechmark/parsed-chunks.json", "datasets/Aventro Motors/md/../pilot.md", "datasets/Aventro Motors/md/..\\pilot.md", "datasets/Aventro Motors/md/example.pdf"]) {
        assert.throws(() => assertCorpusEntry({ ...file, path }), /INVALID_CORPUS_ENTRY/);
    }
});

test("both pinned Git blob and SHA256 hashes are required", () => {
    assert.doesNotThrow(() => verifyBytes(file, bytes));
    assert.throws(() => verifyBytes(file, Buffer.from("Source paragraph. 中文\r\n")), /HASH_MISMATCH/);
    assert.throws(() => verifyBytes({ ...file, gitBlobSha: "0".repeat(40) }, bytes), /HASH_MISMATCH/);
    assert.throws(() => verifyBytes({ ...file, sha256: "0".repeat(64) }, bytes), /HASH_MISMATCH/);
});

test("cache resolves outside the repository", async () => {
    await assert.rejects(cacheDirectory(new URL("../../", import.meta.url)), /CACHE_MUST_BE_OUTSIDE_REPOSITORY/);
    const temporary = await mkdtemp(join(tmpdir(), "vantage-corpus-loader-"));
    try {
        assert.ok(await cacheDirectory(temporary));
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
});

test("committed corpus lock is complete and contains only source file metadata", async () => {
    const lock = JSON.parse(await readFile(new URL("../../fixtures/vantage-benchmarks/rag-multi-corpus/corpus-lock.json", import.meta.url), "utf8"));
    assert.equal(lock.revision, REVISION);
    assert.equal(lock.files.length, 1180);
    assert.equal(new Set(lock.files.map(file => file.path)).size, 1180);
    const counts = {};
    for (const entry of lock.files) {
        assertCorpusEntry(entry);
        counts[entry.format] = (counts[entry.format] ?? 0) + 1;
        assert.equal(entry.text, undefined);
        assert.equal(entry.cacheFile, undefined);
    }
    assert.deepEqual(counts, { docx: 236, html: 236, md: 236, pdf: 236, pptx: 236 });
});

test("database inventory rejects extra documents and versions including neutral sources", () => {
    const manifest = {
        documents: [{ documentId: "10", versionId: "20", companyId: "1" }],
        enterprises: [{ workspaceId: "1", neutralArchitectureId: "11" }],
    };
    const corpus = { document_id: "10", company_id: "1", version_id: "20", current_version_id: "20", version_number: 1 };
    const neutral = { document_id: "11", company_id: "1", version_id: "21", current_version_id: "21", version_number: 1 };
    assert.doesNotThrow(() => assertExactDatabaseInventory(manifest, [corpus, neutral]));
    for (const rows of [
        [corpus, neutral, { ...corpus, document_id: "12", version_id: null }],
        [corpus, neutral, { ...corpus, version_id: "22", version_number: 2 }],
        [corpus, neutral, { ...neutral, version_id: "23", version_number: 2 }],
        [corpus],
        [corpus, { ...neutral, version_id: null }],
        [{ ...corpus, current_version_id: "22" }, neutral],
        [{ ...corpus, company_id: "2" }, neutral],
        [corpus, { ...neutral, document_id: "12" }],
    ]) assert.throws(() => assertExactDatabaseInventory(manifest, rows), /INVENTORY_MISMATCH/);
});
