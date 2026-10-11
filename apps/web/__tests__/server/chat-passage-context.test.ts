/**
 * A selected passage becomes three things for a chat turn: the search query
 * (the question, unless it is only "explain this"), the indexed chunk(s) the
 * passage came from, and a labelled prompt block.
 */

import {
    excerptAround,
    locatePassageContext,
    passagePromptSection,
    pickAnchorChunks,
    retrievalQueryFor,
    withoutAnchoredChunks,
    type AnchorRow,
    type PassageAnchor,
} from "~/server/chat-passage-context";
import { DEFAULT_PASSAGE_QUESTION } from "~/lib/chat-passages";

jest.mock("~/server/db", () => ({ db: {} }));

const PASSAGE = "Retrieval-augmented generation grounds each answer in the indexed sources.";

describe("retrievalQueryFor", () => {
    const passages = [{ text: PASSAGE }];

    it("searches on a substantive question alone", () => {
        expect(
            retrievalQueryFor("How does this compare with the Q3 revenue forecast?", passages)
        ).toBe("How does this compare with the Q3 revenue forecast?");
    });

    it.each([
        DEFAULT_PASSAGE_QUESTION,
        "what does this mean?",
        "summarize",
        "Summarise this paragraph please",
        "why?",
        "Can you explain what this passage says?",
    ])("adds the passage to the bare question %p", question => {
        const query = retrievalQueryFor(question, passages);
        expect(query).toContain(PASSAGE);
        expect(query.startsWith(question)).toBe(true);
    });

    it("searches on the passage alone when nothing was typed", () => {
        expect(retrievalQueryFor("", passages)).toBe(PASSAGE);
    });

    it("leaves a question without passages or legacy context untouched", () => {
        expect(retrievalQueryFor("what is this?", [])).toBe("what is this?");
        expect(retrievalQueryFor("> my own quote\n\nthoughts?", [])).toBe(
            "> my own quote\n\nthoughts?"
        );
    });

    it("strips a legacy blockquote and marker, and uses the quote as the passage", () => {
        const legacy = `> Retrieval-augmented generation grounds each answer\n> in the indexed sources.\n\n[Quoted context](#launchstack-quoted-context)\n\nWhat does this mean?`;
        const query = retrievalQueryFor(legacy, []);
        expect(query).not.toContain(">");
        expect(query).not.toContain("launchstack-quoted-context");
        expect(query).toContain("What does this mean?");
        expect(query).toContain("Retrieval-augmented generation grounds each answer");
    });

    it("drops a legacy Ask AI quote behind a substantive question", () => {
        const legacy = `> some quoted passage\n\n[Quoted context](#launchstack-quoted-context)\n\nHow does the pricing model affect gross margin next year?`;
        expect(retrievalQueryFor(legacy, [])).toBe(
            "How does the pricing model affect gross margin next year?"
        );
    });

    it("leaves a Quote in reply message exactly as it was searched before", () => {
        const reply = `> The authors propose propositions as retrieval units.\n\n[Source message](#chat-message-abc123)\n\nCan you find more evidence for this claim in the document?`;
        expect(retrievalQueryFor(reply, [])).toBe(reply);
    });

    it("keeps a typed blockquote that is not followed by the marker", () => {
        const mixed = `> my own quote\n\nthoughts?\n\n> pasted passage\n\n[Quoted context](#launchstack-quoted-context)\n\nwhy?`;
        const query = retrievalQueryFor(mixed, []);
        expect(query).toContain("> my own quote");
        expect(query).toContain("pasted passage");
        expect(query).not.toContain("> pasted passage");
        expect(query).not.toContain("launchstack-quoted-context");
    });

    it("parses a maximum-size message of quote lines in linear time", () => {
        const hostile = `${">\n".repeat(60_000)}[Quoted context](#launchstack-quoted-context)`;
        const started = performance.now();
        retrievalQueryFor(hostile, []);
        retrievalQueryFor(">\n".repeat(60_000), []);
        retrievalQueryFor(
            `${">\n".repeat(60_000)}x [Quoted context](#launchstack-quoted-context)`,
            []
        );
        expect(performance.now() - started).toBeLessThan(500);
    });

    it("prefers structured passages over a legacy quote", () => {
        const legacy = `> stale quote text\n\n[Quoted context](#launchstack-quoted-context)\n\nwhy?`;
        const query = retrievalQueryFor(legacy, passages);
        expect(query).toContain(PASSAGE);
        expect(query).not.toContain("stale quote text");
    });
});

function row(id: number, content: string, pageNumber: number | null = 1): AnchorRow {
    return { id, content, pageNumber };
}

