/**
 * The simulation's model port over `@launchstack/llm`. Every call — turns,
 * casts, briefs, reports and interviews (`{answer}`) — uses structured output
 * with a zod mirror of the engine's JSON shape. A model without native
 * structured output still works through the JSON fallback in
 * `invokeStructuredWithUsage`. Interviews were plain text until a local model
 * that reasons first spent a plain call's whole budget before writing a word.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import {
    invokeStructuredWithUsage,
    resolveChatModel,
    type ResolveChatModelOptions,
} from "@launchstack/llm";
import {
    ACTION_TYPES,
    BUDGETS,
    BUYING_ROLES,
    SWITCHING_COSTS,
    WOULD_PAY,
    type ModelRequest,
    type SimulationModel,
} from "@launchstack/simulation";

import { BASES } from "./v2/contracts";

/**
 * One model policy per purpose; turns run on the fast route because there are
 * hundreds of them. Timeouts bound one call: a hung turn fails only that
 * person's turn (the round tolerates a minority), never the whole run.
 */
export const SCENARIO_MODELS = {
    decide: { route: "fast", temperature: 0.8, timeoutMs: 90_000 },
    cast: { route: "fast", temperature: 0.7, timeoutMs: 180_000 },
    brief: { route: "fast", temperature: 0.2, timeoutMs: 180_000 },
    report: { route: "default", temperature: 0.3, timeoutMs: 180_000 },
    interview: { route: "fast", temperature: 0.6, timeoutMs: 90_000 },
    // Contract v2. The ontology is one careful call that shapes the whole
    // graph; the cast plan and cast batches are many and run on the fast route.
    ontology: { route: "default", temperature: 0.2, timeoutMs: 180_000 },
    cast_plan: { route: "fast", temperature: 0.4, timeoutMs: 120_000 },
    cast_v2: { route: "fast", temperature: 0.6, timeoutMs: 180_000 },
} as const satisfies Record<ModelRequest["purpose"], ResolveChatModelOptions>;

// `.nullable()`, never `.optional()`: strict json-schema mode sends optional fields as required.
const decisionSchema = z.object({
    thought: z.string(),
    stance: z.number(),
    convincedBy: z.string().nullable(),
    wouldPay: z.enum(WOULD_PAY as [string, ...string[]]),
    objection: z.string().nullable(),
    actions: z.array(
        z.object({
            type: z.enum(ACTION_TYPES as [string, ...string[]]),
            postId: z.string().nullable(),
            text: z.string().nullable(),
            handle: z.string().nullable(),
        })
    ),
});

const castSchema = z.object({
    personas: z.array(
        z.object({
            name: z.string(),
            handle: z.string(),
            role: z.string(),
            bio: z.string(),
            interests: z.array(z.string()),
            stance: z.number(),
            activity: z.number(),
            influence: z.number(),
            sourceIds: z.array(z.string()),
            invented: z.boolean(),
            currentSolution: z.string(),
            budget: z.enum(BUDGETS as [string, ...string[]]),
            buyingRole: z.enum(BUYING_ROLES as [string, ...string[]]),
            switchingCost: z.enum(SWITCHING_COSTS as [string, ...string[]]),
            objection: z.string(),
        })
    ),
});

const briefSchema = z.object({
    brief: z.string(),
    openingPost: z.string(),
    situation: z.string(),
    evidenceIds: z.array(z.string()),
});

const reportSchema = z.object({
    headline: z.string(),
    summary: z.string(),
    dynamics: z.array(z.object({ text: z.string(), postIds: z.array(z.string()) })),
    turningPoints: z.array(
        z.object({ round: z.number(), text: z.string(), postIds: z.array(z.string()) })
    ),
    factions: z.array(
        z.object({
            stance: z.enum(["supportive", "neutral", "critical"]),
            label: z.string(),
            text: z.string(),
        })
    ),
    watchFor: z.array(z.string()),
});

const answerSchema = z.object({ answer: z.string() });

// ─── Contract v2 ─────────────────────────────────────────────────────────────

const ontologyAttributeSchema = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean"]),
    description: z.string(),
});

const ontologySchema = z.object({
    entities: z.array(
        z.object({
            name: z.string(),
            description: z.string(),
            attributes: z.array(ontologyAttributeSchema),
            motivatingEvidenceId: z.string(),
        })
    ),
    edges: z.array(
        z.object({
            name: z.string(),
            description: z.string(),
            attributes: z.array(ontologyAttributeSchema),
            endpoints: z.array(z.object({ source: z.string(), target: z.string() })),
            motivatingEvidenceId: z.string(),
        })
    ),
});

const castPlanSchema = z.object({
    slots: z.array(z.object({ slotId: z.string(), segment: z.string(), query: z.string() })),
});

/** One attributed field. Enum fields constrain the value; free text stays a string. */
function attributed<T extends z.ZodTypeAny>(value: T) {
    return z.object({
        value: value.nullable(),
        basis: z.enum(BASES as unknown as [string, ...string[]]),
        evidenceIds: z.array(z.string()),
        explanation: z.string().nullable(),
    });
}

const castV2Schema = z.object({
    members: z.array(
        z.object({
            slotId: z.string(),
            name: z.string(),
            handle: z.string(),
            bio: z.string(),
            interests: z.array(z.string()),
            activity: z.number(),
            influence: z.number(),
            role: attributed(z.string()),
            currentSolution: attributed(z.string()),
            budget: attributed(z.enum(BUDGETS as [string, ...string[]])),
            buyingRole: attributed(z.enum(BUYING_ROLES as [string, ...string[]])),
            switchingCost: attributed(z.enum(SWITCHING_COSTS as [string, ...string[]])),
            objection: attributed(z.string()),
        })
    ),
});

/** The zod mirror of each engine reply shape; a field missing here is stripped from every reply. */
export const SCENARIO_SCHEMAS: Record<ModelRequest["purpose"], z.ZodType<unknown>> = {
    decide: decisionSchema,
    cast: castSchema,
    brief: briefSchema,
    report: reportSchema,
    interview: answerSchema,
    ontology: ontologySchema,
    cast_plan: castPlanSchema,
    cast_v2: castV2Schema,
};

export function createLlmSimulationModel(): SimulationModel {
    return {
        async complete(request) {
            const policy = SCENARIO_MODELS[request.purpose];
            const resolved = resolveChatModel({
                ...policy,
                maxOutputTokens: request.maxOutputTokens,
            });
            const messages = [new SystemMessage(request.system), new HumanMessage(request.prompt)];
            const { result, usage } = await invokeStructuredWithUsage(
                resolved,
                SCENARIO_SCHEMAS[request.purpose],
                messages,
                { name: `scenario_${request.purpose}` }
            );
            return {
                text: JSON.stringify(result),
                usage: {
                    inputTokens: usage.inputTokens ?? 0,
                    outputTokens: usage.outputTokens ?? 0,
                },
            };
        },
    };
}
