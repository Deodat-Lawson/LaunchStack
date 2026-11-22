import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { scoreRetrieval, externalOutput } from "./vantage-rag-multi-corpus-score.mjs";

export function distribution(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const middle = Math.floor(count / 2);
    return {
        samples: count,
        total: sorted.reduce((sum, value) => sum + value, 0),
        median: count
            ? count % 2
                ? sorted[middle]
                : (sorted[middle - 1] + sorted[middle]) / 2
            : null,
        p90: count ? sorted[Math.ceil(count * 0.9) - 1] : null,
        min: count ? sorted[0] : null,
        max: count ? sorted[count - 1] : null,
    };
}

/** Validates the evidence-byte accounting without loading any provider or database. */
export function measureFrozenRun(run) {
    const selected = run.selected ?? [];
    const selectedBytes = selected.reduce((sum, source) => {
        if (typeof source.text !== "string") throw Error("selected_text_missing");
        return sum + Buffer.byteLength(source.text, "utf8");
    }, 0);
    const snapshotSources = run.snapshot?.sources;
    const bytes = snapshotSources
        ? snapshotSources.reduce((sum, source) => {
              if (typeof source.text !== "string") throw Error("snapshot_text_missing");
              return sum + Buffer.byteLength(source.text, "utf8");
          }, 0)
        : selectedBytes;
    if (
        !Number.isSafeInteger(run.frozenBytes) ||
        run.frozenBytes < 0 ||
        bytes !== run.frozenBytes ||
        bytes !== selectedBytes
    )
        throw Error("frozen_utf8_byte_mismatch");
    if (snapshotSources && snapshotSources.length !== selected.length)
        throw Error("frozen_source_registry_mismatch");
    const documents = new Set(
        selected.map(source =>
            JSON.stringify([String(source.documentId), String(source.versionId)])
        )
    ).size;
    const excerpts = selected.filter(source => source.kind === "excerpt").length;
    return { bytes, documents, excerpts, hasSnapshot: Boolean(snapshotSources) || bytes > 0 };
}

const density = (hits, rows, cohort) => {
    const bytes = rows.reduce((sum, row) => sum + row.measurement.bytes, 0);
    return {
        recoveredFacts: hits,
        denominatorCohort: cohort,
        snapshotCases: rows.length,
        frozenUtf8Bytes: bytes,
        frozenKB1000: bytes / 1000,
        recoveredFactsPerKB1000: bytes ? (hits * 1000) / bytes : null,
    };
};
const cohortMeasurements = rows => ({
    cases: rows.length,
    snapshots: rows.filter(row => row.measurement.hasSnapshot).length,
    failures: rows.filter(row => row.failed).length,
    frozenUtf8Bytes: distribution(rows.map(row => row.measurement.bytes)),
    documents: distribution(rows.map(row => row.measurement.documents)),
    excerpts: distribution(rows.map(row => row.measurement.excerpts)),
});

