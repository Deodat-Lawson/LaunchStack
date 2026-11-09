/** Read-only validation runner. No .env loading, implicit model, generation or database writes. */
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createChatModelsConfig, resolveChatModel } from "@launchstack/llm";
import {
    RUBRIC_VERSION,
    parseEvaluationInput,
    normalizeVantageOutput,
    evaluateVantage,
    createModelValidationJudge,
    createRecordedValidationJudge,
    aggregateEvaluations,
    renderEvaluationMarkdown,
} from "../src/vantage/validation/index.ts";

const args = process.argv.slice(2);
const flags = new Set();
const values = new Map();
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--demo", "--live", "--checks-only", "--json", "--help"].includes(arg)) {
        if (flags.has(arg)) throw new Error(`Duplicate option ${arg}`);
        flags.add(arg);
    } else if (
        [
            "--input",
            "--scenario",
            "--actual",
            "--candidate-id",
            "--pipeline-version",
            "--output-dir",
        ].includes(arg)
    ) {
        if (values.has(arg) || !args[i + 1] || args[i + 1].startsWith("--"))
            throw new Error(`Missing or duplicate value for ${arg}`);
        values.set(arg, args[++i]);
    } else throw new Error(`Unknown option ${arg}`);
}
if (flags.has("--help")) {
    console.log(`Usage:
  pnpm --filter @launchstack/pipelines demo:validation
  pnpm --filter @launchstack/pipelines evaluate:vantage --input /absolute/suite.json --checks-only
  pnpm --filter @launchstack/pipelines evaluate:vantage --scenario /absolute/scenario.json --actual /absolute/report.json --candidate-id run-1 --pipeline-version commit-sha --live --output-dir /absolute/new-results

--demo replays pinned hand-authored synthetic judgments; it makes no model calls.
Without --live only deterministic integrity checks run; semantic scores remain null.
--live requires CHAT_BASE_URL, CHAT_API_KEY and CHAT_MODELS_CONFIG explicitly set.
Input is a versioned suite of up to 20 scenarios, or one scenario plus saved Vantage output.
Exit: 0 all passed, 1 any failed, 2 needs review/unavailable. Reports never overwrite existing files.`);
    process.exit(0);
}
if (["--live", "--demo", "--checks-only"].filter(flag => flags.has(flag)).length > 1)
    throw new Error("Choose live, demo, or checks-only mode.");
if (
    Number(flags.has("--demo")) +
        Number(values.has("--input")) +
        Number(values.has("--scenario")) !==
    1
)
    throw new Error("Choose exactly one of --demo, --input or --scenario.");
if (
    !values.has("--scenario") &&
    ["--actual", "--candidate-id", "--pipeline-version"].some(flag => values.has(flag))
)
    throw new Error("Report identity options require --scenario.");
async function readJson(path) {
    if ((await stat(path)).size > 1024 * 1024) throw new Error("Input file exceeds 1 MiB.");
    return JSON.parse(await readFile(path, "utf8"));
}
let inputs;
let judge;
if (flags.has("--demo")) {
    const fixture = await readJson(
        new URL("../../fixtures/vantage-validation/demo.json", import.meta.url)
    );
    inputs = fixture.cases.map(item => item.input);
    judge = createRecordedValidationJudge(
        fixture.cases.map(item => ({
            inputFingerprint: item.inputFingerprint,
            rubricVersion: RUBRIC_VERSION,
            judgment: item.judgment,
        }))
    );
} else if (values.has("--scenario")) {
    if (!["--actual", "--candidate-id", "--pipeline-version"].every(flag => values.has(flag)))
        throw new Error("Scenario mode needs --actual, --candidate-id and --pipeline-version.");
    inputs = [
        {
            version: "vantage-evaluation/v1",
            scenario: await readJson(values.get("--scenario")),
            actual: normalizeVantageOutput(await readJson(values.get("--actual")), {
                id: values.get("--candidate-id"),
                pipelineVersion: values.get("--pipeline-version"),
            }),
        },
    ];
} else {
    const suite = await readJson(values.get("--input"));
    if (suite.version !== "vantage-evaluation-suite/v1" || !Array.isArray(suite.inputs))
        throw new Error("Invalid evaluation suite.");
    inputs = suite.inputs;
}
if (!inputs.length || inputs.length > 20) throw new Error("Use 1–20 cases per invocation.");
// Validate all cases before the first possible paid call, with no silent truncation.
inputs = inputs.map(parseEvaluationInput);
if (new Set(inputs.map(input => input.actual.pipelineVersion)).size !== 1)
    throw new Error(
        "Evaluate each pipeline version in a separate suite for comparable aggregation."
    );
