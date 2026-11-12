/**
 * What survives a trip through the in-app editor. The editor speaks HTML;
 * files are Markdown and Word — these pin the round trips the save promises
 * (headings, lists, bold/italic, links, tables, images) and the sanitizer
 * that stands between the editor and the converters.
 */
import JSZip from "jszip";
import mammoth from "mammoth";

import {
    docxToHtml,
    htmlToDocx,
    htmlToMarkdown,
    markdownToHtml,
    sanitizeEditorHtml,
    wrapHtmlDocument,
} from "~/server/services/file-editing/convert";
import { editableKindOf } from "~/lib/file-editing";

const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** What TipTap's getHTML() writes for a table, lists and marks. */
const TIPTAP_HTML =
    `<h1>Plan</h1><h2>Goals</h2>` +
    `<p>Hello <strong>bold</strong> <em>italic</em> <s>gone</s> ` +
    `<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">link</a></p>` +
    `<ul><li><p>alpha</p></li><li><p>beta</p><ul><li><p>nested</p></li></ul></li></ul>` +
    `<ol><li><p>one</p></li><li><p>two</p></li></ol>` +
    `<table style="min-width: 50px;"><colgroup><col><col></colgroup><tbody>` +
    `<tr><th colspan="1" rowspan="1"><p>Name</p></th><th colspan="1" rowspan="1"><p>Owner</p></th></tr>` +
    `<tr><td colspan="1" rowspan="1"><p>Launch</p></td><td colspan="1" rowspan="1"><p>Ana | Bo</p></td></tr>` +
    `</tbody></table>` +
    `<pre><code class="language-ts">const x = 1;</code></pre>` +
    `<blockquote><p>quoted</p></blockquote>`;

describe("sanitizeEditorHtml", () => {
    it("drops scripts, handlers, javascript: links and unknown tags", () => {
        const html =
            `<p onclick="steal()">Hi <script>alert(1)</script><a href="javascript:alert(1)">x</a>` +
            `<a href="https://ok.test" onmouseover="x()">ok</a></p>` +
            `<iframe src="https://evil.test"></iframe><style>p{}</style>` +
            `<custom-tag><span class="c1">kept text</span></custom-tag>`;
        const out = sanitizeEditorHtml(html, { allowRemoteImages: true });
        expect(out).not.toMatch(
            /script|onclick|onmouseover|javascript:|iframe|<style|custom-tag|<span/i
        );
        expect(out).toContain('<a href="https://ok.test">ok</a>');
        expect(out).toContain("kept text");
    });

    it("keeps data images, and remote ones only when allowed", () => {
        const html = `<p><img src="${PNG}"><img src="https://169.254.169.254/latest/meta-data"><img src="file:///etc/passwd"></p>`;
        const forWord = sanitizeEditorHtml(html, { allowRemoteImages: false });
        expect(forWord).toContain(PNG);
        expect(forWord).not.toContain("169.254");
        expect(forWord).not.toContain("file:");
        const forMarkdown = sanitizeEditorHtml(html, { allowRemoteImages: true });
        expect(forMarkdown).toContain("169.254.169.254");
        expect(forMarkdown).not.toContain("file:");
    });

    it("keeps text alignment and a code block's language, nothing else of style or class", () => {
        const out = sanitizeEditorHtml(
            `<p style="text-align: center; color: red">c</p><code class="hljs language-js x">y</code>`,
            { allowRemoteImages: false }
        );
        expect(out).toContain('<p style="text-align: center">c</p>');
        expect(out).toContain('<code class="language-js">y</code>');
    });

    it("takes the body of a whole document", () => {
        const out = sanitizeEditorHtml(
            `<html><head><title>T</title><style>.c1{}</style></head><body><p>Body</p></body></html>`,
            { allowRemoteImages: false }
        );
        expect(out).toBe("<p>Body</p>");
    });
});

describe("Markdown round trip", () => {
    it("writes the editor's HTML as tight, readable Markdown", () => {
        const md = htmlToMarkdown(TIPTAP_HTML);
        expect(md).toContain("# Plan\n");
        expect(md).toContain("## Goals");
        expect(md).toContain("**bold**");
        expect(md).toContain("*italic*");
        expect(md).toContain("~~gone~~");
        expect(md).toContain("[link](https://example.com)");
        expect(md).toMatch(/^- alpha$/m);
        expect(md).toMatch(/^ {2}- nested$/m);
        expect(md).toMatch(/^1\. one$/m);
        expect(md).toMatch(/^2\. two$/m);
        expect(md).toMatch(/^\| Name +\| Owner +\|$/m);
        expect(md).toMatch(/^\| Launch +\| Ana \\\| Bo +\|$/m);
        expect(md).toContain("```ts\nconst x = 1;\n```");
        expect(md).toContain("> quoted");
    });

    it("reads back to the same structure", () => {
        const html = markdownToHtml(htmlToMarkdown(TIPTAP_HTML));
        expect(html).toContain("<h1>Plan</h1>");
        expect(html).toContain("<h2>Goals</h2>");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<em>italic</em>");
        expect(html).toContain("<del>gone</del>");
        expect(html).toContain('<a href="https://example.com">link</a>');
        expect(html).toMatch(/<ul>\s*<li>alpha<\/li>/);
        expect(html).toContain("<li>nested</li>");
        expect(html).toMatch(/<ol>\s*<li>one<\/li>/);
        expect(html).toMatch(/<thead>[\s\S]*<th>Name<\/th>[\s\S]*<\/thead>/);
        expect(html).toContain("<td>Ana | Bo</td>");
        expect(html).toContain('<code class="language-ts">');
        expect(html).toContain("<blockquote>");
    });

    it("strips raw HTML a Markdown file carries before it reaches the editor", () => {
        const html = markdownToHtml(
            `# T\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n`
        );
        expect(html).not.toMatch(/script|onerror/);
        expect(html).toContain("<h1>T</h1>");
    });
});

