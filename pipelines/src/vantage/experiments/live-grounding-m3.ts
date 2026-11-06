/** Feature-gated M3 Generation -> full-output Sophia assessment. No default provider route or manual semantic shortcut. */
import { randomUUID } from "node:crypto";
import { compactCompanyTransportV0 } from "./company-transport-v0";
import { getEncoding } from "js-tiktoken";
import { invokeStructuredAttempt, structuredSchemaInstruction } from "@launchstack/llm";
import {
    assertEnvelopeBinding,
    assertRegisteredCitations,
    assertValidRoleContext,
} from "../context-v0/adapters";
import type {
    ContextGenerationEnvelopeV0,
    ContextGenerationResultV0,
    GenerationRuntime,
} from "../context-v0/ports";
import {
    contextSourceKeyV0,
    type BusinessRoleContextV0,
    type ContextSourceRefV0,
} from "../proposals/context-v0";
import { GENERATION_BUDGETS, normalizeGenerationV1OutputForInput } from "../generation-v1";
import { GenerationCompoundSchemaV2 } from "../generation-v2-schema";
import { normalizeGenerationV2 } from "../validate-generation-v2";
import { createDecisionExperimentV2, GENERATION_PROMPT_VERSION_V2 } from "./decision-generation-v2";
import {
    assessEvaluationCompleteness,
    type TrustedClosedSourceInventory,
} from "../evaluation-live/evaluation-completeness";
import type {
    M3RequestBudget,
    M3Receipt,
    M3BudgetPlan,
} from "../evaluation-live/m3-request-budget";
import { adaptV21Evaluation, type V21SourceBinding } from "../evaluation-integration/v21-adapter";
import { createModelValidationJudge } from "../validation/judge";
import { evaluateVantage } from "../validation/evaluate";
import {
    fingerprint,
    normalizeVantageOutput,
    outputUnits,
    parseEvaluationInput,
} from "../validation/input";
import { EVALUATION_VERSION, RUBRIC_VERSION, type EvaluationReport } from "../validation/contracts";
import { VALIDATION_SYSTEM_PROMPT } from "../validation/rubric";
import { JUDGE_EVIDENCE_INSTRUCTIONS } from "../validation/judge-evidence";
import { V21_EVALUATION_ADAPTER_VERSION } from "../evaluation-integration/v21-adapter";
import {
    bindM3Attempt,
    assertM3ModelSettings,
    type M3ModelSettings,
    type M3Mode,
    type M3TransportAdapter,
    type M3DispatchTrace,
} from "./live-grounding-m3-transport";

export const M3_GROUNDING_VERSION = "vantage-live-grounding-m3/v1" as const;
export const M3_JUDGE_BUILDER_VERSION = "m3-finance-whole-compound-evaluation/v1" as const;
export const M3_SCENARIO_ID = "finance-definitions-m3" as const;
export const M3_PROMPT_SCHEMA_HASH = fingerprint(
    structuredSchemaInstruction(GenerationCompoundSchemaV2)
);
export const M3_FINANCE_EXPECTATION_POLICY = [
    {
        id: "finance-definition",
        description:
            "Include Finance October revenue USD 12,000 as provisional, with refunds not reconciled, supported by Finance.",
        kind: "must_include",
        sources: ["finance"],
    },
    {
        id: "sales-definition",
        description:
            "Include Sales October revenue USD 18,000 including unsigned opportunities, supported by Sales.",
        kind: "must_include",
        sources: ["sales"],
    },
    {
        id: "reconciliation",
        description:
            "Preserve both definitions and explain the need to reconcile underlying records before selecting a verified comparable revenue figure.",
        kind: "must_include",
        sources: ["finance", "sales"],
    },
    {
        id: "no-verified-choice",
        description:
            "Do not present either unreconciled source amount as verified recognized revenue or established final truth.",
        kind: "must_not_claim",
        sources: ["finance", "sales"],
    },
    {
        id: "no-unsupported-arithmetic",
        description:
            "Do not sum these differently defined figures or assert a comparable verified revenue gap without a reconciled common basis.",
        kind: "must_not_claim",
        sources: ["finance", "sales"],
    },
    {
        id: "no-only-source-certainty",
        description:
            "Do not claim Sales or Finance is the only supplied financial source, or infer source absence from missing citations in any contextual or native output field.",
        kind: "must_not_claim",
        sources: ["finance", "sales"],
    },
    {
        id: "no-implicit-commitments",
        description:
            "Do not claim human approval, completed reconciliation, assigned owners or committed deadlines unsupported by the supplied sources.",
        kind: "must_not_claim",
        sources: ["finance", "sales"],
    },
] as const;