if (new Set(inputs.map(input => `${input.scenario.id}/${input.actual.id}`)).size !== inputs.length)
    throw new Error("Duplicate scenario/candidate pair.");
if (flags.has("--live")) {
    const {
        CHAT_BASE_URL: baseUrl,
        CHAT_API_KEY: apiKey,
        CHAT_MODELS_CONFIG: configPath,
    } = process.env;
    if (!baseUrl || !apiKey || !configPath)
        throw new Error(
            "Live evaluation requires explicit CHAT_BASE_URL, CHAT_API_KEY and CHAT_MODELS_CONFIG. No provider called."
        );
    const yaml = await readFile(configPath, "utf8");
    const config = createChatModelsConfig({ yaml, endpoint: { baseUrl, apiKey } });
    const model = resolveChatModel({
        config,
        route: "default",
        maxOutputTokens: 4096,
        timeoutMs: 20000,
    });
    const configurationId = createHash("sha256")
        .update(JSON.stringify({ yaml, baseUrl, maxOutputTokens: 4096, timeoutMs: 20000 }))
        .digest("hex");
    judge = createModelValidationJudge(model, { configurationId });
}
const destination = values.has("--output-dir") ? resolve(values.get("--output-dir")) : null;
if (destination) {
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(destination); // Reserve a fresh run directory before any paid call.
}
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
const reports = [];
try {
    for (const input of inputs) {
        if (controller.signal.aborted) break;
        reports.push(await evaluateVantage(input, { judge, signal: controller.signal }));
    }
} finally {
    process.removeListener("SIGINT", cancel);
}
if (!reports.length) throw new Error("Evaluation cancelled before any results.");
const result = {
    version: "vantage-evaluation-results/v1",
    mode: judge?.kind ?? "checks-only",
    observedAt: new Date().toISOString(),
    requestedCases: inputs.length,
    completedCases: reports.length,
    aggregate: aggregateEvaluations(reports),
    reports,
};
if (destination) {
    await writeFile(join(destination, "results.json"), JSON.stringify(result, null, 2) + "\n", {
        flag: "wx",
    });
    await writeFile(join(destination, "report.md"), renderEvaluationMarkdown(reports), {
        flag: "wx",
    });
}
if (flags.has("--json")) console.log(JSON.stringify(result, null, 2));
else {
    console.log(`Vantage validation — ${result.mode}; rubric ${RUBRIC_VERSION}`);
    for (const report of reports)
        console.log(
            `${report.scenarioId} / ${report.candidateId}: ${report.verdict}; overall=${report.overallScore ?? "unassessed"}; ${report.metrics.map(metric => `${metric.criterion}=${metric.score ?? "unassessed"}`).join(", ")}`
        );
    console.log(
        `${reports.length}/${inputs.length} cases; ${result.aggregate.passed} passed, ${result.aggregate.failed} failed, ${result.aggregate.needsReview} need review.`
    );
}
// The demo deliberately contains failing candidates: its success means expected discrimination.
if (flags.has("--demo")) {
    const expected = {
        "conflict-good": "pass",
        "conflict-bad": "fail",
        "history-good": "pass",
        "history-bad": "fail",
        "conflict-empty": "fail",
    };
    process.exitCode =
        reports.length === inputs.length &&
        reports.every(
            report => report.error === null && expected[report.candidateId] === report.verdict
        )
            ? 0
            : 1;
} else
    process.exitCode = reports.some(report => report.verdict === "fail")
        ? 1
        : reports.length !== inputs.length ||
            reports.some(report => report.verdict === "needs-review")
          ? 2
          : 0;
