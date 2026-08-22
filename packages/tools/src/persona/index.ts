/**
 * persona — synthesize a target-audience persona grounded in company knowledge.
 *
 * Extracted from packages/features/src/marketing-pipeline/persona.ts
 * (unification PR-2). Structurally the same grounded-extraction shape as
 * brand-voice; behavior and prompt are unchanged from the pre-extraction
 * pipeline.
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

export const PERSONA_PROMPT_VERSION = "2026-08-22.1";

export const PERSONA_MODELS = {
    extraction: { route: "fast" },
} as const satisfies Record<string, ResolveChatModelOptions>;

export const TargetPersonaSchema = z.object({
    role: z.string(),
    painPoints: z.array(z.string()),
    priorities: z.array(z.string()),
    languageStyle: z.string(),
});
export type TargetPersona = z.infer<typeof TargetPersonaSchema>;

/** Pure message assembly — exported for tests. */
export function buildPersonaMessages(args: {
    snippets: string[];
    targetAudience: string;
}): BaseMessageLike[] {
    const contextBlock = formatSnippetBlock(args.snippets, "No persona-relevant data found in KB.");

    return [
        new SystemMessage(
            `You are an audience research analyst. Given a target audience description and company knowledge, synthesize a TargetPersona profile.

Rules:
- role: their job title or function (e.g., "VP of Engineering at mid-stage SaaS").
- painPoints: 3-5 specific frustrations they face that the company can address.
- priorities: 3-5 things they care most about when evaluating solutions.
- languageStyle: how they prefer to be spoken to (e.g., "direct and data-driven, no fluff").

Ground everything in the provided context. Return valid JSON.`
        ),
        new HumanMessage(
            `Target audience: ${args.targetAudience}\n\nCompany knowledge:\n\n${contextBlock}`
        ),
    ];
}

export async function extractTargetPersona(args: {
    companyId: number;
    targetAudience: string;
}): Promise<TargetPersona> {
    // Retrieval failures propagate ("throw"): the marketing pipeline catches
    // and degrades the stage, same as before extraction.
    const { snippets } = await retrieveCompanySnippets({
        companyId: args.companyId,
        query: `target audience customer persona ${args.targetAudience} pain points needs priorities`,
        policy: SNIPPET_POLICIES.standard,
        onError: "throw",
    });

    const { result } = await invokeToolStructured(
        PERSONA_MODELS.extraction,
        TargetPersonaSchema,
        buildPersonaMessages({ snippets, targetAudience: args.targetAudience }),
        "target_persona"
    );

    return result;
}
