/**
 * Markdown → Tiptap, the inverse of the serializer notes are stored through.
 *
 * This conversion is the difference between an agent-captured note being
 * editable and being destroyed: those notes have `content_rich` null, so the
 * editor used to open empty and write that emptiness back on save. The
 * round-trip tests below are the real contract — whatever the serializer
 * emits must survive being parsed and re-emitted.
 */

import { markdownToTiptapJson, tiptapJsonToMarkdown } from "../StickyNoteEditor";

/** What the editor would store, then show again. */
function roundTrip(markdown: string): string {
    return tiptapJsonToMarkdown(markdownToTiptapJson(markdown));
}

describe("markdownToTiptapJson", () => {
    it("treats nothing as nothing, so an empty note stays empty", () => {
        expect(markdownToTiptapJson("")).toBeNull();
        expect(markdownToTiptapJson("   \n\n ")).toBeNull();
        expect(markdownToTiptapJson(null)).toBeNull();
    });

    it("keeps a plain note's text", () => {
        expect(roundTrip("The cap is twelve months of fees.")).toBe(
            "The cap is twelve months of fees."
        );
    });

    /** The exact shape that showed up as a literal `**Decision:**` on a card. */
    it("parses the agent's bold lead-in rather than leaving the asterisks", () => {
        const doc = markdownToTiptapJson("**Decision:** (none — observation only)");
        const para = doc?.content?.[0];
        expect(para?.type).toBe("paragraph");
        expect(para?.content?.[0]).toEqual({
            type: "text",
            text: "Decision:",
            marks: [{ type: "bold" }],
        });
        expect(para?.content?.[1]?.text).toBe(" (none — observation only)");
    });

    it("round-trips the marks the serializer emits", () => {
        expect(roundTrip("**bold** and *italic* and `code`")).toBe(
            "**bold** and *italic* and `code`"
        );
    });

    it("round-trips a link with its href", () => {
        expect(roundTrip("see [the MSA](https://example.com/msa) for terms")).toBe(
            "see [the MSA](https://example.com/msa) for terms"
        );
    });

    it("does not read a bold opener as two italics", () => {
        const doc = markdownToTiptapJson("**both**");
        expect(doc?.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
    });

    it("nests a mark inside another instead of dropping the inner one", () => {
        const doc = markdownToTiptapJson("**bold with `code` inside**");
        const marks = doc?.content?.[0]?.content?.map(n => n.marks?.map(m => m.type) ?? []);
        expect(marks).toEqual([["bold"], ["bold", "code"], ["bold"]]);
    });

    it("round-trips a bullet list", () => {
        expect(roundTrip("- first\n- second")).toBe("- first\n- second");
    });

    it("round-trips an ordered list, renumbering from one", () => {
        expect(roundTrip("1. first\n2. second")).toBe("1. first\n2. second");
    });

    it("round-trips a blockquote", () => {
        expect(roundTrip("> quoted passage")).toBe("> quoted passage");
    });

    it("round-trips a fenced code block without parsing its contents", () => {
        const doc = markdownToTiptapJson("```\nconst x = **not bold**;\n```");
        expect(doc?.content?.[0]?.type).toBe("codeBlock");
        expect(doc?.content?.[0]?.content?.[0]?.text).toBe("const x = **not bold**;");
    });

    it("clamps headings to the levels the editor registers", () => {
        // StarterKit is configured for levels 2 and 3 only; an unclamped
        // level 1 or 4 would be dropped by the schema on load.
        expect(markdownToTiptapJson("# Top")?.content?.[0]?.attrs?.level).toBe(2);
        expect(markdownToTiptapJson("##### Deep")?.content?.[0]?.attrs?.level).toBe(3);
    });

    it("keeps separate paragraphs separate", () => {
        const doc = markdownToTiptapJson("first para\n\nsecond para");
        expect(doc?.content).toHaveLength(2);
        expect(roundTrip("first para\n\nsecond para")).toBe("first para\n\nsecond para");
    });

    it("keeps a single newline inside a paragraph as a soft break", () => {
        const doc = markdownToTiptapJson("line one\nline two");
        expect(doc?.content).toHaveLength(1);
        expect(doc?.content?.[0]?.content?.[0]?.text).toBe("line one\nline two");
    });

    it("runs an unclosed fence to the end rather than losing the rest of the note", () => {
        const doc = markdownToTiptapJson("```\nstill mine");
        expect(doc?.content?.[0]?.content?.[0]?.text).toBe("still mine");
    });

    it("leaves a stray asterisk alone instead of eating it", () => {
        expect(roundTrip("2 * 3 = 6")).toBe("2 * 3 = 6");
    });

    /**
     * The whole point: a note that only ever had markdown must come back with
     * its text intact, because the alternative is the editor silently
     * blanking it.
     */
    it("recovers a real agent-captured note body", () => {
        const captured =
            "**Summary:** The reranker improves recall.\n\n" +
            "- Q1 through Q4 are covered\n" +
            "- Lines 15–25 carry the sequence\n\n" +
            "> The quick brown fox jumps over the lazy dog.";
        expect(roundTrip(captured)).toBe(captured);
    });
});
