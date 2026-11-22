// Offline evaluator only. Never import from a retriever, provider, or application route.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
    buildRequests,
    scoreRetrieval,
    externalOutput,
} from "./vantage-rag-multi-corpus-score.mjs";

export const GROUP_SCORE_METHOD = Object.freeze({
    schemaVersion: "vantage-grouped-retrieval-method/1",
    groupSizes: Object.freeze([3, 5]),
    primary:
        "Per-topic distinct filename-resolved supporting document versions present in the shared frozen context; failed runs receive zero credit",
    strict: "A topic is eligible only if every labelled supporting fact matches its canonical source under the unchanged exact/normalized matcher",
    lenient:
        "Per-fact token recall at .8 and .9 inside individual frozen units of the correct document version",
    attribution:
        "Explicit frozen unit topicIds are scored separately; missing tags are unavailable; model-submission survivor assignments are document-count diagnostics only",
    bytes: "UTF-8 source text only; shared context bytes counted once per group; per-topic shared bytes are nonadditive",
    limits: Object.freeze({ evidenceBytes: 80000, sourceUnits: 16 }),
});
export const GROUP_SCORE_METHOD_SHA256 = createHash("sha256")
    .update(JSON.stringify(GROUP_SCORE_METHOD))
    .digest("hex");
const docKey = doc => JSON.stringify([String(doc.documentId), String(doc.versionId)]);
const countBytes = sources =>
    sources.reduce((sum, source) => sum + Buffer.byteLength(source.text ?? "", "utf8"), 0);
