import {
    citationWithSource,
    parseQuotedMessage,
    plainTextOfAnswer,
    transcriptFilename,
    transcriptMarkdown,
} from "../transcript";
import type { ThreadMessage, WorkspaceSource } from "../types";

const source: WorkspaceSource = {
    id: "d1",
    documentId: 1,
    title: "Vendor MSA",
    type: "doc",
    size: "",
    added: "",
    folder: "Legal",
    tags: [],
    domain: "General",
};

describe("transcript helpers", () => {
    it("strips bold markers for a plain copy", () => {
        expect(plainTextOfAnswer("The cap is **12 months** of fees.")).toBe(
            "The cap is 12 months of fees."
        );
    });

    it("quotes a passage with where it came from", () => {
        expect(citationWithSource("  liability is capped ", source)).toBe(
            "“liability is capped” — Vendor MSA"
        );
    });

    it("does not claim a page, because indexing does not record one", () => {
        // Every chunk is stored with page_number 1, so a page here would be a
        // precise-looking lie. Pinned so it is a deliberate decision to undo.
        expect(citationWithSource("liability is capped", source)).not.toContain("p.");
    });

    it("renders the whole thread as Markdown with citations", () => {
        const thread: ThreadMessage[] = [
            { role: "user", text: "What is the liability cap?", refs: ["d1"] },
            {
                role: "assistant",
                text: "**12 months** of fees.",
                model: "sonnet",
                citations: [{ sourceId: "d1", snippet: "capped at twelve months", page: 4 }],
            },
        ];
        const md = transcriptMarkdown(thread, [source]);
        expect(md).toContain("# Chat transcript");
        expect(md).toContain("## You\n\nWhat is the liability cap?\n\n_Asked over: Vendor MSA_");
        expect(md).toContain("## Launchstack (sonnet)\n\n**12 months** of fees.");
        expect(md).toContain("- “capped at twelve months” — Vendor MSA");
        expect(transcriptFilename(thread)).toBe("what-is-the-liability-cap.md");
        expect(transcriptFilename([])).toBe("chat.md");
    });
});

/**
 * Quoting writes a Markdown blockquote into a message the chat renders as
 * plain text, so the UI has to read the markers back out to draw the passage
 * as a passage rather than as `>` characters on one collapsed line.
 */
describe("parseQuotedMessage", () => {
    it("splits the question from the passage it quotes", () => {
        const result = parseQuotedMessage(
            "Explain this passage from “Report”:\n\n> Revenue grew 14%,\n> driven by renewals.\n\n"
        );
        expect(result.lead).toBe("Explain this passage from “Report”:");
        expect(result.quote).toBe("Revenue grew 14%,\ndriven by renewals.");
        expect(result.trail).toBe("");
    });

    it("keeps a plain question whole", () => {
        const result = parseQuotedMessage("What changed this quarter?");
        expect(result).toEqual({
            lead: "What changed this quarter?",
            quote: null,
            trail: "",
        });
    });

    it("keeps what was typed after the passage", () => {
        const result = parseQuotedMessage(
            "Look at this:\n\n> the cap is 2x fees\n\nIs that normal?"
        );
        expect(result.quote).toBe("the cap is 2x fees");
        expect(result.trail).toBe("Is that normal?");
    });

    it("preserves blank lines inside a passage", () => {
        const result = parseQuotedMessage("> first para\n>\n> second para");
        expect(result.quote).toBe("first para\n\nsecond para");
    });

    it("does not treat a later chevron line as part of an earlier quote", () => {
        const result = parseQuotedMessage("> quoted\n\nplain line\n> a second block");
        // Only the contiguous run at the top is the quote; the rest is trail.
        expect(result.quote).toBe("quoted");
        expect(result.trail).toBe("plain line\n> a second block");
    });

    it("ignores an empty blockquote", () => {
        expect(parseQuotedMessage(">\n>").quote).toBeNull();
    });
});
