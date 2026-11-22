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

test("primary document selection deduplicates supporting versions and exposes both failure denominators", () => {
    const labels = { cases: [bundle.cases[0], { ...bundle.cases[0], id: "second" }] };
    const scored = scoreRetrieval(labels, corpus, [
        run,
        { ...run, caseId: "2", status: "failed", failure: "topic_exploration_failed:timeout" },
    ]);
    const metric = scored.summary.arms.baseline.primaryDocumentSelectedRecall;
    assert.equal(metric.failuresIncluded.attempts, 2);
    assert.equal(metric.failuresIncluded.expectedDocuments, 2);
    assert.equal(metric.failuresIncluded.selectedDocuments, 1);
    assert.equal(metric.failuresIncluded.recall, 0.5);
    assert.equal(metric.failuresExcluded.attempts, 1);
    assert.equal(metric.failuresExcluded.recall, 1);
    assert.equal(scored.summary.arms.baseline.failureCauses["topic_exploration_failed:timeout"], 1);
    const repeated = {
        cases: [
            {
                ...bundle.cases[0],
                groundTruth: {
                    supportingFacts: [
                        ...bundle.cases[0].groundTruth.supportingFacts,
                        ...bundle.cases[0].groundTruth.supportingFacts,
                    ],
                },
            },
        ],
    };
    assert.equal(
        scoreRetrieval(repeated, corpus, [run]).summary.arms.baseline.primaryDocumentSelectedRecall
            .failuresIncluded.expectedDocuments,
        1
    );
});

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
test("output guard rejects Git descendants and symlinks into them", async () => {
    const { mkdtemp, mkdir, symlink, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join, resolve, relative, sep } = await import("node:path");
    const { externalOutput } = await import("./vantage-rag-multi-corpus-score.mjs");
    const root = await mkdtemp(join(tmpdir(), "rag-scorer-guard-"));
    try {
        const checkout = join(root, "checkout");
        await mkdir(join(checkout, ".git"), { recursive: true });
        await mkdir(join(checkout, "..foo"));
        await assert.rejects(
            externalOutput(join(checkout, "..foo", "local.json"), {}),
            /outside_git_checkout/
        );
        await symlink(checkout, join(root, "alias"), "junction");
        await assert.rejects(
            externalOutput(join(root, "alias", "local.json"), {}),
            /outside_git_checkout/
        );
        const good = join(root, "safe.json");
        await externalOutput(good, { safe: true });
        assert.deepEqual(JSON.parse(await readFile(good, "utf8")), { safe: true });
        await assert.rejects(externalOutput(good, {}), { code: "EEXIST" });
    } finally {
        const offset = relative(resolve(tmpdir()), resolve(root));
        if (!offset || offset === ".." || offset.startsWith(".." + sep))
            throw Error("unsafe_test_cleanup");
        await rm(root, { recursive: true, force: true });
    }
});
test("best token window preserves multiplicity and locality", async () => {
    const { bestWindowTokenRecall } = await import("./vantage-rag-multi-corpus-score.mjs");
    assert.equal(bestWindowTokenRecall("prefix alpha beta gamma suffix", "alpha beta gamma"), 1);
    assert.equal(bestWindowTokenRecall("alpha beta gamma", "alpha alpha alpha"), 1 / 3);
    assert.equal(bestWindowTokenRecall("alpha x x x beta", "alpha beta"), 0.5);
    assert.equal(bestWindowTokenRecall("", "alpha"), 0);
});
test("document and lenient recalls include facts excluded by strict source matching", () => {
    const changed = structuredClone(bundle);
    changed.cases[0].groundTruth.supportingFacts = [
        { filename: "release.md", text: "one two three four five six seven eight nine ten" },
    ];
    const changedRun = {
        ...run,
        selected: [{ ...run.selected[0], text: "one two three four five six seven eight" }],
    };
    const scored = scoreRetrieval(changed, corpus, [changedRun]);
    const arm = scored.summary.arms.baseline;
    assert.equal(arm.strictPassageRecall.cases, 0);
    assert.equal(arm.resolvedDocumentRecall.facts, 1);
    assert.equal(arm.resolvedDocumentRecall.offeredRecall, 1);
    assert.equal(arm.resolvedDocumentRecall.selectedRecall, 1);
    assert.equal(arm.lenientFrozenTokenRecall.thresholds["0.8"].coveredFacts, 1);
    assert.equal(arm.lenientFrozenTokenRecall.thresholds["0.9"].coveredFacts, 0);
    assert.deepEqual(arm.byEnterprise.Example.resolvedDocumentRecall, arm.resolvedDocumentRecall);
    assert.deepEqual(
        arm.byCategory.Temporal.lenientFrozenTokenRecall,
        arm.lenientFrozenTokenRecall
    );
});
test("token calibration measures exact source positives without provider access", () => {
    const scored = scoreRetrieval(bundle, corpus, [run]);
    assert.deepEqual(scored.summary.corpusMatching.tokenCalibration.exactSourcePositives, {
        facts: 1,
        min: 1,
        mean: 1,
        thresholds: { 0.8: 1, 0.9: 1 },
    });
    assert.equal(scored.summary.arms.baseline.strictPassageRecall.exactCoveredFacts, 1);
});
test("lenient token score never credits the wrong document version", () => {
    const scored = scoreRetrieval(bundle, corpus, [
        { ...run, selected: [{ ...run.selected[0], versionId: "wrong" }] },
    ]);
    assert.equal(
        scored.summary.arms.baseline.lenientFrozenTokenRecall.thresholds["0.8"].coveredFacts,
        0
    );
});
test("token windows stay inside each frozen excerpt", () => {
    const changed = structuredClone(bundle);
    changed.cases[0].groundTruth.supportingFacts = [
        { filename: "release.md", text: "one two three four five six seven eight nine ten" },
    ];
    const selected = [
        { ...run.selected[0], text: "one two three four five" },
        { ...run.selected[0], text: "six seven eight nine ten" },
    ];
    const arm = scoreRetrieval(changed, corpus, [{ ...run, selected }]).summary.arms.baseline;
    assert.equal(arm.lenientFrozenTokenRecall.thresholds["0.8"].coveredFacts, 0);
});
