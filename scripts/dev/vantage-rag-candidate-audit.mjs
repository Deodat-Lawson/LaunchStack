// Evaluator only. Never import from retrieval, providers or production routes.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { externalOutput } from "./vantage-rag-multi-corpus-score.mjs";

import { rankQuestion, LEXICAL_SPEC } from "../../pipelines/src/vantage/question-lexical-ranking.mjs";
export { rankQuestion, LEXICAL_SPEC };
const identity = doc => `${doc.documentId}@${doc.versionId}`;
const recency = documents => [...documents].sort((a, b) => Number(BigInt(b.versionId) - BigInt(a.versionId)) || Number(BigInt(b.documentId) - BigInt(a.documentId)));

export function topicEligibility(document) {
    if (!document.text.trim()) return "empty_text";
    if (document.text.length < 200) return "topic_minimum_200_characters";
    if (Buffer.byteLength(document.text, "utf8") > 40000) return "topic_parent_40000_bytes";
    return null;
}
export function baselineEligibility(document) {
    if (!document.text.trim()) return "empty_text";
    if (Buffer.byteLength(document.text, "utf8") > 24000) return "baseline_parent_24000_bytes";
    if ([...document.text].length > 6000) return "baseline_parent_6000_characters";
    return null;
}

export function hasKnownCatalogue(run) {
    return run.status === "ok" || Array.isArray(run.offered);
}

export function candidateReason(document, documents, run) {
    const ordered = recency(documents);
    const rank = ordered.findIndex(item => identity(item) === identity(document)) + 1;
    if (!hasKnownCatalogue(run)) return { reason: "catalogue_unknown_precollection_failure", recencyRank: rank, failure: run.failure ?? null };
    if (run.arm === "baseline") {
        if (rank > 64) return { reason: "baseline_candidate_cap_64", recencyRank: rank };
        const diagnostic = run.selectionDiagnostics?.omitted?.find(item => String(item.id) === document.documentId && String(item.version) === document.versionId);
        const eligibility = baselineEligibility(document);
        if (eligibility) return { reason: eligibility, recencyRank: rank, diagnostic: diagnostic?.reason ?? null };
        if (diagnostic?.reason === "acquisition_budget") return { reason: "baseline_acquisition_128000_bytes", recencyRank: rank };
        return { reason: diagnostic?.reason ?? "unexplained_actual_offer_gap", recencyRank: rank };
    }
    const eligibility = topicEligibility(document);
    if (eligibility) return { reason: eligibility, recencyRank: rank };
    const eligible = ordered.filter(document => !topicEligibility(document));
    const eligibleRank = eligible.findIndex(item => identity(item) === identity(document)) + 1;
    if (eligibleRank > 50) return { reason: "topic_offer_cap_50_recency_seed_order", recencyRank: rank, eligibleRecencyRank: eligibleRank };
    return { reason: "unexplained_actual_offer_gap", recencyRank: rank, eligibleRecencyRank: eligibleRank };
}

function counterfactualOffer(question, documents, run) {
    const ranked = rankQuestion(question, documents);
    if (run.arm !== "baseline") return ranked.filter(document => !topicEligibility(document)).slice(0, 50);
    let bytes = run.snapshot?.sources.filter(source => source.purpose !== "retrieved").reduce((sum, source) => sum + Buffer.byteLength(source.text, "utf8"), 0) ?? 0;
    const offered = [];
    for (const document of ranked.slice(0, 64)) {
        const size = Buffer.byteLength(document.text, "utf8");
        if (baselineEligibility(document) || bytes + size > 128000) continue;
        bytes += size;
        offered.push(document);
    }
    return offered;
}

