import { getEncoding } from "js-tiktoken";
import { coerceMessageLikeToMessage } from "@langchain/core/messages";
import type { ResolvedChatModel } from "@launchstack/llm";
import sources from "../../../../fixtures/vantage-finance-milestone/sources.json";
import { assertEnvelopeBinding, assertRegisteredCitations } from "../context-v0/adapters";
import type { ContextGenerationEnvelopeV0, GenerationRuntime } from "../context-v0/ports";
import type { BusinessRoleContextV0, ContextSourceRefV0 } from "../proposals/context-v0";
import { contextSourceKeyV0 } from "../proposals/context-v0";
import { GENERATION_BUDGETS } from "../generation-v1";
import { GenerationCompoundSchemaV2 } from "../generation-v2-schema";
import {
    createDecisionExperimentV2,
    GENERATION_PROMPT_VERSION_V2,
    outputSizeV2,
} from "./decision-generation-v2";

export type FinanceMilestoneRefs = { finance: ContextSourceRefV0; sales: ContextSourceRefV0 };
/** Test harness configuration only. Never select a variant from a public request. */
export type FinanceMilestoneVariant = "corrected" | "omission" | "malformed";

export function buildFinanceMilestoneCompound(
    envelope: ContextGenerationEnvelopeV0,
    refs: FinanceMilestoneRefs,
    variant: FinanceMilestoneVariant = "corrected"
) {
    assertEnvelopeBinding(envelope);
    const keys = {
        finance: contextSourceKeyV0(refs.finance),
        sales: contextSourceKeyV0(refs.sales),
    };
    if (keys.finance === keys.sales)
        throw new Error("Finance and Sales require distinct exact source refs");
    assertRegisteredCitations(envelope, Object.values(keys));
    for (const name of ["finance", "sales"] as const) {
        const entry = envelope.evidenceSnapshot.entries.find(
            e => contextSourceKeyV0(e.source) === keys[name]
        );
        if (!entry?.excerpt.includes(sources[name]))
            throw new Error(`Frozen ${name} source does not contain the milestone source text`);
    }
    const omitted = variant === "omission";
    const summary = omitted
        ? "Sales reports USD 18,000 including unsigned opportunities; reconcile the definition before reporting verified revenue."
        : "Finance reports provisional October revenue of USD 12,000 with refunds unreconciled; Sales reports USD 18,000 including unsigned opportunities. Reconcile their definitions before selecting a verified amount.";
    const facts = [
        ...(!omitted ? [{ text: sources.finance, refs: [keys.finance] }] : []),
        { text: sources.sales, refs: [keys.sales] },
    ];
    const topic = {
        title: "Reconcile October revenue definitions",
        facts,
        conflicts: omitted
            ? []
            : [
                  {
                      text: "The records use different definitions; reconciliation is required before selecting a verified figure.",
                      refs: Object.values(keys),
                  },
              ],
        whyItMatters:
            "The supplied definitions do not establish a verified comparable revenue amount.",
        decisionQuestion:
            "Which reconciled definition and transaction set should be used for October revenue?",
        proposedNextStep:
            "Compare transaction lists, reconcile refunds, and exclude unsigned opportunities from any recognized revenue view before selecting a verified figure.",
        proposedOwner: null,
        proposedDueInDays: null,
        helpRequested: null,
        unknowns: ["A reconciled revenue amount is not established by the supplied records."],
        rationale: "The records require reconciliation before a reliable reporting decision.",
        whyNow: "The supplied reporting definitions differ and need review before a figure is selected.",
        recommendation: {
            call: "Reconcile the source definitions and underlying transactions before reporting verified revenue.",
            confidence: "medium" as const,
            because:
                "Unsigned opportunities are included in Sales; the records do not establish a reconciled amount.",
            refs: omitted ? [keys.sales] : Object.values(keys),
            wouldChangeIf:
                "A reconciled transaction set and refund treatment establish a comparable reporting basis.",
        },
    };
    const pair = GenerationCompoundSchemaV2.parse({
        native: {
            summary: "Required contextual documents need review.",
            topics: [],
            enhancements: [],
        },
        experimental: {
            summary,
            headline: "Reconcile revenue definitions before selecting a verified figure.",
            brief: summary,
            keyFigures: [
                ...(!omitted
                    ? [
                          {
                              label: "Finance provisional",
                              value: "USD 12,000",
                              tone: "concern",
                              refs: [keys.finance],
                          },
                      ]
                    : []),
                {
                    label: "Sales incl. unsigned",
                    value: "USD 18,000",
                    tone: "concern",
                    refs: [keys.sales],
                },
            ],
            topics: [topic],
            enhancements: [],
        },
    });
    // Deliberately invalid model response for the negative transport/schema check.
    return variant === "malformed"
        ? { ...pair, experimental: { ...pair.experimental, headline: "" } }
        : pair;
}