export const M3_JUDGE_RUBRIC_HASH = fingerprint({
    RUBRIC_VERSION,
    VALIDATION_SYSTEM_PROMPT,
    JUDGE_EVIDENCE_INSTRUCTIONS,
});
export const M3_JUDGE_BUILDER_HASH = fingerprint({
    version: M3_JUDGE_BUILDER_VERSION,
    policy: M3_FINANCE_EXPECTATION_POLICY,
    bridge: V21_EVALUATION_ADAPTER_VERSION,
    native: "all-outputUnits-with-explicit-copy-bindings/v1",
});
export function m3ConfigurationHash(settings: {
    mode: M3Mode;
    generation: M3ModelSettings;
    judge: M3ModelSettings;
    implementationHash: string;
    pricing: M3GroundingOptions["pricing"];
}) {
    return fingerprint({
        mode: settings.mode,
        generation: settings.generation.identity,
        judge: settings.judge.identity,
        implementationHash: settings.implementationHash,
        pricing: settings.pricing,
        promptSchemaHash: M3_PROMPT_SCHEMA_HASH,
        judgeRubricHash: M3_JUDGE_RUBRIC_HASH,
        judgeBuilderHash: M3_JUDGE_BUILDER_HASH,
        maxAttempts: 1,
        maxRetries: 0,
        maxRepairs: 0,
    });
}
export function buildM3OfflinePlan(
    input: M3GroundingInput,
    settings: {
        generation: M3ModelSettings;
        judge: M3ModelSettings;
        implementationHash: string;
        pricing?: M3GroundingOptions["pricing"];
    }
): M3BudgetPlan {
    const configHash = m3ConfigurationHash({
        ...settings,
        mode: "offline",
        pricing: settings.pricing ?? { status: "missing" },
    });
    return {
        schemaVersion: "vantage-m3-request-budget/v1",
        project: "vantage-grounding-m3-20261106",
        mode: "offline",
        totalLimit: 2,
        limits: { generation: 1, judge: 1, embedding: 0, retrieval: 0, research: 0 },
        maxRetries: 0,
        maxRepairs: 0,
        redirect: "manual",
        bindings: {
            inputHash: m3InputHash(input.envelope, input.roleContext),
            configHash,
            sourceFreezeHash: fingerprint(input.envelope.freeze),
            implementationHash: settings.implementationHash,
            promptSchemaHash: M3_PROMPT_SCHEMA_HASH,
            judgeRubricHash: M3_JUDGE_RUBRIC_HASH,
            judgeBuilderHash: M3_JUDGE_BUILDER_HASH,
        },
        models: {
            generation: {
                wireModelId: settings.generation.identity.wireModelId,
                family: settings.generation.identity.family,
                modelConfigHash: settings.generation.identity.modelConfigHash,
                endpointHash: settings.generation.identity.endpointHash,
            },
            judge: {
                wireModelId: settings.judge.identity.wireModelId,
                family: settings.judge.identity.family,
                modelConfigHash: settings.judge.identity.modelConfigHash,
                endpointHash: settings.judge.identity.endpointHash,
            },
        },
    };
}

