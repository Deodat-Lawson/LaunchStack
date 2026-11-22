import test from "node:test";
import assert from "node:assert/strict";
import {
    scoreGroups,
    validateGroups,
    GROUP_SCORE_METHOD_SHA256,
} from "./vantage-rag-score-groups.mjs";

const words = [
    "alpha beta gamma delta epsilon",
    "one two three four five",
    "red green blue black white",
    "north south east west center",
    "spring summer fall winter year",
];
const bundle = {
    cases: words.map((text, index) => ({
        id: "label-" + index,
        enterprise: "Example",
        queryType: "Fictional",
        question: "Question " + (index + 1),
        groundTruth: { supportingFacts: [{ filename: "source" + index + ".md", text }] },
    })),
};
const corpus = {
    documents: words.map((text, index) => ({
        enterprise: "Example",
        filename: "source" + index + ".md",
        companyId: "8",
        documentId: String(index + 11),
        versionId: String(index + 21),
        text,
    })),
};
const group = size => ({
    groupId: "group-" + size,
    enterprise: "Example",
    workspaceId: "8",
    topics: bundle.cases
        .slice(0, size)
        .map((item, index) => ({ caseId: String(index + 1), question: item.question })),
});
const selected = [
    { documentId: "11", versionId: "21", text: "alpha beta gamma delta", kind: "excerpt" },
];
const run = (size = 3, changes = {}) => ({
    caseId: "group-" + size,
    enterprise: "Example",
    workspaceId: "8",
    arm: "scripted",
    status: "ok",
    topics: group(size).topics.map(topic => ({
        caseId: topic.caseId,
        topicId: "topic-" + topic.caseId,
    })),
    selected,
    ...changes,
});
test("shared context credits each topic by its own labels, with explicit attribution unavailable", () => {
    const result = scoreGroups(bundle, corpus, [group(3)], [run()]);
    const topics = result.details[0].topics;
    assert.equal(topics[0].sharedContext.supportingDocuments.selected, 1);
    assert.equal(topics[1].sharedContext.supportingDocuments.selected, 0);
    assert.equal(topics[0].sharedContext.strictPassage.zeroMatchedPassages, true);
    assert.equal(topics[0].sharedContext.lenientPassage["0.8"].covered, 1);
    assert.equal(topics[0].sharedContext.lenientPassage["0.9"].covered, 0);
    assert.equal(topics[0].explicitFrozenAttribution, null);
    assert.equal(topics[0].modelAssignedFrozenDocuments, null);
    assert.equal(
        result.summary.bySizeAndArm[3].scripted.frozenBytes.total,
        Buffer.byteLength(selected[0].text)
    );
    assert.match(GROUP_SCORE_METHOD_SHA256, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(result).includes(words[0]));
});
test("explicit frozen tags are separate from shared context", () => {
    const result = scoreGroups(
        bundle,
        corpus,
        [group(3)],
        [run(3, { selected: [{ ...selected[0], topicIds: ["topic-2"] }] })]
    );
    const first = result.details[0].topics[0];
    assert.equal(first.sharedContext.supportingDocuments.selected, 1);
    assert.equal(first.explicitFrozenAttribution.supportingDocuments.selected, 0);
    assert.equal(first.explicitFrozenAttribution.bytes, 0);
});
test("submission diagnostic is intersected with actual frozen versions and cannot confer label credit", () => {
    const result = scoreGroups(
        bundle,
        corpus,
        [group(3)],
        [
            run(3, {
                topicAttribution: {
                    level: "document-version",
                    provenance: "exploration_submission_filtered_to_frozen_survivors",
                    observable: true,
                    entries: [
                        { documentId: "11", versionId: "21", topicIds: ["topic-2"] },
                        { documentId: "12", versionId: "22", topicIds: ["topic-1"] },
                    ],
                },
            }),
        ]
    );
    const topics = result.details[0].topics;
    assert.equal(topics[0].modelAssignedFrozenDocuments.count, 0);
    assert.equal(topics[0].modelAssignedFrozenDocuments.zeroAttributedDocumentEvidence, true);
    assert.equal(topics[1].modelAssignedFrozenDocuments.count, 1);
    assert.equal(topics[1].sharedContext.supportingDocuments.selected, 0);
    assert.equal(topics[1].explicitFrozenAttribution, null);
});
test("strict source eligibility stays topic-specific and failures zero credit under either view", () => {
    const changed = structuredClone(bundle);
    changed.cases[2].groundTruth.supportingFacts[0].text = "unmatched label";
    const result = scoreGroups(
        changed,
        corpus,
        [group(3)],
        [
            run(),
            run(3, {
                arm: "configured-live",
                status: "failed",
                failure: "topic_exploration_failed:timeout",
            }),
        ]
    );
    assert.equal(result.details[0].topics[2].sharedContext.strictPassage.eligible, false);
    assert.equal(result.details[0].topics[2].sharedContext.strictPassage.zeroMatchedPassages, null);
    const failed = result.summary.bySizeAndArm[3]["configured-live"];
    assert.equal(failed.failuresIncluded.documentSelected.selected, 0);
    assert.equal(failed.failuresIncluded.documentSelected.expected, 3);
    assert.equal(failed.failuresExcluded.topics, 0);
    assert.equal(failed.failureCodes["topic_exploration_failed:timeout"], 1);
});
test("wrong versions and fragments in separate frozen units never satisfy a full passage", () => {
    const result = scoreGroups(
        bundle,
        corpus,
        [group(3)],
        [
            run(3, {
                selected: [
                    { ...selected[0], versionId: "old", text: words[0] },
                    { ...selected[0], text: "alpha beta" },
                    { ...selected[0], text: "gamma delta epsilon" },
                ],
            }),
        ]
    );
    const metric = result.details[0].topics[0].sharedContext;
    assert.equal(metric.supportingDocuments.selected, 1);
    assert.equal(metric.strictPassage.covered, 0);
    assert.equal(metric.lenientPassage["0.8"].covered, 0);
});
test("both group sizes report actual context maximum once and verify both shared limits", () => {
    const huge = Array.from({ length: 17 }, () => ({ ...selected[0], text: "界".repeat(2000) }));
    const result = scoreGroups(
        bundle,
        corpus,
        [group(3), group(5)],
        [run(), run(5, { selected: huge })]
    );
    const metric = result.summary.bySizeAndArm[5].scripted;
    assert.equal(metric.frozenBytes.max, 102000);
    assert.equal(metric.frozenBytes.total, 102000);
    assert.equal(metric.evidenceByteLimitViolations, 1);
    assert.equal(metric.sourceUnitLimitViolations, 1);
    assert.equal(metric.maxSourceUnits, 17);
});
test("group and raw mapping boundaries reject labels, mismatched questions, tenants and duplicate IDs", () => {
    assert.throws(
        () => validateGroups([{ ...group(3), supportingFacts: [] }], bundle, corpus),
        /group_requests_invalid/
    );
    const question = group(3);
    question.topics[0].question = "different";
    assert.throws(() => validateGroups([question], bundle, corpus), /identity_mismatch/);
    assert.throws(
        () => validateGroups([{ ...group(3), workspaceId: "9" }], bundle, corpus),
        /identity_mismatch/
    );
    assert.throws(
        () => scoreGroups(bundle, corpus, [group(3)], [run(), run()]),
        /duplicate_group_arm/
    );
    assert.throws(
        () =>
            scoreGroups(
                bundle,
                corpus,
                [group(3)],
                [run(3, { topics: [{ caseId: "1", topicId: "t" }] })]
            ),
        /topic_mapping_invalid/
    );
});