/** No real provider/model is constructed; only message formatting is supplied. */
export function createFinanceMilestoneRuntime(
    signal = new AbortController().signal
): GenerationRuntime {
    const model = {
        modelId: "offline-finance-milestone-replay",
        behavior: { parameters: { systemMessages: "supported" } },
        prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
            messages.map(coerceMessageLikeToMessage),
    } as unknown as ResolvedChatModel;
    return {
        resolveModel: () => model,
        signal,
        // Legacy runtime type pins this field to literal 2; this harness narrows execution to 1.
        budgets: {
            ...GENERATION_BUDGETS,
            maxAttempts: 1 as GenerationRuntime["budgets"]["maxAttempts"],
        },
    };
}

const encoding = getEncoding("o200k_base");
function countFinanceMilestoneTokens(text: string) {
    return encoding.encode(text).length;
}
/** Same deterministic proxy output bound used by the replay runner; no provider mapping claim. */
export function financeMilestoneOutputSize(compound: unknown) {
    return outputSizeV2(compound, countFinanceMilestoneTokens);
}
export async function runFinanceMilestoneGeneration(options: {
    envelope: ContextGenerationEnvelopeV0;
    sourceRefs: FinanceMilestoneRefs;
    runtime?: GenerationRuntime;
    resolvePrimaryRole?: (identity: {
        principalRef: string;
        companyId: string;
    }) => BusinessRoleContextV0 | null;
    variant?: FinanceMilestoneVariant;
}) {
    const variant = options.variant ?? "corrected";
    const compound = buildFinanceMilestoneCompound(options.envelope, options.sourceRefs, variant);
    const trace = {
        variant,
        invocations: 0,
        compound,
        promptMessages: [] as { type: string; content: unknown }[],
        transport: "deterministic-injected-no-provider" as const,
    };
    const runtime = options.runtime ?? createFinanceMilestoneRuntime();
    const result = await createDecisionExperimentV2({
        version: GENERATION_PROMPT_VERSION_V2,
        resolvePrimaryRole: options.resolvePrimaryRole,
        // Proxy tokenizer only; no actual provider mapping is asserted.
        countTokens: countFinanceMilestoneTokens,
        invoke: async (_model, _schema, messages) => {
            trace.invocations += 1;
            if (trace.invocations > 1)
                throw new Error("Milestone replay permits one transport invocation");
            trace.promptMessages = messages.map(value => {
                const message = coerceMessageLikeToMessage(value);
                return { type: message.getType(), content: message.content };
            });
            return {
                result: structuredClone(compound) as ReturnType<typeof _schema.parse>,
                usage: { outputTokens: 0 },
            };
        },
    })(options.envelope, {
        ...runtime,
        budgets: {
            ...runtime.budgets,
            maxAttempts: 1 as GenerationRuntime["budgets"]["maxAttempts"],
        },
    });
    return {
        ...result,
        trace: {
            ...trace,
            validatedCompound: result.output ? GenerationCompoundSchemaV2.parse(compound) : null,
        },
    };
}

/** Bounded deterministic manual-review checklist; this is not an independent/model Judge. */
export function evaluateFinanceMilestoneReport(report: unknown, refs: FinanceMilestoneRefs) {
    const issues: string[] = [];
    const value = report as {
        topics?: {
            facts?: { text?: string; refs?: ContextSourceRefV0[] }[];
            proposedOwner?: unknown;
            proposedDue?: unknown;
            helpRequested?: unknown;
        }[];
    } | null;
    const facts = value?.topics?.flatMap(topic => topic.facts ?? []) ?? [];
    for (const name of ["finance", "sales"] as const) {
        const bound = facts.filter(fact =>
            fact.refs?.some(ref => contextSourceKeyV0(ref) === contextSourceKeyV0(refs[name]))
        );
        if (!bound.some(fact => fact.text?.includes(sources[name])))
            issues.push(`${name}: exact amount and qualifications missing from cited facts`);
    }
    const serialized = JSON.stringify(report);
    if (/\b(?:6,?000|30,?000)\b/.test(serialized))
        issues.push("unsupported arithmetic across differing revenue definitions");
    if (
        /verified\s+(?:October\s+)?revenue\s+(?:is|of|equals)\s+(?:USD\s*)?(?:12,?000|18,?000)/i.test(
            serialized
        )
    )
        issues.push("unreconciled source amount selected as verified revenue");
    if (
        value?.topics?.some(
            t => t.proposedOwner !== null || t.proposedDue !== null || t.helpRequested !== null
        )
    )
        issues.push("implicit assignment or commitment fields");
    return {
        kind: "deterministic-manual-checklist" as const,
        passed: issues.length === 0,
        issues,
        modelJudgeUsed: false as const,
    };
}
