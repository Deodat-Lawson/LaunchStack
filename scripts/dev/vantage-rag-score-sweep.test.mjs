import test from "node:test";
import assert from "node:assert/strict";
import {
    scoreSweep,
    SWEEP_SCORE_METHOD_SHA256,
    buildReliabilityViews,
    RELIABILITY_SCORE_METHOD_SHA256,
    DOCS_WINDOWS_SCORE_METHOD_SHA256,
} from "./vantage-rag-score-sweep.mjs";

const texts = [
    "alpha beta gamma delta epsilon",
    "one two three four five",
    "red green blue black white",
];
const bundle = {
    cases: texts.map((text, index) => ({
        id: "label" + index,
        enterprise: "Example",
        queryType: "Fictional",
        question: "Question " + index,
        groundTruth: { supportingFacts: [{ filename: "source" + index + ".md", text }] },
    })),
};
const corpus = {
    documents: texts.map((text, index) => ({
        enterprise: "Example",
        filename: "source" + index + ".md",
        companyId: "8",
        documentId: String(index + 1),
        versionId: String(index + 11),
        text,
    })),
};
const group = id => ({
    groupId: id,
    enterprise: "Example",
    workspaceId: "8",
    topics: bundle.cases.map((item, index) => ({
        caseId: String(index + 1),
        question: item.question,
    })),
});
const cohorts = [
    { cohort: "exploratory", bundle, groups: [group("a"), group("b")] },
    { cohort: "heldout", bundle, groups: [group("a")] },
];
function run(cohort, arm, id = "a", cap = 16000, changes = {}) {
    return {
        cohort,
        arm,
        caseId: id,
        enterprise: "Example",
        workspaceId: "8",
        status: "ok",
        runId: "same-exploration",
        ...(arm === "configured-live+backfill" ? { backfillOfRunId: "same-exploration" } : {}),
        accounting: { paidModelCalls: 0 },
        topics: group(id).topics.map(topic => ({
            caseId: topic.caseId,
            topicId: "topic-" + topic.caseId,
        })),
        retrievalLimits: { sharedEvidenceBytes: cap, sourceUnits: 16 },
        selected: [{ documentId: "1", versionId: "11", text: texts[0] }],
        ...changes,
    };
}
test("cohort/cap/arm cells remain distinct and expose absent and partial observations", () => {
    const score = scoreSweep(cohorts, corpus, [
        run("exploratory", "seeds"),
        run("heldout", "configured-live+backfill"),
    ]);
    assert.equal(score.summary.cells.length, 48);
    const exploratory = score.summary.cells.find(
        cell =>
            cell.cohort === "exploratory" &&
            cell.capBytes === 16000 &&
            cell.size === 3 &&
            cell.arm === "seeds"
    );
    assert.equal(exploratory.status, "partial");
    assert.equal(exploratory.expectedGroups, 2);
    assert.equal(exploratory.observedGroups, 1);
    const heldout = score.summary.cells.find(
        cell =>
            cell.cohort === "heldout" &&
            cell.capBytes === 16000 &&
            cell.size === 3 &&
            cell.arm === "configured-live+backfill"
    );
    assert.equal(heldout.status, "complete");
    assert.equal(heldout.metrics.failuresIncluded.documentSelected.expected, 3);
    assert(score.summary.cells.some(cell => cell.status === "absent" && cell.metrics === null));
    assert.equal(score.metadata.length, 2);
    assert(!JSON.stringify(score).includes(texts[0]));
    assert(!JSON.stringify(score).includes("groundTruth"));
    assert.match(SWEEP_SCORE_METHOD_SHA256, /^[a-f0-9]{64}$/);
});
test("partial live comparisons use only exactly paired group IDs and preserve failed zeros", () => {
    const score = scoreSweep(cohorts, corpus, [
        run("exploratory", "seeds", "a"),
        run("exploratory", "seeds", "b"),
        run("exploratory", "configured-live", "a", 16000, {
            status: "failed",
            failure: "topic_exploration_failed:timeout",
        }),
    ]);
    const pair = score.summary.pairs.find(
        pair =>
            pair.cohort === "exploratory" &&
            pair.capBytes === 16000 &&
            pair.size === 3 &&
            pair.leftArm === "configured-live" &&
            pair.rightArm === "seeds"
    );
    assert.equal(pair.matched.groups, 1);
    assert.equal(pair.matched.left.failuresIncluded.documentSelected.expected, 3);
    assert.equal(pair.matched.right.failuresIncluded.documentSelected.expected, 3);
    assert.equal(pair.matched.left.failuresIncluded.documentSelected.selected, 0);
    assert.equal(pair.matched.delta.documentSelected, -1);
    assert.equal(pair.bothSuccessful.groups, 0);
});
test("backfill is separate and compared to the corresponding original live selection", () => {
    const score = scoreSweep(cohorts, corpus, [
        run("heldout", "configured-live"),
        run("heldout", "configured-live+backfill", "a", 16000, {
            selected: corpus.documents.map(doc => ({
                documentId: doc.documentId,
                versionId: doc.versionId,
                text: doc.text,
            })),
        }),
    ]);
    const pair = score.summary.pairs.find(
        pair =>
            pair.cohort === "heldout" &&
            pair.capBytes === 16000 &&
            pair.size === 3 &&
            pair.leftArm === "configured-live+backfill" &&
            pair.rightArm === "configured-live"
    );
    assert.equal(pair.matched.groups, 1);
    assert.equal(pair.matched.delta.documentSelected, 2);
    assert.equal(pair.matched.delta.strictCovered, 2);
});
test("selected UTF8 bytes and source units obey the cap declared on each individual run", () => {
    assert.throws(
        () =>
            scoreSweep(cohorts, corpus, [
                run("exploratory", "seeds", "a", 8000, {
                    selected: [{ documentId: "1", versionId: "11", text: "界".repeat(2667) }],
                }),
            ]),
        /frozen_cap_violation/
    );
    assert.throws(
        () =>
            scoreSweep(cohorts, corpus, [
                run("exploratory", "seeds", "a", 80000, {
                    selected: Array(17).fill({ documentId: "1", versionId: "11", text: "a" }),
                }),
            ]),
        /frozen_cap_violation/
    );
    const score = scoreSweep(cohorts, corpus, [
        run("exploratory", "seeds", "a", 8000, {
            selected: [{ documentId: "1", versionId: "11", text: "a".repeat(8000) }],
        }),
    ]);
    assert.equal(score.metadata[0].atByteLimit, true);
});
test("scope rejects duplicate cell groups, unregistered caps/arms and heldout low caps", () => {
    assert.throws(
        () =>
            scoreSweep(cohorts, corpus, [run("exploratory", "seeds"), run("exploratory", "seeds")]),
        /duplicate_cell_group/
    );
    assert.throws(
        () => scoreSweep(cohorts, corpus, [run("heldout", "seeds", "a", 8000)]),
        /identity_invalid/
    );
    assert.throws(
        () => scoreSweep(cohorts, corpus, [run("exploratory", "baseline")]),
        /identity_invalid/
    );
});
test("backfill pairs verify exploration lineage, prefix preservation and zero added paid calls", () => {
    const primary = run("heldout", "configured-live");
    assert.throws(
        () =>
            scoreSweep(cohorts, corpus, [
                primary,
                run("heldout", "configured-live+backfill", "a", 16000, {
                    backfillOfRunId: "different",
                }),
            ]),
        /lineage_invalid/
    );
    assert.throws(
        () =>
            scoreSweep(cohorts, corpus, [
                primary,
                run("heldout", "configured-live+backfill", "a", 16000, { selected: [] }),
            ]),
        /prefix_changed/
    );
    assert.throws(
        () =>
            scoreSweep(cohorts, corpus, [
                run("heldout", "configured-live+backfill", "a", 16000, {
                    accounting: { paidModelCalls: 1 },
                }),
            ]),
        /paid_calls_invalid/
    );
});

