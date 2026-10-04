/** @jest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CallNoteEditor } from "~/app/calls/_components/CallNoteEditor";
import { renderEnrichedNoteProposal } from "@launchstack/pipelines/call-notes/enrichment";
import { CALL_NOTES_ENRICHMENT_PROPOSAL } from "@launchstack/pipelines/call-notes";

describe("Call note hydration", () => {
    it("renders an enhancement's inline note citations without metadata appendices", async () => {
        const content = renderEnrichedNoteProposal({
            ...CALL_NOTES_ENRICHMENT_PROPOSAL,
            chronologicalSections: [
                {
                    heading: "Launch planning",
                    markdown: "- **Shorten onboarding** before the September launch.",
                    ownerContextLabels: [],
                },
                {
                    heading: "Launch follow-up",
                    markdown: "- Alex will send the checklist on Friday.",
                    ownerContextLabels: [],
                },
            ],
        });
        const { rerender } = render(<CallNoteEditor content={content} editable />);
        const citation = await screen.findByText("Shorten onboarding");
        expect(citation.tagName).toBe("STRONG");
        expect(citation.closest("li")).toHaveTextContent(
            "Shorten onboarding before the September launch."
        );
        expect(screen.getAllByRole("heading").map(heading => heading.textContent)).toEqual([
            "Launch planning",
            "Launch follow-up",
        ]);
        expect(
            screen.getByText("Alex will send the checklist on Friday.").closest("strong")
        ).toBeNull();

        // An untouched accepted proposal can still be Markdown-only on reload.
        rerender(<CallNoteEditor content={content} editable={false} />);
        expect(screen.getByText("Shorten onboarding").tagName).toBe("STRONG");
        expect(screen.getByRole("textbox", { name: "Call note" })).toHaveAttribute(
            "contenteditable",
            "false"
        );
    });

    it("does not dirty a legacy note just by opening or polling it", async () => {
        const onChange = jest.fn();
        const content = { contentRich: {}, contentMarkdown: "- Keep the original wording" };
        const { rerender } = render(
            <CallNoteEditor content={content} editable onChange={onChange} />
        );
        await screen.findByText("Keep the original wording");
        rerender(
            <CallNoteEditor
                content={{ ...content, contentRich: {} }}
                editable
                onChange={onChange}
            />
        );
        await waitFor(() =>
            expect(screen.getByRole("textbox", { name: /call note/i })).toHaveAttribute(
                "contenteditable",
                "true"
            )
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    });

    it("refuses to rewrite unsupported rich content instead of silently dropping it", async () => {
        const onChange = jest.fn();
        render(
            <CallNoteEditor
                content={{
                    contentRich: {
                        type: "doc",
                        content: [
                            { type: "image", attrs: { src: "https://example.com/evidence.png" } },
                        ],
                    },
                    contentMarkdown: "Original note with attached evidence",
                }}
                editable
                onChange={onChange}
            />
        );
        await screen.findByRole("alert");
        expect(screen.getByText("Original note with attached evidence")).toBeInTheDocument();
        expect(screen.queryByRole("toolbar")).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });
});
