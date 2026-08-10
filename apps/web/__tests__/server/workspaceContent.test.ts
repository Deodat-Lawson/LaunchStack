/**
 * The document projections.
 *
 * `content.ts` is the only thing on the server that understands the editor's
 * JSON, and three separate features depend on it being right: search indexes
 * `docToText`, the backlink graph is rebuilt from `extractPageLinks`, and
 * export is `docToMarkdown` / `docToHtml`. None of those surfaces would fail
 * loudly if a block type were dropped — the text would just quietly go
 * missing — so each block is asserted here.
 */

import {
    docToHtml,
    docToMarkdown,
    docToText,
    docWordCount,
    extractPageLinks,
    type DocNode,
} from "~/server/workspace/content";

const text = (value: string): DocNode => ({ type: "text", text: value });

const paragraph = (value: string): DocNode => ({
    type: "paragraph",
    content: [text(value)],
});

describe("docToText", () => {
    it("returns an empty string for a missing document", () => {
        expect(docToText(null)).toBe("");
        expect(docToText(undefined)).toBe("");
    });

    it("keeps blocks on separate lines so a phrase cannot span two", () => {
        const doc: DocNode = {
            type: "doc",
            content: [paragraph("first"), paragraph("second")],
        };

        expect(docToText(doc).split("\n")).toEqual(["first", "second"]);
    });

    it("includes text that lives in attributes rather than children", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                { type: "blockMath", attrs: { latex: "e^{i\\pi}+1=0" } },
                {
                    type: "paragraph",
                    content: [
                        { type: "mention", attrs: { kind: "page", id: "p1", label: "Roadmap" } },
                    ],
                },
                { type: "bookmark", attrs: { url: "https://example.com", title: "Example" } },
                { type: "imageBlock", attrs: { src: "/a.png", caption: "A diagram" } },
            ],
        };

        const flattened = docToText(doc);
        expect(flattened).toContain("e^{i\\pi}+1=0");
        expect(flattened).toContain("Roadmap");
        expect(flattened).toContain("Example");
        expect(flattened).toContain("A diagram");
    });

    it("never prints [object Object] for an attribute holding an object", () => {
        const doc: DocNode = {
            type: "doc",
            content: [{ type: "pageLink", attrs: { title: { nested: true } } }],
        };

        expect(docToText(doc)).not.toContain("[object Object]");
    });
});

describe("extractPageLinks", () => {
    it("collects child pages, mentions, synced blocks and page:// links", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                { type: "pageLink", attrs: { pageId: "child" } },
                {
                    type: "paragraph",
                    content: [
                        { type: "mention", attrs: { kind: "page", id: "mentioned" } },
                        {
                            type: "text",
                            text: "link",
                            marks: [{ type: "link", attrs: { href: "page://linked" } }],
                        },
                    ],
                },
                { type: "syncedBlock", attrs: { sourcePageId: "synced" } },
            ],
        };

        // Document order: the paragraph's mention and inline link come before
        // the synced block that follows it.
        expect(extractPageLinks(doc)).toEqual([
            "child",
            "mentioned",
            "linked",
            "synced",
        ]);
    });

    it("ignores external links and deduplicates repeats", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                { type: "pageLink", attrs: { pageId: "same" } },
                { type: "pageLink", attrs: { pageId: "same" } },
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: "out",
                            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
                        },
                    ],
                },
            ],
        };

        expect(extractPageLinks(doc)).toEqual(["same"]);
    });

    it("skips a mention of a non-page thing", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [{ type: "mention", attrs: { kind: "date", id: "2026-08-09" } }],
                },
            ],
        };

        expect(extractPageLinks(doc)).toEqual([]);
    });
});

describe("docToMarkdown", () => {
    it("renders headings, lists, and marks", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "bold", marks: [{ type: "bold" }] },
                        text(" and "),
                        { type: "text", text: "code", marks: [{ type: "code" }] },
                    ],
                },
                {
                    type: "bulletList",
                    content: [
                        { type: "listItem", content: [paragraph("one")] },
                        { type: "listItem", content: [paragraph("two")] },
                    ],
                },
                {
                    type: "taskList",
                    content: [
                        {
                            type: "taskItem",
                            attrs: { checked: true },
                            content: [paragraph("done")],
                        },
                        {
                            type: "taskItem",
                            attrs: { checked: false },
                            content: [paragraph("todo")],
                        },
                    ],
                },
            ],
        };

        const markdown = docToMarkdown(doc);
        expect(markdown).toContain("## Plan");
        expect(markdown).toContain("**bold** and `code`");
        expect(markdown).toContain("- one");
        expect(markdown).toContain("- two");
        expect(markdown).toContain("- [x] done");
        expect(markdown).toContain("- [ ] todo");
    });

    it("degrades blocks Markdown cannot express rather than dropping them", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                {
                    type: "callout",
                    attrs: { emoji: "⚠️" },
                    content: [paragraph("Careful")],
                },
                {
                    type: "columns",
                    content: [
                        { type: "column", content: [paragraph("left")] },
                        { type: "column", content: [paragraph("right")] },
                    ],
                },
                {
                    type: "embed",
                    attrs: { url: "https://example.com", title: "Demo" },
                },
            ],
        };

        const markdown = docToMarkdown(doc);
        expect(markdown).toContain("Careful");
        expect(markdown).toContain("left");
        expect(markdown).toContain("right");
        expect(markdown).toContain("Demo");
    });

    it("renders a table with a header separator", () => {
        const cell = (value: string): DocNode => ({
            type: "tableCell",
            content: [paragraph(value)],
        });
        const doc: DocNode = {
            type: "doc",
            content: [
                {
                    type: "table",
                    content: [
                        { type: "tableRow", content: [cell("a"), cell("b")] },
                        { type: "tableRow", content: [cell("1"), cell("2")] },
                    ],
                },
            ],
        };

        const lines = docToMarkdown(doc).split("\n");
        expect(lines[0]).toBe("| a | b |");
        expect(lines[1]).toBe("| --- | --- |");
        expect(lines[2]).toBe("| 1 | 2 |");
    });

    it("escapes a pipe inside a cell so the table survives", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                {
                    type: "table",
                    content: [
                        {
                            type: "tableRow",
                            content: [
                                { type: "tableCell", content: [paragraph("a|b")] },
                            ],
                        },
                    ],
                },
            ],
        };

        expect(docToMarkdown(doc)).toContain("a\\|b");
    });
});

describe("docToHtml", () => {
    it("escapes text so a document cannot inject markup", () => {
        const doc: DocNode = {
            type: "doc",
            content: [paragraph("<script>alert(1)</script>")],
        };

        const html = docToHtml(doc);
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("keeps link hrefs and mark nesting", () => {
        const doc: DocNode = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: "site",
                            marks: [
                                { type: "bold" },
                                { type: "link", attrs: { href: "https://example.com" } },
                            ],
                        },
                    ],
                },
            ],
        };

        const html = docToHtml(doc);
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain("<strong>site</strong>");
    });
});

describe("docWordCount", () => {
    it("counts words across blocks and returns zero for an empty document", () => {
        expect(docWordCount(null)).toBe(0);
        expect(
            docWordCount({
                type: "doc",
                content: [paragraph("one two"), paragraph("three")],
            })
        ).toBe(3);
    });
});
