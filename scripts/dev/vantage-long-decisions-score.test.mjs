import test from "node:test";
import assert from "node:assert/strict";
import {
    scoreLongDecisions,
    exactSentences,
    LONG_DECISIONS_SCORE_METHOD,
    LONG_DECISIONS_SCORE_METHOD_SHA256,
    LONG_DECISIONS_SCORE_METHOD_V2,
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

function v2Fixture(weekId = "w1") {
    const value = structuredClone(spec);
    value.schemaVersion = "long-decisions/spec-v2";
    value.weeks = [
        { id: "w1", cutoff: "2026-10-12T00:00:00.000Z" },
        { id: "w2", cutoff: "2026-10-19T00:00:00.000Z" },
        { id: "w3", cutoff: "2026-10-26T00:00:00.000Z" },
    ];
    for (const document of value.documents)
        for (const [index, version] of document.versions.entries())
            version.publishedAt = index ? "2026-10-01T00:00:00.000Z" : "2026-09-01T00:00:00.000Z";
    value.documents.push(
        {
            id: "D6",
            visibility: "actor_readable",
            versions: [
                {
                    id: "stale6",
                    publishedAt: "2026-09-20T00:00:00.000Z",
                    anchors: [
                        anchor(
                            "stale6",
                            "The older release remained held. Its conditions have since changed."
                        ),
                    ],
                },
            ],
        },
        {
            id: "D7",
            visibility: "actor_readable",
            versions: [
                {
                    id: "similar7",
                    publishedAt: "2026-10-01T00:00:00.000Z",
                    anchors: [
                        anchor(
                            "similar7",
                            "A separate project passed. Its permission covers a different account."
                        ),
                    ],
                },
            ],
        }
    );
    value.cases[0].evidence = [
        { anchorId: "A1", documentId: "D1", versionId: "v2" },
        { anchorId: "B1", documentId: "D4", versionId: "s1" },
    ];
    value.cases[0].distractors = [
        { type: "superseded_status", documentId: "D6", versionId: "stale6" },
        { type: "conflicting_metric_definition", documentId: "D2", versionId: "m1" },
        { type: "similar_project", documentId: "D7", versionId: "similar7" },
        { type: "restricted_document", documentId: "D3", versionId: "r1" },
    ];
    for (const item of value.cases) item.originWeekId = weekId;
    for (const group of value.groups) group.weekId = weekId;
    return value;
}
const supportB = "Support has a queue. The queue needs staffing.";
const v2Run = (changes = {}) => run({ weekId: "w1", asOf: "2026-10-12T00:00:00.000Z", ...changes });
const v2Offered = [
    { documentId: "D1", versionId: "v2" },
    { documentId: "D4", versionId: "s1" },
    { documentId: "D5", versionId: "f1" },
];

test("v1 retains its original method hash and summary shape", () => {
    const scored = scoreLongDecisions(spec, [run()], contract);
    assert.equal(
        scored.methodSha256,
        "26cc814b62a47e77f2f09047f05faa84e4b16a06e37a62a6589e15d6a2317401"
    );
    assert.strictEqual(scored.method, LONG_DECISIONS_SCORE_METHOD);
    assert.equal(scored.summary.schemaVersion, "long-decisions/scores-v1");
    assert(!("twoDocumentCases" in cell(scored).failuresIncluded));
    assert(!("supportingDocumentsOffered" in cell(scored).failuresIncluded));
});

test("v2 accepts each declared cohort while binding labels and optional asOf to its cutoff", () => {
    for (const weekId of ["w1", "w2", "w3"]) {
        const fixture = v2Fixture(weekId);
        const cutoff = fixture.weeks.find(week => week.id === weekId).cutoff;
        const scored = scoreLongDecisions(fixture, [v2Run({ weekId, asOf: cutoff })], contract);
        assert.equal(scored.summary.schemaVersion, "long-decisions/scores-v2");
        assert.strictEqual(scored.method, LONG_DECISIONS_SCORE_METHOD_V2);
        assert.notEqual(scored.methodSha256, LONG_DECISIONS_SCORE_METHOD_SHA256);
    }
    assert.throws(
        () => scoreLongDecisions(v2Fixture(), [v2Run({ asOf: "2026-10-19T00:00:00Z" })], contract),
        /identity_invalid/
    );
    const wrongCohort = v2Fixture();
    wrongCohort.cases[0].originWeekId = "w2";
    assert.throws(() => scoreLongDecisions(wrongCohort, [v2Run()], contract), /cohort_invalid/);
    const future = v2Fixture();
    future.documents[0].versions[1].publishedAt = "2026-10-20T00:00:00Z";
    assert.throws(() => scoreLongDecisions(future, [v2Run()], contract), /label_cutoff_invalid/);
});

test("v2 distinguishes offered support, both frozen documents, and strict evidence in both", () => {
    const scored = scoreLongDecisions(
        v2Fixture(),
        [
            v2Run({
                offered: [
                    v2Offered[0],
                    v2Offered[1],
                    v2Offered[1],
                    v2Offered[2],
                    { documentId: "D1", versionId: "v1" },
                ],
                selected: [
                    { ...v2Offered[0], text: current },
                    {
                        ...v2Offered[1],
                        text: "A different passage from the correct supporting document.",
                    },
                ],
            }),
        ],
        contract
    );
    const actual = cell(scored).failuresIncluded;
    assert.deepEqual(actual.supportingDocumentsOffered, { expected: 4, offered: 4, recall: 1 });
    assert.equal(actual.supportingDocuments.selected, 3);
    assert.deepEqual(actual.twoDocumentCases, {
        expectedOccurrences: 1,
        bothOffered: 1,
        bothFrozen: 1,
        strictEvidenceInBoth: 0,
        bothAcquired: null,
        acquisitionObservedOccurrences: 0,
    });
    assert.equal(actual.missingAcquisitionAuditRuns, 1);
    assert.equal(actual.restrictedAcquisitionLeaks.events, null);
    assert.deepEqual(actual.supportingDocumentsAcquired, {
        expected: 0,
        acquired: 0,
        recall: null,
    });
    const older = scoreLongDecisions(
        v2Fixture(),
        [v2Run({ offered: [{ documentId: "D1", versionId: "v1" }] })],
        contract
    );
    assert.equal(cell(older).failuresIncluded.supportingDocumentsOffered.offered, 0);
});

test("v2 acquisition uses only explicit observations and keeps missing runs out of its denominator", () => {
    const observed = v2Run({
        offered: v2Offered,
        acquired: v2Offered,
        selected: [
            { ...v2Offered[0], text: current },
            { ...v2Offered[1], text: supportB },
        ],
    });
    const scored = scoreLongDecisions(
        v2Fixture(),
        [observed, v2Run({ groupId: "g-dev-overlap" })],
        contract
    );
    const actual = cell(scored).failuresIncluded;
    assert.equal(actual.missingAcquisitionAuditRuns, 1);
    assert.deepEqual(actual.supportingDocumentsAcquired, { expected: 4, acquired: 4, recall: 1 });
    assert.equal(actual.twoDocumentCases.expectedOccurrences, 2);
    assert.equal(actual.twoDocumentCases.acquisitionObservedOccurrences, 1);
    assert.equal(actual.twoDocumentCases.bothAcquired, 1);
    assert.equal(actual.twoDocumentCases.strictEvidenceInBoth, 1);
    assert.equal(scored.details[1].topics[0].acquiredDocuments, null);
    assert.throws(
        () => scoreLongDecisions(v2Fixture(), [v2Run({ acquired: {} })], contract),
        /sources_invalid/
    );
    assert.throws(
        () =>
            scoreLongDecisions(
                v2Fixture(),
                [v2Run({ acquired: [{ documentId: "unknown", versionId: "x" }] })],
                contract
            ),
        /version_unknown/
    );
});

test("v2 reports all four distractor types and every restricted boundary without awarding support", () => {
    const sources = [
        { documentId: "D6", versionId: "stale6" },
        { documentId: "D2", versionId: "m1" },
        { documentId: "D7", versionId: "similar7" },
        { documentId: "D3", versionId: "r1" },
    ];
    const scored = scoreLongDecisions(
        v2Fixture(),
        [
            v2Run({
                acquired: sources,
                offered: sources,
                selected: sources.map(source => ({ ...source, text: "Distractor content." })),
                explored: [
                    { ...sources[3], tool: "digest", disclosed: true },
                    { ...sources[3], tool: "read", disclosed: false },
                ],
            }),
        ],
        contract
    );
    const actual = cell(scored).failuresIncluded;
    for (const type of LONG_DECISIONS_SCORE_METHOD_V2.distractorTypes)
        assert.equal(actual.distractors[type].selectedOccurrences, 1);
    assert.equal(actual.supportingDocuments.selected, 0);
    assert.equal(actual.restrictedAcquisitionLeaks.events, 1);
    assert.equal(actual.restrictedLeaks.offered.events, 1);
    assert.equal(actual.restrictedLeaks.digests.events, 1);
    assert.equal(actual.restrictedLeaks.reads.events, 0);
    assert.equal(actual.restrictedLeaks.frozen.events, 1);
    assert.equal(actual.blockedRestrictedAttempts, 1);
});

test("v2 keeps pre-failure catalogue observations and zeros frozen support on failed runs", () => {
    const scored = scoreLongDecisions(
        v2Fixture(),
        [
            v2Run({
                status: "failed",
                failure: "timeout",
                offered: v2Offered,
                acquired: v2Offered,
                selected: [
                    { ...v2Offered[0], text: current },
                    { ...v2Offered[1], text: supportB },
                ],
            }),
        ],
        contract
    );
    const actual = cell(scored).failuresIncluded;
    assert.equal(actual.supportingDocumentsOffered.offered, 4);
    assert.equal(actual.supportingDocumentsAcquired.acquired, 4);
    assert.equal(actual.twoDocumentCases.bothOffered, 1);
    assert.equal(actual.twoDocumentCases.bothAcquired, 1);
    assert.equal(actual.twoDocumentCases.bothFrozen, 0);
    assert.equal(actual.twoDocumentCases.strictEvidenceInBoth, 0);
    assert.equal(cell(scored).failuresExcluded.runs, 0);
});