const successful = run => ["ok", "accepted", "success"].includes(run.status);
function exactKeys(value, keys) {
    return (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === keys.length &&
        keys.every(key => Object.hasOwn(value, key))
    );
}
export function validateGroups(groups, bundle, corpus) {
    if (!Array.isArray(groups) || !groups.length) throw Error("group_requests_invalid");
    const requests = new Map(
        buildRequests(bundle, corpus).map(request => [request.caseId, request])
    );
    const seen = new Set();
    for (const group of groups) {
        if (
            !exactKeys(group, ["groupId", "enterprise", "workspaceId", "topics"]) ||
            typeof group.groupId !== "string" ||
            !group.groupId.length ||
            group.groupId.length > 100 ||
            seen.has(group.groupId) ||
            !Array.isArray(group.topics) ||
            ![3, 5].includes(group.topics.length)
        )
            throw Error("group_requests_invalid");
        seen.add(group.groupId);
        const cases = new Set();
        for (const topic of group.topics) {
            if (
                !exactKeys(topic, ["caseId", "question"]) ||
                typeof topic.caseId !== "string" ||
                cases.has(topic.caseId)
            )
                throw Error("group_topic_invalid");
            cases.add(topic.caseId);
            const request = requests.get(topic.caseId);
            if (
                !request ||
                request.question !== topic.question ||
                request.enterprise !== group.enterprise ||
                request.workspaceId !== group.workspaceId
            )
                throw Error("group_topic_identity_mismatch");
        }
    }
    return groups;
}
function topicMetrics(detail, sources, failed) {
    const facts = detail.factResults;
    const expected = new Map(
        facts
            .filter(fact => fact.filenameResolved)
            .map(fact => [JSON.stringify([fact.documentId, fact.versionId]), fact.selected])
    );
    const selected = failed ? 0 : [...expected.values()].filter(Boolean).length;
    const covered = failed ? 0 : facts.filter(fact => fact.covered).length;
    const resolved = facts.filter(fact => fact.filenameResolved);
    return {
        supportingDocuments: {
            expected: expected.size,
            selected,
            recall: expected.size ? selected / expected.size : null,
            zeroMatchedDocuments: expected.size ? selected === 0 : null,
        },
        strictPassage: {
            eligible: detail.eligible,
            facts: detail.eligible ? facts.length : 0,
            covered: detail.eligible ? covered : 0,
            recall: detail.eligible && facts.length ? covered / facts.length : null,
            zeroMatchedPassages: detail.eligible ? covered === 0 : null,
        },
        lenientPassage: Object.fromEntries(
            [0.8, 0.9].map(threshold => {
                const count = failed
                    ? 0
                    : resolved.filter(fact => fact.frozenTokenRecall >= threshold).length;
                return [
                    String(threshold),
                    {
                        facts: resolved.length,
                        covered: count,
                        recall: resolved.length ? count / resolved.length : null,
                        zeroMatchedPassages: resolved.length ? count === 0 : null,
                    },
                ];
            })
        ),
        frozenDocumentVersions: new Set(sources.map(docKey)).size,
        sourceUnits: sources.length,
        bytes: countBytes(sources),
    };
}
export function byteDistribution(values) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length)
        return { n: 0, total: 0, min: null, median: null, p90: null, p95: null, max: null };
    const middle = Math.floor(sorted.length / 2);
    return {
        n: sorted.length,
        total: sorted.reduce((a, b) => a + b, 0),
        min: sorted[0],
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        max: sorted.at(-1),
    };
}
function rollup(rows) {
    const topics = rows.flatMap(row => row.topics);
    function view(candidates) {
        const source = candidates.flatMap(row => row.topics);
        const expected = source.reduce(
            (sum, row) => sum + row.sharedContext.supportingDocuments.expected,
            0
        );
        const selected = source.reduce(
            (sum, row) => sum + row.sharedContext.supportingDocuments.selected,
            0
        );
        const eligible = source.filter(row => row.sharedContext.strictPassage.eligible);
        const strictFacts = eligible.reduce(
            (sum, row) => sum + row.sharedContext.strictPassage.facts,
            0
        );
        const strictCovered = eligible.reduce(
            (sum, row) => sum + row.sharedContext.strictPassage.covered,
            0
        );
        return {
            groups: candidates.length,
            topics: source.length,
            documentSelected: {
                expected,
                selected,
                recall: expected ? selected / expected : null,
                zeroMatchedDocumentTopics: source.filter(
                    row => row.sharedContext.supportingDocuments.zeroMatchedDocuments === true
                ).length,
                noResolvedDocumentTopics: source.filter(
                    row => row.sharedContext.supportingDocuments.expected === 0
                ).length,
            },
            strictPassage: {
                eligibleTopics: eligible.length,
                excludedTopics: source.length - eligible.length,
                facts: strictFacts,
                covered: strictCovered,
                recall: strictFacts ? strictCovered / strictFacts : null,
                zeroMatchedPassageTopics: eligible.filter(
                    row => row.sharedContext.strictPassage.zeroMatchedPassages
                ).length,
            },
            lenientPassage: Object.fromEntries(
                ["0.8", "0.9"].map(threshold => {
                    const facts = source.reduce(
                        (sum, row) => sum + row.sharedContext.lenientPassage[threshold].facts,
                        0
                    );
                    const covered = source.reduce(
                        (sum, row) => sum + row.sharedContext.lenientPassage[threshold].covered,
                        0
                    );
                    return [
                        threshold,
                        {
                            facts,
                            covered,
                            recall: facts ? covered / facts : null,
                            zeroMatchedPassageTopics: source.filter(
                                row =>
                                    row.sharedContext.lenientPassage[threshold]
                                        .zeroMatchedPassages === true
                            ).length,
                        },
                    ];
                })
            ),
        };
    }
    return {
        runs: rows.length,
        failures: rows.filter(row => row.failed).length,
        failureCodes: Object.fromEntries(
            [...new Set(rows.filter(row => row.failed).map(row => row.failureCode))].map(code => [
                code,
                rows.filter(row => row.failed && row.failureCode === code).length,
            ])
        ),
        failuresIncluded: view(rows),
        failuresExcluded: view(rows.filter(row => !row.failed)),
        frozenBytes: byteDistribution(rows.map(row => row.bytes)),
        maxSourceUnits: Math.max(0, ...rows.map(row => row.sourceUnits)),
        evidenceByteLimitViolations: rows.filter(row => row.bytes > 80000).length,
        sourceUnitLimitViolations: rows.filter(row => row.sourceUnits > 16).length,
        reportedFrozenByteCountMismatches: rows.filter(
            row => row.reportedFrozenBytesMatch === false
        ).length,
        groupsWithZeroSupportingDocuments: rows.filter(
            row =>
                row.topics.some(topic => topic.sharedContext.supportingDocuments.expected > 0) &&
                row.topics.every(topic => topic.sharedContext.supportingDocuments.selected === 0)
        ).length,
        groupsWithNoResolvedDocuments: rows.filter(row =>
            row.topics.every(topic => topic.sharedContext.supportingDocuments.expected === 0)
        ).length,
        groupsWithAllTopicsSupported: rows.filter(row =>
            row.topics.every(
                topic =>
                    topic.sharedContext.supportingDocuments.selected ===
                        topic.sharedContext.supportingDocuments.expected &&
                    topic.sharedContext.supportingDocuments.expected > 0
            )
        ).length,
        modelAssignedDocuments: {
            observableTopics: topics.filter(topic => topic.modelAssignedFrozenDocuments !== null)
                .length,
            zeroAssignedTopics: topics.filter(
                topic => topic.modelAssignedFrozenDocuments?.zeroAttributedDocumentEvidence
            ).length,
            countDistribution: byteDistribution(
                topics
                    .filter(topic => topic.modelAssignedFrozenDocuments !== null)
                    .map(topic => topic.modelAssignedFrozenDocuments.count)
            ),
        },
    };
}
export function scoreGroups(bundle, corpus, groups, runs) {
    validateGroups(groups, bundle, corpus);
    const byGroup = new Map(groups.map(group => [group.groupId, group]));
    const seen = new Set(),
        details = [];
    for (const run of runs) {
        const group = byGroup.get(run.caseId);
        if (
            !group ||
            run.enterprise !== group.enterprise ||
            String(run.workspaceId) !== group.workspaceId ||
            typeof run.arm !== "string"
        )
            throw Error("group_run_identity_mismatch");
        const identity = JSON.stringify([run.caseId, run.arm]);
        if (seen.has(identity)) throw Error("duplicate_group_arm");
        seen.add(identity);
        if (!Array.isArray(run.topics) || run.topics.length !== group.topics.length)
            throw Error("group_run_topic_mapping_invalid");
        const mapping = new Map(run.topics.map(topic => [topic.caseId, topic.topicId]));
        if (
            mapping.size !== group.topics.length ||
            new Set(mapping.values()).size !== mapping.size ||
            group.topics.some(
                topic =>
                    typeof mapping.get(topic.caseId) !== "string" ||
                    !mapping.get(topic.caseId).length
            )
        )
            throw Error("group_run_topic_mapping_invalid");
        const sources = run.selected ?? [];
        if (!Array.isArray(sources) || sources.some(source => typeof source.text !== "string"))
            throw Error("group_selected_evidence_invalid");
        const failed = !successful(run);
        const subBundle = {
            ...bundle,
            cases: group.topics.map(topic => bundle.cases[Number(topic.caseId) - 1]),
        };
        const inputs = group.topics.map((_topic, index) => ({
            ...run,
            caseId: String(index + 1),
            selected: failed ? [] : sources,
        }));
        const shared = scoreRetrieval(subBundle, corpus, inputs);
        const explicit =
            sources.length > 0 && sources.every(source => Array.isArray(source.topicIds));
        const attributed = explicit
            ? scoreRetrieval(
                  subBundle,
                  corpus,
                  inputs.map((input, index) => ({
                      ...input,
                      selected: input.selected.filter(source =>
                          source.topicIds.includes(mapping.get(group.topics[index].caseId))
                      ),
                  }))
              )
            : null;
        const attribution = run.topicAttribution;
        if (
            attribution !== undefined &&
            (attribution.level !== "document-version" ||
                attribution.provenance !== "exploration_submission_filtered_to_frozen_survivors" ||
                typeof attribution.observable !== "boolean" ||
                !Array.isArray(attribution.entries))
        )
            throw Error("group_document_assignments_invalid");
        const assignments = attribution?.observable ? attribution.entries : null;
        if (
            assignments?.some(
                entry =>
                    !Array.isArray(entry.topicIds) ||
                    entry.topicIds.some(id => ![...mapping.values()].includes(id))
            )
        )
            throw Error("group_document_assignment_topic_invalid");
        const frozen = new Set(sources.map(docKey));
        const topics = group.topics.map((topic, index) => {
            const topicId = mapping.get(topic.caseId);
            const tagged = sources.filter(source => source.topicIds?.includes(topicId));
            const assigned = assignments
                ? new Set(
                      assignments
                          .filter(
                              assignment =>
                                  assignment.topicIds.includes(topicId) &&
                                  frozen.has(docKey(assignment))
                          )
                          .map(docKey)
                  )
                : null;
            return {
                caseId: topic.caseId,
                topicId,
                sharedContext: topicMetrics(shared.details[index], sources, failed),
                explicitFrozenAttribution: attributed
                    ? topicMetrics(attributed.details[index], tagged, failed)
                    : null,
                modelAssignedFrozenDocuments: assigned
                    ? {
                          count: assigned.size,
                          zeroAttributedDocumentEvidence: assigned.size === 0,
                          basis: attribution.provenance,
                      }
                    : null,
            };
        });
        details.push({
            groupId: group.groupId,
            enterprise: group.enterprise,
            workspaceId: group.workspaceId,
            groupSize: group.topics.length,
            arm: run.arm,
            failed,
            failureCode:
                failed &&
                typeof run.failure === "string" &&
                /^[a-z][a-z0-9_:]{0,100}$/.test(run.failure)
                    ? run.failure
                    : failed
                      ? "unclassified"
                      : null,
            bytes: countBytes(sources),
            reportedFrozenBytesMatch:
                typeof run.frozenBytes === "number"
                    ? run.frozenBytes === countBytes(sources)
                    : null,
            sourceUnits: sources.length,
            explicitFrozenAttributionAvailable: explicit,
            topics,
        });
    }
    const arms = [...new Set(runs.map(run => run.arm))].sort();
    return {
        method: GROUP_SCORE_METHOD,
        methodSha256: GROUP_SCORE_METHOD_SHA256,
        details,
        summary: {
            schemaVersion: "vantage-grouped-retrieval-scores/1",
            methodSha256: GROUP_SCORE_METHOD_SHA256,
            expectedGroups: groups.length,
            runs: details.length,
            missingGroupArmResults: groups.length * arms.length - details.length,
            bySizeAndArm: Object.fromEntries(
                [3, 5].map(size => [
                    String(size),
                    Object.fromEntries(
                        arms.map(arm => [
                            arm,
                            rollup(
                                details.filter(row => row.groupSize === size && row.arm === arm)
                            ),
                        ])
                    ),
                ])
            ),
            byGroup: details.map(row => ({
                groupId: row.groupId,
                groupSize: row.groupSize,
                arm: row.arm,
                ...rollup([row]),
            })),
        },
    };
}
async function main() {
    const { values } = parseArgs({
        options: Object.fromEntries(
            ["labels", "corpus", "groups", "results", "local", "summary"].map(key => [
                key,
                { type: "string" },
            ])
        ),
    });
    if (Object.values(values).length !== 6) throw Error("group_score_paths_required");
    const [bundle, corpus, groups, raw] = await Promise.all(
        [values.labels, values.corpus, values.groups, values.results].map(async path =>
            JSON.parse(await readFile(path, "utf8"))
        )
    );
    const score = scoreGroups(bundle, corpus, groups, Array.isArray(raw) ? raw : raw.runs);
    await externalOutput(values.local, {
        method: score.method,
        methodSha256: score.methodSha256,
        details: score.details,
    });
    await externalOutput(values.summary, score.summary);
    console.log(JSON.stringify(score.summary));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(() => {
        console.error("group_score_failed");
        process.exitCode = 1;
    });
