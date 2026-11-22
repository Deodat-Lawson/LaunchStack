import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLongDecisionsDatabase, LONG_DECISIONS_DATABASE, loadLongDecisionsWorkspace, verifyLongDecisionsInventory, type LongDecisionsPublicManifest } from "./vantage-long-decisions-ingest";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function fixture() {
    const cache = await mkdtemp(join(tmpdir(), "long-decisions-ingest-synthetic-"));
    const text = "Synthetic routine process context. ".repeat(800), sha256 = hash(text);
    const documents = Array.from({ length: 50 }, (_, i) => {
        const id = `D${String(i + 1).padStart(2, "0")}`;
        return { id, kind: "notes", title: `Synthetic ${id}`, visibility: i >= 42 && i <= 45 ? "denied" as const : "actor_readable" as const, versions: Array.from({ length: i < 12 ? 2 : 1 }, (_, vi) => ({ id: `${id}_V0${vi + 1}`, file: `${id}_V0${vi + 1}.md`, publishedAt: vi ? "2026-09-23T12:00:00Z" : "2026-09-04T12:00:00Z", bytes: Buffer.byteLength(text), sha256 })) };
    });
    const manifest: LongDecisionsPublicManifest = { schemaVersion: "vantage-long-decisions-input/1", specSha256: "a".repeat(64), company: { id: "synthetic", name: "Synthetic", fictional: true, domain: "test" }, weeks: [7, 14, 21].map((d, i) => ({ id: `w${i + 1}`, weekStart: `2026-09-${String(d).padStart(2, "0")}`, cutoff: `2026-09-${String(d + 7).padStart(2, "0")}T00:00:00Z` })), actors: [{ id: "owner", role: "owner", canRead: true, canMutate: true, readableDocumentIds: documents.filter(d => d.visibility === "actor_readable").map(d => d.id), deniedDocumentIds: documents.filter(d => d.visibility === "denied").map(d => d.id) }], documents, fixedSources: ["D49", "D50"].map((id, i) => ({ documentId: id, versionId: `${id}_V01`, purpose: i ? "operating_context" : "architecture", required: true, scope: "anchor_text_only", sameAcrossArms: true, scopeId: `fixed-${i}`, textStart: 0, textEnd: 220, textSha256: hash(text.slice(0, 220)), canonicalTextSha256: sha256 })), groups: Array.from({ length: 8 }, (_, i) => ({ id: `group-${i}`, split: i < 4 ? "dev" : "heldout", size: 3, weekId: "w3", topics: [{ caseId: "synthetic", question: "Synthetic question?" }] })) };
    const files = [];
    for (const d of documents) for (const v of d.versions) { await writeFile(join(cache, v.file), text); files.push({ file: v.file, bytes: v.bytes, sha256 }); }
    const manifestRaw = JSON.stringify(manifest);
    await writeFile(join(cache, "long-decisions-manifest.json"), manifestRaw);
    files.push({ file: "long-decisions-manifest.json", bytes: Buffer.byteLength(manifestRaw), sha256: hash(manifestRaw) });
    const lockPath = join(cache, "synthetic-lock.json");
    const lock = { schemaVersion: "long-decisions-lock/1", specSha256: manifest.specSha256, files, documents: 50, versions: 62 };
    await writeFile(lockPath, JSON.stringify(lock));
    return { cache, lockPath, text, manifest, lock, cleanup: () => rm(cache, { recursive: true, force: true }) };
}
void test("exact database guard rejects alternative credentials, host, port and database", () => {
    assert.equal(assertLongDecisionsDatabase(LONG_DECISIONS_DATABASE), LONG_DECISIONS_DATABASE);
    for (const value of [LONG_DECISIONS_DATABASE.replace("55569", "5432"), LONG_DECISIONS_DATABASE.replace("127.0.0.1", "localhost"), LONG_DECISIONS_DATABASE + "?sslmode=require", "postgres://production"]) assert.throws(() => assertLongDecisionsDatabase(value), /database_rejected/);
});
void test("loads only public manifest and locked corpus, without private validation files", async () => {
    const f = await fixture(); try { const c = await loadLongDecisionsWorkspace(f); assert.equal(c.documents.length, 50); assert.equal(c.documents.flatMap(d => d.versions).length, 62); assert.equal(c.documents[0]!.versions[0]!.text, f.text); } finally { await f.cleanup(); }
});
void test("rejects corrupted text and lock-bound manifest modification", async () => {
    const f = await fixture(); try { await writeFile(join(f.cache, "D01_V01.md"), f.text + "x"); await assert.rejects(loadLongDecisionsWorkspace(f), /file_hash_mismatch/); await writeFile(join(f.cache, "D01_V01.md"), f.text); await writeFile(join(f.cache, "long-decisions-manifest.json"), JSON.stringify({ ...f.manifest, cases: [] })); await assert.rejects(loadLongDecisionsWorkspace(f), /file_hash_mismatch/); } finally { await f.cleanup(); }
});
void test("rejects extra database documents or versions before mapping or writes", async () => {
    const f = await fixture(); try { const c = await loadLongDecisionsWorkspace(f); let calls = 0; await assert.rejects(verifyLongDecisionsInventory(c, async sql => { calls++; if (sql.startsWith("SELECT id::text,name")) return [{ id: "900", name: "Synthetic (benchmark only)" }]; return Array.from({ length: 63 }, (_, i) => ({ document_id: String(i) })); }), /database_inventory_mismatch/); assert.equal(calls, 2); } finally { await f.cleanup(); }
});
void test("rejects labelled keys even if a caller supplies a matching synthetic lock", async () => {
    const f = await fixture(); try { const raw = JSON.stringify({ ...f.manifest, cases: [] }); await writeFile(join(f.cache, "long-decisions-manifest.json"), raw); f.lock.files[f.lock.files.length - 1] = { file: "long-decisions-manifest.json", bytes: Buffer.byteLength(raw), sha256: hash(raw) }; await writeFile(f.lockPath, JSON.stringify(f.lock)); await assert.rejects(loadLongDecisionsWorkspace(f), /Unrecognized key/); } finally { await f.cleanup(); }
});
void test("exact read-only inventory produces stable mapping, bounded policy and actor-only scope", async () => {
    const f = await fixture();
    try {
        const c = await loadLongDecisionsWorkspace(f);
        const inventory = c.documents.flatMap((d, di) => d.versions.map((v, vi) => ({ document_id: String(di + 1), document_key: `long-decisions:${c.publicManifest.specSha256}:${d.id}`, category: d.visibility === "denied" ? "LongDecisions/Restricted" : "LongDecisions/Readable", title: d.title, current_version_id: String((di + 1) * 10 + d.versions.length), restricted: d.visibility === "denied", version_id: String((di + 1) * 10 + vi + 1), version_key: `long-decisions:${c.publicManifest.specSha256}:${v.id}`, version_number: vi + 1, created_at: v.publishedAt, canonical_hash: v.sha256 })));
        const scopes = Object.fromEntries([49, 50].map(n => [String(n), { version: String(n * 10 + 1), expectedParentHash: hash(f.text), qualification: "Required bounded company context from the locked fixture version.", requiredUnits: [{ id: "fixed-context", start: 0, end: 220, excerptHash: hash(f.text.slice(0, 220)) }] }]));
        const query = async (sql: string) => {
            assert(sql.startsWith("SELECT"));
            if (sql.startsWith("SELECT id::text,name")) return [{ id: "900", name: "Synthetic (benchmark only)" }];
            if (sql.includes("LEFT JOIN pdr_ai_v2_document_settings")) return inventory;
            if (sql.startsWith("SELECT architecture_document_id")) return [{ architecture_document_id: "49", required_document_ids: ["50"], required_source_scopes: scopes }];
            return [{ id: "long-decisions-seed-900" }];
        };
        const workspace = await verifyLongDecisionsInventory(c, query);
        assert.equal(workspace.documents.length, 50);
        assert.equal(workspace.readableDocumentIds.length, 46);
        assert.equal(workspace.deniedDocumentIds.length, 4);
        assert.equal(workspace.documentScope.kind, "only");
        if (workspace.documentScope.kind === "only") for (const denied of workspace.deniedDocumentIds) assert(!workspace.documentScope.allowedDocumentIds.includes(Number(denied)));
        inventory[0]!.restricted = true;
        await assert.rejects(verifyLongDecisionsInventory(c, query), /version_database_mismatch/);
    } finally { await f.cleanup(); }
});
