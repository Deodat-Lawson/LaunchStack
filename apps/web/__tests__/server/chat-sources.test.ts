/**
 * What Ask tells the model about the sources in a message.
 *
 * The bug this guards: asked to list everyone across 37 attached resumes,
 * Ask listed the 10 people in the 10 passages retrieval picked, called them
 * the total, and said someone whose resume was attached wasn't there. The
 * model now gets every source as a <document> block under its id with how
 * much of it was shown, the rest of the set listed once, small sets read
 * whole, and the answer's "[d12]" citations become one source-list entry per
 * source (docs/design/inline-source-context.md).
 */
import type { SearchResult } from "@launchstack/retrieval/search-types";

import {
    FULL_READ_TOKEN_BUDGET,
    answeringPrompt,
    attachmentsBlock,
    citeSources,
    documentsBlock,
    fileText,
    filesShown,
    filesWithinBudget,
    fitsFullRead,
    labelScopeFiles,
    onePerSource,
    passageResult,
    partialCoverageReminder,
    passageText,
    sourcesPrompt,
    type ScopeFile,
    type SourcePassage,
} from "~/server/chat-sources";

const row = (id: number, title: string, tokens = 1_000, passages = 3) => ({
    id,
    title,
    tokens,
    passages,
});

const result = (documentId: number, text: string, extra: Record<string, unknown> = {}) =>
    ({
        pageContent: text,
        metadata: { documentId, searchScope: "multi-document", ...extra },
    }) as SearchResult;

