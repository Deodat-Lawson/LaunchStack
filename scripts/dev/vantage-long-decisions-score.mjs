// Offline label-bearing evaluator. Never import this module from providers or application code.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { externalOutput } from "./vantage-rag-multi-corpus-score.mjs";

const distractorTypes = Object.freeze([
    "outdated_version",
    "similar_wrong_definition",
    "denied_document",
]);
const declaredArms = Object.freeze([
    Object.freeze({ name: "seeds-only", kind: "deterministic" }),
    Object.freeze({ name: "seeds-windows", kind: "deterministic" }),
    Object.freeze({ name: "live", kind: "live" }),
    Object.freeze({ name: "live+backfill", kind: "live" }),
    Object.freeze({ name: "live-docs+windows", kind: "live" }),
]);
const declaredCaps = Object.freeze([16000, 32000, 80000]);
export const LONG_DECISIONS_SCORE_METHOD = Object.freeze({
    schemaVersion: "long-decisions/scoring-method-v1",
    sentenceSegmentation:
        "Intl.Segmenter en sentence boundaries; boundary whitespace trimmed; internal source text unchanged",
    strict: "Each expected sentence must be an exact substring of one frozen unit with the exact labelled documentId and versionId; no normalization or cross-unit concatenation",
    anchor: "Full exact anchor blocks are also scored independently",
    document:
        "Unique labelled document IDs; a selected unit must match a labelled version; distinct document/version coverage is also reported",
    failure: "Failed attempts retain denominator occurrences and receive zero support credit",
    overlap:
        "Group membership is authoritative and may repeat cases; occurrence and unique case counts are separate",
    leakage:
        "Denied document IDs at offered/frozen boundaries are disclosures; explored entries count as disclosures only when disclosed=true; denied attempts remain separate",
    bytes: "Actual frozen source text in UTF-8, counted once per run",
    distractorTypes,
    caps: declaredCaps,
    arms: declaredArms,
    statuses: Object.freeze(["completed", "degraded", "failed"]),
    degraded:
        "Usable degraded freezes retain evidence credit and are reported separately; only failed attempts receive zero support",
    lineage:
        "Live variants share one nonempty executionId per group/cap; completed live triples require all three completed variants",
});
export const LONG_DECISIONS_SCORE_METHOD_SHA256 = createHash("sha256")
    .update(JSON.stringify(LONG_DECISIONS_SCORE_METHOD))
    .digest("hex");
const key = source => JSON.stringify([String(source.documentId), String(source.versionId)]);
const success = run => ["completed", "degraded"].includes(run.status);
const sum = values => values.reduce((a, b) => a + b, 0);
const safeCode = value =>
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_:]{0,120}$/.test(value)
        ? value
        : "unclassified";
