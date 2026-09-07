import { EnrichedNoteProposalSchema, type EnrichedNoteProposal } from "./contracts";

export interface RenderedEnrichedNoteProposal {
    contentMarkdown: string;
    contentRich: Record<string, unknown>;
}

/**
 * Renders the complete chronological note, not the structured evidence metadata.
 * Leave rich text empty so the editor's Markdown importer preserves formatting.
 */
export function renderEnrichedNoteProposal(
    rawProposal: EnrichedNoteProposal
): RenderedEnrichedNoteProposal {
    const proposal = EnrichedNoteProposalSchema.parse(rawProposal);
    const contentMarkdown = proposal.chronologicalSections
        .map(item => `## ${item.heading}\n\n${item.markdown.trim()}`)
        .join("\n\n");
    const contentRich = {};

    return { contentMarkdown, contentRich };
}
