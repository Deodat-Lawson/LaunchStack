/**
 * brand-voice — synthesize how a company communicates from its own documents.
 *
 * Extracted from packages/features/src/marketing-pipeline/voice.ts
 * (unification PR-2). Grounded retrieval + structured synthesis; behavior and
 * prompt are unchanged from the pre-extraction pipeline. Consumers: the
 * marketing pipeline today; email tone rules are the planned second consumer
 * (design doc §8).
 */

import { HumanMessage, SystemMessage, type BaseMessageLike } from "@langchain/core/messages";
import { z } from "zod";
import type { ResolveChatModelOptions } from "@launchstack/core/llm";

import {
    formatSnippetBlock,
    retrieveCompanySnippets,
    SNIPPET_POLICIES,
} from "../grounded-retrieval";
import { invokeToolStructured } from "../llm";

export const BRAND_VOICE_PROMPT_VERSION = "2026-08-22.1";

export const BRAND_VOICE_MODELS = {
    extraction: { route: "fast" },
} as const satisfies Record<string, ResolveChatModelOptions>;

export const FormalityLevelEnum = z.enum(["formal", "conversational", "technical", "bold"]);
export type FormalityLevel = z.infer<typeof FormalityLevelEnum>;

export const BrandVoiceSchema = z.object({
    toneDescriptor: z.string(),
    vocabularyExamples: z.array(z.string()),
    sentenceStyle: z.string(),
    formalityLevel: FormalityLevelEnum,
});
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

const VOICE_RETRIEVAL_QUERY =
    "company tone voice communication style brand personality writing examples";

/** Pure message assembly — exported for tests. */
export function buildBrandVoiceMessages(args: {
    snippets: string[];
    toneOverride?: FormalityLevel;
}): BaseMessageLike[] {
    const contextBlock = formatSnippetBlock(args.snippets, "No text samples available.");

    const toneHint = args.toneOverride
        ? `\n\nThe user has requested a ${args.toneOverride} tone. Set formalityLevel to "${args.toneOverride}" and adapt the other fields accordingly.`
        : "";

    return [
        new SystemMessage(
            `You are a brand voice analyst. Given text samples from a company's documents, synthesize a BrandVoice profile that captures how this company communicates.

Rules:
- toneDescriptor: 2-4 adjective phrase (e.g., "confident, technical, approachable").
- vocabularyExamples: 3-6 characteristic words or phrases the company uses.
- sentenceStyle: one sentence describing the typical sentence structure and length.
- formalityLevel: one of "formal", "conversational", "technical", "bold".

Use ONLY patterns visible in the provided text. Return valid JSON.${toneHint}`
        ),
        new HumanMessage(`Company text samples:\n\n${contextBlock}`),
    ];
}

/** Prompt directive appended to a generation system prompt — shared by marketing and email. */
export function buildVoiceDirective(voice: BrandVoice): string {
    return [
        "\n## Brand Voice Directive",
        `Tone: ${voice.toneDescriptor}`,
        `Formality: ${voice.formalityLevel}`,
        `Style: ${voice.sentenceStyle}`,
        `Use these characteristic phrases when natural: ${voice.vocabularyExamples.join(", ")}`,
        "Match this voice throughout the post.",
    ].join("\n");
}

export async function extractBrandVoice(args: {
    companyId: number;
    toneOverride?: FormalityLevel;
}): Promise<BrandVoice> {
    // Retrieval failures propagate ("throw"): the caller decides what a
    // missing voice means — the marketing pipeline degrades the stage.
    const { snippets } = await retrieveCompanySnippets({
        companyId: args.companyId,
        query: VOICE_RETRIEVAL_QUERY,
        policy: SNIPPET_POLICIES.standard,
        onError: "throw",
    });

    const { result } = await invokeToolStructured(
        BRAND_VOICE_MODELS.extraction,
        BrandVoiceSchema,
        buildBrandVoiceMessages({ snippets, toneOverride: args.toneOverride }),
        "brand_voice"
    );

    return result;
}
