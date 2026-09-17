import {
    citationWithSource,
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
        expect(citationWithSource("  liability is capped ", source, 4)).toBe(
            "“liability is capped” — Vendor MSA, p. 4"
        );
        expect(citationWithSource("liability is capped", source)).toBe(
            "“liability is capped” — Vendor MSA"
        );
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
        expect(md).toContain("- “capped at twelve months” — Vendor MSA, p. 4");
        expect(transcriptFilename(thread)).toBe("what-is-the-liability-cap.md");
        expect(transcriptFilename([])).toBe("chat.md");
    });
});
