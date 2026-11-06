/** Approved synthetic live experiment. Every real HTTP dispatch must use the persistent ledger. */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { SystemMessage } from "@langchain/core/messages";
import { createRequire } from "node:module";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    createChatModelsConfig,
    resolveChatModel,
    invokeStructuredAttempt,
} from "@launchstack/llm";
import {
    createDecisionExperimentV2,
    GENERATION_PROMPT_VERSION_V2,
} from "../src/vantage/experiments/decision-generation-v2.ts";
import {
    prepareLivePilotContext,
    attachLivePilotEvaluation,
} from "../src/vantage/evaluation-live/pilot-context.ts";
import {
    initializeRequestLedger,
    inspectRequestLedger,
} from "../src/vantage/evaluation-live/request-ledger.ts";
import { createMeteredFetch } from "../src/vantage/evaluation-live/metered-transport.ts";
import { adaptV21Evaluation } from "../src/vantage/evaluation-integration/v21-adapter.ts";
import {
    evaluateVantage,
    createModelValidationJudge,
    VALIDATION_SYSTEM_PROMPT,
} from "../src/vantage/validation/index.ts";
const CITATION_CLARIFICATION =
    "CITATION CONTRACT CLARIFICATION 1: Native and experimental reports use DIFFERENT citation namespaces. Native refs use only the native payload item refs. Every experimental fact, conflict, keyFigure, derivation input and recommendation ref MUST exactly match a VERSIONED context.sources[].ref, including its @version. An unversioned native ev:<id> ref is invalid in experimental; use its separately listed contextual ref with the exact version. Ground the experimental report in the entire authorized contextual evidence, not only the native intake copy. An intake copy is not independent corroboration. This clarification supplies no new evidence or expected answer.";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nativeFetch = globalThis.fetch;
globalThis.fetch = async () => {
    throw new Error("Unmetered network access is forbidden.");
};
const sha = value =>
    createHash("sha256")
        .update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value))
        .digest("hex");
const require = createRequire(import.meta.url);
const core = require.resolve("@langchain/core");
const encoder = require(require.resolve("js-tiktoken", { paths: [dirname(core)] })).getEncoding(
    "o200k_base"
);
const countTokens = text => encoder.encode(text).length;
const command = process.argv[2];
const caseId = process.argv[3];
const runRoot = (
    await readFile(join(ROOT, "test-output/vantage-live-e2e-20261102/active-run-path.txt"), "utf8")
).trim();
const freezeRoot = join(runRoot, "freeze");
const ledgerRoot = join(runRoot, "ledger");
const read = async path => JSON.parse(await readFile(path, "utf8"));
const save = async (path, value) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
};
const dotenv = require(require.resolve("dotenv", { paths: [join(ROOT, "apps/web")] }));
const privateEnvironment = dotenv.parse(
    await readFile("C:/Users/junku/orca/LaunchStack/.env", "utf8")
);
const baseUrl = privateEnvironment.CHAT_BASE_URL?.trim();
const apiKey = privateEnvironment.CHAT_API_KEY?.trim();
if (!baseUrl || !apiKey)
    throw new Error("Approved CHAT_BASE_URL and CHAT_API_KEY are required locally.");