export function auditCandidateGaps(corpus, requests, scored, runs) {
    const details = [];
    const gapRows = [];
    const specHash = createHash("sha256").update(JSON.stringify(LEXICAL_SPEC)).digest("hex");
    for (const run of runs) {
        const score = scored.details.find(item => item.caseId === String(run.caseId) && item.arm === run.arm);
        const request = requests.find(item => item.caseId === String(run.caseId));
        if (!score || !request) throw new Error("AUDIT_CASE_ARM_METADATA_MISSING");
        if (score.enterprise !== run.enterprise || request.enterprise !== run.enterprise ||
            (request.workspaceId !== undefined && String(request.workspaceId) !== String(run.workspaceId)))
            throw new Error("AUDIT_CASE_IDENTITY_MISMATCH");
        const documents = corpus.documents.filter(document => document.enterprise === run.enterprise);
        const offered = new Set((run.offered ?? []).map(identity));
        const catalogueKnown = hasKnownCatalogue(run);
        const rankedOffer = new Set(catalogueKnown ? counterfactualOffer(request.question, documents, run).map(identity) : []);
        const eligible = score.eligible && !score.failed;
        let actualHits = 0, lexicalHits = 0, lostHits = 0;
        const factResults = [];
        for (const fact of score.factResults) {
            const document = documents.find(document => document.documentId === fact.documentId && document.versionId === fact.versionId);
            factResults.push({ factIndex: fact.factIndex, filenameResolved: Boolean(document),
                passageResolved: Boolean(fact.sourceMatch), actualOffered: Boolean(document && offered.has(identity(document))),
                counterfactualOffered: Boolean(document && rankedOffer.has(identity(document))) });
            if (document && offered.has(identity(document))) {
                actualHits++;
                if (!rankedOffer.has(identity(document))) lostHits++;
            }
            if (document && rankedOffer.has(identity(document))) lexicalHits++;
            if (document && offered.has(identity(document))) continue;
            const reason = !catalogueKnown ? { reason: "catalogue_unknown_precollection_failure" } : document ? candidateReason(document, documents, run) : { reason: "label_filename_unmapped" };
            gapRows.push({ caseId: String(run.caseId), arm: run.arm, enterprise: run.enterprise,
                factIndex: fact.factIndex, eligible, sourceMatch: fact.sourceMatch,
                filename: document?.filename ?? null, documentId: fact.documentId, versionId: fact.versionId,
                ...reason, counterfactualOffered: Boolean(document && rankedOffer.has(identity(document))) });
        }
        details.push({ caseId: String(run.caseId), arm: run.arm, enterprise: run.enterprise, eligible,
            catalogueKnown, facts: score.totalFacts, actualOfferedFacts: actualHits, counterfactualOfferedFacts: lexicalHits, lostOfferedFacts: lostHits, failed: score.failed, factResults });
    }
    const arms = {};
    for (const arm of [...new Set(runs.map(run => run.arm))]) {
        const rows = details.filter(row => row.arm === arm && row.eligible);
        const gaps = gapRows.filter(row => row.arm === arm && row.eligible);
        const allFacts = details.filter(row => row.arm === arm && row.catalogueKnown).flatMap(row => row.factResults);
        const allResolved = allFacts.filter(fact => fact.passageResolved);
        const allNamed = allFacts.filter(fact => fact.filenameResolved);
        const counts = facts => ({ facts: facts.length,
            actualOffered: facts.filter(fact => fact.actualOffered).length,
            counterfactualOffered: facts.filter(fact => fact.counterfactualOffered).length,
            recovered: facts.filter(fact => !fact.actualOffered && fact.counterfactualOffered).length,
            lost: facts.filter(fact => fact.actualOffered && !fact.counterfactualOffered).length });
        arms[arm] = {
            observedCatalogueAttempts: details.filter(row => row.arm === arm && row.catalogueKnown).length,
            failedAfterCatalogue: details.filter(row => row.arm === arm && row.catalogueKnown && row.failed).length,
            unknownCatalogueAttempts: details.filter(row => row.arm === arm && !row.catalogueKnown).length,
            unknownCatalogueFacts: details.filter(row => row.arm === arm && !row.catalogueKnown).reduce((sum, row) => sum + row.facts, 0),
            allPassageResolvedFacts: counts(allResolved),
            allFilenameResolvedFacts: counts(allNamed),
            unresolvedPassages: allFacts.length - allResolved.length,
            unresolvedFilenames: allFacts.length - allNamed.length,
            eligibleCases: rows.length, eligibleFacts: rows.reduce((sum, row) => sum + row.facts, 0),
            actualOfferedFacts: rows.reduce((sum, row) => sum + row.actualOfferedFacts, 0),
            counterfactualOfferedFacts: rows.reduce((sum, row) => sum + row.counterfactualOfferedFacts, 0),
            nonofferedEligibleFacts: gaps.length,
            eligibleCasesWithOfferGaps: rows.filter(row => row.actualOfferedFacts < row.facts).length,
            counterfactualCasesWithOfferGaps: rows.filter(row => row.counterfactualOfferedFacts < row.facts).length,
            lostPreviouslyOfferedFacts: rows.reduce((sum, row) => sum + row.lostOfferedFacts, 0),
            recoveredOfferGaps: gaps.filter(row => row.counterfactualOffered).length,
            reasons: Object.fromEntries([...new Set(gaps.map(row => row.reason))].sort().map(reason => [reason, gaps.filter(row => row.reason === reason).length])),
            allCaseFactReasons: Object.fromEntries([...new Set(gapRows.filter(row => row.arm === arm).map(row => row.reason))].sort().map(reason => [reason, gapRows.filter(row => row.arm === arm && row.reason === reason).length])),
        };
    }
    return { details, gaps: gapRows, summary: { schema: "vantage-candidate-gap-audit/1", lexicalSpec: LEXICAL_SPEC, lexicalSpecHash: specHash, arms } };
}

async function main() {
    const { values } = parseArgs({ options: Object.fromEntries(["corpus", "requests", "scored", "runs", "local", "summary", "sample-size"].map(key => [key, { type: "string" }])) });
    if (["corpus", "requests", "scored", "runs", "local", "summary"].some(key => !values[key])) throw new Error("Pass --corpus --requests --scored --runs --local --summary");
    const read = async file => JSON.parse(await readFile(file, "utf8"));
    const [corpus, requests, scored, raw] = await Promise.all([values.corpus, values.requests, values.scored, values.runs].map(read));
    const sampleSize = values["sample-size"] === undefined ? Infinity : Number(values["sample-size"]);
    if (sampleSize !== Infinity && (!Number.isSafeInteger(sampleSize) || sampleSize < 1)) throw new Error("INVALID_AUDIT_SAMPLE_SIZE");
    const runs = (Array.isArray(raw) ? raw : raw.runs).filter(run => Number(run.caseId) <= sampleSize);
    const result = auditCandidateGaps(corpus, requests, scored, runs);
    await externalOutput(values.local, { details: result.details, gaps: result.gaps });
    await externalOutput(values.summary, result.summary);
    console.log(JSON.stringify(result.summary));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
