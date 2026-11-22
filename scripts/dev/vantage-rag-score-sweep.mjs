// Offline evaluator only. Provider and application paths must never import this module.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
    scoreGroups,
    validateGroups,
    GROUP_SCORE_METHOD_SHA256,
} from "./vantage-rag-score-groups.mjs";
import { externalOutput } from "./vantage-rag-multi-corpus-score.mjs";

const ARMS = Object.freeze(["seeds", "scripted", "configured-live", "configured-live+backfill"]);
const CAPS = Object.freeze({
    exploratory: Object.freeze([8000, 16000, 32000, 80000]),
    heldout: Object.freeze([16000, 80000]),
});
export const SWEEP_SCORE_METHOD = Object.freeze({
    schemaVersion: "vantage-retrieval-sweep-method/1",
    groupMethodSha256: GROUP_SCORE_METHOD_SHA256,
    arms: ARMS,
    cohortCaps: CAPS,
    sourceUnits: 16,
    primary:
        "Unchanged shared-context per-topic document-selected score; cells describe observed groups and identify absent expected groups",
    pairing:
        "Compare candidate to seeds on exact same cohort/cap/group intersection; failure-inclusive views share label denominators; both-successful intersection is reported separately",
    backfill:
        "Distinct configured-live+backfill arm; matching pairs verify original runId, backfillOfRunId, unchanged selected-source prefix, zero added paid calls, and preserved primary failures",
    privacy: "Only source-free per-run and per-topic count metadata is emitted",
});
export const SWEEP_SCORE_METHOD_SHA256 = createHash("sha256")
    .update(JSON.stringify(SWEEP_SCORE_METHOD))
    .digest("hex");
const ok = run => ["ok", "accepted", "success"].includes(run.status);
const identity = run =>
    JSON.stringify([run.cohort, run.retrievalLimits?.sharedEvidenceBytes, run.arm, run.caseId]);
const bytes = run =>
    (run.selected ?? []).reduce(
        (sum, source) => sum + Buffer.byteLength(source.text ?? "", "utf8"),
        0
    );
const sourceIdentity = source =>
    JSON.stringify([
        source.documentId,
        source.versionId,
        source.ref,
        source.text,
        source.start ?? null,
        source.end ?? null,
        source.kind,
        source.purpose,
    ]);