export function exactSentences(text) {
    if (typeof text !== "string" || !text.trim()) throw Error("long_score_anchor_text_invalid");
    return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
        .map(item => item.segment.trim())
        .filter(Boolean);
}
function distribution(values) {
    const sorted = [...values].sort((a, b) => a - b),
        n = sorted.length,
        mid = Math.floor(n / 2);
    return {
        n,
        total: sum(values),
        min: n ? sorted[0] : null,
        median: n ? (n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null,
        p90: n ? sorted[Math.ceil(n * 0.9) - 1] : null,
        max: n ? sorted.at(-1) : null,
    };
}
function specIndexes(spec) {
    if (
        spec.schemaVersion !== "long-decisions/spec-v1" ||
        !Array.isArray(spec.documents) ||
        !Array.isArray(spec.cases) ||
        !Array.isArray(spec.groups)
    )
        throw Error("long_score_spec_invalid");
    const documents = new Map(),
        versions = new Map(),
        anchors = new Map(),
        cases = new Map(),
        groups = new Map();
    for (const document of spec.documents) {
        if (
            documents.has(document.id) ||
            !["actor_readable", "denied"].includes(document.visibility) ||
            !Array.isArray(document.versions)
        )
            throw Error("long_score_document_invalid");
        documents.set(document.id, document);
        for (const version of document.versions) {
            const identity = key({ documentId: document.id, versionId: version.id });
            if (versions.has(identity) || !Array.isArray(version.anchors))
                throw Error("long_score_version_invalid");
            versions.set(identity, version);
            for (const anchor of version.anchors) {
                if (anchors.has(anchor.id)) throw Error("long_score_anchor_duplicate");
                anchors.set(anchor.id, {
                    documentId: document.id,
                    versionId: version.id,
                    text: anchor.text,
                    sentences: exactSentences(anchor.text),
                });
            }
        }
    }
    for (const item of spec.cases) {
        if (
            cases.has(item.id) ||
            !["dev", "heldout"].includes(item.split) ||
            !Array.isArray(item.evidence) ||
            !item.evidence.length ||
            !Array.isArray(item.distractors)
        )
            throw Error("long_score_case_invalid");
        for (const ref of item.evidence) {
            const anchor = anchors.get(ref.anchorId);
            if (!anchor || key(anchor) !== key(ref))
                throw Error("long_score_evidence_lineage_invalid");
        }
        for (const ref of item.distractors)
            if (
                !distractorTypes.includes(ref.type) ||
                !versions.has(key(ref)) ||
                (ref.anchorId && key(anchors.get(ref.anchorId) ?? {}) !== key(ref))
            )
                throw Error("long_score_distractor_invalid");
        cases.set(item.id, item);
    }
    for (const group of spec.groups) {
        if (
            groups.has(group.id) ||
            group.weekId !== "w3" ||
            ![3, 5].includes(group.size) ||
            !Array.isArray(group.caseIds) ||
            group.caseIds.length !== group.size ||
            new Set(group.caseIds).size !== group.size ||
            group.caseIds.some(id => !cases.has(id) || cases.get(id).split !== group.split)
        )
            throw Error("long_score_group_invalid");
        groups.set(group.id, group);
    }
    return { documents, versions, anchors, cases, groups };
}
function evaluateTopic(item, indexes, selected, failed) {
    const selectedVersions = new Set(selected.map(key));
    const expectedVersions = new Set(item.evidence.map(key));
    const expectedDocuments = new Set(item.evidence.map(ref => ref.documentId));
    const supportedDocuments = new Set(
        item.evidence
            .filter(ref => !failed && selectedVersions.has(key(ref)))
            .map(ref => ref.documentId)
    );
    const evidence = item.evidence.map(ref => {
        const anchor = indexes.anchors.get(ref.anchorId),
            units = selected.filter(source => key(source) === key(ref));
        return {
            anchorId: ref.anchorId,
            sentences: anchor.sentences.length,
            coveredSentences: failed
                ? 0
                : anchor.sentences.filter(sentence =>
                      units.some(unit => unit.text.includes(sentence))
                  ).length,
            blockCovered: !failed && units.some(unit => unit.text.includes(anchor.text)),
        };
    });
    const distractors = Object.fromEntries(
        distractorTypes.map(type => {
            const targets = new Set(item.distractors.filter(ref => ref.type === type).map(key));
            return [
                type,
                {
                    expected: targets.size,
                    selected: [...targets].filter(id => selectedVersions.has(id)).length,
                },
            ];
        })
    );
    const sentences = sum(evidence.map(row => row.sentences)),
        coveredSentences = sum(evidence.map(row => row.coveredSentences));
    return {
        caseId: item.id,
        expectedDocuments: expectedDocuments.size,
        selectedDocuments: supportedDocuments.size,
        expectedDocumentVersions: expectedVersions.size,
        selectedDocumentVersions: failed
            ? 0
            : [...expectedVersions].filter(id => selectedVersions.has(id)).length,
        expectedSentences: sentences,
        coveredSentences,
        expectedAnchorBlocks: evidence.length,
        coveredAnchorBlocks: evidence.filter(row => row.blockCovered).length,
        zeroSupportingDocuments: supportedDocuments.size === 0,
        zeroEvidenceSentences: coveredSentences === 0,
        allEvidenceSentencesCovered: coveredSentences === sentences,
        distractors,
    };
}
function auditBoundaries(run, indexes) {
    const denied = source => indexes.documents.get(source.documentId)?.visibility === "denied";
    const count = sources => ({
        events: sources.filter(denied).length,
        uniqueDocumentVersions: new Set(sources.filter(denied).map(key)).size,
    });
    const explored = run.explored ?? [];
    if (
        explored.some(
            event =>
                !["digest", "read"].includes(event.tool) || typeof event.disclosed !== "boolean"
        )
    )
        throw Error("long_score_exploration_audit_invalid");
    return {
        explorationAuditAvailable:
            Array.isArray(run.explored) || run.provenance.kind === "deterministic",
        offered: count(run.offered ?? []),
        digests: count(explored.filter(row => row.tool === "digest" && row.disclosed)),
        reads: count(explored.filter(row => row.tool === "read" && row.disclosed)),
        frozen: count(run.selected ?? []),
        blockedRestrictedAttempts: explored.filter(row => !row.disclosed && denied(row)).length,
    };
}
function aggregate(rows) {
    const topics = rows.flatMap(row => row.topics);
    const metric = (expected, selected, numerator = "selected") => ({
        expected: sum(topics.map(row => row[expected])),
        [numerator]: sum(topics.map(row => row[selected])),
        recall: sum(topics.map(row => row[expected]))
            ? sum(topics.map(row => row[selected])) / sum(topics.map(row => row[expected]))
            : null,
    });
    return {
        runs: rows.length,
        completed: rows.filter(row => row.status === "completed").length,
        degraded: rows.filter(row => row.status === "degraded").length,
        failures: rows.filter(row => row.failed).length,
        topicOccurrences: topics.length,
        uniqueCases: new Set(topics.map(row => row.caseId)).size,
        supportingDocuments: metric("expectedDocuments", "selectedDocuments"),
        supportingDocumentVersions: metric("expectedDocumentVersions", "selectedDocumentVersions"),
        strictEvidenceSentences: metric("expectedSentences", "coveredSentences", "covered"),
        strictAnchorBlocks: metric("expectedAnchorBlocks", "coveredAnchorBlocks", "covered"),
        topicsWithoutSupportingDocuments: topics.filter(row => row.zeroSupportingDocuments).length,
        topicsWithoutEvidenceSentences: topics.filter(row => row.zeroEvidenceSentences).length,
        fullyCoveredTopics: topics.filter(row => row.allEvidenceSentencesCovered).length,
        distractors: Object.fromEntries(
            distractorTypes.map(type => [
                type,
                {
                    expectedOccurrences: sum(topics.map(row => row.distractors[type].expected)),
                    selectedOccurrences: sum(topics.map(row => row.distractors[type].selected)),
                },
            ])
        ),
        restrictedLeaks: Object.fromEntries(
            ["offered", "digests", "reads", "frozen"].map(stage => [
                stage,
                {
                    events: sum(rows.map(row => row.boundaries[stage].events)),
                    documentVersionOccurrences: sum(
                        rows.map(row => row.boundaries[stage].uniqueDocumentVersions)
                    ),
                },
            ])
        ),
        blockedRestrictedAttempts: sum(rows.map(row => row.boundaries.blockedRestrictedAttempts)),
        missingExplorationAuditRuns: rows.filter(row => !row.boundaries.explorationAuditAvailable)
            .length,
        frozenBytes: distribution(rows.map(row => row.bytes)),
        failureCodes: Object.fromEntries(
            [...new Set(rows.filter(row => row.failed).map(row => row.failureCode))].map(code => [
                code,
                rows.filter(row => row.failed && row.failureCode === code).length,
            ])
        ),
    };
}

export function scoreLongDecisions(spec, runs, contract) {
    const indexes = specIndexes(spec);
    if (
        !contract ||
        !Array.isArray(contract.caps) ||
        contract.caps.length !== 3 ||
        new Set(contract.caps).size !== 3 ||
        contract.caps.some(cap => !declaredCaps.includes(cap)) ||
        !Array.isArray(contract.arms) ||
        contract.arms.length !== 5 ||
        new Set(contract.arms.map(arm => arm.name)).size !== 5 ||
        contract.arms.some(
            arm =>
                !declaredArms.some(
                    expected => expected.name === arm.name && expected.kind === arm.kind
                )
        ) ||
        contract.sourceUnits !== 16
    )
        throw Error("long_score_contract_invalid");
    if (!Array.isArray(runs)) throw Error("long_score_runs_invalid");
    const seen = new Set(),
        details = [],
        executions = new Map();
    for (const run of runs) {
        const group = indexes.groups.get(run.groupId),
            arm = contract.arms.find(arm => arm.name === run.arm);
        if (
            !group ||
            run.split !== group.split ||
            run.weekId !== group.weekId ||
            !contract.caps.includes(run.capBytes) ||
            !arm ||
            run.provenance?.kind !== arm.kind ||
            !LONG_DECISIONS_SCORE_METHOD.statuses.includes(run.status)
        )
            throw Error("long_score_run_identity_invalid");
        if (arm.kind === "live") {
            if (typeof run.provenance.executionId !== "string" || !run.provenance.executionId)
                throw Error("long_score_live_execution_invalid");
            const executionKey = JSON.stringify([run.groupId, run.capBytes]);
            if (
                executions.has(executionKey) &&
                executions.get(executionKey) !== run.provenance.executionId
            )
                throw Error("long_score_live_execution_mismatch");
            executions.set(executionKey, run.provenance.executionId);
        }
        const identity = JSON.stringify([run.groupId, run.capBytes, run.arm]);
        if (seen.has(identity)) throw Error("long_score_duplicate_run");
        seen.add(identity);
        if (
            !Array.isArray(run.selected) ||
            !Array.isArray(run.offered) ||
            (run.explored !== undefined && !Array.isArray(run.explored)) ||
            run.selected.some(
                source =>
                    typeof source.text !== "string" ||
                    (source.topicIds !== undefined &&
                        (!Array.isArray(source.topicIds) ||
                            source.topicIds.some(id => typeof id !== "string")))
            )
        )
            throw Error("long_score_sources_invalid");
        if (
            [
                ...run.selected,
                ...run.offered,
                ...(run.explored ?? []).filter(row => row.disclosed),
            ].some(source => !indexes.versions.has(key(source)))
        )
            throw Error("long_score_source_version_unknown");
        const bytes = sum(run.selected.map(source => Buffer.byteLength(source.text, "utf8")));
        if (bytes > run.capBytes || run.selected.length > contract.sourceUnits)
            throw Error("long_score_frozen_cap_violation");
        const failed = !success(run);
        const topicMapping = new Map(
            (run.topics ?? []).map(topic => [topic.caseId, topic.topicId])
        );
        if (
            run.topics !== undefined &&
            (topicMapping.size !== group.size ||
                group.caseIds.some(id => typeof topicMapping.get(id) !== "string"))
        )
            throw Error("long_score_topic_mapping_invalid");
        const topics = group.caseIds.map(id => {
            const topic = evaluateTopic(indexes.cases.get(id), indexes, run.selected, failed),
                topicId = topicMapping.get(id);
            const observable =
                topicId !== undefined &&
                run.selected.some(source => Array.isArray(source.topicIds));
            return {
                ...topic,
                attributedEvidence: observable
                    ? evaluateTopic(
                          indexes.cases.get(id),
                          indexes,
                          run.selected.filter(source => source.topicIds?.includes(topicId)),
                          failed
                      )
                    : null,
            };
        });
        details.push({
            groupId: group.id,
            split: group.split,
            size: group.size,
            capBytes: run.capBytes,
            arm: run.arm,
            status: run.status,
            failed,
            failureCode: failed ? safeCode(run.failure) : null,
            provenanceKind: arm.kind,
            executionId: arm.kind === "live" ? run.provenance.executionId : null,
            bytes,
            sourceUnits: run.selected.length,
            boundaries: auditBoundaries(run, indexes),
            topics,
        });
    }
    const cells = [];
    for (const split of [...new Set(spec.groups.map(group => group.split))])
        for (const cap of contract.caps)
            for (const size of [...new Set(spec.groups.map(group => group.size))])
                for (const arm of contract.arms) {
                    const expected = spec.groups.filter(
                            group => group.split === split && group.size === size
                        ),
                        observed = details.filter(
                            row =>
                                row.split === split &&
                                row.size === size &&
                                row.capBytes === cap &&
                                row.arm === arm.name
                        );
                    cells.push({
                        split,
                        capBytes: cap,
                        size,
                        arm: arm.name,
                        provenanceKind: arm.kind,
                        expectedGroups: expected.length,
                        observedGroups: observed.length,
                        missingGroups: expected.length - observed.length,
                        failuresIncluded: aggregate(observed),
                        failuresExcluded: aggregate(observed.filter(row => !row.failed)),
                    });
                }
    const configurationSha256 = createHash("sha256")
        .update(JSON.stringify({ method: LONG_DECISIONS_SCORE_METHOD, contract }))
        .digest("hex");
    const triples = [];
    for (const group of spec.groups)
        for (const cap of contract.caps) {
            const variants = details.filter(
                row =>
                    row.groupId === group.id &&
                    row.capBytes === cap &&
                    row.provenanceKind === "live"
            );
            if (!variants.length) continue;
            triples.push({
                split: group.split,
                size: group.size,
                capBytes: cap,
                observedVariants: variants.length,
                status:
                    variants.length < 3
                        ? "incomplete"
                        : variants.some(row => row.failed)
                          ? "failed"
                          : variants.some(row => row.status === "degraded")
                            ? "degraded"
                            : "completed",
            });
        }
    return {
        method: LONG_DECISIONS_SCORE_METHOD,
        methodSha256: LONG_DECISIONS_SCORE_METHOD_SHA256,
        configurationSha256,
        details,
        summary: {
            schemaVersion: "long-decisions/scores-v1",
            methodSha256: LONG_DECISIONS_SCORE_METHOD_SHA256,
            configurationSha256,
            observedRuns: details.length,
            segmentationRuntime: { node: process.versions.node, icu: process.versions.icu },
            cells,
            liveTriples: triples,
        },
    };
}
async function main() {
    const { values } = parseArgs({
        options: {
            spec: { type: "string" },
            contract: { type: "string" },
            results: { type: "string", multiple: true },
            local: { type: "string" },
            summary: { type: "string" },
        },
    });
    if (
        !values.spec ||
        !values.contract ||
        !values.results?.length ||
        !values.local ||
        !values.summary
    )
        throw Error("long_score_paths_required");
    const spec = JSON.parse(await readFile(values.spec, "utf8")),
        contract = JSON.parse(await readFile(values.contract, "utf8"));
    const runs = (
        await Promise.all(
            values.results.map(async path => {
                const raw = JSON.parse(await readFile(path, "utf8"));
                return Array.isArray(raw) ? raw : raw.runs;
            })
        )
    ).flat();
    const scored = scoreLongDecisions(spec, runs, contract);
    await externalOutput(values.local, {
        method: scored.method,
        configurationSha256: scored.configurationSha256,
        runs: scored.details,
    });
    await externalOutput(values.summary, scored.summary);
    console.log(
        JSON.stringify({
            methodSha256: scored.methodSha256,
            configurationSha256: scored.configurationSha256,
            observedRuns: runs.length,
            cells: scored.summary.cells.length,
        })
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(() => {
        console.error("long_decisions_score_failed");
        process.exitCode = 1;
    });