const endpoint = new URL(baseUrl);
if (
    endpoint.protocol !== "https:" ||
    !endpoint.hostname.endsWith(".openai.azure.com") ||
    !/\/openai\/v1\/?$/.test(endpoint.pathname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search
)
    throw new Error("The saved endpoint is not the approved Azure OpenAI v1 shape.");
const sanitize = value => {
    let text = String(value);
    for (const secret of [apiKey, baseUrl, endpoint.hostname])
        if (secret) text = text.split(secret).join("[private-config-redacted]");
    return text;
};
const yamlPath = join(ROOT, "apps/web/config/chat-models.vantage-demo.azure.yaml");
const yaml = await readFile(yamlPath, "utf8");
const modelConfigHash = sha({
    yaml,
    endpointHash: sha(baseUrl),
    wireId: "gpt-6-luna",
    generationReasoning: "none",
    judgeReasoning: "medium",
});
const config = createChatModelsConfig({
    yaml,
    endpoint: { baseUrl, apiKey },
    sourceLabel: "approved-local-synthetic-Azure-config",
});
const effectiveModelConfigHash = sha({
    baseModelConfigHash: modelConfigHash,
    responseFormat: "json_object",
});
const dryConfig = createChatModelsConfig({
    yaml,
    endpoint: { baseUrl: "https://synthetic.invalid/v1", apiKey: "offline-not-a-provider-key" },
    sourceLabel: "offline-transport-preflight",
});
function model(purpose, fetch, dry = false) {
    const resolved = resolveChatModel({
        config: dry ? dryConfig : config,
        route: "default",
        reasoningControl: { enabled: true, effort: purpose === "generation" ? "none" : "medium" },
        maxOutputTokens: purpose === "generation" ? 2400 : 4096,
        timeoutMs: 20000,
    });
    if (resolved.modelId !== "gpt-6-luna") throw new Error("Model substitution forbidden.");
    if (!resolved.behavior.nativeStructuredOutput.includes("json-object"))
        throw new Error("Native JSON output was not declared by the approved model.");
    const jsonKwargs = {
        ...(resolved.chat.modelKwargs ?? {}),
        response_format: { type: "json_object" },
    };
    resolved.chat.modelKwargs = jsonKwargs;
    resolved.chat.lc_kwargs.modelKwargs = jsonKwargs;
    resolved.chat.lc_kwargs.maxRetries = 0;
    resolved.chat.lc_kwargs.configuration = {
        ...(resolved.chat.lc_kwargs.configuration ?? {}),
        baseURL: (dry ? dryConfig : config).endpoint.baseUrl,
        fetch,
    };
    return resolved;
}
const runtime = resolved => ({
    resolveModel: () => resolved,
    signal: new AbortController().signal,
    budgets: { attemptTimeoutMs: 20000, maxAttempts: 1, retryWaitMs: 1000, totalMs: 45000 },
});
function generation(envelope, prepared) {
    return createDecisionExperimentV2({
        version: GENERATION_PROMPT_VERSION_V2,
        invoke: (m, schema, messages, limits) =>
            invokeStructuredAttempt(
                m,
                schema,
                [...messages, new SystemMessage(CITATION_CLARIFICATION)],
                limits
            ),
        countTokens,
        resolvePrimaryRole: identity =>
            identity.principalRef === prepared.scope.principalRef &&
            identity.companyId === prepared.scope.companyId
                ? prepared.roleContext
                : null,
    });
}
const sourcePaths = [
    "pipelines/src/vantage/generation-v1.ts",
    "pipelines/src/vantage/contract-v1.ts",
    "pipelines/src/vantage/evidence-v1.ts",
    "pipelines/src/vantage/rules-v1.ts",
    "pipelines/src/vantage/validate-generation-v1.ts",
    "pipelines/src/vantage/event-state-grounding-v1.ts",
    "pipelines/src/vantage/context-v0/adapters.ts",
    "pipelines/src/vantage/context-v0/registry.ts",
    "pipelines/src/vantage/context-v0/assembler.ts",
    "pipelines/src/vantage/context-v0/evidence-snapshot.ts",
    "pipelines/src/vantage/validation/input.ts",
    "pipelines/src/vantage/generation-v2-schema.ts",
    "pipelines/src/vantage/validate-generation-v2.ts",
    "pipelines/src/vantage/experiments/decision-generation-v2.ts",
    "pipelines/src/vantage/experiments/sophia-generation-v0.ts",
    "pipelines/src/vantage/evaluation-live/pilot-context.ts",
    "pipelines/src/vantage/evaluation-live/request-ledger.ts",
    "pipelines/src/vantage/evaluation-live/metered-transport.ts",
    "pipelines/src/vantage/evaluation-integration/joseph-adapter.ts",
    "pipelines/src/vantage/evaluation-integration/v21-adapter.ts",
    "pipelines/src/vantage/validation/contracts.ts",
    "pipelines/src/vantage/validation/judge.ts",
    "pipelines/src/vantage/validation/rubric.ts",
    "pipelines/src/vantage/validation/evaluate.ts",
    "packages/llm/src/structured-attempt.ts",
    "packages/llm/src/openai-compatible-transport.ts",
    "pipelines/scripts/vantage-live-e2e.mjs",
    "fixtures/vantage-pipeline-edge-cases/semantic-cases.json",
];
async function captureGeneration(envelope, prepared) {
    let captured;
    const fetch = async (_url, init) => {
        if (captured) throw new Error("Unexpected second dry transport call");
        captured = String(init.body);
        throw new Error("Offline request capture only");
    };
    await generation(envelope, prepared)(envelope, runtime(model("generation", fetch, true)));
    if (!captured)
        throw new Error("The genuine Generation transport was not reached in preflight.");
    const body = JSON.parse(captured);
    if (
        body.model !== "gpt-6-luna" ||
        body.max_completion_tokens !== 2400 ||
        body.reasoning_effort !== "none"
    )
        throw new Error("Unexpected generation model/cap/reasoning");
    if (/"(?:expectations|must_include|must_not_claim|expected_by_role)"/.test(captured))
        throw new Error("Gold entered generation request");
    return {
        body,
        rawBody: captured,
        requestHash: sha(captured),
        promptHash: sha(JSON.stringify(body.messages)),
        evidence: "offline SDK request capture; zero provider calls",
    };
}
async function verifyFreeze() {
    const frozen = await read(join(freezeRoot, "protocol.json"));
    if (frozen.modelConfigHash !== modelConfigHash)
        throw new Error("Approved runtime model configuration changed after freeze");
    for (const [path, expected] of Object.entries(frozen.fileHashes))
        if (sha(await readFile(join(ROOT, path))) !== expected)
            throw new Error(`Frozen source changed: ${path}`);
    const ledger = await inspectRequestLedger(ledgerRoot);
    if (ledger.state.frozenSpecHash !== sha(frozen))
        throw new Error("Frozen protocol does not match persistent ledger");
    return frozen;
}
async function prepare() {
    await mkdir(freezeRoot);
    const dataset = await read(
        join(ROOT, "fixtures/vantage-pipeline-edge-cases/semantic-cases.json")
    );
    const amendments = {
        model: "User explicitly approved gpt-6-luna for every task; separate calls and blinded presentation, same model family.",
        pricing:
            "User explicitly waived pricing verification; dollar cost remains unverified; request-count ceilings control spending.",
        phaseA: 14,
        phaseB: 168,
        combined: 182,
    };
    await save(join(freezeRoot, "authorization-amendments.json"), amendments);
    await save(join(freezeRoot, "gold-for-evaluator-only.json"), dataset);
    const cases = [];
    for (const scenario of dataset.cases) {
        const built = await prepareLivePilotContext(scenario);
        const request = await captureGeneration(built.envelope, built.prepared);
        const payload = {
            prepared: built.prepared,
            envelope: built.envelope,
            scopeProvenance: built.scopeProvenance,
        };
        await save(join(freezeRoot, scenario.id, "generation-context-gold-free.json"), payload);
        await save(join(freezeRoot, scenario.id, "generation-request-template.json"), request);
        cases.push({
            id: scenario.id,
            inputHash: sha(payload),
            requestHash: request.requestHash,
            promptHash: request.promptHash,
            sourceKeys: built.envelope.evidenceSnapshot.entries.map(
                e => `${e.source.kind}~${e.source.id}~${e.source.version}`
            ),
        });
    }
    const fileHashes = Object.fromEntries(
        await Promise.all(
            sourcePaths.map(async path => [path, sha(await readFile(join(ROOT, path)))])
        )
    );
    const protocol = {
        version: "vantage-live-e2e-pilot/v1",
        baseline: "b809e8248e4c65eb2e6e8c4aa05b52003e352aa9",
        cases,
        amendments,
        fileHashes,
        modelConfigHash,
        modelId: "gpt-6-luna",
        generation: {
            policy: "V2.1 opt-in exact source snapshot",
            promptVersion:
                GENERATION_PROMPT_VERSION_V2 + "/citation-contract-clarification-native-json.2",
            maxOutputTokens: 2400,
            reasoning: "none",
            maxAttempts: 1,
            sdkRetries: 0,
        },
        judge: {
            agent: "Sophia actual Validation Agent",
            rubricHash: sha(VALIDATION_SYSTEM_PROMPT),
            maxOutputTokens: 4096,
            reasoning: "medium",
            separateInvocation: true,
            sameModelFamily: true,
        },
        tokenizer: { name: "js-tiktoken/o200k_base", providerMappingVerified: false },
        goldHash: sha(dataset),
        budget: { A: 14, B: 168, combined: 182 },
        preparedAt: new Date().toISOString(),
    };
    await save(join(freezeRoot, "protocol.json"), protocol);
    await initializeRequestLedger(ledgerRoot, {
        runId: dirname(freezeRoot).split(/[\\/]/).at(-1),
        frozenSpecHash: sha(protocol),
    });
    console.log(
        JSON.stringify(
            {
                prepared: cases.length,
                modelId: protocol.modelId,
                promptVersion: protocol.generation.promptVersion,
                providerCalls: 0,
                runRoot,
            },
            null,
            2
        )
    );
}
async function verifyAmendment() {
    const amendment = await read(join(runRoot, "amendment-2", "protocol.json"));
    if (
        sha(await readFile(fileURLToPath(import.meta.url))) !== amendment.runnerHash ||
        sha(CITATION_CLARIFICATION) !== amendment.clarificationHash
    )
        throw new Error("Amendment source changed after freeze");
    return amendment;
}
async function prepareAmendment() {
    const original = await verifyFreeze();
    const directory = join(runRoot, "amendment-2");
    await mkdir(directory);
    for (const item of original.cases) {
        const payload = await read(join(freezeRoot, item.id, "generation-context-gold-free.json"));
        const request = await captureGeneration(payload.envelope, payload.prepared);
        await save(join(directory, item.id, "generation-request-template.json"), request);
    }
    await save(join(directory, "protocol.json"), {
        version: "citation-contract-clarification-native-json.2",
        originalProtocolHash: sha(original),
        diagnosis: "diagnosis-A01-recovery1.json",
        nativeJsonMode: "json_object",
        effectiveModelConfigHash,
        clarification: CITATION_CLARIFICATION,
        clarificationHash: sha(CITATION_CLARIFICATION),
        runnerHash: sha(await readFile(fileURLToPath(import.meta.url))),
        expectedAnswersChanged: false,
        underlyingGeneratorChanged: false,
        goldHidden: true,
        budgetsChanged: false,
        realRequests: 0,
    });
    console.log(
        JSON.stringify({
            amendment: "citation-contract-clarification-native-json.2",
            providerCalls: 0,
        })
    );
}
async function executeGeneration(frozen) {
    const item = frozen.cases.find(item => item.id === caseId);
    if (!item) throw new Error("Unknown original pilot case");
    const payload = await read(join(freezeRoot, caseId, "generation-context-gold-free.json"));
    const request = await read(
        join(runRoot, "amendment-2", caseId, "generation-request-template.json")
    );
    if (sha(payload) !== item.inputHash || sha(request.rawBody) !== request.requestHash)
        throw new Error("Frozen context/template modified");
    const recovering = command === "recover-generation";
    const intentId = recovering ? `A-recovery-generation-${caseId}-2` : `A-generation-${caseId}`;
    const callDir = join(runRoot, "calls", intentId);
    await mkdir(callDir, { recursive: true });
    const counted = createMeteredFetch({
        ledgerDirectory: ledgerRoot,
        metadata: {
            intentId,
            phase: "A",
            caseId,
            kind: recovering ? "recovery" : "initial-generation",
            ...(recovering
                ? {
                      recovery: {
                          purpose: "generation",
                          reason: "Earlier exact-ref repair produced invalid JSON; enable approved native JSON-object response mode without editing output",
                          authorizationRef:
                              "PhaseA-user-approved-four-recovery-requests/diagnosis-A01-recovery1",
                      },
                  }
                : {}),
            modelId: "gpt-6-luna",
            modelConfigHash: effectiveModelConfigHash,
            promptHash: request.promptHash,
            inputHash: item.inputHash,
            promptVersion:
                GENERATION_PROMPT_VERSION_V2 + "/citation-contract-clarification-native-json.2",
        },
        expectedUrl: baseUrl.replace(/\/$/, "") + "/chat/completions",
        expectedModelId: "gpt-6-luna",
        expectedRequestHash: request.requestHash,
        requestPath: join(callDir, "request.json"),
        responsePath: join(callDir, "response.json"),
        sanitize,
        fetchImpl: nativeFetch,
    });
    const started = Date.now();
    const result = await generation(payload.envelope, payload.prepared)(
        payload.envelope,
        runtime(model("generation", counted))
    );
    const valid =
        ["v2-first-pass", "v2-after-repair"].includes(result.outcome) &&
        result.output?.generated?.v1Result?.execution?.mode === "ai";
    await save(
        join(
            runRoot,
            "results",
            caseId,
            recovering ? "generation-recovery-2.json" : "generation-initial.json"
        ),
        {
            live: true,
            valid,
            latencyMs: Date.now() - started,
            result,
            callerAmendment: "citation-contract-clarification-native-json.2",
            firstPass: !recovering && valid,
            deliveryOutcome: recovering && valid ? "v2-after-explicit-recovery" : result.outcome,
            ...(recovering ? { initialFailureIntentId: `A-generation-${caseId}` } : {}),
        }
    );
    console.log(
        JSON.stringify(
            {
                caseId,
                stage: "generation",
                valid,
                outcome: result.outcome,
                counts: (await inspectRequestLedger(ledgerRoot)).counts,
            },
            null,
            2
        )
    );
    if (!valid) process.exitCode = 1;
}
async function executeJudge(frozen) {
    const item = frozen.cases.find(item => item.id === caseId);
    if (!item) throw new Error("Unknown pilot case");
    let saved;
    try {
        saved = await read(join(runRoot, "results", caseId, "generation-recovery-2.json"));
    } catch {
        saved = await read(join(runRoot, "results", caseId, "generation-initial.json"));
    }
    if (!saved.valid) throw new Error("No successfully validated real Generation output to judge");
    const payload = await read(join(freezeRoot, caseId, "generation-context-gold-free.json"));
    const gold = await read(join(freezeRoot, "gold-for-evaluator-only.json"));
    const scenario = gold.cases.find(item => item.id === caseId);
    const base = attachLivePilotEvaluation(
        payload.prepared,
        scenario,
        saved.result.output.report,
        payload.envelope,
        {
            id: `pilot-v21-clarification2-${caseId}`,
            pipelineVersion: `v21-pilot-${frozen.fileHashes["pipelines/src/vantage/experiments/decision-generation-v2.ts"].slice(0, 12)}`,
        }
    );
    const bridge = adaptV21Evaluation(saved.result.output.report, {
        input: base.input,
        roleContext: payload.prepared.roleContext,
        roleMetadataAlreadyIncluded: true,
    });
    const input = bridge.supplementaryInput;
    await save(join(runRoot, "results", caseId, "evaluation-input-with-gold.json"), input);
    await save(join(runRoot, "results", caseId, "evaluation-provenance.json"), {
        base: base.sidecar,
        v21: bridge,
    });
    let request;
    const capture = async (_url, init) => {
        if (request) throw new Error("Unexpected second judge dry call");
        request = String(init.body);
        throw new Error("Offline Judge request capture only");
    };
    await evaluateVantage(input, {
        judge: createModelValidationJudge(model("judge", capture, true), {
            configurationId: effectiveModelConfigHash,
            timeoutMs: 20000,
            maxOutputTokens: 4096,
        }),
    });
    if (!request) throw new Error("Real Sophia Judge transport was not reached in preflight");
    const promptHash = sha(JSON.stringify(JSON.parse(request).messages));
    const intentId = `A-judge-${caseId}`;
    const callDir = join(runRoot, "calls", intentId);
    await mkdir(callDir, { recursive: true });
    const counted = createMeteredFetch({
        ledgerDirectory: ledgerRoot,
        metadata: {
            intentId,
            phase: "A",
            caseId,
            kind: "initial-judge",
            modelId: "gpt-6-luna",
            modelConfigHash: effectiveModelConfigHash,
            promptHash,
            inputHash: sha(input),
            promptVersion: "vantage-quality/1.0",
        },
        expectedUrl: baseUrl.replace(/\/$/, "") + "/chat/completions",
        expectedModelId: "gpt-6-luna",
        expectedRequestHash: sha(request),
        requestPath: join(callDir, "request.json"),
        responsePath: join(callDir, "response.json"),
        sanitize,
        fetchImpl: nativeFetch,
    });
    const started = Date.now();
    const report = await evaluateVantage(input, {
        judge: createModelValidationJudge(model("judge", counted), {
            configurationId: effectiveModelConfigHash,
            timeoutMs: 20000,
            maxOutputTokens: 4096,
        }),
    });
    const criticalIds = new Set(
        input.scenario.expectations
            .filter(item => item.importance === "critical")
            .map(item => item.id)
    );
    const criticalPassed = report.expectations
        .filter(item => criticalIds.has(item.expectationId))
        .every(item => item.verdict === "met");
    const passed =
        report.status === "assessed" &&
        report.verdict === "pass" &&
        criticalPassed &&
        report.integrityIssues.every(issue => issue.severity !== "error");
    await save(join(runRoot, "results", caseId, "validation-initial.json"), {
        live: true,
        passed,
        criticalPassed,
        latencyMs: Date.now() - started,
        report,
    });
    console.log(
        JSON.stringify(
            {
                caseId,
                stage: "validation",
                passed,
                criticalPassed,
                verdict: report.verdict,
                status: report.status,
                overallScore: report.overallScore,
                error: report.error,
                counts: (await inspectRequestLedger(ledgerRoot)).counts,
            },
            null,
            2
        )
    );
    if (!passed) process.exitCode = 1;
}
try {
    if (command === "amend") await prepareAmendment();
    else if (command === "prepare")
        throw new Error("Use original frozen runner for initial preparation only");
    else if (command === "status")
        console.log(JSON.stringify(await inspectRequestLedger(ledgerRoot), null, 2));
    else {
        const frozen = await verifyFreeze();
        await verifyAmendment();
        if (command === "generate" || command === "recover-generation")
            await executeGeneration(frozen);
        else if (command === "judge") await executeJudge(frozen);
        else
            throw new Error(
                "Choose prepare, generate CASE, judge CASE, or status; no implicit live batch."
            );
    }
} catch (error) {
    console.error(sanitize(error instanceof Error ? error.message : "Pilot failed"));
    process.exitCode = 1;
}
