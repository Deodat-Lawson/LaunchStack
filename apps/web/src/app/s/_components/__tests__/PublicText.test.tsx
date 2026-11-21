/** @jest-environment node */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PublicHeader, type PublicHeaderFile } from "../PublicHeader";
import {
    PAGE_TEXT_MAX_CHARS,
    PublicNoPreview,
    PublicTextSection,
    asCodeBlock,
    isTextOnlyType,
    pageText,
    shownAs,
} from "../PublicText";

/**
 * The public page's server-rendered parts. What matters most: the file's
 * words are in the HTML itself, so an AI agent (or anyone with scripts off)
 * reading `/s/<token>` gets them without running the viewer.
 */

const MARKDOWN_URL = "/s/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ.md";
const DOWNLOAD_URL = "/api/s/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ/content?download=1";

const TEXT = {
    markdown: [
        "# Q3 plan",
        "",
        "The billing migration ships before the October board meeting.",
        "",
        "| Owner | Task |",
        "| --- | --- |",
        "| Ana | Tax provider |",
        "",
        "[click me](javascript:alert(1)) and [docs](https://example.com/docs)",
        "",
        "<script>alert('x')</script>",
        "",
        "![Team photo](https://tracker.example.com/pixel.png)",
    ].join("\n"),
    available: true,
    truncated: false,
};

describe("Text version", () => {
    const html = renderToStaticMarkup(<PublicTextSection text={TEXT} markdownUrl={MARKDOWN_URL} />);

    it("puts the file's words in the HTML, open", () => {
        expect(html).toContain("The billing migration ships before the October board meeting.");
        expect(html).toContain("<h1>Q3 plan</h1>");
        expect(html).toContain("<td>Tax provider</td>");
        expect(html).toContain('<details open=""');
        expect(html).toContain("Text version");
    });

    it("runs nothing and loads nothing from the text", () => {
        // Raw HTML in the text reads as text; it is never markup.
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("<img");
        expect(html).not.toContain("tracker.example.com");
        // The picture's alt text stays.
        expect(html).toContain("Team photo");
        expect(html).toContain(
            'href="https://example.com/docs" target="_blank" rel="noopener noreferrer nofollow ugc"'
        );
    });

    it("says so when there is no text", () => {
        const none = renderToStaticMarkup(
            <PublicTextSection
                text={{ markdown: "", available: false, truncated: false }}
                markdownUrl={MARKDOWN_URL}
            />
        );
        expect(none).toContain("This file has no readable text yet.");
    });

    it("says where a very long file's text stops", () => {
        const cut = renderToStaticMarkup(
            <PublicTextSection text={{ ...TEXT, truncated: true }} markdownUrl={MARKDOWN_URL} />
        );
        expect(cut).toContain("The text stops here because the file is very long.");
    });
});

describe("pageText", () => {
    it("keeps a normal file whole", () => {
        expect(pageText("short")).toEqual({ markdown: "short", cut: false });
    });

    it("cuts a very long file at a paragraph near the cap", () => {
        const paragraph = `${"word ".repeat(199)}word`;
        const long = Array.from({ length: 400 }, () => paragraph).join("\n\n");
        expect(long.length).toBeGreaterThan(PAGE_TEXT_MAX_CHARS);
        const shown = pageText(long);
        expect(shown.cut).toBe(true);
        expect(shown.markdown.length).toBeLessThanOrEqual(PAGE_TEXT_MAX_CHARS);
        expect(shown.markdown.length).toBeGreaterThan(PAGE_TEXT_MAX_CHARS * 0.8);
        expect(shown.markdown.endsWith("word")).toBe(true);
    });

    it("points at the Markdown for the rest of a file cut on the page", () => {
        const long = "A sentence that repeats.\n\n".repeat(10_000);
        const html = renderToStaticMarkup(
            <PublicTextSection
                text={{ markdown: long, available: true, truncated: false }}
                markdownUrl={MARKDOWN_URL}
            />
        );
        expect(html).toContain(`<a href="${MARKDOWN_URL}"`);
        expect(html).toContain("Read the full text as Markdown");
    });
});

