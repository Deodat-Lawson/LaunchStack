import { readFile, writeFile, realpath, access } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname, basename, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

// This module is evaluator-only. Never import it from a retriever/provider.
export function normalizePassage(text) {
    return text
        .normalize("NFKC")
        .replace(/[\p{P}\p{Z}\s]+/gu, "")
        .toLocaleLowerCase("en-US");
}
export function matchPassage(text, passage) {
    if (text.includes(passage)) return "exact";
    const normalized = normalizePassage(passage);
    return normalized && normalizePassage(text).includes(normalized) ? "normalized" : null;
}
const key = (enterprise, filename) => JSON.stringify([enterprise, filename]);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const docKey = doc => JSON.stringify([String(doc.documentId), String(doc.versionId)]);

const enterpriseMappings = corpus =>
    corpus.enterprises ?? [
        ...new Map(
            corpus.documents.map(doc => [
                doc.enterprise,
                { enterprise: doc.enterprise, workspaceId: String(doc.companyId) },
            ])
        ).values(),
    ];

export function buildRequests(bundle, corpus) {
    const enterprises = new Map(
        enterpriseMappings(corpus).map(item => [item.enterprise, String(item.workspaceId)])
    );
    return bundle.cases.map((item, index) => {
        if (!enterprises.has(item.enterprise)) throw Error("request_enterprise_unmapped:" + index);
        return {
            caseId: String(index + 1),
            enterprise: item.enterprise,
            workspaceId: enterprises.get(item.enterprise),
            question: item.question,
        };
    });
}