function compactTopic(topic) {
    return {
        caseId: topic.caseId,
        expectedDocuments: topic.sharedContext.supportingDocuments.expected,
        selectedSupportingDocuments: topic.sharedContext.supportingDocuments.selected,
        zeroMatchedDocuments: topic.sharedContext.supportingDocuments.zeroMatchedDocuments,
        strictEligible: topic.sharedContext.strictPassage.eligible,
        strictFacts: topic.sharedContext.strictPassage.facts,
        strictCovered: topic.sharedContext.strictPassage.covered,
        zeroStrictPassages: topic.sharedContext.strictPassage.zeroMatchedPassages,
        lenientFacts: topic.sharedContext.lenientPassage["0.8"].facts,
        lenient80Covered: topic.sharedContext.lenientPassage["0.8"].covered,
        lenient90Covered: topic.sharedContext.lenientPassage["0.9"].covered,
        zeroLenient80: topic.sharedContext.lenientPassage["0.8"].zeroMatchedPassages,
        zeroLenient90: topic.sharedContext.lenientPassage["0.9"].zeroMatchedPassages,
        modelAssignedFrozenDocuments: topic.modelAssignedFrozenDocuments?.count ?? null,
        zeroModelAssignedDocumentEvidence:
            topic.modelAssignedFrozenDocuments?.zeroAttributedDocumentEvidence ?? null,
    };
}
function metricDelta(left, right) {
    const subtract = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : null);
    return {
        documentSelected: left.documentSelected.selected - right.documentSelected.selected,
        documentRecall: subtract(left.documentSelected.recall, right.documentSelected.recall),
        strictCovered: left.strictPassage.covered - right.strictPassage.covered,
        strictRecall: subtract(left.strictPassage.recall, right.strictPassage.recall),
        lenient80Covered: left.lenientPassage["0.8"].covered - right.lenientPassage["0.8"].covered,
        lenient90Covered: left.lenientPassage["0.9"].covered - right.lenientPassage["0.9"].covered,
        lenient80Recall: subtract(
            left.lenientPassage["0.8"].recall,
            right.lenientPassage["0.8"].recall
        ),
        lenient90Recall: subtract(
            left.lenientPassage["0.9"].recall,
            right.lenientPassage["0.9"].recall
        ),
        zeroMatchedDocumentTopics:
            left.documentSelected.zeroMatchedDocumentTopics -
            right.documentSelected.zeroMatchedDocumentTopics,
    };
}
function paired(cohort, partition, size, leftArm, rightArm) {
    const left = new Map(
        partition.filter(run => run.arm === leftArm).map(run => [run.caseId, run])
    );
    const right = new Map(
        partition.filter(run => run.arm === rightArm).map(run => [run.caseId, run])
    );
    const matched = cohort.groups.filter(
        group => group.topics.length === size && left.has(group.groupId) && right.has(group.groupId)
    );
    let verifiedBackfillPairs = 0;
    if (leftArm === "configured-live+backfill" && rightArm === "configured-live") {
        for (const group of matched) {
            const backfill = left.get(group.groupId),
                primary = right.get(group.groupId);
            if (
                primary.runId
                    ? backfill.runId !== primary.runId || backfill.backfillOfRunId !== primary.runId
                    : Boolean(backfill.runId) || Boolean(backfill.backfillOfRunId)
            )
                throw Error("sweep_backfill_lineage_invalid");
            if (!ok(primary) && (ok(backfill) || backfill.failure !== primary.failure))
                throw Error("sweep_backfill_failure_changed");
            if (
                (primary.selected ?? []).some(
                    (source, index) =>
                        sourceIdentity(source) !== sourceIdentity(backfill.selected?.[index] ?? {})
                )
            )
                throw Error("sweep_backfill_prefix_changed");
            verifiedBackfillPairs++;
        }
    }
    function scoreSubset(groups) {
        if (!groups.length) return { groups: 0, left: null, right: null, delta: null };
        const scored = scoreGroups(
            cohort.bundle,
            cohort.corpus,
            groups,
            groups.flatMap(group => [left.get(group.groupId), right.get(group.groupId)])
        );
        const a = scored.summary.bySizeAndArm[size][leftArm],
            b = scored.summary.bySizeAndArm[size][rightArm];
        if (
            a.failuresIncluded.documentSelected.expected !==
                b.failuresIncluded.documentSelected.expected ||
            a.failuresIncluded.strictPassage.facts !== b.failuresIncluded.strictPassage.facts ||
            a.failuresIncluded.lenientPassage["0.8"].facts !==
                b.failuresIncluded.lenientPassage["0.8"].facts
        )
            throw Error("sweep_paired_denominators_differ");
        return {
            groups: groups.length,
            left: a,
            right: b,
            delta: {
                ...metricDelta(a.failuresIncluded, b.failuresIncluded),
                failures: a.failures - b.failures,
            },
        };
    }
    return {
        leftArm,
        rightArm,
        verifiedBackfillPairs,
        matched: scoreSubset(matched),
        bothSuccessful: scoreSubset(
            matched.filter(group => ok(left.get(group.groupId)) && ok(right.get(group.groupId)))
        ),
    };
}

