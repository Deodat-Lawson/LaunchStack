/** New deterministic role-pair plumbing pilot; original benchmark outputs/scores are untouched. */
import { getEncoding } from "js-tiktoken";
import { coerceMessageLikeToMessage } from "@langchain/core/messages";
import {
    systemMessageFor,
    structuredSchemaInstruction,
    type ResolvedChatModel,
} from "@launchstack/llm";
import sources from "../../../../fixtures/vantage-role-pair-milestone/sources.json";
import {
    assertEnvelopeBinding,
    assertRegisteredCitations,
    assertValidRoleContext,
} from "../context-v0/adapters";
import type { ContextGenerationEnvelopeV0, GenerationRuntime } from "../context-v0/ports";
import {
    contextSourceKeyV0,
    validateDynamicRetrievalBundle,
    type BusinessRoleContextV0,
    type ContextSourceRefV0,
    type DynamicRetrievalBundleV0,
} from "../proposals/context-v0";
import { canonicalRoleV0, resolveRoleSelectionV0, roleDirectoryV0 } from "../role-context-v0/roles";
import { GENERATION_BUDGETS } from "../generation-v1";
import { GenerationCompoundSchemaV2 } from "../generation-v2-schema";
import {
    createDecisionExperimentV2,
    GENERATION_PROMPT_VERSION_V2,
    outputSizeV2,
} from "./decision-generation-v2";

export type RolePairLogicalKey =
    | "D01"
    | "D02"
    | "D03"
    | "D04"
    | "D05"
    | "D06"
    | "D07"
    | "D08"
    | "D09"
    | "D10";
export type RoleMilestoneRefs = Record<RolePairLogicalKey, ContextSourceRefV0>;
export type RolePairPriorityPlan = {
    kind: "trusted-primary-and-retrieval-before-generation";
    persona: "mapped" | "neutral";
    primaryRoleId: string | null;
    mappingVersion: string;
    priorities: string[];
    topics: {
        logicalKey: "D01" | "D08";
        primaryRoleMatch: boolean;
        retrievalRank: number;
        matchedRoleIds: string[];
        selectionReason: string;
    }[];
};
export interface RoleMilestoneInput {
    envelope: ContextGenerationEnvelopeV0;
    sourceRefs: RoleMilestoneRefs;
    roleContext: BusinessRoleContextV0;
    ranking: DynamicRetrievalBundleV0;
}
const key = contextSourceKeyV0;
const pairRoleIds = ["partnerships-lead", "security-engineer"];
const sourceText = (id: string) =>
    sources.documents.find(document => document.logicalKey === id)!.text;

export function buildRolePairPriorityPlan(input: RoleMilestoneInput): RolePairPriorityPlan {
    const { envelope, sourceRefs, roleContext, ranking } = input;
    assertEnvelopeBinding(envelope);
    assertValidRoleContext(roleContext, envelope.manifest.actor.principalRef);
    if (
        roleContext.mappingVersion !== envelope.manifest.roleMapVersion ||
        roleContext.mappingVersion !== roleDirectoryV0().mapVersion ||
        roleContext.roleIds.some(id => !envelope.manifest.roleIds.includes(id))
    )
        throw new Error("Role directory or manifest binding mismatch");
    if (new Set(Object.values(sourceRefs).map(key)).size !== 10)
        throw new Error("The role pair requires ten distinct exact source refs");
    assertRegisteredCitations(envelope, Object.values(sourceRefs).map(key));
    for (const document of sources.documents) {
        const ref = sourceRefs[document.logicalKey as RolePairLogicalKey];
        const entry = envelope.evidenceSnapshot.entries.find(item => key(item.source) === key(ref));
        if (!entry?.excerpt.includes(document.text))
            throw new Error(`Frozen source text mismatch: ${document.logicalKey}`);
    }
    const checked = validateDynamicRetrievalBundle(ranking, {
        contractVersion: "v0-proposed",
        actor: envelope.manifest.actor,
        reportWindow: envelope.manifest.reportWindow,
        verifiedRoleContext: roleContext,
        sourceCatalog: envelope.manifest.sourceRegistry,
        budgets: {
            maxSources: 20,
            maxExcerptChars: 60000,
            maxTokens: 20000,
            maxQueries: 6,
            timeoutMs: 5000,
        },
    });
    if (!checked.ok) throw new Error("Retrieval ranking does not bind to the role-pair envelope");
    const canonical = resolveRoleSelectionV0({
        principalRef: roleContext.authenticatedPrincipalRef,
        values: roleContext.roleIds,
        primaryRoleId: roleContext.primaryRoleId,
        confirmed: roleContext.userConfirmed,
    });
    const mapped =
        roleContext.userConfirmed &&
        !roleContext.fallback &&
        roleContext.provenance.kind !== "fallback" &&
        !!roleContext.primaryRoleId &&
        pairRoleIds.includes(roleContext.primaryRoleId) &&
        canonicalRoleV0(roleContext.primaryRoleId) === roleContext.primaryRoleId &&
        pairRoleIds.every(id => roleContext.roleIds.includes(id)) &&
        JSON.stringify(canonical.roles) === JSON.stringify(roleContext.roles);
    const primary = mapped ? roleContext.primaryRoleId! : null;
    const ranked = [
        ...ranking.roleMatches,
        ...ranking.recentChanges,
        ...ranking.unresolvedOlderItems,
    ];
    const topics = (["D01", "D08"] as const)
        .map(logicalKey => {
            const item = ranked.find(value => key(value.source) === key(sourceRefs[logicalKey]));
            if (!item)
                throw new Error(
                    `Consequential topic missing from actual retrieval ranking: ${logicalKey}`
                );
            return {
                logicalKey,
                primaryRoleMatch: primary !== null && item.roleIds.includes(primary),
                retrievalRank: item.rank,
                matchedRoleIds: [...item.roleIds],
                selectionReason: item.selectionReason,
            };
        })
        .sort(
            (a, b) => a.retrievalRank - b.retrievalRank || a.logicalKey.localeCompare(b.logicalKey)
        );
    if (mapped && !topics[0]!.primaryRoleMatch)
        throw new Error("Actual ranking does not prioritize the verified primary role");
    if (mapped && topics.some(topic => !topic.selectionReason.includes(`primaryRole=${primary};`)))
        throw new Error("Primary-role retrieval preference was not enabled for the actual ranking");
    return {
        kind: "trusted-primary-and-retrieval-before-generation",
        persona: mapped ? "mapped" : "neutral",
        primaryRoleId: primary,
        mappingVersion: roleContext.mappingVersion,
        priorities: primary
            ? [...roleContext.roles.find(role => role.roleId === primary)!.priorities]
            : [],
        topics,
    };
}

