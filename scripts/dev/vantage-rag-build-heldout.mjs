// Offline sampling only. Evidence stays in a separate evaluator bundle.
import { createHash } from "node:crypto";
import { readFile, access, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildGroups, validateGroupRequests } from "./vantage-rag-build-groups.mjs";
import { externalOutput } from "./vantage-rag-multi-corpus-score.mjs";

export const HELDOUT_SEED = "vantage-heldout-20261122";
export const HELDOUT_ALGORITHM = "enterprise-question-sha256-heldout/1";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const hashObject = value => hash(JSON.stringify(value));
const serialized = value => JSON.stringify(value, null, 2) + "\n";
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function questionIdentity(item) {
    return JSON.stringify([
        item.enterprise,
        item.question
            .normalize("NFKC")
            .replace(/[\p{P}\p{Z}\s]+/gu, "")
            .toLocaleLowerCase("en-US"),
    ]);
}

export function requestMetadata(item) {
    return { id: item.id, enterprise: item.enterprise, question: item.question };
}

function validateMetadata(items) {
    if (!Array.isArray(items) || !items.length) throw new Error("HELDOUT_METADATA_EMPTY");
    const ids = new Set();
    for (const item of items) {
        if (
            !item ||
            Object.keys(item).sort().join(",") !== "enterprise,id,question" ||
            typeof item.id !== "string" ||
            !/^rag-multi-corpus:[a-f0-9]{64}$/.test(item.id) ||
            typeof item.enterprise !== "string" ||
            !item.enterprise.trim() ||
            typeof item.question !== "string" ||
            !item.question.trim()
        )
            throw new Error("HELDOUT_METADATA_INVALID");
        if (ids.has(item.id)) throw new Error("HELDOUT_DUPLICATE_CANONICAL_ID");
        ids.add(item.id);
    }
}

export function selectHeldoutMetadata(all, prior) {
    validateMetadata(all);
    validateMetadata(prior);
    const byId = new Map(all.map(item => [item.id, item]));
    for (const item of prior) {
        const original = byId.get(item.id);
        if (
            !original ||
            original.enterprise !== item.enterprise ||
            original.question !== item.question
        )
            throw new Error("HELDOUT_PRIOR_NOT_IN_PINNED_SOURCE");
    }
    const enterprises = [...new Set(prior.map(item => item.enterprise))].sort();
    if (
        enterprises.length !== 5 ||
        prior.length !== 100 ||
        enterprises.some(
            enterprise => prior.filter(item => item.enterprise === enterprise).length !== 20
        )
    )
        throw new Error("HELDOUT_PRIOR_REQUIRES_FIVE_BY_TWENTY");
    const priorIds = new Set(prior.map(item => item.id));
    const priorQuestions = new Set(prior.map(questionIdentity));
    const representatives = new Map();
    let excludedCanonicalIds = 0,
        excludedQuestionEquivalence = 0;
    for (const item of [...all].sort((a, b) => compare(a.id, b.id))) {
        if (priorIds.has(item.id)) {
            excludedCanonicalIds++;
            continue;
        }
        const key = questionIdentity(item);
        if (priorQuestions.has(key)) {
            excludedQuestionEquivalence++;
            continue;
        }
        // One representative per remaining question equivalence class. No
        // evidence, category or retrieval result participates in ranking.
        if (!representatives.has(key)) representatives.set(key, item);
    }
    const buckets = enterprises.map(enterprise => {
        const eligible = [...representatives.values()]
            .filter(item => item.enterprise === enterprise)
            .map(item => ({
                item,
                rank: hashObject([HELDOUT_SEED, enterprise, questionIdentity(item)]),
            }))
            .sort((a, b) => compare(a.rank, b.rank) || compare(a.item.id, b.item.id));
        if (eligible.length < 20) throw new Error("HELDOUT_INSUFFICIENT_ENTERPRISE_POOL");
        return {
            enterprise,
            eligible: eligible.length,
            selected: eligible.slice(0, 20).map(row => row.item),
        };
    });
    // Round-robin enterprise order assigns fresh local ordinals 1..100.
    const selected = Array.from({ length: 20 }, (_, index) =>
        buckets.map(bucket => bucket.selected[index])
    ).flat();
    const selectedIds = selected.map(item => item.id).sort();
    const selectedQuestions = selected.map(questionIdentity).sort();
    const idOverlap = selectedIds.filter(id => priorIds.has(id)).length;
    const questionOverlap = selectedQuestions.filter(key => priorQuestions.has(key)).length;
    if (idOverlap || questionOverlap) throw new Error("HELDOUT_EXCLUSION_FAILED");
    return {
        selected,
        proof: {
            algorithm: HELDOUT_ALGORITHM,
            seed: HELDOUT_SEED,
            questionEquivalence: "enterprise + NFKC/case/punctuation/whitespace-folded question",
            sampleRankEncoding: "SHA256(UTF8(JSON.stringify([seed,enterprise,questionIdentity])))",
            priorCases: prior.length,
            selectedCases: selected.length,
            excludedCanonicalIds,
            excludedQuestionEquivalence,
            priorCanonicalIdsSha256: hashObject([...priorIds].sort()),
            selectedCanonicalIdsSha256: hashObject(selectedIds),
            priorQuestionIdentitiesSha256: hashObject([...priorQuestions].sort()),
            selectedQuestionIdentitiesSha256: hashObject(selectedQuestions),
            canonicalIdOverlap: idOverlap,
            questionEquivalenceOverlap: questionOverlap,
            enterprises: buckets.map(bucket => ({
                enterprise: bucket.enterprise,
                availableQuestionClasses: bucket.eligible,
                selected: 20,
            })),
        },
    };
}