describe("pickAnchorChunks", () => {
    it("finds the chunk that contains the passage exactly", () => {
        const rows = [
            row(1, "An unrelated opening section about the company history."),
            row(2, `Background. ${PASSAGE} Further detail follows here.`),
            row(3, "A closing section."),
        ];
        expect(pickAnchorChunks(PASSAGE, rows).map(r => r.id)).toEqual([2]);
    });

    it("ignores whitespace, line breaks, hyphenation and soft hyphens", () => {
        const indexed =
            "Background.\nRetrieval-\naugmented gen­eration   grounds each\nanswer in the in-\ndexed sources.";
        const rows = [row(1, "Nothing to see."), row(2, indexed)];
        expect(pickAnchorChunks(PASSAGE, rows).map(r => r.id)).toEqual([2]);
    });

    const SPANNING =
        "The committee reviewed every vendor contract signed during the fiscal year and found that " +
        "most renewals were approved without a competitive bid, which raised procurement costs.";

    it.each(["vendor contract", "most renewals", "procurement costs"])(
        "returns both chunks when the passage is cut before %p",
        cutAt => {
            const cut = SPANNING.indexOf(cutAt);
            const rows = [
                row(10, "Opening remarks about the audit scope.", 3),
                row(11, `Section 4. ${SPANNING.slice(0, cut)}`, 3),
                row(12, `${SPANNING.slice(cut)} Section 5 discusses remediation.`, 4),
                row(13, "Appendix.", 5),
            ];
            expect(pickAnchorChunks(SPANNING, rows, 3).map(r => r.id)).toEqual([11, 12]);
        }
    );

    it("tolerates overlapping chunks and spans of three", () => {
        const a = SPANNING.indexOf("signed");
        const b = SPANNING.indexOf("approved");
        const rows = [
            row(1, `Intro. ${SPANNING.slice(0, a + 20)}`, 3),
            // Overlaps the previous chunk by a few words.
            row(2, SPANNING.slice(a, b), 3),
            row(3, `${SPANNING.slice(b)} Next section.`, 4),
        ];
        expect(pickAnchorChunks(SPANNING, rows).map(r => r.id)).toEqual([1, 2, 3]);
    });

    it("does not stitch a passage from chunks that are not consecutive", () => {
        const cut = SPANNING.indexOf("most renewals");
        const rows = [
            row(1, SPANNING.slice(0, cut), 3),
            row(2, "Unrelated.", 3),
            row(3, "Unrelated.", 3),
            row(4, SPANNING.slice(cut), 4),
        ];
        expect(pickAnchorChunks(SPANNING, rows)).toEqual([]);
    });

    it("falls back to the chunk sharing most of the passage's words", () => {
        // OCR noise breaks the exact match, but nearly every word is there.
        const rows = [
            row(1, "Quarterly revenue grew in every region."),
            row(2, "Retrieval augmented generatlon grounds each answer in the indexed sourc3s."),
        ];
        expect(pickAnchorChunks(PASSAGE, rows).map(r => r.id)).toEqual([2]);
    });

    it("returns nothing when no chunk holds the passage", () => {
        const rows = [row(1, "Quarterly revenue grew in every region."), row(2, "Hiring paused.")];
        expect(pickAnchorChunks(PASSAGE, rows)).toEqual([]);
        expect(pickAnchorChunks(PASSAGE, [])).toEqual([]);
    });

    it("prefers the passage's page, and refuses a short ambiguous phrase without one", () => {
        const rows = [row(1, "Net revenue rose.", 1), row(2, "Net revenue rose again.", 2)];
        expect(pickAnchorChunks("Net revenue rose", rows, 2).map(r => r.id)).toEqual([2]);
        expect(pickAnchorChunks("Net revenue rose", rows)).toEqual([]);
    });
});

describe("locatePassageContext", () => {
    const passage = { documentId: 7, title: "Report", page: 2, text: PASSAGE };

    it("reads the page window first and stops when it anchors", async () => {
        const load = jest.fn().mockResolvedValue([row(5, `Intro. ${PASSAGE}`, 2)]);
        const anchors = await locatePassageContext(passage, { companyId: BigInt(1), load });
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith({
            companyId: BigInt(1),
            documentId: 7,
            pages: [1, 2, 3],
        });
        expect(anchors).toEqual([
            { documentId: 7, chunkId: 5, page: 2, content: `Intro. ${PASSAGE}` },
        ]);
    });

    it("scans the document when the page window misses", async () => {
        const load = jest
            .fn()
            .mockResolvedValueOnce([row(5, "Something else.", 2)])
            .mockResolvedValueOnce([row(5, "Something else.", 2), row(9, PASSAGE, 6)]);
        const anchors = await locatePassageContext(passage, { companyId: BigInt(1), load });
        expect(load).toHaveBeenLastCalledWith({ companyId: BigInt(1), documentId: 7 });
        expect(anchors.map(a => a.chunkId)).toEqual([9]);
    });

    it("needs a document and never throws", async () => {
        const load = jest.fn().mockRejectedValue(new Error("db down"));
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(
            await locatePassageContext(
                { title: "x", text: PASSAGE },
                { companyId: BigInt(1), load }
            )
        ).toEqual([]);
        expect(load).not.toHaveBeenCalled();
        expect(await locatePassageContext(passage, { companyId: BigInt(1), load })).toEqual([]);
        warn.mockRestore();
    });
});

