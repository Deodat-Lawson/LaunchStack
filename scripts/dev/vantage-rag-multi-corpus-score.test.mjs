import test from "node:test";
import assert from "node:assert/strict";
import { buildRequests, matchPassage, scoreRetrieval } from "./vantage-rag-multi-corpus-score.mjs";

const bundle = {
    cases: [
        {
            id: "hidden-benchmark-id",
            enterprise: "Example",
            queryType: "Temporal",
            question: "When did the plan change?",
            groundTruth: {
                supportingFacts: [{ filename: "release.md", text: "Version 2: starts Friday." }],
            },
        },
    ],
};
const corpus = {
    documents: [
        {
            enterprise: "Example",
            filename: "release.md",
            text: "# Plan\nVersion 2: starts Friday.",
            companyId: "8",
            documentId: "11",
            versionId: "12",
        },
    ],
};
const run = {
    caseId: "1",
    enterprise: "Example",
    workspaceId: "8",
    arm: "baseline",
    status: "ok",
    offered: [{ documentId: "11", versionId: "12" }],
    selected: [{ documentId: "11", versionId: "12", text: "Version 2: starts Friday." }],
    frozenBytes: 100,
};

test("request boundary contains only ordinal company identities and question", () => {
    const requests = buildRequests(bundle, corpus);
    assert.deepEqual(requests, [
        {
            caseId: "1",
            enterprise: "Example",
            workspaceId: "8",
            question: "When did the plan change?",
        },
    ]);
    assert.equal(JSON.stringify(requests).includes("Version 2"), false);
    assert.equal(JSON.stringify(requests).includes("release.md"), false);
});
test("passage exact and conservative punctuation/whitespace normalization", () => {
    assert.equal(matchPassage("Version 2: starts Friday.", "Version 2: starts Friday."), "exact");
    assert.equal(
        matchPassage("Version 2 — starts\nFriday", "Version 2: starts Friday."),
        "normalized"
    );
    assert.equal(matchPassage("Version 3 starts Friday.", "Version 2: starts Friday."), null);
});
test("matches both document and version and scores label coverage", () => {
    const scored = scoreRetrieval(bundle, corpus, [run]);
    assert.equal(scored.summary.arms.baseline.coveredFacts, 1);
    assert.equal(scored.summary.arms.baseline.offeredFacts, 1);
    assert.equal(scored.summary.arms.baseline.selectedDocuments, 1);
    assert.equal(JSON.stringify(scored.summary).includes("Version 2"), false);
    const stale = scoreRetrieval(bundle, corpus, [
        { ...run, selected: [{ ...run.selected[0], versionId: "old" }] },
    ]);
    assert.equal(stale.summary.arms.baseline.coveredFacts, 0);
});
test("does not credit a labelled passage copied into another document", () => {
    const scored = scoreRetrieval(bundle, corpus, [
        { ...run, selected: [{ ...run.selected[0], documentId: "99" }] },
    ]);
    assert.equal(scored.summary.arms.baseline.coveredFacts, 0);
});
test("enumerates unmatched and skipped formats without exposing passage text", () => {
    const skipped = {
        documents: [],
        enterprises: [{ enterprise: "Example", workspaceId: "8" }],
        skipped: [{ enterprise: "Example", filename: "release.md", format: "pdf" }],
    };
    const scored = scoreRetrieval(bundle, skipped, [{ ...run, status: "failed", selected: [] }]);
    assert.equal(scored.summary.skippedNonTextAffectedCases, 1);
    assert.equal(scored.summary.arms.baseline.failures, 0);
    assert.equal(scored.summary.arms.baseline.rawAttemptFailures, 1);
    assert.equal(scored.summary.arms.baseline.cases, 0);
    assert.equal(scored.unmatched[0].reason, "skipped_non_text");
    assert.equal(JSON.stringify(scored).includes("Version 2"), false);
});
test("rejects mismatched enterprise or workspace and duplicate arm results", () => {
    assert.throws(
        () => scoreRetrieval(bundle, corpus, [{ ...run, workspaceId: "99" }]),
        /identity_mismatch/
    );
    assert.throws(() => scoreRetrieval(bundle, corpus, [run, run]), /duplicate_case_arm/);
});
test("reproduction hash excludes run IDs and timestamps while binding selected text", () => {
    const first = scoreRetrieval(bundle, corpus, [{ ...run, runId: "a", startedAt: "yesterday" }])
        .summary.arms.baseline.reproductionHash;
    const second = scoreRetrieval(bundle, corpus, [{ ...run, runId: "b", startedAt: "today" }])
        .summary.arms.baseline.reproductionHash;
    assert.equal(first, second);
    const changed = scoreRetrieval(bundle, corpus, [
        { ...run, selected: [{ ...run.selected[0], text: "changed" }] },
    ]).summary.arms.baseline.reproductionHash;
    assert.notEqual(first, changed);
});
test("excludes the entire case from primary scores when a second fact is unresolved", () => {
    const mixed = structuredClone(bundle);
    mixed.cases[0].groundTruth.supportingFacts.push({
        filename: "missing.md",
        text: "Unresolved source passage",
    });
    const scored = scoreRetrieval(mixed, corpus, [run]);
    assert.equal(scored.details[0].coveredFacts, 1);
    assert.equal(scored.summary.arms.baseline.cases, 0);
    assert.equal(scored.summary.arms.baseline.coveredFacts, 0);
    assert.equal(scored.summary.arms.baseline.rawAttempts, 1);
    assert.equal(scored.summary.arms.baseline.excludedUnmatchedCases, 1);
});
test("counts only excerpt units and separates raw generation outcomes", () => {
    const selected = [
        { ...run.selected[0], kind: "excerpt" },
        { ...run.selected[0], documentId: "22", kind: "full_document" },
    ];
    const scored = scoreRetrieval(bundle, corpus, [
        { ...run, selected, generation: { status: "accepted" } },
    ]);
    assert.equal(scored.summary.arms.baseline.selectedExcerpts, 1);
    assert.equal(scored.summary.arms.baseline.selectedDocuments, 2);
    assert.equal(scored.summary.arms.baseline.rawAttemptGenerationAccepted, 1);
    assert.equal(scored.summary.arms.baseline.rawAttemptGenerationFailures, 0);
});
