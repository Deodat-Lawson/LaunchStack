import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured } from "@launchstack/llm";
import {
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
    EnrichmentResultSchema,
    type EnrichedNoteProposal,
    type EnrichmentInput,
    type EnrichmentModel,
    type EnrichmentResult,
} from "@launchstack/pipelines/call-notes";

import { resolveConfiguredChatModel, resolveConfiguredChatRoute } from "~/lib/models";
import {
    CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
    CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT,
} from "./enrichment-prompts";
import { validateEnrichmentProvenance } from "./enrichment-validation";
import { prepareCallNotesEnrichmentPrompt } from "./enrichment-compaction";

export const CALL_NOTES_ENRICHMENT_ROUTE = "reasoning" as const;

function renderPartialChronologicalSections(value: unknown): string {
    if (value === null || typeof value !== "object" || !("chronologicalSections" in value)) {
        return "";
    }
    const sections = value.chronologicalSections;
    if (!Array.isArray(sections)) return "";

    return sections
        .map((section: unknown) => {
            if (section === null || typeof section !== "object") return "";
            const headingValue = "heading" in section ? section.heading : undefined;
            const markdownValue = "markdown" in section ? section.markdown : undefined;
            const heading = typeof headingValue === "string" ? headingValue.trim() : "";
            const markdown = typeof markdownValue === "string" ? markdownValue.trim() : "";
            if (heading && markdown) return `## ${heading}\n\n${markdown}`;
            if (heading) return `## ${heading}`;
            return markdown;
        })
        .filter(Boolean)
        .join("\n\n");
}

/** Configured LaunchStack model adapter for the isolated enrichment core. */
export class ConfiguredCallNotesEnrichmentModel implements EnrichmentModel {
    async generate(
        rawInput: EnrichmentInput,
        onPreview?: (markdown: string) => void | Promise<void>
    ): Promise<EnrichmentResult> {
        const input = EnrichmentInputSchema.parse(rawInput);
        const limits = resolveConfiguredChatRoute(CALL_NOTES_ENRICHMENT_ROUTE).definition.behavior
            .limits;
        const outputTokens = Math.min(4_096, limits?.maxOutputTokens ?? 4_096);
        const resolved = resolveConfiguredChatModel({
            route: CALL_NOTES_ENRICHMENT_ROUTE,
            maxOutputTokens: outputTokens,
            ...(onPreview ? { streaming: true } : {}),
        });
        const prompt = await prepareCallNotesEnrichmentPrompt(input, resolved, outputTokens);
        const proposal = await invokeStructured<EnrichedNoteProposal>(
            resolved,
            EnrichedNoteProposalSchema,
            [new SystemMessage(CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT), new HumanMessage(prompt)],
            {
                name: "call_notes_enrichment_v1",
                onPartial: onPreview
                    ? async partial => {
                          await onPreview(renderPartialChronologicalSections(partial));
                      }
                    : undefined,
            }
        );

        const validatedProposal = validateEnrichmentProvenance(input, proposal);

        return EnrichmentResultSchema.parse({
            proposal: validatedProposal,
            modelMetadata: {
                provider: resolved.name,
                model: resolved.modelId,
                promptVersion: CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
            },
        });
    }
}
