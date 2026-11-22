import test from "node:test";
import assert from "node:assert/strict";
import {
    distribution,
    measureFrozenRun,
    retrievalEfficiency,
} from "./vantage-rag-retrieval-efficiency.mjs";

const makeRun = (caseId, documentId, versionId, text, kind = "full_document") => ({
    caseId,
    enterprise: "Example",
    workspaceId: "9",
    arm: "baseline",
    status: "ok",
    offered: [{ documentId, versionId }],
    selected: [{ documentId, versionId, text, kind }],
    snapshot: { sources: [{ text }] },
    frozenBytes: Buffer.byteLength(text, "utf8"),
});
const first = "alpha beta gamma";
const second = "noise ".repeat(200);
const corpus = {
    documents: [
        {
            enterprise: "Example",
            filename: "a.md",
            companyId: "9",
            documentId: "1",
            versionId: "11",
            text: first,
        },
        {
            enterprise: "Example",
            filename: "b.md",
            companyId: "9",
            documentId: "2",
            versionId: "22",
            text: second,
        },
    ],
};
const bundle = {
    cases: [
        {
            id: "private-a",
            enterprise: "Example",
            queryType: "A",
            question: "Question one",
            groundTruth: { supportingFacts: [{ filename: "a.md", text: first }] },
        },
        {
            id: "private-b",
            enterprise: "Example",
            queryType: "B",
            question: "Question two",
            groundTruth: { supportingFacts: [{ filename: "b.md", text: "missing anchor" }] },
        },
    ],
};

test("uses an even median and nearest-rank p90 with explicit samples", () => {
    const result = distribution(Array.from({ length: 10 }, (_, i) => i + 1));
    assert.equal(result.samples, 10);
    assert.equal(result.median, 5.5);
    assert.equal(result.p90, 9);
    assert.equal(distribution([]).p90, null);
});
test("checks UTF8 bytes and separates parent documents from excerpt units", () => {
    const run = makeRun("1", "1", "11", "\u6c49\ud83d\ude80", "excerpt");
    assert.equal(measureFrozenRun(run).bytes, 7);
    assert.equal(measureFrozenRun(run).excerpts, 1);
    assert.throws(() => measureFrozenRun({ ...run, frozenBytes: 3 }), /byte_mismatch/);
    const extended = {
        ...run,
        selected: [...run.selected, { ...run.selected[0] }],
        snapshot: { sources: [...run.snapshot.sources, ...run.snapshot.sources] },
        frozenBytes: 14,
    };
    assert.equal(measureFrozenRun(extended).documents, 1);
    assert.equal(measureFrozenRun(extended).excerpts, 2);
});
test("pairs strict facts to eligible snapshot bytes and pools rather than averaging ratios", () => {
    const runs = [makeRun("1", "1", "11", first), makeRun("2", "2", "22", second)];
    const result = retrievalEfficiency(bundle, corpus, runs);
    const arm = result.arms.baseline;
    assert.equal(arm.strictRecall.coveredFacts, 1);
    assert.equal(arm.strictRecall.facts, 1);
    assert.equal(arm.strictEligible.cases, 1);
    assert.equal(arm.pooledEfficiency.strictPaired.frozenUtf8Bytes, 16);
    assert.equal(arm.pooledEfficiency.strictPaired.recoveredFactsPerKB1000, 62.5);
    assert.equal(arm.pooledEfficiency.strictOverAllRuns.frozenUtf8Bytes, 1216);
    assert.equal(arm.pooledEfficiency.strictOverAllRuns.recoveredFactsPerKB1000, 1000 / 1216);
    assert.equal(arm.pooledEfficiency.lenient80Paired.recoveredFactsPerKB1000, 1000 / 1216);
    assert.equal(arm.allRuns.frozenUtf8Bytes.median, 608);
    assert.equal(arm.byCategory.B.strictEligible.cases, 0);
    assert.equal(arm.byCategory.B.pooledEfficiency.strictPaired.recoveredFactsPerKB1000, null);
    assert.equal(JSON.stringify(result).includes("missing anchor"), false);
    assert.equal(JSON.stringify(result).includes("private-a"), false);
});
test("retains failed zero-evidence attempts in all-run measurements", () => {
    const failed = {
        ...makeRun("2", "2", "22", second),
        status: "failed",
        failure: "timeout",
        selected: [],
        snapshot: undefined,
        frozenBytes: 0,
    };
    const result = retrievalEfficiency(bundle, corpus, [makeRun("1", "1", "11", first), failed]);
    assert.equal(result.arms.baseline.allRuns.cases, 2);
    assert.equal(result.arms.baseline.allRuns.failures, 1);
    assert.equal(result.arms.baseline.allRuns.snapshots, 1);
    assert.equal(result.arms.baseline.allRuns.frozenUtf8Bytes.median, 8);
});
