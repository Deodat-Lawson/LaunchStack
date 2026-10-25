#!/usr/bin/env node
/** Explicit synthetic-only A/B observer. No app route, database, connector, or dotenv loading. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createChatModelsConfig, resolveChatModel } from "@launchstack/llm";
import {
    generateWeeklyAgendaV1,
    GENERATION_BUDGETS,
    GENERATION_PROMPT_VERSION,
} from "../src/vantage/generation-v1.ts";
import { validateGenerationResult } from "../src/vantage/validate-generation-v1.ts";
import {
    eligibleInput,
    computeGenerationSignals,
    selectGenerationEvidence,
} from "../src/vantage/evidence-v1.ts";
import { createSophiaContextGenerationExperimentV0 } from "../src/vantage/experiments/sophia-generation-v0.ts";

const args = process.argv.slice(2);
const option = name => {
    const at = args.indexOf(name);
    return at < 0 ? null : args[at + 1];
};
if (!args.includes("--live")) throw Error("Explicit --live required. No provider request made.");
const inputPath = path.resolve(option("--input") || "");
const output = path.resolve(option("--output") || "");
if (!option("--input") || !option("--output"))
    throw Error("--input and a new --output directory are required.");
const fixtureRaw = await fs.readFile(inputPath, "utf8");
const fixture = JSON.parse(fixtureRaw);
if (fixture.syntheticOnly !== true || !fixture.envelope)
    throw Error("An explicitly synthetic host-captured envelope is required.");
const envelope = fixture.envelope;
const base = process.env.CHAT_BASE_URL,
    key = process.env.CHAT_API_KEY,
    configPath = process.env.CHAT_MODELS_CONFIG;
if (!base || !key || !path.isAbsolute(configPath || ""))
    throw Error("CHAT_BASE_URL, CHAT_API_KEY and absolute CHAT_MODELS_CONFIG required.");
const endpoint = new URL(base);
if (
    !endpoint.hostname.endsWith(".openai.azure.com") ||
    endpoint.pathname.replace(/\/+$/, "") !== "/openai/v1"
)
    throw Error("Approved Azure OpenAI v1 endpoint required.");
const secrets = [base, key, endpoint.hostname];
const redact = value =>
    secrets.reduce((s, secret) => s.split(secret).join("[REDACTED]"), String(value));
const sha = value => createHash("sha256").update(value).digest("hex");
const yaml = await fs.readFile(configPath, "utf8");
if (sha(yaml) !== "2b5e377779313de1e13868b4c61f0633d15b63a3eb82e03d761f399768e02bb9")
    throw Error("Approved model configuration fingerprint differs.");
const config = createChatModelsConfig({ yaml, endpoint: { baseUrl: base, apiKey: key } });
const model = resolveChatModel({
    config,
    route: "default",
    maxOutputTokens: 2400,
    timeoutMs: 20000,
});
if (model.modelId !== "gpt-6-luna") throw Error("Approved deployment gpt-6-luna required.");
await fs.mkdir(output);
const write = (name, value) =>
    fs.writeFile(
        path.join(output, name),
        redact(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)) +
            "\n",
        { flag: "wx" }
    );
const nativeRaw = JSON.stringify(envelope.v1Input);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceFiles = [
    "pipelines/src/vantage/generation-v1.ts",
    "pipelines/src/vantage/event-state-grounding-v1.ts",
    "pipelines/src/vantage/experiments/sophia-generation-v0.ts",
    "pipelines/src/vantage/context-v0/adapters.ts",
    "pipelines/src/vantage/context-v0/assembler.ts",
    "pipelines/src/vantage/context-v0/registry.ts",
    "pipelines/scripts/vantage-sophia-generation-experiment.mjs",
];
const sourceFileSha256 = Object.fromEntries(
    await Promise.all(
        sourceFiles.map(async file => [file, sha(await fs.readFile(path.join(sourceRoot, file)))])
    )
);
await write("input.json", fixture);
await write("configuration.json", {
    observedAt: new Date().toISOString(),
    syntheticOnly: true,
    deployment: model.modelId,
    endpointKind: "Azure OpenAI v1; resource withheld",
    modelConfigSha256: sha(yaml),
    fixtureSha256: sha(fixtureRaw),
    nativeInputSha256: sha(nativeRaw),
    sourceFileSha256,
    basePromptVersion: GENERATION_PROMPT_VERSION,
    budgets: GENERATION_BUDGETS,
    outputTokenCap: 2400,
    script: fileURLToPath(import.meta.url),
    comparisonLimit:
        "A uses original V1 output; B spends the same output budget on a native carrier and a separate contextual report. Inputs and instructions differ only through the declared experiment; one pair is not a benchmark.",
});
let observing = null;
const realFetch = globalThis.fetch;
model.chat.lc_kwargs.configuration = {
    ...model.chat.lc_kwargs.configuration,
    fetch: async (url, init) => {
        if (!observing) throw Error("Unobserved provider request refused.");
        const slot = observing,
            index = ++slot.requests,
            started = performance.now();
        const stem = `${slot.side}.attempt-${String(index).padStart(2, "0")}`;
        await write(stem + ".request.json", {
            request: JSON.parse(String(init.body)),
            note: "Body only; no headers, endpoint or credentials.",
        });
        try {
            const response = await realFetch(url, init);
            const safeText = redact(await response.clone().text());
            let body;
            try {
                body = JSON.parse(safeText);
            } catch {
                body = { unparsed: safeText };
            }
            const record = {
                httpStatus: response.status,
                durationMs: Math.ceil(performance.now() - started),
                response: body,
            };
            slot.responses.push(record);
            await write(stem + ".response.json", record);
            return response;
        } catch (error) {
            const record = {
                name: error.name,
                message: redact(error.message),
                durationMs: Math.ceil(performance.now() - started),
            };
            slot.transportErrors.push(record);
            await write(stem + ".transport-error.json", record);
            throw error;
        }
    },
};
const eligible = eligibleInput(envelope.v1Input);
const signals = computeGenerationSignals(eligible);
await write("native-evidence-selection.json", selectGenerationEvidence(eligible, signals));
const results = [];
for (const side of ["a-v1", "b-context"]) {
    const input = structuredClone(envelope),
        before = JSON.stringify(input.v1Input);
    observing = { side, requests: 0, responses: [], transportErrors: [] };
    const started = performance.now();
    let result = null,
        error = null,
        validationError = null;
    const runtime = {
        resolveModel: () => model,
        signal: new AbortController().signal,
        budgets: GENERATION_BUDGETS,
    };
    try {
        result =
            side === "a-v1"
                ? await generateWeeklyAgendaV1(input.v1Input, runtime)
                : await createSophiaContextGenerationExperimentV0()(input, runtime);
        validateGenerationResult(
            input.v1Input,
            structuredClone(side === "a-v1" ? result : result.generated.v1Result)
        );
    } catch (failure) {
        error = {
            name: failure.name,
            message: redact(failure.message),
            execution: failure.execution || null,
        };
    }
    const observed = observing;
    observing = null;
    const nativeResult = side === "a-v1" ? result : result?.generated.v1Result;
    const liveModelSuccess =
        !!nativeResult &&
        nativeResult.execution.mode === "ai" &&
        nativeResult.execution.fallbackReason === null &&
        observed.responses.some(x => x.httpStatus === 200) &&
        !error;
    const record = {
        side,
        liveModelSuccess,
        durationMs: Math.ceil(performance.now() - started),
        inputUnchanged: before === JSON.stringify(input.v1Input),
        nativeInputSha256: sha(before),
        result,
        error,
        validationError,
        providerAttempts: observed.responses.map(x => ({
            httpStatus: x.httpStatus,
            durationMs: x.durationMs,
            model: x.response.model,
            finishReason: x.response.choices?.[0]?.finish_reason,
            usage: x.response.usage,
        })),
        requests: observed.requests,
        transportErrors: observed.transportErrors,
    };
    await write(side + ".result.json", record);
    results.push(record);
    console.log(
        JSON.stringify({
            side,
            liveModelSuccess,
            requests: record.requests,
            summary: side === "a-v1" ? result?.draft.summary : result?.report.summary,
            error,
        })
    );
    if (!liveModelSuccess || !record.inputUnchanged) process.exitCode = 1;
}
await write("run-summary.json", {
    observedAt: new Date().toISOString(),
    identicalNativeInput: results.every(x => x.nativeInputSha256 === sha(nativeRaw)),
    results,
    note: "Execution and exact-citation validation do not establish semantic entailment. Compare actual prose with captured source excerpts.",
});
