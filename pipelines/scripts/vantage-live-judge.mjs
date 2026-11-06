/** Real Sophia Judge runner; no Generation call, no unmetered network or implicit retries. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatModelsConfig, resolveChatModel } from "@launchstack/llm";
import {
    createModelValidationJudge,
    evaluateVantage,
    VALIDATION_SYSTEM_PROMPT,
} from "../src/vantage/validation/index.ts";
import { attachLivePilotEvaluation } from "../src/vantage/evaluation-live/pilot-context.ts";
import { buildDiagnosticEvaluation } from "../src/vantage/evaluation-live/diagnostic-evaluation.ts";
import { adaptV21Evaluation } from "../src/vantage/evaluation-integration/v21-adapter.ts";
import { createMeteredFetch } from "../src/vantage/evaluation-live/metered-transport.ts";
import { inspectRequestLedger } from "../src/vantage/evaluation-live/request-ledger.ts";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha = v =>
    createHash("sha256")
        .update(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v))
        .digest("hex");
const read = async p => JSON.parse(await readFile(p, "utf8"));
const save = async (p, v) => {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
};
const run = (
    await readFile(join(ROOT, "test-output/vantage-live-e2e-20261102/active-run-path.txt"), "utf8")
).trim();
const protocol = await read(join(run, "freeze/protocol.json"));
const amendmentDir = join(run, "judge-amendment-1");
const actualFetch = globalThis.fetch;
globalThis.fetch = async () => {
    throw new Error("Unmetered network forbidden");
};
const require = createRequire(import.meta.url);
const dotenv = require(require.resolve("dotenv", { paths: [join(ROOT, "apps/web")] }));
const env = dotenv.parse(await readFile("C:/Users/junku/orca/LaunchStack/.env", "utf8"));
const baseUrl = env.CHAT_BASE_URL?.trim(),
    apiKey = env.CHAT_API_KEY?.trim();
if (!baseUrl || !apiKey) throw new Error("Approved local model configuration missing");
const url = new URL(baseUrl);
if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".openai.azure.com") ||
    !/^\/openai\/v1\/?$/.test(url.pathname)
)
    throw new Error("Unexpected endpoint shape");
const sanitize = v => {
    let s = String(v);
    for (const secret of [apiKey, baseUrl, url.hostname])
        if (secret) s = s.split(secret).join("[private-config-redacted]");
    return s;
};
const yaml = await readFile(
    join(ROOT, "apps/web/config/chat-models.vantage-demo.azure.yaml"),
    "utf8"
);
const originalModelHash = sha({
    yaml,
    endpointHash: sha(baseUrl),
    wireId: "gpt-6-luna",
    generationReasoning: "none",
    judgeReasoning: "medium",
});
if (originalModelHash !== protocol.modelConfigHash)
    throw new Error("Approved configuration changed");
const configHash = sha({
    baseModelConfigHash: originalModelHash,
    judgeReasoning: "none",
    responseFormat: "json_object",
    timeoutMs: 60000,
    maxOutputTokens: 4096,
});
const config = createChatModelsConfig({
    yaml,
    endpoint: { baseUrl, apiKey },
    sourceLabel: "approved-Azure-synthetic-Judge",
});
const dryConfig = createChatModelsConfig({
    yaml,
    endpoint: { baseUrl: "https://synthetic.invalid/v1", apiKey: "offline-not-provider" },
});
function model(fetch, dry = false) {
    const m = resolveChatModel({
        config: dry ? dryConfig : config,
        route: "default",
        reasoningControl: { enabled: true, effort: "none" },
        maxOutputTokens: 4096,
        timeoutMs: 60000,
    });
    if (m.modelId !== "gpt-6-luna") throw new Error("Model substitution forbidden");
    m.chat.modelKwargs = {
        ...(m.chat.modelKwargs ?? {}),
        response_format: { type: "json_object" },
    };
    m.chat.lc_kwargs.modelKwargs = m.chat.modelKwargs;
    m.chat.lc_kwargs.maxRetries = 0;
    m.chat.lc_kwargs.configuration = {
        ...(m.chat.lc_kwargs.configuration ?? {}),
        baseURL: (dry ? dryConfig : config).endpoint.baseUrl,
        fetch,
    };
    return m;
}
const settings = { configurationId: configHash, timeoutMs: 60000, maxOutputTokens: 4096 };
async function verify() {
    for (const [p, h] of Object.entries(protocol.fileHashes))
        if (sha(await readFile(join(ROOT, p))) !== h)
            throw new Error(`Frozen pilot source changed: ${p}`);
    const l = await inspectRequestLedger(join(run, "ledger"));
    if (l.state.frozenSpecHash !== sha(protocol))
        throw new Error("Ledger/freeze identity mismatch");
    return l;
}
try {
    await verify();
    const cmd = process.argv[2];
    if (cmd === "freeze") {
        await mkdir(amendmentDir);
        await save(join(amendmentDir, "protocol.json"), {
            version: "sophia-judge-operational-amendment/v1",
            reason: "Original medium-reasoning Judge timed out at20seconds with no response. Preserve that charged attempt. Use same actual Judge/rubric with no hidden reasoning and published60second option.",
            modelId: "gpt-6-luna",
            reasoning: "none",
            timeoutMs: 60000,
            maxOutputTokens: 4096,
            nativeJsonMode: true,
            configHash,
            rubricHash: sha(VALIDATION_SYSTEM_PROMPT),
            runnerHash: sha(await readFile(fileURLToPath(import.meta.url))),
            diagnosticAdapterHash: sha(
                await readFile(
                    join(ROOT, "pipelines/src/vantage/evaluation-live/diagnostic-evaluation.ts")
                )
            ),
            semanticAnswersChanged: false,
            sourceGoldChanged: false,
        });
        console.log(JSON.stringify({ amendment: "sophia-judge-operational.1", providerCalls: 0 }));
    } else {
        const caseId = cmd;
        const retry = process.argv[3] === "--recovery";
        if (!protocol.cases.some(c => c.id === caseId)) throw new Error("Unknown pilot case");
        const amendment = await read(join(amendmentDir, "protocol.json"));
        if (
            amendment.runnerHash !== sha(await readFile(fileURLToPath(import.meta.url))) ||
            amendment.diagnosticAdapterHash !==
                sha(
                    await readFile(
                        join(ROOT, "pipelines/src/vantage/evaluation-live/diagnostic-evaluation.ts")
                    )
                )
        )
            throw new Error("Judge amendment code changed");
        const payload = await read(
            join(run, "freeze", caseId, "generation-context-gold-free.json")
        );
        const gold = await read(join(run, "freeze/gold-for-evaluator-only.json"));
        const scenario = gold.cases.find(c => c.id === caseId);
        let saved, selectedFile;
        for (const file of [
            "generation-recovery-2.json",
            "generation-recovery-1.json",
            "generation-initial.json",
        ]) {
            try {
                saved = await read(join(run, "results", caseId, file));
                selectedFile = file;
                break;
            } catch {}
        }
        if (!saved) throw new Error("No actual provider generation artifact exists");
        let input, sidecar;
        if (saved.valid) {
            try {
                input = await read(join(run, "results", caseId, "evaluation-input-with-gold.json"));
                sidecar = {
                    reuse: "Same already-frozen original Judge input after transport timeout",
                };
            } catch {
                const base = attachLivePilotEvaluation(
                    payload.prepared,
                    scenario,
                    saved.result.output.report,
                    payload.envelope,
                    {
                        id: `pilot-v21-${caseId}`,
                        pipelineVersion: "live-v21-pilot/citation-clarification-native-json.2",
                    }
                );
                const bridge = adaptV21Evaluation(saved.result.output.report, {
                    input: base.input,
                    roleContext: payload.prepared.roleContext,
                    roleMetadataAlreadyIncluded: true,
                });
                input = bridge.supplementaryInput;
                sidecar = { base: base.sidecar, v21: bridge };
            }
        } else {
            const intent =
                selectedFile === "generation-recovery-2.json"
                    ? `A-recovery-generation-${caseId}-2`
                    : selectedFile === "generation-recovery-1.json"
                      ? `A-recovery-generation-${caseId}-1`
                      : `A-generation-${caseId}`;
            const capture = await read(join(run, "calls", intent, "response.json"));
            if (!capture.body)
                throw new Error("No parseable raw model output for diagnostic Judge");
            const raw = JSON.parse(capture.body);
            const compound = JSON.parse(raw.choices[0].message.content);
            const projected = buildDiagnosticEvaluation(
                payload.prepared,
                scenario,
                compound.experimental,
                payload.envelope,
                {
                    id: `diagnostic-invalid-v21-${caseId}`,
                    pipelineVersion: "live-v21-invalid-delivery-diagnostic/v1",
                }
            );
            input = projected.input;
            sidecar = projected.sidecar;
        }
        const attemptDir = join(amendmentDir, caseId, retry ? "recovery-1" : "initial");
        await mkdir(attemptDir, { recursive: true });
        await save(join(attemptDir, "evaluation-input-with-gold.json"), input);
        await save(join(attemptDir, "projection.json"), sidecar);
        let template;
        await evaluateVantage(input, {
            timeoutMs: 60000,
            judge: createModelValidationJudge(
                model(async (_u, init) => {
                    if (template) throw new Error("Unexpected extra dry Judge call");
                    template = String(init.body);
                    throw new Error("Offline SDK capture");
                }, true),
                settings
            ),
        });
        if (!template) throw new Error("Actual Sophia Judge transport not reached");
        const body = JSON.parse(template);
        if (body.response_format?.type !== "json_object" || body.reasoning_effort !== "none")
            throw new Error("Judge request options not applied");
        const intentId = retry ? `A-recovery-judge-${caseId}-1` : `A-judge-${caseId}`;
        const callDir = join(run, "calls", intentId);
        await mkdir(callDir, { recursive: true });
        const counted = createMeteredFetch({
            ledgerDirectory: join(run, "ledger"),
            metadata: {
                intentId,
                phase: "A",
                caseId,
                kind: retry ? "recovery" : "initial-judge",
                ...(retry
                    ? {
                          recovery: {
                              purpose: "judge",
                              reason: "First Judge timed out with no receipt; same frozen candidate/rubric with no hidden reasoning and60second transport",
                              authorizationRef:
                                  "PhaseA-reserved-recovery/Judge-operational-amendment1",
                          },
                      }
                    : {}),
                modelId: "gpt-6-luna",
                modelConfigHash: configHash,
                promptHash: sha(JSON.stringify(body.messages)),
                inputHash: sha(input),
                promptVersion: "vantage-quality/1.0",
            },
            expectedUrl: baseUrl.replace(/\/$/, "") + "/chat/completions",
            expectedModelId: "gpt-6-luna",
            expectedRequestHash: sha(template),
            requestPath: join(callDir, "request.json"),
            responsePath: join(callDir, "response.json"),
            sanitize,
            fetchImpl: actualFetch,
        });
        const started = Date.now();
        const report = await evaluateVantage(input, {
            timeoutMs: 60000,
            judge: createModelValidationJudge(model(counted), settings),
        });
        const critical = new Set(
            input.scenario.expectations.filter(e => e.importance === "critical").map(e => e.id)
        );
        const criticalPassed =
            critical.size > 0 &&
            report.expectations
                .filter(e => critical.has(e.expectationId))
                .every(e => e.verdict === "met");
        const casePass =
            saved.valid &&
            report.status === "assessed" &&
            report.verdict === "pass" &&
            criticalPassed &&
            report.integrityIssues.every(i => i.severity !== "error");
        const result = {
            live: true,
            generationValidated: saved.valid,
            diagnosticOnly: !saved.valid,
            selectedGenerationArtifact: selectedFile,
            casePass,
            criticalPassed,
            latencyMs: Date.now() - started,
            report,
        };
        await save(join(attemptDir, "validation-report.json"), result);
        console.log(
            JSON.stringify(
                {
                    caseId,
                    stage: "actual-Sophia-Judge",
                    generationValidated: saved.valid,
                    diagnosticOnly: !saved.valid,
                    casePass,
                    criticalPassed,
                    status: report.status,
                    verdict: report.verdict,
                    overallScore: report.overallScore,
                    error: report.error,
                    counts: (await inspectRequestLedger(join(run, "ledger"))).counts,
                },
                null,
                2
            )
        );
        if (!casePass) process.exitCode = 1;
    }
} catch (error) {
    console.error(sanitize(error instanceof Error ? error.message : "Judge runner failed"));
    process.exitCode = 1;
}