describe("Word round trip", () => {
    it("writes a valid .docx that keeps headings, lists, marks, links, a table and an image", async () => {
        const bytes = await htmlToDocx(
            `${TIPTAP_HTML}<p><u>under</u></p><p><img src="${PNG}"></p>`,
            "Plan"
        );
        expect(bytes.subarray(0, 2).toString()).toBe("PK");

        const html = await docxToHtml(bytes);
        expect(html).toContain("<h1>Plan</h1>");
        expect(html).toContain("<h2>Goals</h2>");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<em>italic</em>");
        expect(html).toContain("<u>under</u>");
        expect(html).toContain('<a href="https://example.com">link</a>');
        expect(html).toMatch(/<ul><li>alpha<\/li><li>beta<ul><li>nested<\/li><\/ul><\/li><\/ul>/);
        expect(html).toMatch(/<ol><li>one<\/li><li>two<\/li><\/ol>/);
        expect(html).toMatch(
            /<table>[\s\S]*Name[\s\S]*Owner[\s\S]*Launch[\s\S]*Ana \| Bo[\s\S]*<\/table>/
        );
        expect(html).toMatch(/<img src="data:image\/png;base64,/);
    });

    it("draws bullets as a plain bullet, not Symbol's private-use glyph a browser cannot show", async () => {
        const bytes = await htmlToDocx("<ul><li>alpha</li></ul>", "T");
        const zip = await JSZip.loadAsync(bytes);
        const numbering = await zip.file("word/numbering.xml")!.async("string");
        expect(numbering).not.toContain("\uF0B7");
        expect(numbering).not.toContain('w:ascii="Symbol"');
        expect(numbering).toContain('<w:lvlText w:val="\u2022"/>');
        // Still the list it was.
        expect((await docxToHtml(bytes)).replace(/\s/g, "")).toContain("<ul><li>alpha</li></ul>");
    });

    it("never hands a remote image to the converter", async () => {
        const bytes = await htmlToDocx(
            `<p>x</p><p><img src="http://169.254.169.254/latest/meta-data/"></p>`,
            "T"
        );
        const { value } = await mammoth.convertToHtml({ buffer: bytes });
        expect(value).not.toContain("<img");
        expect(value).toContain("x");
    });

    it("writes an empty document from empty content", async () => {
        const bytes = await htmlToDocx("", "Blank");
        await expect(mammoth.convertToHtml({ buffer: bytes })).resolves.toBeDefined();
    });
});

describe("wrapHtmlDocument", () => {
    it("escapes the title", () => {
        expect(wrapHtmlDocument("<p>b</p>", `<x>&"`)).toBe(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>&lt;x&gt;&amp;&quot;</title></head><body><p>b</p></body></html>`
        );
    });
});

describe("editableKindOf", () => {
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    it.each([
        [{ title: "Notes.md", mimeType: "text/markdown" }, "markdown"],
        [{ title: "notes", fileType: "text/x-markdown" }, "markdown"],
        [{ title: "a.txt", mimeType: "text/plain" }, "text"],
        [{ title: "Plan", mimeType: DOCX }, "docx"],
        [{ title: "Plan.docx" }, "docx"],
        [
            {
                title: "Vault note.md",
                mimeType: "text/markdown",
                ocrMetadata: { connector: "obsidian" },
            },
            "markdown",
        ],
    ])("edits %j as %s", (doc, kind) => {
        expect(editableKindOf(doc)).toBe(kind);
    });

    it.each([
        { title: "a.pdf", mimeType: "application/pdf" },
        { title: "old.doc", mimeType: "application/msword" },
        { title: "page.html", mimeType: "text/html" },
        { title: "Notion page", mimeType: "text/markdown", ocrMetadata: { connector: "notion" } },
        { title: "Drive doc", mimeType: DOCX, ocrMetadata: { connector: "google-drive" } },
        {
            title: "Session",
            mimeType: "text/markdown",
            ocrMetadata: { connector: "agent-sessions" },
        },
        { title: "Call (transcription)", mimeType: "text/plain" },
        {
            title: "Map",
            mimeType: "text/markdown",
            ocrMetadata: { kind: "mindmap", mindmapId: 3, revision: 1, publishedAt: "x" },
        },
    ])("does not edit %j", doc => {
        expect(editableKindOf(doc)).toBeNull();
    });
});