export function scoreRetrieval(bundle, corpus, runs) {
    const documents = new Map();
    for (const doc of corpus.documents) {
        const identity = key(doc.enterprise, doc.filename);
        if (documents.has(identity)) throw Error("ambiguous_corpus_filename");
        documents.set(identity, doc);
    }
    const skipped = new Map(
        (corpus.skipped ?? []).map(doc => [key(doc.enterprise, doc.filename), doc])
    );
    const byCase = new Map(bundle.cases.map((item, index) => [String(index + 1), item]));
    const workspaces = new Map(
        enterpriseMappings(corpus).map(item => [item.enterprise, String(item.workspaceId)])
    );
    const details = [];
    const reproduction = new Map();
    const documentIdentities = new Map(
        corpus.documents.map(doc => [docKey(doc), [doc.enterprise, doc.filename, digest(doc.text)]])
    );
    const unmatched = [];
    let longQuestionCount = 0;
    const matches = new Map();
    for (const [caseId, item] of byCase) {
        if (item.question.length > 400) longQuestionCount++;
        matches.set(
            caseId,
            item.groundTruth.supportingFacts.map((fact, index) => {
                const doc = documents.get(key(item.enterprise, fact.filename));
                const skippedFile = skipped.get(key(item.enterprise, fact.filename));
                const match = doc ? matchPassage(doc.text, fact.text) : null;
                if (!match)
                    unmatched.push({
                        caseId,
                        benchmarkId: item.id,
                        enterprise: item.enterprise,
                        category: item.queryType,
                        factIndex: index,
                        reason: skippedFile
                            ? "skipped_non_text"
                            : doc
                              ? "passage_unmatched"
                              : "filename_unmapped",
                        format: skippedFile?.format ?? doc?.format ?? null,
                    });
                return { doc, match, passage: fact.text };
            })
        );
    }
    const seen = new Set();
    for (const run of runs) {
        const caseId = String(run.caseId);
        const item = byCase.get(caseId);
        if (
            !item ||
            run.enterprise !== item.enterprise ||
            String(run.workspaceId) !== workspaces.get(item.enterprise)
        )
            throw Error("result_case_identity_mismatch");
        const runKey = JSON.stringify([caseId, run.arm]);
        if (seen.has(runKey)) throw Error("duplicate_case_arm");
        seen.add(runKey);
        const facts = matches.get(caseId);
        const projection = {
            caseId,
            status: run.status,
            offered: (run.offered ?? []).map(
                doc => documentIdentities.get(docKey(doc)) ?? ["unmapped"]
            ),
            selected: (run.selected ?? []).map(doc => [
                documentIdentities.get(docKey(doc)) ?? ["unmapped"],
                doc.start ?? null,
                doc.end ?? null,
                digest(doc.text ?? ""),
            ]),
            frozenBytes: run.frozenBytes ?? 0,
        };
        if (!reproduction.has(run.arm)) reproduction.set(run.arm, []);
        reproduction.get(run.arm).push(projection);
        const offered = new Set((run.offered ?? []).map(docKey));
        const selected = run.selected ?? [];
        const selectedDocuments = new Set(selected.map(docKey));
        let matchedFacts = 0,
            offeredFacts = 0,
            selectedFacts = 0,
            coveredFacts = 0;
        let exactMatches = 0,
            normalizedMatches = 0;
        const factResults = [];
        for (const [factIndex, fact] of facts.entries()) {
            const factOffered = Boolean(fact.doc && offered.has(docKey(fact.doc)));
            const factSelected = Boolean(fact.doc && selectedDocuments.has(docKey(fact.doc)));
            const factCovered = Boolean(
                fact.match &&
                    selected.some(
                        doc =>
                            docKey(doc) === docKey(fact.doc) &&
                            typeof doc.text === "string" &&
                            matchPassage(doc.text, fact.passage)
                    )
            );
            factResults.push({
                factIndex,
                documentId: fact.doc?.documentId ?? null,
                versionId: fact.doc?.versionId ?? null,
                sourceMatch: fact.match,
                offered: factOffered,
                selected: factSelected,
                covered: factCovered,
            });
            if (factOffered) offeredFacts++;
            if (factSelected) selectedFacts++;
            if (!fact.match) continue;
            matchedFacts++;
            if (fact.match === "exact") exactMatches++;
            else normalizedMatches++;
            if (factCovered) coveredFacts++;
        }
        details.push({
            caseId,
            benchmarkId: item.id,
            enterprise: item.enterprise,
            category: item.queryType,
            arm: run.arm,
            reproductionHash: digest(projection),
            eligible: facts.every(fact => Boolean(fact.match)),
            factResults,
            totalFacts: facts.length,
            matchedFacts,
            exactMatches,
            normalizedMatches,
            offeredFacts,
            selectedFacts,
            coveredFacts,
            offeredDocuments: offered.size,
            selectedDocuments: selectedDocuments.size,
            selectedExcerpts: selected.filter(source => source.kind === "excerpt").length,
            frozenBytes: Number(run.frozenBytes ?? 0),
            generationAttempted: Boolean(run.generation),
            generationFailed: run.generation?.status === "failed",
            generationAccepted: run.generation?.status === "accepted",
            failed: !["ok", "accepted", "success"].includes(run.status),
            failureCode:
                run.failure?.code ??
                (typeof run.failure === "string" ? run.failure.split(":")[0] : null),
        });
    }
    const aggregate = attempts => {
        // Primary scores exclude the whole case when any supporting fact is unresolved.
        const rows = attempts.filter(row => row.eligible);
        const countFields = [
            "totalFacts",
            "matchedFacts",
            "exactMatches",
            "normalizedMatches",
            "offeredFacts",
            "selectedFacts",
            "coveredFacts",
            "offeredDocuments",
            "selectedDocuments",
            "selectedExcerpts",
            "frozenBytes",
        ];
        const totals = Object.fromEntries(
            countFields.map(field => [field, rows.reduce((sum, row) => sum + row[field], 0)])
        );
        return {
            cases: rows.length,
            excludedUnmatchedCases: attempts.length - rows.length,
            rawAttempts: attempts.length,
            rawAttemptFailures: attempts.filter(row => row.failed).length,
            rawAttemptGenerationAttempts: attempts.filter(row => row.generationAttempted).length,
            rawAttemptGenerationAccepted: attempts.filter(row => row.generationAccepted).length,
            rawAttemptGenerationFailures: attempts.filter(row => row.generationFailed).length,
            rawAttemptFrozenBytes: attempts.reduce((sum, row) => sum + row.frozenBytes, 0),
            rawAttemptOfferedDocuments: attempts.reduce(
                (sum, row) => sum + row.offeredDocuments,
                0
            ),
            rawAttemptSelectedDocuments: attempts.reduce(
                (sum, row) => sum + row.selectedDocuments,
                0
            ),
            rawAttemptSelectedExcerpts: attempts.reduce(
                (sum, row) => sum + row.selectedExcerpts,
                0
            ),
            failures: rows.filter(row => row.failed).length,
            generationAttempts: rows.filter(row => row.generationAttempted).length,
            generationFailures: rows.filter(row => row.generationFailed).length,
            generationAccepted: rows.filter(row => row.generationAccepted).length,
            fullyCoveredCases: rows.filter(row => row.coveredFacts === row.totalFacts).length,
            ...totals,
            maxFrozenBytes: Math.max(0, ...rows.map(row => row.frozenBytes)),
            meanFrozenBytes: rows.length ? totals.frozenBytes / rows.length : 0,
            meanOfferedDocuments: rows.length ? totals.offeredDocuments / rows.length : 0,
            meanSelectedDocuments: rows.length ? totals.selectedDocuments / rows.length : 0,
            meanSelectedExcerpts: rows.length ? totals.selectedExcerpts / rows.length : 0,
            factCoverage: totals.totalFacts ? totals.coveredFacts / totals.totalFacts : 0,
            matchedFactCoverage: totals.matchedFacts
                ? totals.coveredFacts / totals.matchedFacts
                : 0,
        };
    };
    const groups = field =>
        Object.fromEntries(
            [...new Set(details.map(row => row[field]))]
                .sort()
                .map(value => [value, aggregate(details.filter(row => row[field] === value))])
        );
    const arms = Object.fromEntries(
        [...new Set(details.map(row => row.arm))].sort().map(arm => {
            const rows = details.filter(row => row.arm === arm);
            return [
                arm,
                {
                    ...aggregate(rows),
                    reproductionHash: digest(
                        reproduction.get(arm).sort((a, b) => Number(a.caseId) - Number(b.caseId))
                    ),
                    byEnterprise: Object.fromEntries(
                        [...new Set(rows.map(row => row.enterprise))]
                            .sort()
                            .map(value => [
                                value,
                                aggregate(rows.filter(row => row.enterprise === value)),
                            ])
                    ),
                    byCategory: Object.fromEntries(
                        [...new Set(rows.map(row => row.category))]
                            .sort()
                            .map(value => [
                                value,
                                aggregate(rows.filter(row => row.category === value)),
                            ])
                    ),
                },
            ];
        })
    );
    const matchingGroups = field =>
        Object.fromEntries(
            [...new Set(bundle.cases.map(item => item[field]))].sort().map(value => {
                const groups = bundle.cases.flatMap((item, index) =>
                    item[field] === value ? [matches.get(String(index + 1))] : []
                );
                const eligible = groups.filter(facts => facts.every(fact => fact.match));
                return [
                    value,
                    {
                        cases: groups.length,
                        eligibleCases: eligible.length,
                        eligibleFacts: eligible.reduce((sum, facts) => sum + facts.length, 0),
                        totalFacts: groups.flat().length,
                        unmatchedFacts: groups.flat().filter(fact => !fact.match).length,
                    },
                ];
            })
        );
    const allMatches = [...matches.values()].flat();
    const formatCounts = {};
    for (const item of bundle.cases)
        for (const fact of item.groundTruth.supportingFacts) {
            const format = fact.filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "unknown";
            formatCounts[format] = (formatCounts[format] ?? 0) + 1;
        }
    const unmatchedReasons = Object.fromEntries(
        [...new Set(unmatched.map(item => item.reason))]
            .sort()
            .map(reason => [reason, unmatched.filter(item => item.reason === reason).length])
    );
    return {
        details,
        unmatched,
        summary: {
            schemaVersion: "vantage-rag-multi-corpus-scores/v1",
            caseCount: bundle.cases.length,
            resultCount: details.length,
            missingCaseArmResults:
                new Set(details.map(row => row.arm)).size * bundle.cases.length - details.length,
            longQuestionCount,
            corpusMatching: {
                strictEligibleCases: [...matches.values()].filter(facts =>
                    facts.every(item => item.match)
                ).length,
                strictEligibleFacts: [...matches.values()]
                    .filter(facts => facts.every(item => item.match))
                    .reduce((sum, facts) => sum + facts.length, 0),
                totalFacts: allMatches.length,
                exact: allMatches.filter(item => item.match === "exact").length,
                normalized: allMatches.filter(item => item.match === "normalized").length,
                formatCounts,
                byEnterprise: matchingGroups("enterprise"),
                byCategory: matchingGroups("queryType"),
            },
            unmatchedFacts: unmatched.length,
            unmatchedCases: new Set(unmatched.map(item => item.caseId)).size,
            skippedNonTextAffectedCases: new Set(
                unmatched
                    .filter(item => item.reason === "skipped_non_text")
                    .map(item => item.caseId)
            ).size,
            unmatchedReasons,
            zxBankSourceOfferDiagnostics: Object.fromEntries(
                [...new Set(details.map(row => row.arm))].sort().map(arm => {
                    const rows = details.filter(
                        row => row.arm === arm && row.enterprise === "ZX Bank"
                    );
                    return [
                        arm,
                        {
                            rawCasesWithSupportingDocumentNotOffered: rows.filter(
                                row => row.offeredFacts < row.totalFacts
                            ).length,
                            eligibleCasesWithSupportingDocumentNotOffered: rows.filter(
                                row => row.eligible && row.offeredFacts < row.totalFacts
                            ).length,
                            excludedUnmatchedCasesWithSupportingDocumentNotOffered: rows.filter(
                                row => !row.eligible && row.offeredFacts < row.totalFacts
                            ).length,
                        },
                    ];
                })
            ),
            arms,
            byEnterprise: groups("enterprise"),
            byCategory: groups("category"),
        },
    };
}