describe("shownAs", () => {
    it("keeps the server's classification", () => {
        expect(shownAs({ displayType: "pdf", mimeType: "application/pdf", title: "a.pdf" })).toBe(
            "pdf"
        );
        expect(shownAs({ displayType: "text", mimeType: "text/plain", title: "notes.txt" })).toBe(
            "text"
        );
    });

    it("shows a CSV in the spreadsheet viewer, by type or by name", () => {
        expect(shownAs({ displayType: "text", mimeType: "text/csv", title: "x" })).toBe("xlsx");
        expect(
            shownAs({ displayType: "text", mimeType: "application/csv; charset=utf-8", title: "x" })
        ).toBe("xlsx");
        expect(shownAs({ displayType: "text", mimeType: null, title: "Pipeline.CSV" })).toBe(
            "xlsx"
        );
    });

    it("fences data text so its lines stay lines, whatever backticks it holds", () => {
        const fenced = asCodeBlock(
            { markdown: "a,b\n```,c\n", available: true, truncated: false },
            "csv"
        );
        expect(fenced.markdown).toBe("````csv\na,b\n```,c\n````");
        const none = { markdown: "", available: false, truncated: false };
        expect(asCodeBlock(none, "csv")).toBe(none);
    });
});

describe("A file with no preview", () => {
    it("shows presentations, archives and unknown files as text", () => {
        expect(["pptx", "zip", "unknown"].every(type => isTextOnlyType(type as never))).toBe(true);
        expect(isTextOnlyType("pdf")).toBe(false);
        expect(isTextOnlyType("docx")).toBe(false);
    });

    it("explains, offers the download when allowed, and shows the text", () => {
        const html = renderToStaticMarkup(
            <PublicNoPreview
                displayType="pptx"
                text={TEXT}
                markdownUrl={MARKDOWN_URL}
                downloadUrl={DOWNLOAD_URL}
            />
        );
        expect(html).toContain("Presentations can&#x27;t be previewed here");
        expect(html).toContain(`href="${DOWNLOAD_URL.replace("&", "&amp;")}"`);
        expect(html).toContain("The billing migration ships before the October board meeting.");
        expect(html).not.toContain("officeapps");
    });

    it("offers no download when the link has downloads off", () => {
        const html = renderToStaticMarkup(
            <PublicNoPreview
                displayType="zip"
                text={{ markdown: "", available: false, truncated: false }}
                markdownUrl={MARKDOWN_URL}
                downloadUrl={null}
            />
        );
        expect(html).toContain("This file can&#x27;t be previewed here");
        expect(html).toContain("Ask the person who shared it to send you a copy.");
        expect(html).not.toContain("download");
    });
});

describe("Header", () => {
    const FILE: PublicHeaderFile = {
        title: "Q3 plan.pdf",
        displayType: "pdf",
        workspaceName: "Acme",
        updatedAt: "2026-11-02T12:00:00.000Z",
        downloadUrl: DOWNLOAD_URL,
        markdownUrl: MARKDOWN_URL,
    };

    it("names the file, its kind and where it is from, with both actions", () => {
        const html = renderToStaticMarkup(<PublicHeader file={FILE} />);
        expect(html).toContain("Q3 plan.pdf");
        expect(html).toContain(">PDF<");
        expect(html).toMatch(/Shared from Acme · updated Nov \d, 2026/);
        expect(html).toContain(">Download<");
        expect(html).toContain(`href="${MARKDOWN_URL}"`);
        expect(html).toContain("Markdown for AI");
    });

    it("leaves Download out when the link has downloads off", () => {
        const html = renderToStaticMarkup(<PublicHeader file={{ ...FILE, downloadUrl: null }} />);
        expect(html).not.toContain(">Download<");
        expect(html).toContain("Markdown for AI");
    });
});
