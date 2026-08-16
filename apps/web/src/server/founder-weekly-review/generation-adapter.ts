/**
 * Host adapter between the Founder Weekly Review generator and the configured
 * chat models.
 *
 * The feature package takes generation as an injected function, so it stays
 * free of provider and web concerns; everything model-shaped lives here. There
 * is no founder-review-specific provider selection: the review is a synthesis
 * task, so it asks for the `reasoning` route and the operator's chat model
 * configuration decides what serves it. Pointing the deployment at a different
 * endpoint or model is a configuration change, never a code change.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured } from "@launchstack/core/llm";
import type { ZodType } from "zod";

import type { FounderWeeklyReviewResolvedGenerationMetadata } from "@launchstack/features/founder-weekly-review";
import { resolveConfiguredChatModel } from "~/lib/models";

/**
 * A weekly review is long-form synthesis over the whole evidence pack, so it
 * runs on the reasoning tier rather than the default one.
 */
const FOUNDER_WEEKLY_REVIEW_ROUTE = "reasoning" as const;

const CAPABILITY = "founderWeeklyReview";
export const FOUNDER_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS = 2_400;

export async function generateFounderWeeklyReviewStructured<TSchema extends ZodType>(input: {
    system?: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
    generationPhase?: "initial" | "semantic-repair";
}): Promise<{
    object: ReturnType<TSchema["parse"]>;
    metadata: FounderWeeklyReviewResolvedGenerationMetadata;
}> {
    const resolved = resolveConfiguredChatModel({
        route: FOUNDER_WEEKLY_REVIEW_ROUTE,
        maxOutputTokens: FOUNDER_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS,
    });

    const messages = [
        ...(input.system ? [new SystemMessage(input.system)] : []),
        new HumanMessage(input.prompt),
    ];

    const startedAt = Date.now();
    console.info(
        `[fwr] generation start phase=${input.generationPhase ?? "initial"} ` +
            `route=${resolved.route} model=${resolved.modelId}`
    );

    try {
        // invokeStructured picks the model's native mechanism when it declares
        // one and falls back to strict JSON prompting when it does not, with a
        // single repair attempt either way. Reimplementing that here to recover
        // the raw response — and with it token usage — would mean a second,
        // divergent structured-output path, which is exactly what the shared
        // boundary exists to prevent. Usage is therefore not reported per call;
        // it is visible at the chat boundary.
        const object = (await invokeStructured(resolved, input.schema, messages, {
            name: input.schemaName ?? "founder_weekly_review_v2",
        })) as ReturnType<TSchema["parse"]>;

        console.info(
            `[fwr] generation ok    phase=${input.generationPhase ?? "initial"} ` +
                `route=${resolved.route} model=${resolved.modelId} ${Date.now() - startedAt}ms`
        );

        return {
            object,
            metadata: {
                provider: resolved.name,
                model: resolved.modelId,
                capability: CAPABILITY,
            },
        };
    } catch (error) {
        console.error(
            `[fwr] generation FAIL  phase=${input.generationPhase ?? "initial"} ` +
                `route=${resolved.route} model=${resolved.modelId} ` +
                `${Date.now() - startedAt}ms err=${
                    error instanceof Error ? error.message : String(error)
                }`
        );
        throw error;
    }
}
