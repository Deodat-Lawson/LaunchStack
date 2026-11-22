import test from "node:test";
import assert from "node:assert/strict";
import {
    scoreLongDecisions,
    exactSentences,
    LONG_DECISIONS_SCORE_METHOD,
    LONG_DECISIONS_SCORE_METHOD_SHA256,
} from "./vantage-long-decisions-score.mjs";

const current = "Approval uses 3.5 percent. The owner signed on Monday.";
const second = "The check passed. The gate is ready.";
const anchor = (id, text) => ({ id, text });
const spec = {
    schemaVersion: "long-decisions/spec-v1",
    documents: [
        {
            id: "D1",
            visibility: "actor_readable",
            versions: [
                {
                    id: "v1",
                    anchors: [
                        anchor("old", "Approval used eighteen percent. This version is obsolete."),
                    ],
                },
                { id: "v2", anchors: [anchor("A1", current), anchor("A2", second)] },
            ],
        },
        {
            id: "D2",
            visibility: "actor_readable",
            versions: [
                {
                    id: "m1",
                    anchors: [
                        anchor(
                            "wrong",
                            "This metric uses a different cohort. Reopened tickets are excluded."
                        ),
                    ],
                },
            ],
        },
        {
            id: "D3",
            visibility: "denied",
            versions: [
                {
                    id: "r1",
                    anchors: [
                        anchor(
                            "denied",
                            "PRIVATE_SOURCE Secret gate number is seven. Access is restricted."
                        ),
                    ],
                },
            ],
        },
        {
            id: "D4",
            visibility: "actor_readable",
            versions: [
                {
                    id: "s1",
                    anchors: [anchor("B1", "Support has a queue. The queue needs staffing.")],
                },
            ],
        },
        {
            id: "D5",
            visibility: "actor_readable",
            versions: [
                {
                    id: "f1",
                    anchors: [anchor("C1", "Finance approved the reserve. Payment begins Friday.")],
                },
            ],
        },
    ],
    cases: [
        {
            id: "c1",
            split: "dev",
            evidence: [
                { anchorId: "A1", documentId: "D1", versionId: "v2" },
                { anchorId: "A2", documentId: "D1", versionId: "v2" },
            ],
            distractors: [
                { type: "outdated_version", documentId: "D1", versionId: "v1" },
                { type: "similar_wrong_definition", documentId: "D2", versionId: "m1" },
                { type: "denied_document", documentId: "D3", versionId: "r1" },
            ],
        },
        {
            id: "c2",
            split: "dev",
            evidence: [{ anchorId: "B1", documentId: "D4", versionId: "s1" }],
            distractors: [],
        },
        {
            id: "c3",
            split: "dev",
            evidence: [{ anchorId: "C1", documentId: "D5", versionId: "f1" }],
            distractors: [],
        },
        ...["c4", "c5", "c6"].map(id => ({
            id,
            split: "heldout",
            evidence: [{ anchorId: "A1", documentId: "D1", versionId: "v2" }],
            distractors: [],
        })),
    ],
    groups: [
        { id: "g-dev", split: "dev", size: 3, weekId: "w3", caseIds: ["c1", "c2", "c3"] },
        { id: "g-dev-overlap", split: "dev", size: 3, weekId: "w3", caseIds: ["c1", "c2", "c3"] },
        { id: "g-heldout", split: "heldout", size: 3, weekId: "w3", caseIds: ["c4", "c5", "c6"] },
    ],
};
const contract = {
    caps: [16000, 32000, 80000],
    sourceUnits: 16,
    arms: LONG_DECISIONS_SCORE_METHOD.arms,
};
const run = (changes = {}) => ({
    groupId: "g-dev",
    split: "dev",
    weekId: "w3",
    capBytes: 16000,
    arm: "seeds-only",
    status: "completed",
    provenance: { kind: "deterministic" },
    offered: [],
    explored: [],
    selected: [{ documentId: "D1", versionId: "v2", text: current + " " + second }],
    ...changes,
});
const cell = (scored, arm = "seeds-only", split = "dev") =>
    scored.summary.cells.find(
        row => row.split === split && row.capBytes === 16000 && row.size === 3 && row.arm === arm
    );
