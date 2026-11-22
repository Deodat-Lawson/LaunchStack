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
const RELIABILITY_ARMS = Object.freeze([
    "seeds",
    "seeds-windows",
    "configured-live",
    "configured-live+backfill",
]);
const RELIABILITY_CAPS = Object.freeze({ heldout: Object.freeze([8000, 16000]) });
export const RELIABILITY_SCORE_METHOD = Object.freeze({
    ...SWEEP_SCORE_METHOD,
    schemaVersion: "vantage-retrieval-reliability-method/1",
    arms: RELIABILITY_ARMS,
    cohortCaps: RELIABILITY_CAPS,
    pairing:
        "Exact matched-group and both-successful comparisons against seeds and seeds-windows; backfill also compared with its originating live arm",
    views: "Without reruns retains original 16 KB attempts plus new 8 KB attempts. With reruns replaces only predeclared failed transport-affected 16 KB attempts once, retaining replacement failures.",
});
export const RELIABILITY_SCORE_METHOD_SHA256 = createHash("sha256")
    .update(JSON.stringify(RELIABILITY_SCORE_METHOD))
    .digest("hex");
const DOCS_WINDOWS_ARMS = Object.freeze([
    "seeds-windows",
    "configured-live",
    "configured-live+backfill",
    "live-docs+windows",
]);
export const DOCS_WINDOWS_SCORE_METHOD = Object.freeze({
    ...RELIABILITY_SCORE_METHOD,
    schemaVersion: "vantage-live-document-windows-method/1",
    arms: DOCS_WINDOWS_ARMS,
    pairing:
        "Compare offline live-docs+windows to seeds-windows, configured-live and configured-live+backfill on exact matched groups and both-successful intersections",
    projection:
        "Offline projected selection from the fixed reliability with-reruns source view; exact source run/work IDs verified; zero added paid calls and no generation; archived document inference distinguished from explicit recorded selection; failed primary remains failed",
});
export const DOCS_WINDOWS_SCORE_METHOD_SHA256 = createHash("sha256")
    .update(JSON.stringify(DOCS_WINDOWS_SCORE_METHOD))
    .digest("hex");
const ok = run => ["ok", "accepted", "success"].includes(run.status);
const identity = run =>
    JSON.stringify([run.cohort, run.retrievalLimits?.sharedEvidenceBytes, run.arm, run.caseId]);
const reliabilityPairKey = run =>
    JSON.stringify([run.cohort, run.retrievalLimits?.sharedEvidenceBytes, run.caseId]);