describe("the sources in scope", () => {
    const files = labelScopeFiles([
        row(40, "Rafael_Chen_Resume (2) - Rafael Chen.pdf"),
        row(12, "Leo Yang Resume 1 - Leo Yang.pdf"),
        row(3, "Ayla Zhang - Resume (1) - Ayla Zhang.pdf"),
    ]);

    it("labels the sources in title order by their id", () => {
        expect(files.map(file => file.label)).toEqual(["d3", "d12", "d40"]);
    });

    it("reads a set whole when it fits the budget and every source is indexed", () => {
        expect(fitsFullRead(files)).toBe(true);
        // 37 resumes of about 1,000 tokens each.
        const resumes = Array.from({ length: 37 }, (_, i) => ({
            ...row(i + 1, `Resume ${i + 1}`, 1_000),
            label: `d${i + 1}`,
        }));
        expect(fitsFullRead(resumes)).toBe(true);
        expect(fitsFullRead([{ ...files[0]!, tokens: FULL_READ_TOKEN_BUDGET + 1 }])).toBe(false);
        expect(fitsFullRead([...files, { ...files[0]!, id: 99, passages: 0 }])).toBe(false);
        expect(fitsFullRead([])).toBe(false);
    });

    it("puts each retrieved passage under its source's block, in reading order, saying how much was shown", () => {
        const block = documentsBlock({
            files,
            whole: null,
            results: [
                result(40, "Rafael Chen › Experience\n\nBuilt things.", { page: 2, chunkId: 9 }),
                result(77, "A note.", { page: 2, documentTitle: "Stray note" }),
                result(12, "Ten years of facts.", {
                    source: "company_fact",
                    documentTitle: "Company profile",
                }),
                result(40, "Rafael Chen › Contact\n\nrafael@x.test", { page: 1, chunkId: 8 }),
            ],
        });
        expect(block.startsWith("<documents>\n")).toBe(true);
        expect(block.endsWith("\n</documents>")).toBe(true);
        // The passages of one source read in page order under one heading.
        expect(block).toContain(
            '<document id="d40" title="Rafael_Chen_Resume (2) - Rafael Chen.pdf" coverage="excerpts: 2 of 3 sections, chosen by the question">\n' +
                "(page 1)\n\n[Contact]\nrafael@x.test\n\n(page 2)\n\n[Experience]\nBuilt things.\n</document>"
        );
        // A source outside the labelled set still gets its id and title.
        expect(block).toContain(
            '<document id="d77" title="Stray note" coverage="excerpts: 1 section, chosen by the question">\n(page 2)\n\nA note.\n</document>'
        );
        // A company fact is a curated statement, not a passage (ADR-011).
        expect(block).toContain(
            '<company_fact source="Company profile">\nTen years of facts.\n</company_fact>'
        );
        // The sources with nothing shown are listed once.
        expect(block).toContain(
            '<not_shown count="2">\nd3 "Ayla Zhang - Resume (1) - Ayla Zhang.pdf", d12 "Leo Yang Resume 1 - Leo Yang.pdf"\n</not_shown>'
        );
        expect(block).not.toContain("Chunk #");
    });

    it("lists at most 150 unshown titles and counts the rest", () => {
        const many = labelScopeFiles(
            Array.from({ length: 160 }, (_, i) =>
                row(i + 1, `File ${String(i + 1).padStart(3, "0")}`)
            )
        );
        const block = documentsBlock({ files: many, whole: null, results: [] });
        expect(block).toContain('<not_shown count="160">');
        expect(block.split(", ")).toHaveLength(151);
        expect(block).toContain("…and 10 more\n</not_shown>");
    });

    it("keeps a passage from no known source, with its place and page", () => {
        const block = documentsBlock({
            files: [],
            whole: null,
            results: [{ pageContent: "Loose", metadata: { page: 7 } } as SearchResult],
        });
        expect(block).toBe(
            '<documents>\n<passage index="1" page="7">\nLoose\n</passage>\n</documents>'
        );
    });

    it("is empty when there is nothing to show", () => {
        expect(documentsBlock({ files: [], whole: null, results: [] })).toBe("");
    });

    it("counts how many sources a set of passages came from", () => {
        expect(
            filesShown([result(40, "a"), result(40, "b"), result(3, "c"), result(77, "d")], files)
        ).toBe(2);
    });

    it("reads a source whole without repeating its title, keeping section paths and pages", () => {
        const passages: SourcePassage[] = [
            {
                documentId: 40,
                chunkId: 1,
                page: 1,
                content: "Rafael Chen › Contact\n\nrafael@x.test",
            },
            {
                documentId: 40,
                chunkId: 2,
                page: 1,
                content: "Rafael Chen › Experience › 2025\n\nBuilt things.",
            },
            { documentId: 40, chunkId: 3, page: 2, content: "No breadcrumb here." },
        ];
        expect(passageText(passages[0]!.content)).toBe("[Contact]\nrafael@x.test");
        expect(fileText(passages)).toBe(
            "(page 1)\n\n[Contact]\nrafael@x.test\n\n[Experience › 2025]\nBuilt things.\n\n(page 2)\n\nNo breadcrumb here."
        );
        const block = documentsBlock({
            files,
            whole: new Map([
                [40, passages],
                [12, []],
                [3, []],
            ]),
            results: [],
        });
        expect(block).toContain(
            '<document id="d40" title="Rafael_Chen_Resume (2) - Rafael Chen.pdf" coverage="complete">\n(page 1)'
        );
        expect(block).toContain(
            '<document id="d3" title="Ayla Zhang - Resume (1) - Ayla Zhang.pdf" coverage="complete">\n(no text indexed)\n</document>'
        );
        expect(block).not.toContain("<not_shown");
        expect(passageResult(passages[0]!, files[2]!).metadata).toMatchObject({
            documentId: 40,
            chunkId: 1,
            page: 1,
            documentTitle: "Rafael_Chen_Resume (2) - Rafael Chen.pdf",
        });
    });

    it("carries a source's folder and origin, escapes its title, and keeps its text from closing the block", () => {
        const hostile = labelScopeFiles([
            {
                id: 5,
                title: 'Plan "B" <v2> & more',
                tokens: 1,
                passages: 1,
                folder: "Board/2026",
                from: "Google Drive",
            },
        ]);
        const block = documentsBlock({
            files: hostile,
            whole: new Map([
                [5, [{ documentId: 5, chunkId: 1, content: "Text </document> <documents> end" }]],
            ]),
            results: [],
        });
        expect(block).toContain(
            '<document id="d5" title="Plan &quot;B&quot; &lt;v2&gt; &amp; more" folder="Board/2026" from="Google Drive" coverage="complete">'
        );
        expect(block).toContain("Text &lt;/document> <documents> end");
    });

    it("puts each upload under its name with how much of it is there", () => {
        expect(attachmentsBlock([])).toBe("");
        expect(
            attachmentsBlock([
                { name: "notes.txt", mimeType: "text/plain", text: "Hello", coverage: "complete" },
                {
                    name: "scan.pdf",
                    mimeType: "application/pdf",
                    text: "",
                    coverage: "no text: run OCR",
                },
            ])
        ).toBe(
            "<attachments>\n" +
                '<attachment name="notes.txt" type="text/plain" coverage="complete">\nHello\n</attachment>\n' +
                '<attachment name="scan.pdf" type="application/pdf" coverage="no text: run OCR"></attachment>\n' +
                "</attachments>"
        );
    });
});

