import { EnrichedNoteProposalSchema, type EnrichedNoteProposal } from "./contracts";

export interface RenderedEnrichedNoteProposal {
    contentMarkdown: string;
    contentRich: Record<string, unknown>;
}

function section(heading: string, body: string): string {
    return `## ${heading}\n\n${body.trim()}`;
}

function actionItemText(item: EnrichedNoteProposal["actionItems"][number]): string {
    const metadata = [item.ownerName, item.dueDate].filter((value): value is string => Boolean(value));
    return metadata.length === 0 ? item.text : `${item.text} (${metadata.join(" · ")})`;
}

function citationText(
    citation: EnrichedNoteProposal["bookmarkPassages"][number]["citations"][number]
): string {
    const speaker = citation.speakerName ?? "Unknown speaker";
    const timestamp = citation.providerStartMs === null ? "time unavailable" : `${citation.providerStartMs} ms`;
    return `${speaker}, ${timestamp}, bookmark ${citation.bookmarkId}`;
}

/**
 * Produces the initial editable proposal from one canonical semantic model output.
 * The AI never generates parallel Markdown and rich-text representations.
 */
export function renderEnrichedNoteProposal(
    rawProposal: EnrichedNoteProposal
): RenderedEnrichedNoteProposal {
    const proposal = EnrichedNoteProposalSchema.parse(rawProposal);
    const markdownSections: string[] = proposal.chronologicalSections.map(item =>
        section(item.heading, item.markdown)
    );

    markdownSections.push(section("Summary", proposal.summary));

    if (proposal.decisions.length > 0) {
        markdownSections.push(
            section("Decisions", proposal.decisions.map(item => `- ${item.text}`).join("\n"))
        );
    }

    if (proposal.actionItems.length > 0) {
        markdownSections.push(
            section("Action items", proposal.actionItems.map(item => `- ${actionItemText(item)}`).join("\n"))
        );
    }

    if (proposal.bookmarkPassages.length > 0) {
        markdownSections.push(
            section(
                "Bookmarked evidence",
                proposal.bookmarkPassages
                    .map(
                        passage =>
                            `${passage.markdown.trim()}\n\n${passage.citations
                                .map(citation => `- ${citationText(citation)}`)
                                .join("\n")}`
                    )
                    .join("\n\n")
            )
        );
    }

    if (proposal.conflicts.length > 0) {
        markdownSections.push(
            section(
                "Conflicts to review",
                proposal.conflicts
                    .map(item => `- ${item.ownerText}\n  - ${item.explanation}`)
                    .join("\n")
            )
        );
    }

    const contentMarkdown = markdownSections.join("\n\n");
    const contentRich = {
        type: "doc",
        content: contentMarkdown.split("\n\n").map(block => {
            if (block.startsWith("## ")) {
                const heading = block.slice(3);
                return {
                    type: "heading",
                    attrs: { level: 2 },
                    content: [{ type: "text", text: heading }],
                };
            }
            return {
                type: "paragraph",
                content: [{ type: "text", text: block }],
            };
        }),
    };

    return { contentMarkdown, contentRich };
}