function reliabilityFixture() {
    const primary = run("heldout", "configured-live", "a", 16000, {
        workId: "old-a",
        status: "failed",
        failure: "topic_exploration_failed:provider_or_submission",
        selected: [],
        runId: "old-run",
    });
    const backfill = {
        ...primary,
        arm: "configured-live+backfill",
        backfillOfRunId: "old-run",
        accounting: { paidModelCalls: 0 },
    };
    const audit = {
        schemaVersion: "vantage-budget-sweep-failure-audit/1",
        eligibleWorkIds: ["old-a"],
        eligibleJobs: [
            {
                workId: "old-a",
                groupId: "a",
                evidenceCapBytes: 16000,
                classification: "transport",
                causeWorkIds: [],
            },
        ],
        failures: [{ workId: "old-a", classification: "transport" }],
    };
    const retry = run("heldout", "configured-live", "a", 16000, {
        workId: "new-a",
        replacesWorkId: "old-a",
        runId: "new-run",
    });
    const retryBackfill = {
        ...retry,
        arm: "configured-live+backfill",
        backfillOfRunId: "new-run",
        accounting: { paidModelCalls: 0 },
    };
    return { primary, backfill, audit, retry, retryBackfill };
}
test("explicit reliability mode permits heldout8/16 and seeds-windows without changing original scope", () => {
    const h = [cohorts[1]];
    const r = run("heldout", "seeds-windows", "a", 8000);
    const scored = scoreSweep(h, corpus, [r], { mode: "heldout-reliability" });
    assert.equal(scored.summary.cells.length, 16);
    assert.equal(scored.methodSha256, RELIABILITY_SCORE_METHOD_SHA256);
    assert.notEqual(RELIABILITY_SCORE_METHOD_SHA256, SWEEP_SCORE_METHOD_SHA256);
    assert.throws(() => scoreSweep(h, corpus, [r]), /identity_invalid/);
    assert.throws(
        () =>
            scoreSweep(h, corpus, [run("heldout", "seeds", "a", 80000)], {
                mode: "heldout-reliability",
            }),
        /identity_invalid/
    );
});
test("reliability compares live directly with seeds-windows on matched and both-successful groups", () => {
    const runs = [
        run("heldout", "seeds-windows", "a", 8000),
        run("heldout", "configured-live", "a", 8000, {
            status: "failed",
            failure: "topic_exploration_failed:timeout",
        }),
    ];
    const score = scoreSweep([cohorts[1]], corpus, runs, { mode: "heldout-reliability" });
    const pair = score.summary.pairs.find(
        pair =>
            pair.capBytes === 8000 &&
            pair.size === 3 &&
            pair.leftArm === "configured-live" &&
            pair.rightArm === "seeds-windows"
    );
    assert.equal(pair.matched.groups, 1);
    assert.equal(pair.matched.delta.documentSelected, -1);
    assert.equal(pair.bothSuccessful.groups, 0);
    assert.equal(
        pair.matched.left.failuresIncluded.documentSelected.expected,
        pair.matched.right.failuresIncluded.documentSelected.expected
    );
});
test("reliability views retain original16 without reruns and replace eligible pairs once including failures", () => {
    const f = reliabilityFixture();
    const new8 = run("heldout", "seeds", "a", 8000);
    const views = buildReliabilityViews(
        [f.primary, f.backfill, run("exploratory", "configured-live", "a", 80000)],
        [new8, f.retry, f.retryBackfill],
        f.audit
    );
    assert.equal(views.withoutReruns.length, 3);
    assert.equal(views.withoutReruns[0], f.primary);
    assert.equal(views.withReruns[0], f.retry);
    assert.equal(views.audit.replacedPairs, 1);
    const failedRetry = {
        ...f.retry,
        status: "failed",
        selected: [],
        failure: "topic_exploration_failed:timeout",
    };
    const failedBackfill = {
        ...f.retryBackfill,
        ...failedRetry,
        arm: "configured-live+backfill",
        backfillOfRunId: failedRetry.runId,
    };
    const failed = buildReliabilityViews(
        [f.primary, f.backfill],
        [failedRetry, failedBackfill],
        f.audit
    );
    assert.equal(failed.withReruns[0].status, "failed");
    assert.equal(failed.audit.replacedFailures, 2);
});
test("partial replacement capture preserves original pair until both terminal rows are present", () => {
    const f = reliabilityFixture();
    const result = buildReliabilityViews([f.primary, f.backfill], [f.retry], f.audit);
    assert.deepEqual(result.withReruns, [f.primary, f.backfill]);
    assert.equal(result.audit.deferredReplacementRows, 1);
});
test("reliability forbids success, unrelated failure, wrong identity and repeated reruns", () => {
    const f = reliabilityFixture();
    assert.throws(
        () =>
            buildReliabilityViews(
                [{ ...f.primary, status: "ok" }, f.backfill],
                [f.retry, f.retryBackfill],
                f.audit
            ),
        /eligible_original_invalid/
    );
    assert.throws(
        () =>
            buildReliabilityViews([f.primary, f.backfill], [f.retry], {
                ...f.audit,
                eligibleWorkIds: [],
                eligibleJobs: [],
            }),
        /not_eligible/
    );
    assert.throws(
        () =>
            buildReliabilityViews(
                [f.primary, f.backfill],
                [{ ...f.retry, replacesWorkId: "other" }],
                f.audit
            ),
        /not_eligible/
    );
    assert.throws(
        () => buildReliabilityViews([f.primary, f.backfill], [f.retry, f.retry], f.audit),
        /multiple_replacement_attempts/
    );
    assert.throws(
        () =>
            buildReliabilityViews(
                [f.primary, f.backfill],
                [f.retry, { ...f.retryBackfill, runId: "different" }],
                f.audit
            ),
        /pair_lineage_invalid/
    );
});
test("shared-hold eligibility can be rooted in a proven80KB transport sibling", () => {
    const f = reliabilityFixture();
    const audit = {
        ...f.audit,
        eligibleJobs: [
            {
                ...f.audit.eligibleJobs[0],
                classification: "shared_hold_transport",
                causeWorkIds: ["wave-80"],
            },
        ],
        failures: [{ workId: "wave-80", classification: "transport" }],
    };
    assert.equal(
        buildReliabilityViews(
            [
                f.primary,
                f.backfill,
                {
                    ...f.primary,
                    workId: "wave-80",
                    retrievalLimits: { ...f.primary.retrievalLimits, sharedEvidenceBytes: 80000 },
                },
            ],
            [f.retry, f.retryBackfill],
            audit
        ).audit.replacedPairs,
        1
    );
    assert.throws(
        () => buildReliabilityViews([f.primary, f.backfill], [f.retry], { ...audit, failures: [] }),
        /transport_cause_unproven/
    );
});