test("exact sentence and block coverage use exact labelled version and deduplicate supporting documents", () => {
    assert.deepEqual(exactSentences(current), [
        "Approval uses 3.5 percent.",
        "The owner signed on Monday.",
    ]);
    const scored = scoreLongDecisions(spec, [run()], contract),
        c = cell(scored).failuresIncluded;
    assert.equal(c.supportingDocuments.expected, 3);
    assert.equal(c.supportingDocuments.selected, 1);
    assert.equal(c.strictEvidenceSentences.expected, 8);
    assert.equal(c.strictEvidenceSentences.covered, 4);
    assert.equal(c.strictAnchorBlocks.covered, 2);
    assert.equal(c.topicsWithoutSupportingDocuments, 2);
    assert.equal(c.frozenBytes.total, Buffer.byteLength(current + " " + second));
    assert.match(LONG_DECISIONS_SCORE_METHOD_SHA256, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(scored).includes("PRIVATE_SOURCE"));
    assert(!JSON.stringify(scored).includes(current));
});
test("wrong version, wrong metric document and punctuation normalization never earn strict credit", () => {
    const scored = scoreLongDecisions(
        spec,
        [
            run({
                selected: [
                    { documentId: "D1", versionId: "v1", text: current },
                    { documentId: "D2", versionId: "m1", text: current },
                ],
            }),
        ],
        contract
    );
    const c = cell(scored).failuresIncluded;
    assert.equal(c.supportingDocuments.selected, 0);
    assert.equal(c.strictEvidenceSentences.covered, 0);
    assert.equal(c.distractors.outdated_version.selectedOccurrences, 1);
    assert.equal(c.distractors.similar_wrong_definition.selectedOccurrences, 1);
    const normalized = scoreLongDecisions(
        spec,
        [
            run({
                selected: [
                    { documentId: "D1", versionId: "v2", text: current.replaceAll(".", "!") },
                ],
            }),
        ],
        contract
    );
    assert.equal(cell(normalized).failuresIncluded.strictEvidenceSentences.covered, 0);
});
test("sentences can be individually covered across units but blocks cannot be concatenated", () => {
    const scored = scoreLongDecisions(
        spec,
        [
            run({
                selected: exactSentences(current).map(text => ({
                    documentId: "D1",
                    versionId: "v2",
                    text,
                })),
            }),
        ],
        contract
    );
    const c = cell(scored).failuresIncluded;
    assert.equal(c.strictEvidenceSentences.covered, 2);
    assert.equal(c.strictAnchorBlocks.covered, 0);
    const fragments = scoreLongDecisions(
        spec,
        [
            run({
                selected: ["Approval uses", " 3.5 percent."].map(text => ({
                    documentId: "D1",
                    versionId: "v2",
                    text,
                })),
            }),
        ],
        contract
    );
    assert.equal(cell(fragments).failuresIncluded.strictEvidenceSentences.covered, 0);
});
test("restricted boundary disclosures and blocked requests remain distinct, even on failed runs", () => {
    const source = { documentId: "D3", versionId: "r1" };
    const scored = scoreLongDecisions(
        spec,
        [
            run({
                status: "failed",
                failure: "timeout",
                offered: [source],
                explored: [
                    { ...source, tool: "digest", disclosed: false },
                    { ...source, tool: "read", disclosed: true },
                ],
                selected: [{ ...source, text: "restricted" }],
            }),
        ],
        contract
    );
    const c = cell(scored).failuresIncluded;
    assert.equal(c.restrictedLeaks.offered.events, 1);
    assert.equal(c.restrictedLeaks.digests.events, 0);
    assert.equal(c.restrictedLeaks.reads.events, 1);
    assert.equal(c.restrictedLeaks.frozen.events, 1);
    assert.equal(c.blockedRestrictedAttempts, 1);
    assert.equal(c.supportingDocuments.selected, 0);
    assert.equal(cell(scored).failuresExcluded.runs, 0);
});
test("declared overlapping groups count occurrences separately and dev never mixes with heldout", () => {
    const scored = scoreLongDecisions(
        spec,
        [run(), run({ groupId: "g-dev-overlap" }), run({ groupId: "g-heldout", split: "heldout" })],
        contract
    );
    assert.equal(cell(scored).failuresIncluded.topicOccurrences, 6);
    assert.equal(cell(scored).failuresIncluded.uniqueCases, 3);
    assert.equal(cell(scored, "seeds-only", "heldout").failuresIncluded.topicOccurrences, 3);
});
test("live variants require common execution lineage and count completed or degraded triples explicitly", () => {
    const live = ["live", "live+backfill", "live-docs+windows"].map(arm =>
        run({ arm, provenance: { kind: "live", executionId: "e1" } })
    );
    const scored = scoreLongDecisions(spec, live, contract);
    assert.equal(scored.summary.liveTriples[0].status, "completed");
    live[1] = { ...live[1], status: "degraded" };
    const degraded = scoreLongDecisions(spec, live, contract);
    assert.equal(degraded.summary.liveTriples[0].status, "degraded");
    assert.equal(cell(degraded, "live+backfill").failuresIncluded.supportingDocuments.selected, 1);
    assert.throws(
        () =>
            scoreLongDecisions(
                spec,
                [live[0], { ...live[1], provenance: { kind: "live", executionId: "e2" } }],
                contract
            ),
        /execution_mismatch/
    );
});
test("source caps use every frozen UTF8 text and exact contract/roster/provenance boundaries fail closed", () => {
    assert.throws(
        () =>
            scoreLongDecisions(
                spec,
                [
                    run({
                        selected: [{ documentId: "D1", versionId: "v2", text: "界".repeat(5334) }],
                    }),
                ],
                contract
            ),
        /cap_violation/
    );
    assert.throws(() => scoreLongDecisions(spec, [run(), run()], contract), /duplicate_run/);
    assert.throws(
        () => scoreLongDecisions(spec, [run({ split: "heldout" })], contract),
        /identity_invalid/
    );
    assert.throws(
        () => scoreLongDecisions(spec, [run({ provenance: { kind: "live" } })], contract),
        /identity_invalid/
    );
    assert.throws(
        () => scoreLongDecisions(spec, [run()], { ...contract, caps: [8000, 32000, 80000] }),
        /contract_invalid/
    );
    assert.throws(
        () =>
            scoreLongDecisions(
                spec,
                [run({ selected: [{ documentId: "unknown", versionId: "v", text: "text" }] })],
                contract
            ),
        /version_unknown/
    );
});
test("optional source-topic attribution is diagnostic and never changes shared primary evidence", () => {
    const scored = scoreLongDecisions(
        spec,
        [
            run({
                topics: [
                    { caseId: "c1", topicId: "t1" },
                    { caseId: "c2", topicId: "t2" },
                    { caseId: "c3", topicId: "t3" },
                ],
                selected: [{ documentId: "D1", versionId: "v2", text: current, topicIds: ["t2"] }],
            }),
        ],
        contract
    );
    assert.equal(scored.details[0].topics[0].selectedDocuments, 1);
    assert.equal(scored.details[0].topics[0].attributedEvidence.selectedDocuments, 0);
    assert.equal(scored.details[0].topics[1].attributedEvidence.selectedDocuments, 0);
});
