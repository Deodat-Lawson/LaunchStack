import { test } from "node:test";
import assert from "node:assert/strict";
import { rankQuestion, candidateReason, auditCandidateGaps } from "./vantage-rag-candidate-audit.mjs";

const documents = Array.from({ length: 71 }, (_, index) => ({
    documentId: String(index + 1), versionId: String(index + 1), enterprise: "Example",
    filename: `document-${index + 1}.md`, sourcePath: `corpus/${String(index + 1).padStart(2, "0")}.md`,
    text: `${index === 0 ? "target gearbox" : "office logistics"} ${"Background material. ".repeat(20)}`,
}));

test("question ranking is deterministic and ignores unrelated evaluator labels", () => {
    const ranked = rankQuestion("Which target gearbox?", documents);
    assert.equal(ranked[0].documentId, "1");
    assert.deepEqual(ranked.map(document => document.documentId),
        rankQuestion("Which target gearbox?", [...documents].reverse().map(document => ({ ...document, groundTruth: "unrelated" }))).map(document => document.documentId));
    assert.equal(rankQuestion("the and what", documents)[0].sourcePath, "corpus/01.md");
});

test("gap reasons distinguish topic offer cap, baseline candidate cap and read limit", () => {
    assert.equal(candidateReason(documents[0], documents, { arm: "seeds", status: "ok" }).reason, "topic_offer_cap_50_recency_seed_order");
    assert.equal(candidateReason(documents[0], documents, { arm: "baseline", status: "ok" }).reason, "baseline_candidate_cap_64");
    const long = { ...documents[70], text: "x".repeat(6001) };
    assert.equal(candidateReason(long, [...documents.slice(0, 70), long], { arm: "baseline", status: "ok" }).reason, "baseline_parent_6000_characters");
    const short = { ...documents[70], text: "small" };
    assert.equal(candidateReason(short, [...documents.slice(0, 70), short], { arm: "seeds", status: "ok" }).reason, "topic_minimum_200_characters");
    assert.equal(candidateReason(documents[70], documents, { arm: "baseline", status: "ok", selectionDiagnostics: { omitted: [{ id: "71", version: "71", reason: "acquisition_budget" }] } }).reason, "baseline_acquisition_128000_bytes");
});

test("counterfactual counts only document offer recovery and reports source eligibility", () => {
    const offered = [...documents].reverse().slice(0, 50);
    const run = { caseId: "1", arm: "scripted", enterprise: "Example", status: "ok", offered };
    const result = auditCandidateGaps({ documents }, [{ caseId: "1", enterprise: "Example", question: "target gearbox" }], {
        details: [{ caseId: "1", arm: "scripted", enterprise: "Example", eligible: true, failed: false, totalFacts: 1,
            factResults: [{ factIndex: 0, documentId: "1", versionId: "1", sourceMatch: "exact" }] }],
    }, [run]);
    assert.equal(result.gaps[0].reason, "topic_offer_cap_50_recency_seed_order");
    assert.equal(result.summary.arms.scripted.actualOfferedFacts, 0);
    assert.equal(result.summary.arms.scripted.recoveredOfferGaps, 1);
    assert.equal(result.summary.arms.scripted.counterfactualOfferedFacts, 1);
});

test("resolved-fact denominator retains matched facts from whole-case exclusions", () => {
    const run = { caseId: "1", arm: "seeds", enterprise: "Example", status: "ok", offered: [...documents].reverse().slice(0, 50) };
    const result = auditCandidateGaps({ documents }, [{ caseId: "1", enterprise: "Example", question: "target gearbox" }], {
        details: [{ caseId: "1", arm: "seeds", enterprise: "Example", eligible: false, failed: false, totalFacts: 2,
            factResults: [
                { factIndex: 0, documentId: "1", versionId: "1", sourceMatch: "exact" },
                { factIndex: 1, documentId: "71", versionId: "71", sourceMatch: null },
            ] }],
    }, [run]);
    const summary = result.summary.arms.seeds;
    assert.equal(summary.eligibleCases, 0);
    assert.equal(summary.allPassageResolvedFacts.facts, 1);
    assert.equal(summary.allPassageResolvedFacts.recovered, 1);
    assert.equal(summary.allFilenameResolvedFacts.facts, 2);
    assert.equal(summary.unresolvedPassages, 1);
    assert.equal(summary.unresolvedFilenames, 0);
});

test("failure after collection retains actual catalogue and attempt denominators", () => {
    const run = { caseId: "1", arm: "configured-live", enterprise: "Example", status: "failed", failure: "topic_exploration_failed:timeout", offered: [...documents].reverse().slice(0, 50) };
    const requests = [{ caseId: "1", enterprise: "Example", question: "target gearbox" }];
    const scored = { details: [{ caseId: "1", arm: "configured-live", enterprise: "Example", eligible: true, failed: true, totalFacts: 1,
        factResults: [{ factIndex: 0, documentId: "1", versionId: "1", sourceMatch: "exact" }] }] };
    const result = auditCandidateGaps({ documents }, requests, scored, [run]);
    const summary = result.summary.arms["configured-live"];
    assert.equal(result.gaps[0].reason, "topic_offer_cap_50_recency_seed_order");
    assert.equal(summary.allPassageResolvedFacts.facts, 1);
    assert.equal(summary.allPassageResolvedFacts.recovered, 1);
    assert.equal(summary.failedAfterCatalogue, 1);
    const unknown = auditCandidateGaps({ documents }, requests, scored, [{ ...run, offered: undefined }]);
    assert.equal(unknown.gaps[0].reason, "catalogue_unknown_precollection_failure");
    assert.equal(unknown.summary.arms["configured-live"].allPassageResolvedFacts.facts, 0);
    assert.equal(unknown.summary.arms["configured-live"].unknownCatalogueFacts, 1);
    assert.equal(unknown.gaps[0].counterfactualOffered, false);
});