function projectionFixture(provenance = "explicit-model-selection") {
    const primary = run("heldout", "configured-live", "a", 8000, { workId: "origin-work" });
    const windows = run("heldout", "seeds-windows", "a", 8000, {
        selected: corpus.documents.map(doc => ({
            documentId: doc.documentId,
            versionId: doc.versionId,
            text: doc.text,
        })),
    });
    const backfill = run("heldout", "configured-live+backfill", "a", 8000, {
        workId: "origin-work",
    });
    const projected = {
        ...primary,
        arm: "live-docs+windows",
        selected: windows.selected.slice(0, 2),
        projection: {
            sourceView: "with-reruns",
            sourceRunId: primary.runId,
            sourceWorkId: primary.workId,
            derivationKind: "offline-projection",
            documentSelectionProvenance: provenance,
        },
        accounting: { paidModelCalls: 0 },
    };
    return { primary, windows, backfill, projected };
}
test("docs-windows mode preserves existing metrics and compares offline projection with all three references", () => {
    const f = projectionFixture();
    const scored = scoreSweep(
        [cohorts[1]],
        corpus,
        [f.primary, f.windows, f.backfill, f.projected],
        { mode: "heldout-docs-windows" }
    );
    assert.equal(scored.summary.cells.length, 16);
    assert.equal(scored.summary.pairs.length, 12);
    assert.equal(scored.methodSha256, DOCS_WINDOWS_SCORE_METHOD_SHA256);
    assert.notEqual(scored.methodSha256, RELIABILITY_SCORE_METHOD_SHA256);
    const pairs = scored.summary.pairs.filter(p => p.capBytes === 8000 && p.size === 3);
    assert.deepEqual(
        pairs.map(p => p.rightArm),
        ["seeds-windows", "configured-live", "configured-live+backfill"]
    );
    assert.deepEqual(
        pairs.map(p => p.matched.delta.documentSelected),
        [-1, 1, 1]
    );
    assert.equal(scored.summary.sourceBackfillPairsVerified, 1);
    const cell = scored.summary.cells.find(
        c => c.capBytes === 8000 && c.size === 3 && c.arm === "live-docs+windows"
    );
    assert.equal(cell.evaluationStatus, "offline-projected");
    assert.deepEqual(cell.projectionProvenance, { explicitModelSelection: 1, archiveInferred: 0 });
    assert.equal(
        scored.metadata.find(m => m.arm === "live-docs+windows").projection.sourceView,
        "with-reruns"
    );
    assert(!JSON.stringify(scored).includes(texts[0]));
});
test("archive inference is separately labelled and wrong source lineage fails closed", () => {
    const f = projectionFixture("archive-inferred");
    const score = scoreSweep([cohorts[1]], corpus, [f.primary, f.projected], {
        mode: "heldout-docs-windows",
    });
    assert.equal(
        score.summary.cells.find(
            c => c.capBytes === 8000 && c.size === 3 && c.arm === "live-docs+windows"
        ).projectionProvenance.archiveInferred,
        1
    );
    assert.throws(
        () =>
            scoreSweep(
                [cohorts[1]],
                corpus,
                [
                    f.primary,
                    {
                        ...f.projected,
                        projection: { ...f.projected.projection, sourceWorkId: "wrong" },
                    },
                ],
                { mode: "heldout-docs-windows" }
            ),
        /projection_lineage_invalid/
    );
    assert.throws(
        () => scoreSweep([cohorts[1]], corpus, [f.projected], { mode: "heldout-docs-windows" }),
        /projection_lineage_invalid/
    );
});
test("offline projection cannot claim added paid or generation evidence, or rescue a failed source", () => {
    const f = projectionFixture();
    assert.throws(
        () =>
            scoreSweep(
                [cohorts[1]],
                corpus,
                [f.primary, { ...f.projected, accounting: { paidModelCalls: 1 } }],
                { mode: "heldout-docs-windows" }
            ),
        /projection_evidence_invalid/
    );
    assert.throws(
        () =>
            scoreSweep(
                [cohorts[1]],
                corpus,
                [f.primary, { ...f.projected, generation: { status: "accepted" } }],
                { mode: "heldout-docs-windows" }
            ),
        /projection_evidence_invalid/
    );
    const failed = {
        ...f.primary,
        status: "failed",
        failure: "topic_exploration_failed:timeout",
        selected: [],
    };
    assert.throws(
        () =>
            scoreSweep([cohorts[1]], corpus, [failed, f.projected], {
                mode: "heldout-docs-windows",
            }),
        /primary_failure_changed/
    );
    const p = { ...f.projected, status: "failed", failure: failed.failure, selected: [] };
    const score = scoreSweep([cohorts[1]], corpus, [failed, p], { mode: "heldout-docs-windows" });
    assert.equal(
        score.summary.cells.find(
            c => c.capBytes === 8000 && c.size === 3 && c.arm === "live-docs+windows"
        ).metrics.failures,
        1
    );
});