describe("passagePromptSection", () => {
    const anchor: PassageAnchor = {
        documentId: 7,
        chunkId: 5,
        page: 4,
        content: `Before the passage. ${PASSAGE} After the passage.`,
    };

    it("labels the passage with its document and page, then its surrounding text", () => {
        const section = passagePromptSection(
            [{ documentId: 7, title: "Annual Report", page: 4, text: PASSAGE }],
            [[anchor]]
        );
        expect(section).toContain("The user selected the following passage(s)");
        expect(section).toContain(
            `Selected passage 1 — "Annual Report", page 4:\n"""\n${PASSAGE}\n"""`
        );
        expect(section).toContain(`Surrounding text:\n${anchor.content}`);
    });

    it("never labels the surrounding text with an index page that contradicts the viewer", () => {
        const stampedPageOne = { ...anchor, page: 1 };
        const withPage = passagePromptSection(
            [{ documentId: 7, title: "Annual Report", page: 2, text: PASSAGE }],
            [[stampedPageOne]]
        );
        expect(withPage).toContain('"Annual Report", page 2:');
        expect(withPage).not.toContain("page 1");
        const withoutPage = passagePromptSection(
            [{ documentId: 7, title: "Annual Report", text: PASSAGE }],
            [[anchor]]
        );
        expect(withoutPage).toContain(`Surrounding text (page 4):\n${anchor.content}`);
    });

    it("omits the page when unknown and the surrounding text when not found", () => {
        const section = passagePromptSection([{ title: "Notes", text: PASSAGE }], [[]]);
        expect(section).toContain(`Selected passage 1 — "Notes":\n"""\n${PASSAGE}\n"""`);
        expect(section).not.toContain("Surrounding text");
        expect(section).not.toContain("page");
        expect(passagePromptSection([], [])).toBe("");
    });

    it("numbers several passages", () => {
        const section = passagePromptSection(
            [
                { title: "A", page: 1, text: "first" },
                { title: "B", text: "second" },
            ],
            []
        );
        expect(section).toContain('Selected passage 1 — "A", page 1:');
        expect(section).toContain('Selected passage 2 — "B":');
    });

    it("trims a long chunk to a window centred on the passage", () => {
        const before = "alpha ".repeat(1_000);
        const after = "omega ".repeat(1_000);
        const long = { ...anchor, content: `${before}${PASSAGE} ${after}` };
        const section = passagePromptSection([{ title: "T", page: 4, text: PASSAGE }], [[long]]);
        const surrounding = section.split("Surrounding text:\n")[1]!;
        expect(surrounding.length).toBeLessThanOrEqual(3_002);
        expect(surrounding).toContain(PASSAGE);
        expect(surrounding.startsWith("…")).toBe(true);
        expect(surrounding.endsWith("…")).toBe(true);
        expect(surrounding).toContain("alpha");
        expect(surrounding).toContain("omega");
    });

    it("shows an anchor whole when retrieval returned the same chunk", () => {
        const long = { ...anchor, content: `${"alpha ".repeat(1_000)}${PASSAGE}` };
        const section = passagePromptSection([{ title: "T", text: PASSAGE }], [[long]], {
            whole: new Set([5]),
        });
        expect(section).toContain(long.content.trim());
    });
});

describe("excerptAround", () => {
    it("keeps short content as is", () => {
        expect(excerptAround("  short text  ", "short")).toBe("short text");
    });
});

describe("withoutAnchoredChunks", () => {
    const anchor: PassageAnchor = {
        documentId: 7,
        chunkId: 5,
        page: 4,
        content: `Before the passage. ${PASSAGE} After the passage.`,
    };

    it("drops the anchor's own chunk and text inside it, and reports what it covered", () => {
        const documents = [
            { pageContent: "anything", metadata: { parentChunkId: 5, documentId: 7 } },
            { pageContent: PASSAGE, metadata: { documentId: 7 } },
            { pageContent: "A different section about hiring plans.", metadata: { page: 9 } },
            { pageContent: PASSAGE, metadata: { source: "company_fact" } },
        ];
        const { remaining, covered } = withoutAnchoredChunks(documents, [anchor]);
        expect(remaining).toEqual([documents[2], documents[3]]);
        expect([...covered]).toEqual([5]);
    });

    it("keeps everything when there are no anchors", () => {
        const documents = [{ pageContent: PASSAGE, metadata: {} }];
        expect(withoutAnchoredChunks(documents, []).remaining).toEqual(documents);
    });
});