export async function externalOutput(path, value) {
    const root = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
    const parent = await realpath(dirname(resolve(path)));
    const target = join(parent, basename(path));
    const offset = relative(root, target);
    if (!offset || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(".." + sep)))
        throw Error("evaluation_output_must_be_external");
    let ancestor = parent;
    for (;;) {
        try {
            await access(join(ancestor, ".git"));
            throw Error("evaluation_output_must_be_outside_git_checkout");
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        const next = dirname(ancestor);
        if (next === ancestor) break;
        ancestor = next;
    }
    // Exclusive creation also rejects existing output files and final-path symlinks.
    await writeFile(target, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
async function main() {
    const { values } = parseArgs({
        options: {
            labels: { type: "string" },
            corpus: { type: "string" },
            requests: { type: "string" },
            results: { type: "string" },
            local: { type: "string" },
            summary: { type: "string" },
        },
    });
    if (!values.labels || !values.corpus) throw Error("labels_and_corpus_required");
    const bundle = JSON.parse(await readFile(values.labels, "utf8"));
    const corpus = JSON.parse(await readFile(values.corpus, "utf8"));
    if (values.requests) await externalOutput(values.requests, buildRequests(bundle, corpus));
    if (values.results) {
        if (!values.local || !values.summary) throw Error("score_output_paths_required");
        const raw = JSON.parse(await readFile(values.results, "utf8"));
        const scored = scoreRetrieval(bundle, corpus, Array.isArray(raw) ? raw : raw.runs);
        await externalOutput(values.local, {
            details: scored.details,
            unmatched: scored.unmatched,
        });
        await externalOutput(values.summary, scored.summary);
        console.log(JSON.stringify(scored.summary));
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