/** Metadata-only view builder. It never reads benchmark labels or chooses a winning attempt. */
export function buildReliabilityViews(originalRows, newRows, eligibility) {
    if (
        !Array.isArray(originalRows) ||
        !Array.isArray(newRows) ||
        eligibility?.schemaVersion !== "vantage-budget-sweep-failure-audit/1" ||
        !Array.isArray(eligibility?.eligibleWorkIds) ||
        eligibility.eligibleWorkIds.some(id => typeof id !== "string" || !id) ||
        !Array.isArray(eligibility.eligibleJobs) ||
        !Array.isArray(eligibility.failures)
    )
        throw Error("reliability_eligibility_invalid");
    const eligible = new Set(eligibility.eligibleWorkIds);
    const original = originalRows.filter(
        row =>
            row.cohort === "heldout" &&
            row.retrievalLimits?.sharedEvidenceBytes === 16000 &&
            ["configured-live", "configured-live+backfill"].includes(row.arm)
    );
    const originals = new Map(original.map(row => [identity(row), row]));
    if (originals.size !== original.length) throw Error("reliability_original_duplicate");
    const primaryByPair = new Map(
        original
            .filter(row => row.arm === "configured-live")
            .map(row => [reliabilityPairKey(row), row])
    );
    const jobs = new Map(eligibility.eligibleJobs.map(job => [job.workId, job]));
    if (
        jobs.size !== eligible.size ||
        jobs.size !== eligibility.eligibleJobs.length ||
        eligibility.eligibleWorkIds.length !== eligible.size
    )
        throw Error("reliability_eligibility_jobs_invalid");
    const directTransport = new Set(
        eligibility.failures
            .filter(
                job =>
                    job.classification === "transport" &&
                    originalRows.some(
                        row =>
                            row.workId === job.workId &&
                            row.arm === "configured-live" &&
                            row.status === "failed"
                    )
            )
            .map(job => job.workId)
    );
    for (const workId of eligible) {
        const candidate = original.filter(
            row => row.arm === "configured-live" && row.workId === workId
        );
        if (candidate.length !== 1 || candidate[0].status !== "failed")
            throw Error("reliability_eligible_original_invalid");
        const job = jobs.get(workId);
        if (
            !job ||
            job.groupId !== candidate[0].caseId ||
            job.evidenceCapBytes !== 16000 ||
            !["transport", "shared_hold_transport"].includes(job.classification) ||
            !Array.isArray(job.causeWorkIds)
        )
            throw Error("reliability_eligibility_job_mismatch");
        if (
            job.classification === "transport"
                ? !directTransport.has(workId)
                : !job.causeWorkIds.length ||
                  job.causeWorkIds.some(cause => !directTransport.has(cause))
        )
            throw Error("reliability_transport_cause_unproven");
    }
    const additions = [],
        replacements = new Map();
    for (const row of newRows) {
        if (
            row.cohort !== "heldout" ||
            ![8000, 16000].includes(row.retrievalLimits?.sharedEvidenceBytes) ||
            !RELIABILITY_ARMS.includes(row.arm)
        )
            throw Error("reliability_new_scope_invalid");
        const key = identity(row),
            cap = row.retrievalLimits.sharedEvidenceBytes;
        if (row.replacesWorkId !== undefined) {
            const prior = originals.get(key),
                primary = primaryByPair.get(reliabilityPairKey(row));
            if (
                cap !== 16000 ||
                !["configured-live", "configured-live+backfill"].includes(row.arm) ||
                typeof row.replacesWorkId !== "string" ||
                !prior ||
                prior.workId !== row.replacesWorkId ||
                prior.status !== "failed" ||
                !primary ||
                !eligible.has(primary.workId) ||
                primary.status !== "failed"
            )
                throw Error("reliability_replacement_not_eligible");
            if (replacements.has(key)) throw Error("reliability_multiple_replacement_attempts");
            replacements.set(key, row);
        } else {
            if (
                originals.has(key) ||
                (cap === 16000 && ["configured-live", "configured-live+backfill"].includes(row.arm))
            )
                throw Error("reliability_original_overwrite_forbidden");
            additions.push(row);
        }
    }
    const withoutReruns = [...original, ...additions];
    if (new Set(withoutReruns.map(identity)).size !== withoutReruns.length)
        throw Error("reliability_new_duplicate");
    const activated = new Set();
    for (const row of replacements.values()) {
        const pairKey = reliabilityPairKey(row);
        const primary = replacements.get(
            JSON.stringify([row.cohort, 16000, "configured-live", row.caseId])
        );
        const backfill = replacements.get(
            JSON.stringify([row.cohort, 16000, "configured-live+backfill", row.caseId])
        );
        if (!primary || !backfill) continue;
        if (
            primary.runId
                ? backfill.runId !== primary.runId || backfill.backfillOfRunId !== primary.runId
                : Boolean(backfill.runId) || Boolean(backfill.backfillOfRunId)
        )
            throw Error("reliability_replacement_pair_lineage_invalid");
        if (!ok(primary) && (ok(backfill) || backfill.failure !== primary.failure))
            throw Error("reliability_replacement_failure_changed");
        activated.add(pairKey);
    }
    const withReruns = withoutReruns.map(row =>
        activated.has(reliabilityPairKey(row)) && replacements.has(identity(row))
            ? replacements.get(identity(row))
            : row
    );
    return {
        withoutReruns,
        withReruns,
        audit: {
            original16Rows: original.length,
            newRows: newRows.length,
            eligibleOriginalPrimaryWorkIds: eligible.size,
            replacementAttempts: replacements.size,
            replacedRows: original.filter(row => activated.has(reliabilityPairKey(row))).length,
            replacedPairs: activated.size,
            deferredReplacementRows: [...replacements.values()].filter(
                row => !activated.has(reliabilityPairKey(row))
            ).length,
            replacedFailures: [...replacements.values()].filter(
                row => activated.has(reliabilityPairKey(row)) && !ok(row)
            ).length,
        },
    };
}
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