export function retrievalEfficiency(bundle, corpus, runs) {
    const scored = scoreRetrieval(bundle, corpus, runs);
    const measurements = new Map(
        runs.map(run => [JSON.stringify([String(run.caseId), run.arm]), measureFrozenRun(run)])
    );
    const details = scored.details.map(row => ({
        ...row,
        measurement: measurements.get(JSON.stringify([row.caseId, row.arm])),
    }));
    function aggregate(rows, recall) {
        const strict = rows.filter(row => row.eligible);
        const resolved = rows.filter(row => row.factResults.some(fact => fact.filenameResolved));
        const token = recall.lenientFrozenTokenRecall.thresholds;
        return {
            allRuns: cohortMeasurements(rows),
            strictEligible: cohortMeasurements(strict),
            filenameResolvedCases: cohortMeasurements(resolved),
            strictRecall: recall.strictPassageRecall,
            documentRecall: recall.resolvedDocumentRecall,
            lenientRecall: recall.lenientFrozenTokenRecall,
            pooledEfficiency: {
                strictPaired: density(
                    recall.strictPassageRecall.coveredFacts,
                    strict,
                    "strict eligible cases"
                ),
                strictOverAllRuns: density(
                    recall.strictPassageRecall.coveredFacts,
                    rows,
                    "all attempted cases"
                ),
                lenient80Paired: density(
                    token["0.8"].coveredFacts,
                    resolved,
                    "cases with at least one filename-resolved fact"
                ),
                lenient90Paired: density(
                    token["0.9"].coveredFacts,
                    resolved,
                    "cases with at least one filename-resolved fact"
                ),
                lenient80OverAllRuns: density(
                    token["0.8"].coveredFacts,
                    rows,
                    "all attempted cases"
                ),
                lenient90OverAllRuns: density(
                    token["0.9"].coveredFacts,
                    rows,
                    "all attempted cases"
                ),
            },
        };
    }
    const arms = Object.fromEntries(
        Object.entries(scored.summary.arms).map(([arm, recall]) => {
            const rows = details.filter(row => row.arm === arm);
            return [
                arm,
                {
                    ...aggregate(rows, recall),
                    byEnterprise: Object.fromEntries(
                        Object.entries(recall.byEnterprise).map(([name, group]) => [
                            name,
                            aggregate(
                                rows.filter(row => row.enterprise === name),
                                group
                            ),
                        ])
                    ),
                    byCategory: Object.fromEntries(
                        Object.entries(recall.byCategory).map(([name, group]) => [
                            name,
                            aggregate(
                                rows.filter(row => row.category === name),
                                group
                            ),
                        ])
                    ),
                },
            ];
        })
    );
    return {
        schemaVersion: "vantage-rag-retrieval-efficiency/v1",
        methods: {
            evidenceBytes:
                "Sum of UTF8 bytes of all frozen source text, including fixed sources. Verified against both snapshot and selected-source accounting.",
            documents:
                "Distinct document/version pairs among frozen selected sources, including fixed sources.",
            excerpts:
                "Selected source units with kind=excerpt; full documents are excluded from this count.",
            median: "Middle value, or arithmetic mean of the two middle values for even sample sizes.",
            p90: "Nearest rank, sorted value at ceil(0.90*n), with one-based ranks.",
            efficiency:
                "Pooled recovered supporting-fact occurrences divided by pooled frozen bytes/1000; never an average of case-level ratios. Repeated facts across questions retain their benchmark occurrence weights.",
            strict: "Existing exact/normalized whole-case eligibility and recall, unchanged.",
            lenient:
                "Existing same-document/version, single-unit best-window lexical token recall at 0.8 and 0.9, unchanged.",
            failedAttempts:
                "Retained in all-run measurements. A failed capture with no frozen evidence contributes zero bytes, documents and excerpts.",
            zeroByteDenominator:
                "Efficiency is null when the denominator contains zero frozen bytes.",
        },
        caseCount: scored.summary.caseCount,
        resultCount: scored.summary.resultCount,
        missingCaseArmResults: scored.summary.missingCaseArmResults,
        sourceVerification: scored.summary.corpusMatching,
        arms,
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            labels: { type: "string" },
            corpus: { type: "string" },
            capture: { type: "string", multiple: true },
            output: { type: "string" },
        },
    });
    if (!values.labels || !values.corpus || !values.capture?.length || !values.output)
        throw Error("labels_corpus_capture_output_required");
    const labels = await readFile(values.labels);
    const corpus = await readFile(values.corpus);
    const captures = await Promise.all(
        values.capture.map(async path => {
            const bytes = await readFile(path);
            const raw = JSON.parse(bytes.toString("utf8"));
            return {
                name: basename(path),
                sha256: createHash("sha256").update(bytes).digest("hex"),
                runs: raw.runs ?? raw,
            };
        })
    );
    const result = retrievalEfficiency(
        JSON.parse(labels.toString("utf8")),
        JSON.parse(corpus.toString("utf8")),
        captures.flatMap(capture => capture.runs)
    );
    result.inputs = {
        labelsSha256: createHash("sha256").update(labels).digest("hex"),
        corpusSha256: createHash("sha256").update(corpus).digest("hex"),
        captures: captures.map(({ name, sha256 }) => ({ name, sha256 })),
    };
    await externalOutput(values.output, result);
    console.log(
        JSON.stringify({
            output: basename(values.output),
            cases: result.caseCount,
            results: result.resultCount,
            arms: Object.keys(result.arms),
        })
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