function compoundForTrustedPlan(
    input: RoleMilestoneInput,
    plan = buildRolePairPriorityPlan(input)
) {
    const refs = input.sourceRefs;
    const pitch = {
        title: "Check readiness for the proposed pitch",
        facts: [
            { text: sourceText("D01"), refs: [key(refs.D01)] },
            { text: sourceText("D03"), refs: [key(refs.D03)] },
        ],
        conflicts: [],
        whyItMatters:
            "The draft and fund criteria call for preparation; they do not establish an accepted invitation or sponsorship.",
        decisionQuestion:
            "Can the remaining slides be ready for the proposed pitch after the invitation is confirmed?",
        proposedNextStep:
            "Confirm the invitation and remaining slide work, then assess whether the proposed date is feasible or a revised scope is needed.",
        proposedOwner: null,
        proposedDueInDays: null,
        helpRequested: null,
        unknowns: [
            "An accepted invitation and completed impact and budget slides are not established by the supplied draft.",
        ],
        rationale:
            "The sponsorship draft proposes a presentation while its impact and budget slides remain unfinished.",
        whyNow: "The draft proposes a November 4 pitch while key slides and an accepted invitation remain unresolved.",
        recommendation: {
            call: "Confirm the invitation and assess remaining impact and budget slide work before deciding whether to proceed.",
            confidence: "medium" as const,
            because:
                "The source is a draft with unfinished slides; the fund criteria do not guarantee funding.",
            refs: [key(refs.D01), key(refs.D03)],
            wouldChangeIf:
                "An accepted invitation and a credible slide completion plan establish readiness.",
        },
    };
    const access = {
        title: "Prepare the shared-admin access review",
        facts: [{ text: sourceText("D08"), refs: [key(refs.D08)] }],
        conflicts: [],
        whyItMatters:
            "The checklist records a review deadline without establishing completion or final sign-off.",
        decisionQuestion: "What must be completed for the scheduled shared-admin access review?",
        proposedNextStep:
            "Check the access-review checklist and unresolved items, then confirm the evidence needed for completion and final sign-off.",
        proposedOwner: null,
        proposedDueInDays: null,
        helpRequested: null,
        unknowns: [
            "Completed review evidence and final sign-off are not present in the supplied checklist.",
        ],
        rationale:
            "The security checklist records an upcoming access review with completion and final sign-off outstanding.",
        whyNow: "The shared-admin access review is due November 5, with no completion or final sign-off in the current checklist.",
        recommendation: {
            call: "Review unresolved access items and confirm what evidence is needed for the scheduled review and final sign-off.",
            confidence: "medium" as const,
            because:
                "The current checklist records the review deadline without a completed review or final sign-off.",
            refs: [key(refs.D08)],
            wouldChangeIf:
                "Current evidence shows the review completed and final sign-off recorded.",
        },
    };
    const ordered = plan.topics.map(topic => (topic.logicalKey === "D01" ? pitch : access));
    const lead =
        plan.persona === "neutral"
            ? "Review both authorized issues while confirming business responsibilities."
            : plan.topics[0]!.logicalKey === "D01"
              ? "Pitch readiness leads this review."
              : "Access-review readiness leads this review.";
    const brief = `${lead} The November 4 pitch is proposed in a draft without an accepted invitation; the access review is due November 5 without recorded completion or sign-off.`;
    return GenerationCompoundSchemaV2.parse({
        native: {
            summary: "Required contextual documents need review.",
            topics: [],
            enhancements: [],
        },
        experimental: {
            summary: brief,
            headline: lead,
            brief,
            keyFigures: [
                {
                    label: "Proposed pitch",
                    value: "November 4",
                    tone: "neutral",
                    refs: [key(refs.D01)],
                },
                {
                    label: "Access review due",
                    value: "November 5",
                    tone: "concern",
                    refs: [key(refs.D08)],
                },
            ],
            topics: ordered,
            enhancements: [],
        },
    });
}
export function buildRolePairCompound(input: RoleMilestoneInput) {
    return compoundForTrustedPlan(input, buildRolePairPriorityPlan(input));
}
const encoding = getEncoding("o200k_base");
const countTokens = (text: string) => encoding.encode(text).length;
export const roleMilestoneOutputSize = (compound: unknown) => outputSizeV2(compound, countTokens);
export function createRoleMilestoneRuntime(
    signal = new AbortController().signal
): GenerationRuntime {
    const model = {
        modelId: "offline-role-milestone-replay",
        behavior: { parameters: { systemMessages: "supported" } },
        prepareMessages: (messages: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
            messages.map(coerceMessageLikeToMessage),
    } as unknown as ResolvedChatModel;
    return {
        resolveModel: () => model,
        signal,
        budgets: {
            ...GENERATION_BUDGETS,
            maxAttempts: 1 as GenerationRuntime["budgets"]["maxAttempts"],
        },
    };
}
export async function runRoleMilestoneGeneration(
    input: RoleMilestoneInput & { runtime?: GenerationRuntime }
) {
    const priorityPlan = buildRolePairPriorityPlan(input);
    const compound = compoundForTrustedPlan(input, priorityPlan);
    const trace = {
        priorityPlan,
        compound,
        transportProfile: "role-pair-m2" as const,
        suppliedPromptMessages: [] as { type: string; content: unknown }[],
        invocations: 0,
        promptMessages: [] as { type: string; content: unknown }[],
        transport: "deterministic-injected-no-provider" as const,
    };
    const runtime = input.runtime ?? createRoleMilestoneRuntime();
    const result = await createDecisionExperimentV2({
        version: GENERATION_PROMPT_VERSION_V2,
        transportProfile: "role-pair-m2",
        countTokens,
        resolvePrimaryRole: () => (priorityPlan.persona === "mapped" ? input.roleContext : null),
        invoke: async (_model, schema, messages) => {
            trace.invocations++;
            if (trace.invocations > 1) throw new Error("Role-pair replay permits one invocation");
            const capture = (values: Parameters<ResolvedChatModel["prepareMessages"]>[0]) =>
                values.map(value => {
                    const message = coerceMessageLikeToMessage(value);
                    return { type: message.getType(), content: message.content };
                });
            trace.suppliedPromptMessages = capture(messages);
            trace.promptMessages = capture(
                _model.prepareMessages([
                    ...systemMessageFor(_model.behavior, structuredSchemaInstruction(schema)),
                    ...messages,
                ])
            );
            return {
                result: structuredClone(compound) as ReturnType<typeof schema.parse>,
                usage: { outputTokens: 0 },
            };
        },
    })(input.envelope, {
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
/** Bounded authored-fixture review, not a model Judge or semantic model-quality measurement. */
export function evaluateRoleMilestoneReport(
    value: unknown,
    refs: RoleMilestoneRefs,
    roleContext: BusinessRoleContextV0
) {
    const report = value as {
        topics?: {
            facts?: { text: string; refs: ContextSourceRefV0[] }[];
            proposedOwner?: unknown;
            proposedDue?: unknown;
            helpRequested?: unknown;
        }[];
    };
    const issues: string[] = [];
    const topics = report?.topics ?? [];
    for (const id of ["D01", "D08"] as const)
        if (
            !topics.some(topic =>
                topic.facts?.some(
                    fact =>
                        fact.text === sourceText(id) &&
                        fact.refs.some(ref => key(ref) === key(refs[id]))
                )
            )
        )
            issues.push(`${id}: exact event state or registered source missing`);
    const primary =
        roleContext.userConfirmed && !roleContext.fallback ? roleContext.primaryRoleId : null;
    const expected =
        primary === "partnerships-lead" ? "D01" : primary === "security-engineer" ? "D08" : null;
    if (
        expected &&
        !topics[0]?.facts?.some(fact => fact.refs.some(ref => key(ref) === key(refs[expected])))
    )
        issues.push("First topic does not match the verified primary role");
    if (
        topics.some(
            topic =>
                topic.proposedOwner !== null ||
                topic.proposedDue !== null ||
                topic.helpRequested !== null
        )
    )
        issues.push("Implicit assignment fields must remain null");
    return {
        kind: "deterministic-manual-checklist" as const,
        passed: issues.length === 0,
        issues,
        modelJudgeUsed: false as const,
    };
}
