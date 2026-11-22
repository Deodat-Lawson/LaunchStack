/** Read-only fixture export and offline reconstruction CLI. No label/model configuration imports. */
import { readFile, writeFile, realpath, access } from "node:fs/promises";
import { resolve, relative, dirname, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { canonicalTextHash } from "@launchstack/store/document-digests";
import type { TopicManifest } from "../src/server/vantage/weekly-review-topic-types";
import {
    primaryReferences,
    projectSavedPrimary,
    refOf,
    success,
    type SavedPrimary,
    type Group,
    type ReconstructionArchive,
} from "./vantage-benchmark-live-docs-windows-core";
const repository = fileURLToPath(new URL("../../../", import.meta.url));
async function outsideCache(value: string) {
    const cache = await realpath(value);
    const offset = relative(await realpath(repository), cache);
    if (!offset || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(".." + sep)))
        throw Error("projection_cache_must_be_external");
    for (let p = cache; ; p = dirname(p)) {
        try {
            await access(resolve(p, ".git"));
            throw Error("projection_cache_must_be_external");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (dirname(p) === p) break;
    }
    return cache;
}
function leaf(cache: string, name: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(name))
        throw Error("projection_file_name_invalid");
    return resolve(cache, name);
}
async function input(cache: string, name: string) {
    const path = await realpath(leaf(cache, name));
    if (dirname(path) !== cache) throw Error("projection_input_outside_cache");
    return readFile(path);
}
async function exportState(
    cache: string,
    references: SavedPrimary[],
    referencesSha256: string,
    groupsSha256: string
) {
    const corpus = JSON.parse((await input(cache, "corpus-manifest.json")).toString("utf8"));
    const url = new URL(corpus.databaseUrl);
    if (
        url.hostname !== "127.0.0.1" ||
        url.port !== "55569" ||
        url.pathname !== "/vantage_rag_benchmark_20261121" ||
        url.search ||
        url.hash ||
        !["postgres:", "postgresql:"].includes(url.protocol)
    )
        throw Error("projection_local_database_required");
    const sql = postgres(corpus.databaseUrl, { max: 1 });
    try {
        return await sql.begin(async tx => {
            await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
            const records =
                await tx`SELECT r.id::text,r.company_id::text,r.owner_id,r.input_hash,r.snapshot_hash,m.manifest,m.manifest_hash,m.trace FROM pdr_ai_v2_vantage_weekly_review_runs r JOIN pdr_ai_v2_vantage_weekly_review_run_manifests m ON m.run_id=r.id WHERE r.id=ANY(${references.map(row => row.runId)}::uuid[])`;
            const archive: ReconstructionArchive = {
                schemaVersion: "live-docs-windows-state/1",
                referencesSha256,
                groupsSha256,
                documents: {},
                runs: {},
            };
            const offers = new Map<
                string,
                { id: string; version: string; hash: string; versionDate: string }
            >();
            for (const row of records) {
                const manifest = row.manifest as TopicManifest;
                const source = references.find(source => source.runId === row.id)!;
                if (!source || source.workspaceId !== String(row.company_id))
                    throw Error("projection_run_lineage_mismatch");
                archive.runs[String(row.id)] = {
                    companyId: String(row.company_id),
                    ownerId: String(row.owner_id),
                    inputHash: String(row.input_hash),
                    snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null,
                    manifestHash: String(row.manifest_hash),
                    manifest,
                    trace: row.trace,
                };
                for (const offer of manifest.offered) offers.set(offer.ref, offer);
            }
            const versions = [...offers.values()].map(offer => offer.version);
            const documents =
                await tx`SELECT d.id::text,d.company_id::text,d.title,d.category,v.id::text AS version_id,v.created_at FROM pdr_ai_v2_document d JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id WHERE v.id=ANY(${versions}::bigint[])`;
            const chunks =
                await tx`SELECT c.id::text,c.document_id::text,c.version_id::text,c.content,c.page_number,c.line_start FROM pdr_ai_v2_document_context_chunks c JOIN pdr_ai_v2_document_versions v ON v.id=c.version_id AND v.document_id=c.document_id WHERE c.version_id=ANY(${versions}::bigint[]) ORDER BY c.version_id,c.page_number,c.line_start,c.id`;
            for (const document of documents) {
                const ref = refOf(String(document.id), String(document.version_id));
                const offer = offers.get(ref)!;
                const rows = chunks.filter(chunk => chunk.version_id === document.version_id);
                const text = rows.map(chunk => String(chunk.content)).join("\n");
                const cached = corpus.documents.find(
                    (cached: { ref: string }) => cached.ref === ref
                );
                if (
                    !cached ||
                    text !== cached.text ||
                    canonicalTextHash(text) !== offer.hash ||
                    String(document.company_id) !==
                        String(cached.workspaceId ?? cached.companyId) ||
                    new Date(document.created_at as string).toISOString() !==
                        new Date(offer.versionDate).toISOString()
                )
                    throw Error("projection_source_hash_mismatch");
                archive.documents[ref] = {
                    id: String(document.id),
                    version: String(document.version_id),
                    companyId: String(document.company_id),
                    title: String(document.title),
                    category: String(document.category),
                    versionDate: new Date(document.created_at as string).toISOString(),
                    text,
                    chunks: rows.map((chunk, ordinal) => ({
                        id: String(chunk.id),
                        ordinal,
                        text: String(chunk.content),
                    })),
                };
            }
            if (references.filter(success).some(row => !archive.runs[row.runId]))
                throw Error("projection_run_manifest_missing");
            return archive;
        });
    } finally {
        await sql.end();
    }
}
async function main() {
    const { values } = parseArgs({
        options: {
            cache: { type: "string" },
            references: { type: "string", default: "closeout-heldout-references.json" },
            groups: { type: "string", default: "heldout-grouped-3-5-requests.json" },
            "export-state": { type: "string" },
            archive: { type: "string" },
            output: { type: "string" },
        },
    });
    if (!values.cache) throw Error("projection_cache_required");
    const cache = await outsideCache(values.cache);
    const referenceBytes = await input(cache, values.references);
    const groupBytes = await input(cache, values.groups);
    const raw = JSON.parse(referenceBytes.toString("utf8"));
    const groups = JSON.parse(groupBytes.toString("utf8")) as Group[];
    const refs = primaryReferences(raw.runs ?? raw, groups);
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    if (values["export-state"]) {
        if (values.archive || values.output) throw Error("projection_export_separate_from_fit");
        const state = await exportState(cache, refs, hash(referenceBytes), hash(groupBytes));
        await writeFile(leaf(cache, values["export-state"]), JSON.stringify(state) + "\n", {
            flag: "wx",
        });
        console.log(
            JSON.stringify({
                exportedRuns: Object.keys(state.runs).length,
                canonicalVersions: Object.keys(state.documents).length,
            })
        );
        return;
    }
    if (!values.archive || !values.output) throw Error("projection_archive_output_required");
    const archive = JSON.parse(
        (await input(cache, values.archive)).toString("utf8")
    ) as ReconstructionArchive;
    if (
        archive.schemaVersion !== "live-docs-windows-state/1" ||
        archive.referencesSha256 !== hash(referenceBytes) ||
        archive.groupsSha256 !== hash(groupBytes)
    )
        throw Error("projection_archive_input_mismatch");
    const rows = [];
    for (const source of refs) rows.push(await projectSavedPrimary(source, archive));
    await writeFile(leaf(cache, values.output), JSON.stringify(rows) + "\n", { flag: "wx" });
    console.log(
        JSON.stringify({
            projected: rows.length,
            successful: rows.filter(row => row.status === "ok").length,
            failed: rows.filter(row => row.status === "failed").length,
            archiveInferred: rows.filter(
                row => row.projection.documentSelectionProvenance === "archive-inferred"
            ).length,
            paidCalls: 0,
        })
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        console.error(
            error instanceof Error && /^projection_[a-z_]{1,100}$/.test(error.message)
                ? error.message
                : "projection_failed"
        );
        process.exitCode = 1;
    });