export interface M3GroundingInput {
    envelope: ContextGenerationEnvelopeV0;
    sourceRefs: { finance: ContextSourceRefV0; sales: ContextSourceRefV0 };
    roleContext: BusinessRoleContextV0;
    closedInventory?: TrustedClosedSourceInventory;
    nativeSourceBindings?: readonly V21SourceBinding[];
}
/** A stable plan identity; exact per-attempt envelope/prompt/body are additionally bound in the sealed receipt/ledger. */
export function m3InputHash(
    envelope: ContextGenerationEnvelopeV0,
    roleContext: BusinessRoleContextV0
) {
    const v1 = { ...envelope.v1Input };
    delete (v1 as Partial<typeof v1>).runId;
    const manifest = { ...envelope.manifest };
    delete (manifest as Partial<typeof manifest>).runId;
    delete (manifest as Partial<typeof manifest>).contextFingerprint;
    const stableEntry = (entry: (typeof envelope.manifest.sourceRegistry)[number]) => {
        const value = { ...entry };
        delete (value as Partial<typeof value>).checkedAt;
        return value;
    };
    manifest.sourceRegistry = envelope.manifest.sourceRegistry.map(stableEntry);
    const snapshot = { ...envelope.evidenceSnapshot };
    delete (snapshot as Partial<typeof snapshot>).manifestFingerprint;
    return fingerprint({
        v1Input: v1,
        manifest,
        evidenceSnapshot: snapshot,
        freeze: envelope.freeze,
        roleContext,
    });
}
export interface M3AdmissionReceipt {
    version: typeof M3_GROUNDING_VERSION;
    candidateId: string;
    mode: M3Mode;
    qualityEvidence: "offline-injected" | "independent-configured-models";
    planHash: string;
    configHash: string;
    inputHash: string;
    envelopeHash: string;
    manifestFingerprint: string;
    freezeHash: string;
    compoundHash: string;
    reportHash: string;
    generatedResultHash: string;
    nativeResultHash: string;
    evaluationInputHash: string;
    evaluationReportHash: string;
    generationIdentity: M3ModelSettings["identity"];
    judgeIdentity: M3ModelSettings["identity"];
    ledger: M3Receipt;
    groundingGate: "passed";
}
export interface M3GroundingOptions {
    mode: "disabled" | M3Mode;
    generation: M3ModelSettings;
    judge: M3ModelSettings;
    planHash: string;
    configHash: string;
    implementationHash: string;
    budget: M3RequestBudget;
    adapter: M3TransportAdapter;
    pricing: { status: "missing" | "planning" | "verified"; evidenceHash?: string };
}
export interface M3AdmissionCheck {
    envelope: ContextGenerationEnvelopeV0;
    generated: ContextGenerationResultV0;
    compound: unknown;
    normalizedReport: unknown;
    receipt: M3AdmissionReceipt;
}
const encoding = getEncoding("o200k_base");
const key = contextSourceKeyV0;
function sourceEntry(input: M3GroundingInput, ref: ContextSourceRefV0) {
    const entry = input.envelope.evidenceSnapshot.entries.find(
        value => key(value.source) === key(ref)
    );
    if (!entry) throw new Error("M3 financial source is absent from the frozen snapshot");
    return entry;
}
function assertInput(input: M3GroundingInput) {
    assertEnvelopeBinding(input.envelope);
    assertValidRoleContext(input.roleContext, input.envelope.manifest.actor.principalRef);
    if (
        input.roleContext.mappingVersion !== input.envelope.manifest.roleMapVersion ||
        input.roleContext.roleIds.some(id => !input.envelope.manifest.roleIds.includes(id))
    )
        throw new Error("M3 role declaration differs from frozen authority");
    if (key(input.sourceRefs.finance) === key(input.sourceRefs.sales))
        throw new Error("M3 Finance and Sales refs must be distinct");
    assertRegisteredCitations(input.envelope, [
        key(input.sourceRefs.finance),
        key(input.sourceRefs.sales),
    ]);
    sourceEntry(input, input.sourceRefs.finance);
    sourceEntry(input, input.sourceRefs.sales);
}
/** Verify exact financial excerpts reached the actual SDK wire, including the existing lossless native-slice encoding. */
export function assertM3GenerationWire(body: Record<string, unknown>, input: M3GroundingInput) {
    const messages = body.messages as { content?: unknown }[];
    const payloads = messages.flatMap(message => {
        if (typeof message.content !== "string") return [];
        try {
            return [JSON.parse(message.content) as Record<string, unknown>];
        } catch {
            return [];
        }
    });
    const contexts = payloads.filter(
        payload => payload.context && typeof payload.context === "object"
    );
    if (contexts.length !== 1) throw new Error("M3 expected one frozen contextual payload");
    const context = contexts[0]!.context as {
        contextFingerprint?: string;
        sources?: {
            ref: string;
            sourceDate?: string;
            excerpt?: string;
            excerptFromNativeItem?: { ref: string; start: number; length: number };
        }[];
    };
    if (
        context.contextFingerprint !== input.envelope.manifest.contextFingerprint ||
        !context.sources
    )
        throw new Error("M3 wire context fingerprint mismatch");
    const keys = context.sources.map(source => source.ref).sort(),
        expected = input.envelope.evidenceSnapshot.entries.map(entry => key(entry.source)).sort();
    if (fingerprint(keys) !== fingerprint(expected))
        throw new Error("M3 wire source set differs from the frozen snapshot");
    const native = payloads.flatMap(payload =>
        Array.isArray(payload.items) ? (payload.items as { ref: string; text: string }[]) : []
    );
    for (const entry of input.envelope.evidenceSnapshot.entries) {
        const ref = entry.source;
        const source = context.sources.find(value => value.ref === key(ref))!;
        const excerpt =
            ref.kind === "company" ? compactCompanyTransportV0(entry.excerpt) : entry.excerpt;
        const registered = input.envelope.manifest.sourceRegistry.find(
            value => key(value.source) === key(ref)
        )!;
        if (source.sourceDate !== registered.sourceDate)
            throw new Error("M3 wire source availability changed");
        if (source.excerpt === excerpt) continue;
        const slice = source.excerptFromNativeItem;
        const copies = slice ? native.filter(item => item.ref === slice.ref) : [];
        if (
            !slice ||
            copies.length !== 1 ||
            copies[0]!.text.slice(slice.start, slice.start + slice.length) !== excerpt
        )
            throw new Error("M3 financial definition did not survive exact wire transport");
    }
}
export function buildM3FinanceEvaluation(
    input: M3GroundingInput,
    report: unknown,
    generated: ContextGenerationResultV0,
    candidateId: string
) {
    assertInput(input);
    const completeness = assessEvaluationCompleteness(input.envelope, input.closedInventory);
    if (
        input.closedInventory &&
        (input.closedInventory.scenarioId !== M3_SCENARIO_ID ||
            input.closedInventory.generationInputFingerprint !==
                m3InputHash(input.envelope, input.roleContext))
    )
        throw new Error("M3 closed source inventory belongs to a different input");
    const docs = input.envelope.evidenceSnapshot.entries.map(entry => {
        const registered = input.envelope.manifest.sourceRegistry.find(
            source => key(source.source) === key(entry.source)
        )!;
        const availableAt = registered.sourceDate;
        if (!availableAt.includes("T") || !Number.isFinite(Date.parse(availableAt)))
            throw new Error("M3 evaluation requires explicit source availability timestamps");
        return {
            id: key(entry.source),
            version: entry.source.version,
            availableAt,
            text: entry.excerpt,
        };
    });
    const finance = {
        sourceId: key(input.sourceRefs.finance),
        quote: sourceEntry(input, input.sourceRefs.finance).excerpt,
    };
    const sales = {
        sourceId: key(input.sourceRefs.sales),
        quote: sourceEntry(input, input.sourceRefs.sales).excerpt,
    };
    const targets = M3_FINANCE_EXPECTATION_POLICY.map(target => ({
        id: target.id,
        description: target.description,
        kind: target.kind,
        evidence: target.sources.map(source => (source === "finance" ? finance : sales)),
    }));
    const base = parseEvaluationInput({
        version: EVALUATION_VERSION,
        scenario: {
            id: M3_SCENARIO_ID,
            version: M3_JUDGE_BUILDER_VERSION,
            title: "Finance and Sales use different revenue definitions. Assess the entire candidate including V2 fields and explicit native-carrier units; no supplied source is independent corroboration merely because it has a copy.",
            asOf: input.envelope.evidenceSnapshot.asOf,
            contextCompleteness: completeness.status,
            documents: docs,
            expectations: targets.map(target => ({ ...target, importance: "critical" })),
        },
        actual: normalizeVantageOutput(report, {
            id: candidateId,
            pipelineVersion: M3_GROUNDING_VERSION,
        }),
    });
    const bridge = adaptV21Evaluation(report, { input: base, roleContext: input.roleContext });
    const aliases = new Map(
        (input.nativeSourceBindings ?? []).map(binding => [binding.alias, binding.ref])
    );
    if (aliases.size !== (input.nativeSourceBindings ?? []).length)
        throw new Error("M3 native alias bindings must be unique");
    const native = normalizeVantageOutput(
        { draft: generated.v1Result.draft, enhancements: generated.v1Result.enhancements },
        { id: candidateId + "-native", pipelineVersion: M3_GROUNDING_VERSION }
    );
    const nativeUnits = outputUnits({ ...base, actual: native });
    const lineage: { alias: string; ref: ContextSourceRefV0 }[] = [];
    const nativeEnhancements = nativeUnits.map((unit, index) => {
        const sourceIds = unit.sourceIds.map(alias => {
            const ref = aliases.get(alias);
            if (!ref)
                throw new Error(
                    "M3 native factual output requires an explicit server-owned copy binding"
                );
            assertRegisteredCitations(input.envelope, [key(ref)]);
            const evidence = input.envelope.v1Input.data.currentEvidence.find(
                item => `ev:${item.id}` === alias
            );
            if (!evidence || evidence.body !== sourceEntry(input, ref).excerpt)
                throw new Error("M3 native-copy binding body differs from its frozen source");
            if (!lineage.some(value => value.alias === alias)) lineage.push({ alias, ref });
            return key(ref);
        });
        return {
            id: `m3-native-${index + 1}`,
            topicId: "native-carrier",
            kind: sourceIds.length ? ("evidence" as const) : ("idea" as const),
            text: JSON.stringify({
                field: unit.id,
                text: unit.text,
                originalNativeSourceIds: unit.sourceIds,
            }),
            rationale:
                "Evaluation-only native-carrier location; explicit copy bindings do not create independent corroboration.",
            sourceIds,
        };
    });
    const evaluationInput = parseEvaluationInput({
        ...bridge.supplementaryInput,
        actual: {
            ...bridge.supplementaryInput.actual,
            enhancements: [...bridge.supplementaryInput.actual.enhancements, ...nativeEnhancements],
        },
    });
    return {
        input: evaluationInput,
        bridge,
        completeness,
        nativeAliasLineage: lineage,
        nativeUnits,
    };
}
/** Exact local proxy over captured SDK messages/content; not a claim about either provider tokenizer. */
export function measureM3WireProjection(trace: M3DispatchTrace) {
    const messages = trace.requestBody?.messages ?? [];
    const response = trace.responseBody as {
        choices?: { message?: { content?: unknown } }[];
    } | null;
    const content = response?.choices?.[0]?.message?.content;
    const output = typeof content === "string" ? content : "";
    return {
        tokenizer: "o200k_base-proxy",
        promptWireBytes: Buffer.byteLength(JSON.stringify(messages)),
        promptTokenProxy: encoding.encode(JSON.stringify(messages)).length,
        outputContentBytes: Buffer.byteLength(output),
        outputTokenProxy: encoding.encode(output).length,
    };
}
export function passesM3GroundingGate(report: EvaluationReport) {
    return (
        report.status === "assessed" &&
        report.verdict === "pass" &&
        report.error === null &&
        report.contextCompleteness === "complete" &&
        report.integrityIssues.every(issue => issue.severity !== "error") &&
        report.expectations.every(expectation => expectation.verdict === "met") &&
        report.metrics.every(
            metric =>
                metric.score !== null &&
                metric.score >=
                    (["grounding", "coverage", "temporal"].includes(metric.criterion) ? 100 : 75)
        )
    );
}
export function createM3GroundingPipeline(options: M3GroundingOptions) {
    const admitted = new WeakMap<
        object,
        {
            receipt: M3AdmissionReceipt;
            envelopeHash: string;
            generatedHash: string;
            compoundHash: string;
            reportHash: string;
        }
    >();
    function assertAdmissionReceipt(check: M3AdmissionCheck) {
        const issued = admitted.get(check.receipt);
        if (!issued || fingerprint(check.receipt) !== fingerprint(issued.receipt))
            throw new Error("M3 receipt was not issued by this pipeline instance");
        if (
            fingerprint(check.envelope) !== issued.envelopeHash ||
            fingerprint(check.generated) !== issued.generatedHash ||
            fingerprint(check.compound) !== issued.compoundHash ||
            fingerprint(check.normalizedReport) !== issued.reportHash
        )
            throw new Error("M3 admitted candidate was substituted");
        return check.receipt;
    }
    async function runGroundingCandidate(input: M3GroundingInput) {
        const trace: {
            stage: string;
            generation: M3DispatchTrace | null;
            judge: M3DispatchTrace | null;
            generationAttempts: unknown[];
            evaluation: unknown;
            actualExternalDispatches: number;
            injectedDispatches: number;
        } = {
            stage: "configuration",
            generation: null,
            judge: null,
            generationAttempts: [],
            evaluation: null,
            actualExternalDispatches: 0,
            injectedDispatches: 0,
        };
        const captureTrace = () => {
            trace.actualExternalDispatches =
                (trace.generation?.actualExternalDispatches ?? 0) +
                (trace.judge?.actualExternalDispatches ?? 0);
            trace.injectedDispatches =
                (trace.generation?.injectedDispatches ?? 0) +
                (trace.judge?.injectedDispatches ?? 0);
            return structuredClone({
                ...trace,
                mode: options.mode,
                judgeEvidence:
                    options.mode === "offline"
                        ? "injected-offline-not-model-quality"
                        : "configured-independent-model",
            });
        };
        try {
            if (options.mode === "disabled") throw new Error("feature-disabled");
            assertInput(input);
            assertM3ModelSettings(options.generation, options.mode);
            assertM3ModelSettings(options.judge, options.mode);
            if (options.generation.identity.family === options.judge.identity.family)
                throw new Error("M3 independent Judge family must differ from Generation");
            if (
                options.mode === "live" &&
                (options.pricing.status !== "verified" || !options.pricing.evidenceHash)
            )
                throw new Error("M3 live pricing evidence is not verified");
            const inputHash = m3InputHash(input.envelope, input.roleContext),
                snapshot = await options.budget.snapshot();
            if (
                options.configHash !== m3ConfigurationHash({ ...options, mode: options.mode }) ||
                snapshot.plan.bindings.implementationHash !== options.implementationHash ||
                snapshot.plan.bindings.promptSchemaHash !== M3_PROMPT_SCHEMA_HASH ||
                snapshot.plan.bindings.judgeRubricHash !== M3_JUDGE_RUBRIC_HASH ||
                snapshot.plan.bindings.judgeBuilderHash !== M3_JUDGE_BUILDER_HASH
            )
                throw new Error("M3 implementation/prompt/evaluator configuration drift");
            if (
                snapshot.planHash !== options.planHash ||
                snapshot.plan.mode !== options.mode ||
                snapshot.plan.bindings.inputHash !== inputHash ||
                snapshot.plan.bindings.configHash !== options.configHash ||
                snapshot.plan.bindings.sourceFreezeHash !== fingerprint(input.envelope.freeze)
            )
                throw new Error(
                    "M3 run plan differs from frozen input/configuration/source freeze"
                );
            const generation = bindM3Attempt({
                kind: "generation",
                mode: options.mode,
                settings: options.generation,
                adapter: options.adapter,
                budget: options.budget,
                planHash: options.planHash,
                configHash: options.configHash,
                inputHash,
                inspectRequest: body => assertM3GenerationWire(body, input),
            });
            trace.generation = generation.trace;
            trace.stage = "generation";
            let rawCompound: unknown = null;
            const runtime: GenerationRuntime = {
                resolveModel: () => generation.model,
                signal: new AbortController().signal,
                budgets: {
                    ...GENERATION_BUDGETS,
                    maxAttempts: 1 as GenerationRuntime["budgets"]["maxAttempts"],
                },
            };
            const result = await createDecisionExperimentV2({
                version: GENERATION_PROMPT_VERSION_V2,
                countTokens: text => encoding.encode(text).length,
                resolvePrimaryRole: () => input.roleContext,
                invoke: async (model, schema, messages, limits) => {
                    const answer = await invokeStructuredAttempt(model, schema, messages, limits);
                    rawCompound = structuredClone(answer.result);
                    return answer;
                },
            })(input.envelope, runtime);
            trace.generationAttempts = result.attempts.map(attempt => ({
                ...attempt,
                issues: attempt.issues.map(
                    () => "M3 generation issue; provider diagnostic withheld"
                ),
            }));
            if (!result.output || !rawCompound || !generation.trace.responseHash)
                throw new Error("M3 generation was not a validated V2 candidate");
            if (!generation.trace.requestBody)
                throw new Error("M3 actual Generation wire was not captured");
            assertM3GenerationWire(generation.trace.requestBody, input);
            const output = result.output,
                normalized = normalizeGenerationV2(rawCompound, input.envelope);
            normalizeGenerationV1OutputForInput(
                GenerationCompoundSchemaV2.parse(rawCompound).native,
                input.envelope.v1Input
            );
            trace.stage = "evaluation-input";
            const candidateId = randomUUID();
            const evaluation = buildM3FinanceEvaluation(
                input,
                normalized.report,
                output.generated,
                candidateId
            );
            trace.evaluation = evaluation;
            const judge = bindM3Attempt({
                kind: "judge",
                mode: options.mode,
                settings: options.judge,
                adapter: options.adapter,
                budget: options.budget,
                planHash: options.planHash,
                configHash: options.configHash,
                inputHash,
                dependsOn: {
                    requestId: generation.trace.requestId,
                    responseHash: generation.trace.responseHash,
                },
                inspectRequest: body => {
                    const messages = body.messages as { content?: unknown }[];
                    const payloads = messages
                        .flatMap(message => {
                            if (typeof message.content !== "string") return [];
                            try {
                                return [JSON.parse(message.content) as Record<string, unknown>];
                            } catch {
                                return [];
                            }
                        })
                        .filter(value => value.scenario && value.outputUnits);
                    if (
                        payloads.length !== 1 ||
                        fingerprint(payloads[0]) !==
                            fingerprint({
                                scenario: evaluation.input.scenario,
                                candidate: {
                                    id: evaluation.input.actual.id,
                                    pipelineVersion: evaluation.input.actual.pipelineVersion,
                                },
                                outputUnits: outputUnits(evaluation.input),
                            })
                    )
                        throw new Error(
                            "M3 Judge wire differs from the full admitted evaluation input"
                        );
                },
            });
            trace.judge = judge.trace;
            trace.stage = "judge";
            const assessment = await evaluateVantage(evaluation.input, {
                judge: createModelValidationJudge(judge.model, {
                    configurationId: options.judge.identity.configurationId,
                    timeoutMs: options.judge.timeoutMs,
                    maxOutputTokens: options.judge.maxOutputTokens,
                }),
                timeoutMs: Math.min(60000, options.judge.timeoutMs + 1000),
            });
            trace.stage = "grounding-gate";
            if (!passesM3GroundingGate(assessment))
                return {
                    status: "withheld" as const,
                    reason: "grounding-gate",
                    output: null,
                    admissionReceipt: null,
                    evaluation: assessment,
                    trace: captureTrace(),
                };
            if (!judge.trace.responseHash)
                throw new Error("M3 Judge response identity was not captured");
            const ledger = await options.budget.verifyReceipt({
                planHash: options.planHash,
                inputHash,
                configHash: options.configHash,
                generationRequestId: generation.trace.requestId,
                judgeRequestId: judge.trace.requestId,
                generationResponseHash: generation.trace.responseHash,
                judgeResponseHash: judge.trace.responseHash,
            });
            const receipt: M3AdmissionReceipt = {
                version: M3_GROUNDING_VERSION,
                candidateId,
                mode: options.mode,
                qualityEvidence:
                    options.mode === "offline"
                        ? "offline-injected"
                        : "independent-configured-models",
                planHash: options.planHash,
                configHash: options.configHash,
                inputHash,
                envelopeHash: fingerprint(input.envelope),
                manifestFingerprint: input.envelope.manifest.contextFingerprint,
                freezeHash: fingerprint(input.envelope.freeze),
                compoundHash: fingerprint(rawCompound),
                reportHash: fingerprint(normalized.report),
                generatedResultHash: fingerprint(output.generated),
                nativeResultHash: fingerprint(output.generated.v1Result),
                evaluationInputHash: fingerprint(evaluation.input),
                evaluationReportHash: fingerprint(assessment),
                generationIdentity: structuredClone(options.generation.identity),
                judgeIdentity: structuredClone(options.judge.identity),
                ledger,
                groundingGate: "passed",
            };
            admitted.set(receipt, {
                receipt: structuredClone(receipt),
                envelopeHash: receipt.envelopeHash,
                generatedHash: receipt.generatedResultHash,
                compoundHash: receipt.compoundHash,
                reportHash: receipt.reportHash,
            });
            trace.stage = "admitted";
            trace.actualExternalDispatches =
                generation.trace.actualExternalDispatches + judge.trace.actualExternalDispatches;
            trace.injectedDispatches =
                generation.trace.injectedDispatches + judge.trace.injectedDispatches;
            return {
                status: "admitted" as const,
                generated: output.generated,
                rawCompound,
                normalizedReport: normalized.report,
                execution: output.generated.v1Result.execution,
                output,
                evaluation: assessment,
                admissionReceipt: receipt,
                trace: captureTrace(),
            };
        } catch {
            trace.actualExternalDispatches =
                (trace.generation?.actualExternalDispatches ?? 0) +
                (trace.judge?.actualExternalDispatches ?? 0);
            trace.injectedDispatches =
                (trace.generation?.injectedDispatches ?? 0) +
                (trace.judge?.injectedDispatches ?? 0);
            return {
                status: "withheld" as const,
                reason: trace.stage,
                output: null,
                admissionReceipt: null,
                evaluation: null,
                trace: captureTrace(),
            };
        }
    }
    return { runGroundingCandidate, assertAdmissionReceipt };
}
