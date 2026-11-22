import test from "node:test";
import assert from "node:assert/strict";
import { scoreSweep, SWEEP_SCORE_METHOD_SHA256 } from "./vantage-rag-score-sweep.mjs";

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
