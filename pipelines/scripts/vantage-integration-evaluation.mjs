/** Local, network-free integration demonstration. No --live option or provider setup. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
    runJosephOfflineScenario,
    OFFLINE_COMPOSITION_VERSION,
} from "../src/vantage/evaluation-integration/compose-offline.ts";
import { adaptV21Evaluation } from "../src/vantage/evaluation-integration/v21-adapter.ts";
import {
    evaluateVantage,
    aggregateEvaluations,
    renderEvaluationMarkdown,
} from "../src/vantage/validation/index.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output-dir"))
    throw new Error("Only --output-dir PATH is supported. Model calls are forbidden.");
const output = resolve(
    root,
    args[1] ??
        `test-output/vantage-joseph-sophia-eval-20261102/offline-${new Date().toISOString().replace(/[:.]/g, "-")}`
);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const json = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
const save = (file, value) =>
    writeFile(join(output, file), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const dataset = await json("fixtures/vantage-pipeline-edge-cases/semantic-cases.json");
const synthetic = await json("fixtures/vantage-integration-evaluation/offline-outputs.json");
const calls = [];
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => {
    calls.push("network-attempt");
    throw new Error("Network forbidden in offline integration.");
};
try {
    const reports = [],
        rows = [];
    let v21Base;
    for (const scenario of dataset.cases) {
        const response = synthetic.cases.find(item => item.scenarioId === scenario.id);
        if (!response) throw new Error(`Missing synthetic response ${scenario.id}`);
        const result = await runJosephOfflineScenario(scenario, response, {
            pipelineVersion: OFFLINE_COMPOSITION_VERSION,
        });
        await mkdir(join(output, scenario.id));
        await save(`${scenario.id}/composition.json`, result);
        if (result.outcome !== "evaluated")
            throw new Error(`Unexpected block for ${scenario.id}: ${result.message}`);
        await save(`${scenario.id}/generation-input-gold-free.json`, result.prepared);
        await save(`${scenario.id}/context-manifest.json`, result.manifest);
        await save(`${scenario.id}/evidence-snapshot.json`, result.evidenceSnapshot);
        await save(`${scenario.id}/synthetic-output.json`, result.output);
        await save(`${scenario.id}/evaluation-input-with-gold.json`, result.evaluationInput);
        await save(`${scenario.id}/evaluation-report.json`, result.evaluation);
        await save(`${scenario.id}/role-source-provenance.json`, result.sidecar);
        if (result.evaluation.integrityIssues.some(issue => issue.severity === "error"))
            throw new Error(`Integrity failure ${scenario.id}`);
        reports.push(result.evaluation);
        rows.push({
            id: scenario.id,
            documents: result.prepared.documents.length,
            expectations: result.evaluation.expectations.length,
            assessedExpectations: 0,
            integrityErrors: 0,
            verdict: result.evaluation.verdict,
            source: "hand-authored synthetic generation output",
            semanticJudge: "none",
            contextState: result.manifest.status,
        });
        if (scenario.id === "missing-denominator") v21Base = result;
    }
    const first = dataset.cases[0],
        response = synthetic.cases.find(item => item.scenarioId === first.id);
    const negatives = [];
    for (const fault of [
        "missing-required",
        "revoked-required",
        "unregistered-citation",
        "acl-changed-during-generation",
    ]) {
        const blocked = await runJosephOfflineScenario(first, response, { fault });
        if (
            blocked.outcome !== "blocked" ||
            blocked.mockPersistCalls !== 0 ||
            "evaluation" in blocked
        )
            throw new Error(`Fault not blocked: ${fault}`);
        if (
            ["missing-required", "revoked-required"].includes(fault) &&
            blocked.generatorCalls !== 0
        )
            throw new Error("Pre-generation failure invoked generation");
        negatives.push({ fault, ...blocked });
    }
    await save("negative-boundaries.json", negatives);
    const v21 = await json("fixtures/vantage-integration-evaluation/v21-presentation.json");
    if (!v21Base) throw new Error("Missing V2 fixture scenario");
    const bridge = adaptV21Evaluation(v21.report, {
        input: v21Base.evaluationInput,
        roleContext: v21Base.prepared.roleContext,
        sourceBindings: v21Base.prepared.documents.map(doc => ({
            alias: doc.originalId,
            ref: doc.source,
        })),
        roleMetadataAlreadyIncluded: true,
    });
    const supplemental = await evaluateVantage(bridge.supplementaryInput);
    if (supplemental.integrityIssues.some(issue => issue.severity === "error"))
        throw new Error("V2 supplementary integrity failed");
    await save("v21-bridge.json", bridge);
    await save("v21-supplementary-evaluation.json", supplemental);
    const files = [
        "fixtures/vantage-pipeline-edge-cases/cases.json",
        "fixtures/vantage-pipeline-edge-cases/semantic-cases.json",
        "fixtures/vantage-integration-evaluation/offline-outputs.json",
        "fixtures/vantage-integration-evaluation/v21-presentation.json",
        "pipelines/src/vantage/evaluation-integration/joseph-adapter.ts",
        "pipelines/src/vantage/evaluation-integration/v21-adapter.ts",
        "pipelines/src/vantage/evaluation-integration/compose-offline.ts",
        "pipelines/src/vantage/validation/input.ts",
        "pipelines/src/vantage/validation/evaluate.ts",
        "pipelines/scripts/vantage-integration-evaluation.mjs",
    ];
    const hashes = Object.fromEntries(
        await Promise.all(
            files.map(async file => [
                file,
                createHash("sha256")
                    .update(await readFile(resolve(root, file)))
                    .digest("hex"),
            ])
        )
    );
    const summary = {
        version: OFFLINE_COMPOSITION_VERSION,
        baseline: "284a5dc9ed6c5f65e2f9e0620107f7e0d33d1656",
        josephHead: "3afeb35dbefc817dfc9a7ea887c94424a047d061",
        sophiaHead: "2b0ce19fcf34f33d87d97276ad6c247c58abb4dd",
        mode: "offline-canned-generation-no-semantic-judge",
        rows,
        aggregate: aggregateEvaluations(reports),
        negativeBoundaries: negatives.length,
        v21: {
            fixtureOrigin: v21.origin,
            retainedFields: Object.keys(bridge.originalFields),
            evaluableUnits: bridge.units.length,
            verdict: supplemental.verdict,
            semanticScoresAssessed: 0,
        },
        providerCalls: 0,
        networkAttempts: calls.length,
        codeAndFixtureHashes: hashes,
        integrationBoundaryChecksPassed: true,
        completeModelE2EPass: false,
    };
    await save("summary.json", summary);
    await writeFile(join(output, "evaluation.md"), renderEvaluationMarkdown(reports), {
        flag: "wx",
    });
    console.log(
        JSON.stringify(
            {
                output,
                cases: rows.length,
                expectations: rows.reduce((n, row) => n + row.expectations, 0),
                deterministicIntegrityErrors: 0,
                semanticAssessed: 0,
                semanticVerdict: "needs-review",
                negativeBoundaries: negatives.length,
                providerCalls: 0,
                completeModelE2EPass: false,
            },
            null,
            2
        )
    );
} finally {
    globalThis.fetch = oldFetch;
}