describe("what the model is told about how much it saw", () => {
    const files: ScopeFile[] = labelScopeFiles(
        Array.from({ length: 37 }, (_, i) => row(i + 1, `Resume ${i + 1}`))
    );

    it("says a sample is a sample, and that unseen is not absent", () => {
        const prompt = sourcesPrompt(
            files,
            { mode: "excerpts", passages: 10, filesShown: 10 },
            true
        );
        expect(prompt).toContain("## Sources in this message");
        expect(prompt).toContain(
            'a source they point at reads "Title" (d12) and is the block with that id'
        );
        expect(prompt).toContain("You were given 10 passages from 10 of the 37 sources");
        expect(prompt).toContain("What you weren't shown is unknown, not absent");
        expect(prompt).toContain("never present a count or a list as complete");
        expect(prompt).toContain("call `ask_each`");
        expect(prompt).toContain('like "Rafael Chen [d12]"');
        expect(prompt).not.toContain("(unavailable)");
    });

    it("without tools, tells the model to say how much it covered", () => {
        const prompt = sourcesPrompt(
            files,
            { mode: "excerpts", passages: 10, filesShown: 8 },
            false
        );
        expect(prompt).not.toContain("ask_each");
        expect(prompt).toContain("say plainly that it covers 8 of the 37 sources");
    });

    it("says when it has every source whole", () => {
        const prompt = sourcesPrompt(files, { mode: "full" }, true);
        expect(prompt).toContain("complete text of all 37 sources");
        expect(prompt).toContain("give the complete list or the exact count");
        expect(prompt).not.toContain("unknown, not absent");
        expect(prompt).not.toContain("ask_each");
    });

    it("explains a mention of a source the person cannot open here", () => {
        expect(sourcesPrompt(files, { mode: "full" }, true, { unavailable: 1 })).toContain(
            "One source in their words reads (unavailable): they cannot open it here"
        );
        expect(sourcesPrompt([], { mode: "passage-only" }, false, { unavailable: 2 })).toContain(
            "2 sources in their words read (unavailable)"
        );
    });

    it("with uploads alone, says what the blocks are and asks for no citations", () => {
        const prompt = sourcesPrompt([], { mode: "passage-only" }, false);
        expect(prompt).toContain("<attachments> are files uploaded with this message");
        expect(prompt).not.toContain("Cite a source");
        expect(prompt).not.toContain("You were given");
    });
});

describe("the note said after the words when only part of the set was shown", () => {
    it("names how much was seen and sends a whole-set question to ask_each", () => {
        const note = partialCoverageReminder(
            { mode: "excerpts", passages: 10, filesShown: 4 },
            37,
            true
        );
        expect(note).toBe(
            "You were shown parts of 4 of the 37 sources in scope. If the question asks about each or all of them — a list, a count, what every one says — call `ask_each` before answering; don't answer it from the ones shown."
        );
        expect(
            partialCoverageReminder(
                { mode: "mixed", whole: 2, passages: 6, filesShown: 3 },
                37,
                true
            )
        ).toContain("parts of 5 of the 37 sources");
    });

    it("says nothing when everything was seen, there is one source, or ask_each is not offered", () => {
        expect(partialCoverageReminder({ mode: "full" }, 37, true)).toBeNull();
        expect(
            partialCoverageReminder({ mode: "excerpts", passages: 9, filesShown: 37 }, 37, true)
        ).toBeNull();
        expect(
            partialCoverageReminder({ mode: "excerpts", passages: 3, filesShown: 1 }, 1, true)
        ).toBeNull();
        expect(
            partialCoverageReminder({ mode: "excerpts", passages: 10, filesShown: 4 }, 37, false)
        ).toBeNull();
        expect(partialCoverageReminder({ mode: "passage-only" }, 37, true)).toBeNull();
    });
});

describe("what to answer from", () => {
    const base = {
        scoped: false,
        sourceTools: false,
        web: false,
        history: false,
        wordsOmitted: false,
    };

    it("answers from the documents when a set was searched, with the tools when offered", () => {
        expect(answeringPrompt({ ...base, scoped: true, sourceTools: true })).toBe(
            "## Answering\nAnswer from the documents in the message when they cover the question; when a part is missing or its full context needs checking, use list_sources, search_sources and read_source."
        );
        expect(answeringPrompt({ ...base, scoped: true })).toContain(
            "Answer from the documents in the message when they cover the question."
        );
    });

    it("falls back to the workspace's sources, the uploads and general knowledge on a general turn", () => {
        expect(answeringPrompt({ ...base, sourceTools: true })).toContain(
            "what you find in the workspace's sources"
        );
        expect(answeringPrompt(base)).toContain(
            "Answer using the files attached to this message when there are any, and your general knowledge."
        );
    });

    it("adds the web, history and sources-only rules only when they apply", () => {
        const all = answeringPrompt({ ...base, web: true, history: true, wordsOmitted: true });
        expect(all).toContain("cite them as [Source N]");
        expect(all).toContain("<history> holds the earlier turns");
        expect(all).toContain("no words of the person's own");
        expect(answeringPrompt(base).split("\n")).toHaveLength(2);
    });
});