export function scoreSweep(cohorts, corpus, runs, { mode = "original" } = {}) {
    if (!["original", "heldout-reliability", "heldout-docs-windows"].includes(mode))
        throw Error("sweep_score_mode_invalid");
    const arms =
        mode === "original"
            ? ARMS
            : mode === "heldout-reliability"
              ? RELIABILITY_ARMS
              : DOCS_WINDOWS_ARMS;
    const caps = mode === "original" ? CAPS : RELIABILITY_CAPS;
    const method =
        mode === "original"
            ? SWEEP_SCORE_METHOD
            : mode === "heldout-reliability"
              ? RELIABILITY_SCORE_METHOD
              : DOCS_WINDOWS_SCORE_METHOD;
    const methodSha256 =
        mode === "original"
            ? SWEEP_SCORE_METHOD_SHA256
            : mode === "heldout-reliability"
              ? RELIABILITY_SCORE_METHOD_SHA256
              : DOCS_WINDOWS_SCORE_METHOD_SHA256;
    if (
        !Array.isArray(cohorts) ||
        !cohorts.length ||
        new Set(cohorts.map(item => item.cohort)).size !== cohorts.length
    )
        throw Error("sweep_cohorts_invalid");
    for (const cohort of cohorts) {
        if (!Object.hasOwn(caps, cohort.cohort)) throw Error("sweep_cohort_unknown");
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
            !caps[run.cohort].includes(cap) ||
            !arms.includes(run.arm) ||
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
        if (mode === "heldout-docs-windows" && run.arm === "live-docs+windows") {
            const p = run.projection;
            const source = runs.find(
                candidate =>
                    candidate.arm === "configured-live" &&
                    reliabilityPairKey(candidate) === reliabilityPairKey(run)
            );
            if (
                !p ||
                p.sourceView !== "with-reruns" ||
                p.derivationKind !== "offline-projection" ||
                !["explicit-model-selection", "archive-inferred"].includes(
                    p.documentSelectionProvenance
                ) ||
                !source ||
                typeof p.sourceWorkId !== "string" ||
                !p.sourceWorkId ||
                p.sourceWorkId !== source.workId ||
                (p.sourceRunId ?? null) !== (source.runId ?? null)
            )
                throw Error("docs_windows_projection_lineage_invalid");
            if (run.accounting?.paidModelCalls !== 0 || run.generation !== undefined)
                throw Error("docs_windows_projection_evidence_invalid");
            if (!ok(source) && (ok(run) || run.failure !== source.failure))
                throw Error("docs_windows_primary_failure_changed");
        }
    }
    const cells = [],
        pairs = [],
        metadata = [];
    let sourceBackfillPairsVerified = 0;
    for (const cohort of cohorts) {
        const scoring = { ...cohort, corpus };
        for (const cap of caps[cohort.cohort]) {
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
                    workId: typeof raw.workId === "string" ? raw.workId : null,
                    replacesWorkId:
                        typeof raw.replacesWorkId === "string" ? raw.replacesWorkId : null,
                    backfillOfRunId:
                        typeof raw.backfillOfRunId === "string" ? raw.backfillOfRunId : null,
                    topics: detail.topics.map(compactTopic),
                    ...(raw.arm === "live-docs+windows"
                        ? {
                              evaluationStatus: "offline-projected",
                              projection: {
                                  sourceView: raw.projection.sourceView,
                                  sourceRunId: raw.projection.sourceRunId ?? null,
                                  sourceWorkId: raw.projection.sourceWorkId ?? null,
                                  derivationKind: raw.projection.derivationKind,
                                  documentSelectionProvenance:
                                      raw.projection.documentSelectionProvenance,
                              },
                          }
                        : {}),
                });
            }
            for (const size of [3, 5]) {
                const expected = cohort.groups.filter(group => group.topics.length === size);
                for (const arm of arms) {
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
                        ...(arm === "live-docs+windows"
                            ? {
                                  evaluationStatus: "offline-projected",
                                  projectionProvenance: {
                                      explicitModelSelection: observed.filter(
                                          run =>
                                              run.projection.documentSelectionProvenance ===
                                              "explicit-model-selection"
                                      ).length,
                                      archiveInferred: observed.filter(
                                          run =>
                                              run.projection.documentSelectionProvenance ===
                                              "archive-inferred"
                                      ).length,
                                  },
                              }
                            : {}),
                    });
                }
                if (mode === "heldout-docs-windows") {
                    sourceBackfillPairsVerified += paired(
                        scoring,
                        partition,
                        size,
                        "configured-live+backfill",
                        "configured-live"
                    ).verifiedBackfillPairs;
                    for (const reference of [
                        "seeds-windows",
                        "configured-live",
                        "configured-live+backfill",
                    ])
                        pairs.push({
                            cohort: cohort.cohort,
                            capBytes: cap,
                            size,
                            ...paired(scoring, partition, size, "live-docs+windows", reference),
                        });
                } else {
                    for (const candidate of arms.filter(arm => arm !== "seeds"))
                        pairs.push({
                            cohort: cohort.cohort,
                            capBytes: cap,
                            size,
                            ...paired(scoring, partition, size, candidate, "seeds"),
                        });
                    if (mode === "heldout-reliability")
                        for (const candidate of ["configured-live", "configured-live+backfill"])
                            pairs.push({
                                cohort: cohort.cohort,
                                capBytes: cap,
                                size,
                                ...paired(scoring, partition, size, candidate, "seeds-windows"),
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
    }
    return {
        method,
        methodSha256,
        metadata,
        summary: {
            schemaVersion: "vantage-retrieval-sweep-scores/1",
            methodSha256,
            groupMethodSha256: GROUP_SCORE_METHOD_SHA256,
            observedRuns: runs.length,
            cohorts: cohorts.map(item => ({
                cohort: item.cohort,
                expectedGroups: item.groups.length,
                caps: caps[item.cohort],
                expectedArms: arms,
            })),
            cells,
            pairs,
            ...(mode === "heldout-docs-windows" ? { sourceBackfillPairsVerified } : {}),
        },
    };
}
async function main() {
    const { values } = parseArgs({
        options: {
            cohorts: { type: "string" },
            mode: { type: "string", default: "original" },
            corpus: { type: "string" },
            results: { type: "string", multiple: true },
            local: { type: "string" },
            summary: { type: "string" },
            original: { type: "string" },
            eligibility: { type: "string" },
            view: { type: "string" },
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
    let runs = (
        await Promise.all(
            values.results.map(async path => {
                const raw = JSON.parse(await readFile(path, "utf8"));
                return Array.isArray(raw) ? raw : raw.runs;
            })
        )
    ).flat();
    let replacementAudit;
    if (values.original || values.eligibility || values.view) {
        if (
            values.mode !== "heldout-reliability" ||
            !values.original ||
            !values.eligibility ||
            !["without-reruns", "with-reruns"].includes(values.view)
        )
            throw Error("reliability_view_arguments_invalid");
        const originalBytes = await readFile(values.original);
        const eligibility = JSON.parse(await readFile(values.eligibility, "utf8"));
        if (
            eligibility.captureSha256 !==
                createHash("sha256").update(originalBytes).digest("hex") ||
            !/^[a-f0-9]{64}$/.test(eligibility.ledgerSha256 ?? "")
        )
            throw Error("reliability_original_archive_hash_mismatch");
        const parsedOriginal = JSON.parse(originalBytes.toString("utf8"));
        const views = buildReliabilityViews(
            Array.isArray(parsedOriginal) ? parsedOriginal : parsedOriginal.runs,
            runs,
            eligibility
        );
        runs = values.view === "without-reruns" ? views.withoutReruns : views.withReruns;
        replacementAudit = {
            view: values.view,
            originalArchiveSha256: eligibility.captureSha256,
            eligibilityLedgerSha256: eligibility.ledgerSha256,
            ...views.audit,
        };
    }
    const score = scoreSweep(cohorts, corpus, runs, { mode: values.mode });
    if (replacementAudit) score.summary.replacementAudit = replacementAudit;
    await externalOutput(values.local, {
        method: score.method,
        methodSha256: score.methodSha256,
        runs: score.metadata,
        ...(replacementAudit ? { replacementAudit } : {}),
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
