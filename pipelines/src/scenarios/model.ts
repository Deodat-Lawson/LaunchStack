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
import { ACTION_TYPES, type ModelRequest, type SimulationModel } from "@launchstack/simulation";

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
} as const satisfies Record<ModelRequest["purpose"], ResolveChatModelOptions>;

// `.nullable()`, never `.optional()`: strict json-schema mode sends optional fields as required.
const decisionSchema = z.object({
    thought: z.string(),
    stance: z.number(),
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
        })
    ),
});

const briefSchema = z.object({
    brief: z.string(),
    openingPost: z.string(),
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

const SCHEMAS: Record<ModelRequest["purpose"], z.ZodType<unknown>> = {
    decide: decisionSchema,
    cast: castSchema,
    brief: briefSchema,
    report: reportSchema,
    interview: answerSchema,
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
                SCHEMAS[request.purpose],
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