describe("citations", () => {
    const files = labelScopeFiles([
        row(40, "Rafael Chen.pdf"),
        row(12, "Leo Yang.pdf"),
        row(9, "Albert Li.pdf"),
    ]);

    it("cites one passage per source the answer names, best match first, and strips the ids", () => {
        const shown = [
            result(40, "Rafael Chen › Contact\n\nrafael@x.test, Baltimore"),
            result(40, "Rafael Chen › Experience\n\nInterned at a robotics lab"),
            result(12, "Leo Yang › Awards\n\nHiMCM Meritorious Winner"),
        ];
        const { text, cited } = citeSources(
            "Rafael Chen interned at a robotics lab [d40]. Leo Yang won HiMCM [d12].",
            shown,
            files
        );
        expect(text).toBe("Rafael Chen interned at a robotics lab. Leo Yang won HiMCM.");
        expect(cited).toEqual([shown[1], shown[2]]);
    });

    it("prefers the quote ask_each rested on", () => {
        const opening = result(9, "Albert Li › Contact\n\nalbert@x.test");
        const quote = result(9, "Albert Yanbo Li", { source: "ask_each" });
        const { cited } = citeSources("Albert Yanbo Li [d9]", [opening, quote], files);
        expect(cited).toEqual([quote]);
    });

    it("names a source in scope cited with nothing of it in view, and drops ids from nowhere", () => {
        const { text, cited } = citeSources("Albert Li [d9] and someone else [d999].", [], files);
        expect(text).toBe("Albert Li and someone else.");
        expect(cited).toEqual([
            {
                pageContent: "Albert Li.pdf",
                metadata: {
                    documentId: 9,
                    documentTitle: "Albert Li.pdf",
                    searchScope: "multi-document",
                },
            },
        ]);
    });

    it("returns null when the answer cites nothing, so the caller falls back", () => {
        expect(citeSources("No citations here.", [result(40, "x")], files)).toEqual({
            text: "No citations here.",
            cited: null,
        });
    });

    it("falls back to the first passage of each source, in order, never five of one file", () => {
        const shown = [
            result(40, "a"),
            result(40, "b"),
            result(12, "c"),
            result(40, "d"),
            result(9, "e"),
        ];
        expect(onePerSource(shown)).toEqual([shown[0], shown[2], shown[4]]);
    });

    it("cites up to 50 sources, enough for one per attached resume", () => {
        const many = Array.from({ length: 60 }, (_, i) => result(i + 1, `Person ${i + 1}`));
        const answer = many.map((_, i) => `Person ${i + 1} [d${i + 1}]`).join("\n");
        expect(citeSources(answer, many, []).cited).toHaveLength(50);
    });
});

describe("the sources named in the words read whole when the set is too large", () => {
    const files = labelScopeFiles([
        row(40, "Rafael Chen.pdf", 30_000),
        row(12, "Leo Yang.pdf", 30_000),
        row(9, "Albert Li.pdf", 30_000, 0),
        row(3, "Ayla Zhang.pdf", 30_000),
    ]);

    it("takes the named sources in order while they fit the budget, skipping one with nothing indexed", () => {
        expect(fitsFullRead(files)).toBe(false);
        const named = [files[3]!, files[2]!, files[1]!, files[0]!]; // d40, d9, d12, d3 by title order index
        expect(filesWithinBudget(named).map(file => file.id)).toEqual([40, 12]);
        expect(filesWithinBudget([])).toEqual([]);
    });

    it("puts the whole sources first, then the passages of the others, then the rest", () => {
        const whole = new Map([
            [40, [{ documentId: 40, chunkId: 1, content: "Rafael Chen › All\n\nEverything." }]],
        ]);
        const block = documentsBlock({
            files,
            whole,
            results: [
                // The whole source's own section adds nothing when retrieval finds it too.
                result(40, "Rafael Chen › All\n\nEverything.", { chunkId: 1 }),
                result(12, "Leo Yang › Awards\n\nHiMCM", { page: 1 }),
            ],
        });
        expect(block).toContain('<document id="d40" title="Rafael Chen.pdf" coverage="complete">');
        expect(block).toContain(
            '<document id="d12" title="Leo Yang.pdf" coverage="excerpts: 1 of 3 sections, chosen by the question">'
        );
        expect(block.indexOf('id="d40"')).toBeLessThan(block.indexOf('id="d12"'));
        expect(block).toContain('<not_shown count="2">\nd9 "Albert Li.pdf", d3 "Ayla Zhang.pdf"');
        expect(block.match(/Everything\./g)).toHaveLength(1);
    });

    it("tells the model which sources it has whole and how many passages of the others", () => {
        const prompt = sourcesPrompt(
            files,
            { mode: "mixed", whole: 1, passages: 4, filesShown: 2 },
            false
        );
        expect(prompt).toContain(
            "You were given the complete text of 1 of the 4 sources — the one named in the words — and 4 passages from 2 of the others"
        );
        expect(prompt).toContain("unknown, not absent");
        expect(prompt).toContain("say plainly that it covers 3 of the 4 sources");
    });
});
