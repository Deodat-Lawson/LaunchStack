/** Replays captured bytes through local guards. No model, credentials, DB or historical writes. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
let blockedNetworkAttempts = 0;
globalThis.fetch = async () => {
    blockedNetworkAttempts++;
    throw new Error("OFFLINE_AUDIT_NETWORK_FORBIDDEN");
};
const { GenerationCompoundSchemaV2 } = await import("../src/vantage/generation-v2-schema.ts");
const { normalizeGenerationV2 } = await import("../src/vantage/validate-generation-v2.ts");
const { inspectSourceUsageV0 } = await import("../src/vantage/experiments/source-usage-v0.ts");
const { parseEvaluationInput, outputUnits } = await import("../src/vantage/validation/input.ts");
const { validateJudgment } = await import("../src/vantage/validation/evaluate.ts");
const { judgmentSchemaFor } = await import("../src/vantage/validation/judge-evidence.ts");
const llm = await import("@launchstack/llm");
const { createModelValidationJudge } = await import("../src/vantage/validation/judge.ts");
const config = llm.createChatModelsConfig({
    yaml: await readFile(
        new URL("../../apps/web/config/chat-models.vantage-demo.azure.yaml", import.meta.url),
        "utf8"
    ),
    endpoint: {
        baseUrl: "https://synthetic.invalid/v1",
        apiKey: "offline-placeholder-not-a-provider-key",
    },
    sourceLabel: "offline-prompt-preparation-only",
});
const promptModel = llm.resolveChatModel({
    config,
    route: "default",
    reasoningControl: { enabled: true, effort: "none" },
    maxOutputTokens: 4096,
    timeoutMs: 60000,
});
promptModel.chat.lc_kwargs.maxRetries = 0;
promptModel.chat.lc_kwargs.configuration = {
    ...(promptModel.chat.lc_kwargs.configuration ?? {}),
    fetch: globalThis.fetch,
};
const { RUBRIC_VERSION } = await import("../src/vantage/validation/contracts.ts");
const { assessEvaluationCompleteness } = await import(
    "../src/vantage/evaluation-live/evaluation-completeness.ts"
);
const args = process.argv.slice(2);
const option = name => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`Required ${name}`);
    return resolve(args[index + 1]);
};
if (args.length !== 4) throw new Error("Use --pilot-root PATH --output-dir NEW_PATH");
const pilot = option("--pilot-root");
const destination = option("--output-dir");
if (
    destination === pilot ||
    destination.startsWith(pilot + "/") ||
    destination.startsWith(pilot + "\\")
)
    throw new Error(
        "The original pilot tree is immutable; choose a separate new output directory."
    );
const read = async path => JSON.parse(await readFile(path, "utf8"));
const digest = value => createHash("sha256").update(value).digest("hex");
const accounting = await read(join(pilot, "provider-request-token-cost-ledger.json"));
const ledgerBefore = await readFile(join(pilot, "ledger/ledger.json"));
if (accounting.actualDispatchAttempts !== 14 || accounting.phaseB !== 0)
    throw new Error("Unexpected pilot accounting");
await mkdir(destination, { recursive: false });
const records = [];
const judgeInputPaths = {
    "A-recovery-judge-conflicting-metrics-1":
        "judge-amendment-1/conflicting-metrics/recovery-1/evaluation-input-with-gold.json",
    "A-judge-missing-denominator":
        "judge-amendment-1/missing-denominator/initial/evaluation-input-with-gold.json",
    "A-judge-mixed-currencies-and-periods":
        "judge-amendment-1/mixed-currencies-and-periods/initial/evaluation-input-with-gold.json",
    "A-judge-negation-and-old-mandatory-policy":
        "judge-amendment-1/negation-and-old-mandatory-policy/initial/evaluation-input-with-gold.json",
    "A-judge-instruction-inside-document":
        "judge-amendment-1/instruction-inside-document/initial/evaluation-input-with-gold.json",
    "A-recovery-judge-missing-denominator-1":
        "judge-evidence-repair-1/missing-denominator/recovery-1/evaluation-input-with-gold.json",
};
for (const dispatch of accounting.requests) {
    const responsePath = join(pilot, "calls", dispatch.intentId, "response.json");
    const responseBytes = await readFile(responsePath);
    const capture = JSON.parse(responseBytes.toString("utf8"));
    const record = {
        ordinal: dispatch.ordinal,
        intentId: dispatch.intentId,
        caseId: dispatch.caseId,
        scope: "offline-current-guard-replay-not-a-new-generation-or-historical-regrade",
        responseArtifactSha256: digest(responseBytes),
        model: capture.responseModel,
        historicalUsage: capture.usage,
        historicalHttpStatus: capture.httpStatus,
    };
    records.push(record);
    if (!capture.body) {
        record.stage = "provider-no-response";
        record.valid = false;
        continue;
    }
    const body = JSON.parse(capture.body);
    const content = body.choices[0].message.content;
    let raw;
    try {
        raw = JSON.parse(content);
    } catch (error) {
        record.stage = "json-parse";
        record.valid = false;
        record.error = error.message;
        continue;
    }
    if (dispatch.intentId.includes("generation")) {
        const context = await read(
            join(pilot, "freeze", dispatch.caseId, "generation-context-gold-free.json")
        );
        record.originalSummary = raw.experimental?.summary;
        if (raw.experimental?.topics)
            record.sourceUsage = inspectSourceUsageV0(
                context.envelope.evidenceSnapshot.entries.map(entry => entry.source),
                raw.experimental
            );
        const parsed = GenerationCompoundSchemaV2.safeParse(raw);
        if (!parsed.success) {
            record.stage = "compound-schema";
            record.valid = false;
            record.issues = parsed.error.issues;
            continue;
        }
        try {
            const normalized = normalizeGenerationV2(raw, context.envelope);
            record.stage = "normalized-with-current-guards";
            record.valid = true;
            record.normalizedSummaryUnchanged =
                normalized.report.summary === raw.experimental.summary;
            record.currentRefs = normalized.refs;
            record.completenessWithoutNewAttestation = assessEvaluationCompleteness(
                context.envelope
            );
        } catch (error) {
            record.stage = "grounding-and-citations";
            record.valid = false;
            record.error = error.message;
            record.issues = error.issues ?? [];
        }
    } else {
        const inputPath = judgeInputPaths[dispatch.intentId];
        if (!inputPath) throw new Error("Missing exact Judge input binding");
        const input = parseEvaluationInput(await read(join(pilot, inputPath)));
        const units = outputUnits(input);
        const request = { input, outputUnits: units, rubricVersion: RUBRIC_VERSION };
        const preflightJudge = createModelValidationJudge(
            promptModel,
            {
                configurationId: "offline-current-transport-preflight",
                timeoutMs: 60000,
                maxOutputTokens: 4096,
            },
            async (_model, schema, messages) => {
                const prepared = promptModel.prepareMessages([
                    ...llm.systemMessageFor(
                        promptModel.behavior,
                        llm.structuredSchemaInstruction(schema)
                    ),
                    ...messages,
                ]);
                record.currentJudgePreparedPromptBytes = Buffer.byteLength(
                    JSON.stringify(prepared.map(message => message.content)),
                    "utf8"
                );
                if (record.currentJudgePreparedPromptBytes > 24000)
                    throw new Error("Current Judge request exceeds unchanged 24000-byte cap");
                return { result: raw };
            }
        );
        await preflightJudge.evaluate(request, new AbortController().signal);
        record.judgePreflightOnlyNoNewAssessment = true;
        record.scopedEvidenceSchemaValid = judgmentSchemaFor(request).safeParse(raw).success;
        const sources = new Map(input.scenario.documents.map(doc => [doc.id, doc.text]));
        const outputs = new Map(units.map(unit => [unit.id, unit.text]));
        record.invalidEvidence = [...raw.expectations, ...raw.ratings].flatMap(assessment =>
            assessment.evidence.flatMap(evidence => {
                const expectedText = (evidence.kind === "source" ? sources : outputs).get(
                    evidence.id
                );
                return expectedText?.includes(evidence.quote)
                    ? []
                    : [
                          {
                              assessment: assessment.expectationId ?? assessment.criterion,
                              ...evidence,
                              reason:
                                  expectedText === undefined
                                      ? "unknown-exact-id-in-kind-namespace"
                                      : "non-verbatim-quote",
                          },
                      ];
            })
        );
        try {
            validateJudgment(raw, input);
            record.stage = "judgment-evidence-valid";
            record.valid = true;
        } catch (error) {
            record.stage = "judgment-evidence-rejected";
            record.valid = false;
            record.error = error.message;
        }
        record.semanticRegrading = false;
    }
}
const ledgerAfter = await readFile(join(pilot, "ledger/ledger.json"));
if (!ledgerAfter.equals(ledgerBefore)) throw new Error("Historical ledger changed");
const report = {
    version: "vantage-phase-a-offline-audit/v1",
    providerRequests: 0,
    blockedNetworkAttempts,
    historicalPhaseARequests: accounting.phaseA,
    historicalPhaseBRequests: accounting.phaseB,
    historicalLedgerUnchanged: true,
    historicalLedgerSha256: digest(ledgerBefore),
    historicalResultsRegraded: false,
    interpretation:
        "valid means current local guard acceptance of frozen bytes, never a new provider success or semantic quality pass",
    records,
};
await writeFile(
    join(destination, "captured-response-replay.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" }
);
const summary = records
    .map(record => `| ${record.ordinal} | ${record.intentId} | ${record.stage} | ${record.valid} |`)
    .join("\n");
await writeFile(
    join(destination, "captured-response-replay.md"),
    `# Offline captured-response replay\n\nZero provider requests. Historical results unchanged. Valid below means current guard acceptance only.\n\n| # | Original intent | Current local stage | Accepted by local guard |\n| --- | --- | --- | --- |\n${summary}\n`,
    { flag: "wx" }
);
console.log(
    JSON.stringify({
        outputDirectory: destination,
        providerRequests: 0,
        blockedNetworkAttempts,
        records: records.length,
        ledgerUnchanged: true,
    })
);
