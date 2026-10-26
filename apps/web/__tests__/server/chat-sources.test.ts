/**
 * What Ask tells the model about the files attached to a message.
 *
 * The bug this guards: asked to list everyone across 37 attached resumes,
 * Ask listed the 10 people in the 10 passages retrieval picked, called them
 * the total, and said someone whose resume was attached wasn't there. The
 * model now gets the list of attached files, every passage under its file,
 * and a line saying how much of the set it saw; small sets are read whole;
 * and the answer's "[d12]" citations become one source-list entry per file.
 */
import type { SearchResult } from "@launchstack/retrieval/search-types";

import {
    FULL_READ_TOKEN_BUDGET,
    attachedFilesPrompt,
    citeSources,
    excerptsBlock,
    fileText,
    filesShown,
    fitsFullRead,
    fullReadBlock,
    labelScopeFiles,
    manifestBlock,
    onePerSource,
    passageResult,
    passageText,
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

describe("the attached files", () => {
    const files = labelScopeFiles([
        row(40, "Rafael_Chen_Resume (2) - Rafael Chen.pdf"),
        row(12, "Leo Yang Resume 1 - Leo Yang.pdf"),
        row(3, "Ayla Zhang - Resume (1) - Ayla Zhang.pdf"),
    ]);

    it("lists the files in title order, each named by its id", () => {
        expect(files.map(file => file.label)).toEqual(["d3", "d12", "d40"]);
        expect(manifestBlock(files)).toBe(
            [
                "Attached files (3):",
                "d3 · Ayla Zhang - Resume (1) - Ayla Zhang.pdf",
                "d12 · Leo Yang Resume 1 - Leo Yang.pdf",
                "d40 · Rafael_Chen_Resume (2) - Rafael Chen.pdf",
            ].join("\n")
        );
    });

    it("lists at most 150 titles and says how many more there are", () => {
        const many = labelScopeFiles(
            Array.from({ length: 160 }, (_, i) =>
                row(i + 1, `File ${String(i + 1).padStart(3, "0")}`)
            )
        );
        const block = manifestBlock(many);
        expect(block.split("\n")).toHaveLength(152);
        expect(block).toContain("Attached files (160):");
        expect(block.endsWith("…and 10 more.")).toBe(true);
    });

    it("reads a set whole when it fits the budget and every file is indexed", () => {
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

    it("shows each passage under its file's id and title, not a bare chunk number", () => {
        const block = excerptsBlock(
            [
                result(40, "Rafael Chen › Experience\n\nBuilt things.", { page: 1 }),
                result(77, "A note.", { page: 2 }),
                result(12, "Ten years of facts.", {
                    source: "company_fact",
                    documentTitle: "Company profile",
                }),
            ],
            files
        );
        expect(block).toContain("=== [d40] Rafael_Chen_Resume (2) - Rafael Chen.pdf · page 1 ===");
        expect(block).toContain("=== Passage #2, page 2 ===");
        expect(block).toContain("=== Company fact #3 (from Company profile) ===");
        expect(block).not.toContain("Chunk #");
    });

    it("counts how many attached files a set of passages came from", () => {
        expect(
            filesShown([result(40, "a"), result(40, "b"), result(3, "c"), result(77, "d")], files)
        ).toBe(2);
    });

    it("reads a file whole without repeating its title, keeping section paths and pages", () => {
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
        const block = fullReadBlock(files, new Map([[40, passages]]));
        expect(block).toContain("=== [d40] Rafael_Chen_Resume (2) - Rafael Chen.pdf ===\n(page 1)");
        expect(block).toContain("=== [d3] Ayla Zhang - Resume (1) - Ayla Zhang.pdf ===\n");
        expect(passageResult(passages[0]!, files[2]!).metadata).toMatchObject({
            documentId: 40,
            chunkId: 1,
            page: 1,
            documentTitle: "Rafael_Chen_Resume (2) - Rafael Chen.pdf",
        });
    });
});

describe("what the model is told about how much it saw", () => {
    const files: ScopeFile[] = labelScopeFiles(
        Array.from({ length: 37 }, (_, i) => row(i + 1, `Resume ${i + 1}`))
    );

    it("says a sample is a sample, and that unseen is not absent", () => {
        const prompt = attachedFilesPrompt(
            files,
            { mode: "excerpts", passages: 10, filesShown: 10 },
            true
        );
        expect(prompt).toContain("The person attached 37 files to this message");
        expect(prompt).toContain("You were given 10 passages from 10 of the 37 files");
        expect(prompt).toContain("What you weren't shown is unknown, not absent");
        expect(prompt).toContain("never present a count or a list as complete");
        expect(prompt).toContain("call `ask_each`");
        expect(prompt).toContain('like "Rafael Chen [d12]"');
    });

    it("without tools, tells the model to say how much it covered", () => {
        const prompt = attachedFilesPrompt(
            files,
            { mode: "excerpts", passages: 10, filesShown: 8 },
            false
        );
        expect(prompt).not.toContain("ask_each");
        expect(prompt).toContain("say plainly that it covers 8 of the 37 files");
    });

    it("says when it has every file whole", () => {
        const prompt = attachedFilesPrompt(files, { mode: "full" }, true);
        expect(prompt).toContain("complete text of all 37 files");
        expect(prompt).toContain("give the complete list or the exact count");
        expect(prompt).not.toContain("unknown, not absent");
        expect(prompt).not.toContain("ask_each");
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

    it("names an attached file cited with nothing of it in view, and drops ids from nowhere", () => {
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