export function scoreSweep(cohorts, corpus, runs) {
    if (
        !Array.isArray(cohorts) ||
        !cohorts.length ||
        new Set(cohorts.map(item => item.cohort)).size !== cohorts.length
    )
        throw Error("sweep_cohorts_invalid");
    for (const cohort of cohorts) {
        if (!Object.hasOwn(CAPS, cohort.cohort)) throw Error("sweep_cohort_unknown");
        validateGroups(cohort.groups, cohort.bundle, corpus);
    }
    if (!Array.isArray(runs)) throw Error("sweep_runs_invalid");
    const byCohort = new Map(cohorts.map(item => [item.cohort, item]));
    const seen = new Set();
    for (const run of runs) {
        const cohort = byCohort.get(run.cohort),
            cap = run.retrievalLimits?.sharedEvidenceBytes;
        if (
            !cohort ||
            !CAPS[run.cohort].includes(cap) ||
            !ARMS.includes(run.arm) ||
            run.retrievalLimits?.sourceUnits !== 16 ||
            !cohort.groups.some(group => group.groupId === run.caseId)
        )
            throw Error("sweep_run_identity_invalid");
        if (seen.has(identity(run))) throw Error("sweep_duplicate_cell_group");
        seen.add(identity(run));
        if (bytes(run) > cap || (run.selected ?? []).length > 16)
            throw Error("sweep_frozen_cap_violation");
        if (run.arm === "configured-live+backfill" && run.accounting?.paidModelCalls !== 0)
            throw Error("sweep_backfill_paid_calls_invalid");
    }
    const cells = [],
        pairs = [],
        metadata = [];
    for (const cohort of cohorts) {
        const scoring = { ...cohort, corpus };
        for (const cap of CAPS[cohort.cohort]) {
            const partition = runs.filter(
                run =>
                    run.cohort === cohort.cohort && run.retrievalLimits.sharedEvidenceBytes === cap
            );
            const scored = scoreGroups(cohort.bundle, corpus, cohort.groups, partition);
            for (const detail of scored.details) {
                const raw = partition.find(
                    run => run.caseId === detail.groupId && run.arm === detail.arm
                );
                metadata.push({
                    cohort: cohort.cohort,
                    capBytes: cap,
                    groupId: detail.groupId,
                    size: detail.groupSize,
                    arm: detail.arm,
                    failed: detail.failed,
                    failureCode: detail.failureCode,
                    bytes: detail.bytes,
                    sourceUnits: detail.sourceUnits,
                    atSourceLimit: detail.sourceUnits === 16,
                    atByteLimit: detail.bytes === cap,
                    reportedFrozenBytesMatch: detail.reportedFrozenBytesMatch,
                    runId: typeof raw.runId === "string" ? raw.runId : null,
                    backfillOfRunId:
                        typeof raw.backfillOfRunId === "string" ? raw.backfillOfRunId : null,
                    topics: detail.topics.map(compactTopic),
                });
            }
            for (const size of [3, 5]) {
                const expected = cohort.groups.filter(group => group.topics.length === size);
                for (const arm of ARMS) {
                    const observed = partition.filter(
                        run =>
                            run.arm === arm && expected.some(group => group.groupId === run.caseId)
                    );
                    cells.push({
                        cohort: cohort.cohort,
                        capBytes: cap,
                        size,
                        arm,
                        status:
                            observed.length === 0
                                ? "absent"
                                : observed.length === expected.length
                                  ? "complete"
                                  : "partial",
                        expectedGroups: expected.length,
                        expectedTopics: expected.length * size,
                        observedGroups: observed.length,
                        missingGroups: expected.length - observed.length,
                        metrics: scored.summary.bySizeAndArm[size][arm] ?? null,
                        atSourceLimit: observed.filter(run => (run.selected ?? []).length === 16)
                            .length,
                        atByteLimit: observed.filter(run => bytes(run) === cap).length,
                        verifiedActualMaxBytes: observed.length
                            ? Math.max(...observed.map(bytes))
                            : null,
                        capViolations: 0,
                    });
                }
                for (const candidate of ARMS.filter(arm => arm !== "seeds"))
                    pairs.push({
                        cohort: cohort.cohort,
                        capBytes: cap,
                        size,
                        ...paired(scoring, partition, size, candidate, "seeds"),
                    });
                pairs.push({
                    cohort: cohort.cohort,
                    capBytes: cap,
                    size,
                    ...paired(
                        scoring,
                        partition,
                        size,
                        "configured-live+backfill",
                        "configured-live"
                    ),
                });
            }
        }
    }
    return {
        method: SWEEP_SCORE_METHOD,
        methodSha256: SWEEP_SCORE_METHOD_SHA256,
        metadata,
        summary: {
            schemaVersion: "vantage-retrieval-sweep-scores/1",
            methodSha256: SWEEP_SCORE_METHOD_SHA256,
            groupMethodSha256: GROUP_SCORE_METHOD_SHA256,
            observedRuns: runs.length,
            cohorts: cohorts.map(item => ({
                cohort: item.cohort,
                expectedGroups: item.groups.length,
                caps: CAPS[item.cohort],
                expectedArms: ARMS,
            })),
            cells,
            pairs,
        },
    };
}
async function main() {
    const { values } = parseArgs({
        options: {
            cohorts: { type: "string" },
            corpus: { type: "string" },
            results: { type: "string", multiple: true },
            local: { type: "string" },
            summary: { type: "string" },
        },
    });
    if (
        !values.cohorts ||
        !values.corpus ||
        !values.results?.length ||
        !values.local ||
        !values.summary
    )
        throw Error("sweep_score_paths_required");
    const configs = JSON.parse(await readFile(values.cohorts, "utf8"));
    const cohorts = await Promise.all(
        configs.map(async config => ({
            cohort: config.cohort,
            bundle: JSON.parse(await readFile(config.labels, "utf8")),
            groups: JSON.parse(await readFile(config.groups, "utf8")),
        }))
    );
    const corpus = JSON.parse(await readFile(values.corpus, "utf8"));
    const runs = (
        await Promise.all(
            values.results.map(async path => {
                const raw = JSON.parse(await readFile(path, "utf8"));
                return Array.isArray(raw) ? raw : raw.runs;
            })
        )
    ).flat();
    const score = scoreSweep(cohorts, corpus, runs);
    await externalOutput(values.local, {
        method: score.method,
        methodSha256: score.methodSha256,
        runs: score.metadata,
    });
    await externalOutput(values.summary, score.summary);
    console.log(
        JSON.stringify({
            methodSha256: score.methodSha256,
            observedRuns: runs.length,
            cells: score.summary.cells.length,
            completeCells: score.summary.cells.filter(cell => cell.status === "complete").length,
        })
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(() => {
        console.error("sweep_score_failed");
        process.exitCode = 1;
    });
