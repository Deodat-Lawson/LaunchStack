import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured } from "@launchstack/core/llm";
import {
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
    EnrichmentResultSchema,
    type EnrichedNoteProposal,
    type EnrichmentInput,
    type EnrichmentModel,
    type EnrichmentResult,
} from "@launchstack/features/call-notes";

import { resolveConfiguredChatModel } from "~/lib/models";
import {
    buildCallNotesEnrichmentPrompt,
    CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
    CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT,
} from "./enrichment-prompts";
import { validateEnrichmentProvenance } from "./enrichment-validation";

export const CALL_NOTES_ENRICHMENT_ROUTE = "reasoning" as const;

/** Configured LaunchStack model adapter for the isolated enrichment core. */
export class ConfiguredCallNotesEnrichmentModel implements EnrichmentModel {
    async generate(rawInput: EnrichmentInput): Promise<EnrichmentResult> {
        const input = EnrichmentInputSchema.parse(rawInput);
        const resolved = resolveConfiguredChatModel({ route: CALL_NOTES_ENRICHMENT_ROUTE });
        const proposal = await invokeStructured<EnrichedNoteProposal>(
            resolved,
            EnrichedNoteProposalSchema,
            [
                new SystemMessage(CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT),
                new HumanMessage(buildCallNotesEnrichmentPrompt(input)),
            ],
            { name: "call_notes_enrichment_v1" }
        );

        const validatedProposal = validateEnrichmentProvenance(input, proposal);

        return EnrichmentResultSchema.parse({
            proposal: validatedProposal,
            modelMetadata: {
                model: resolved.modelId,
                promptVersion: CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
            },
        });
    }
}