export function buildHeldoutRequests(metadata, workspaceByEnterprise) {
    validateMetadata(metadata);
    const requests = metadata.map((item, index) => {
        const workspaceId = workspaceByEnterprise.get(item.enterprise);
        if (!workspaceId) throw new Error("HELDOUT_WORKSPACE_MISSING");
        return {
            caseId: String(index + 1),
            enterprise: item.enterprise,
            workspaceId,
            question: item.question,
        };
    });
    validateGroupRequests(requests);
    return requests;
}

async function requireAbsent(path) {
    try {
        await access(path);
        throw new Error("HELDOUT_OUTPUT_EXISTS");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: Object.fromEntries(
            [
                "csv",
                "prior-labels",
                "prior-requests",
                "requests",
                "labels",
                "groups",
                "inventory",
            ].map(key => [key, { type: "string" }])
        ),
    });
    if (Object.keys(values).length !== 7) throw new Error("HELDOUT_ARGUMENTS_REQUIRED");
    const paths = Object.values(values).map(path => resolve(path));
    if (new Set(paths).size !== 7) throw new Error("HELDOUT_PATHS_MUST_DIFFER");
    for (const key of ["requests", "labels", "groups", "inventory"])
        await requireAbsent(values[key]);
    // Scoped tsx import reuses the pinned importer without copying its parser or
    // canonical-ID rules. Tests of sampling/request projection remain plain Node.
    const { tsImport } = await import("tsx/esm/api");
    const importer = await tsImport(
        "../../pipelines/scripts/benchmarks/rag-multi-corpus.ts",
        import.meta.url
    );
    const csvBytes = await readFile(values.csv);
    if (hash(csvBytes) !== importer.sourceLock.files.queries.sha256)
        throw new Error("HELDOUT_SOURCE_HASH_MISMATCH");
    const normalized = importer.normalizeCsv(
        new TextDecoder("utf-8", { fatal: true }).decode(csvBytes),
        "merge-identical"
    );
    const priorLabelBytes = await readFile(values["prior-labels"]);
    const prior = importer.pilotSchema.parse(JSON.parse(priorLabelBytes.toString("utf8")));
    const priorRequestBytes = await readFile(values["prior-requests"]);
    const priorRequests = JSON.parse(priorRequestBytes.toString("utf8"));
    validateGroupRequests(priorRequests);
    if (
        priorRequests.length !== prior.cases.length ||
        priorRequests.some(
            (request, index) =>
                request.caseId !== String(index + 1) ||
                request.enterprise !== prior.cases[index].enterprise ||
                request.question !== prior.cases[index].question
        )
    )
        throw new Error("HELDOUT_PRIOR_ACTUAL_REQUESTS_MISMATCH");
    const selection = selectHeldoutMetadata(
        normalized.cases.map(requestMetadata),
        prior.cases.map(requestMetadata)
    );
    const originalById = new Map(normalized.cases.map(item => [item.id, item]));
    const selectedCases = selection.selected.map(item => originalById.get(item.id));
    const priorRecords = new Set(
        prior.cases.flatMap(item => item.sourceRecords.map(record => record.recordNumber))
    );
    const sourceRecordOverlap = selectedCases
        .flatMap(item => item.sourceRecords)
        .filter(record => priorRecords.has(record.recordNumber)).length;
    if (sourceRecordOverlap) throw new Error("HELDOUT_DUPLICATE_ROW_OVERLAP");
    // Project labels away before calling either request builder or grouping.
    const workspaceMap = new Map(
        priorRequests.map(request => [request.enterprise, request.workspaceId])
    );
    const requests = buildHeldoutRequests(selection.selected, workspaceMap);
    const grouped = buildGroups(requests);
    const labels = {
        schemaVersion: "vantage-heldout-benchmark-v1",
        provenance: prior.provenance,
        selection: {
            ...selection.proof,
            sourceRows: normalized.sourceRows,
            uniqueCases: normalized.cases.length,
            duplicateRows: normalized.duplicateRows,
            sourceRecordOverlap,
        },
        cases: selectedCases,
    };
    const outputs = [
        [values.requests, requests],
        [values.labels, labels],
        [values.groups, grouped.groups],
    ];
    const inventory = {
        ...selection.proof,
        sourceRecordOverlap,
        sourceRows: normalized.sourceRows,
        uniqueCanonicalCases: normalized.cases.length,
        duplicateRowsMerged: normalized.duplicateRows,
        priorSourceRecords: priorRecords.size,
        selectedSourceRecords: selectedCases.reduce(
            (sum, item) => sum + item.sourceRecords.length,
            0
        ),
        csvSha256: hash(csvBytes),
        priorLabelsSha256: hash(priorLabelBytes),
        priorRequestsSha256: hash(priorRequestBytes),
        requestsSha256: hash(serialized(requests)),
        labelsSha256: hash(serialized(labels)),
        groupsSha256: hash(serialized(grouped.groups)),
        grouping: grouped.inventory,
        limitations:
            "Question equivalence is deterministic string normalization. Semantic near-duplicates and answer quality were not assessed.",
    };
    outputs.push([values.inventory, inventory]);
    const written = [];
    try {
        for (const [path, value] of outputs) {
            await externalOutput(path, value);
            written.push(path);
        }
    } catch (error) {
        for (const path of written) await unlink(path);
        throw error;
    }
    console.log(JSON.stringify(inventory));
    return inventory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(
            /^HELDOUT_[A-Z_]+$/.test(error.message) ? error.message : "HELDOUT_BUILD_FAILED"
        );
        process.exitCode = 1;
    });
}
