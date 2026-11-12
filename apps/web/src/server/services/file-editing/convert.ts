/**
 * The in-app editor speaks HTML; files are Markdown, plain text or Word.
 * Every conversion between them lives here, so the editor route stays a
 * router and the rules for what survives a save are in one place.
 *
 *   load:  Markdown → HTML (marked, GFM) · Word → HTML (mammoth)
 *   save:  HTML → Markdown (turndown + GFM tables) · HTML → Word (html-to-docx)
 *
 * Everything that crosses in either direction goes through
 * {@link sanitizeEditorHtml} first: an allowlist of the tags the editor can
 * hold, no scripts, handlers or `javascript:` links, and — for Word — no
 * remote images, because html-to-docx would fetch them from the server.
 */
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";
import { marked } from "marked";
import mammoth from "mammoth";
import HTMLtoDOCX from "@turbodocx/html-to-docx";
import JSZip from "jszip";

/** Tags whose content is dangerous or meaningless in a document: dropped whole. */
const DROP_TAGS = new Set([
    "script",
    "style",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "noscript",
    "template",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "link",
    "meta",
    "base",
    "title",
    "head",
    "svg",
    "math",
    "canvas",
    "audio",
    "video",
    "source",
    "track",
]);

/** Tags the editor holds; anything else is unwrapped to its children. */
const KEEP_TAGS = new Set([
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "strike",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "colgroup",
    "col",
    "img",
    "hr",
    "sub",
    "sup",
    "mark",
]);

const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
    a: new Set(["href", "title"]),
    img: new Set(["src", "alt", "title", "width", "height"]),
    th: new Set(["colspan", "rowspan"]),
    td: new Set(["colspan", "rowspan"]),
    ol: new Set(["start"]),
    col: new Set(["span"]),
    code: new Set(["class"]),
};

/** Text alignment is the one inline style the editor writes. */
const ALIGN_STYLE = /text-align\s*:\s*(left|center|right|justify)/i;
const ALIGNABLE = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "th", "td"]);

const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
const REMOTE_IMAGE = /^https?:\/\//i;

export interface SanitizeOptions {
    /**
     * Keep `http(s)` image sources. Off for Word: html-to-docx downloads
     * every image it is given, and a server-side fetch of a URL the client
     * chose is an SSRF hole.
     */
    allowRemoteImages: boolean;
}

/** domhandler's node types, reached through cheerio (pnpm does not hoist domhandler). */
type AnyNode = ReturnType<ReturnType<cheerio.CheerioAPI["root"]>["contents"]>[number];
type Element = Extract<AnyNode, { name: string; attribs: Record<string, string> }>;

function isElement(node: AnyNode): node is Element {
    const type = String(node.type);
    return type === "tag" || type === "script" || type === "style";
}

/**
 * Reduce HTML to what the editor can hold. Returns body content only (no
 * `<html>`/`<head>`), safe to hand to the editor, turndown or html-to-docx.
 */
export function sanitizeEditorHtml(html: string, options: SanitizeOptions): string {
    const $ = cheerio.load(html, {}, false);
    // A full document (Drive export, a pasted page) contributes its body.
    const body = $("body");

    const walk = (nodes: AnyNode[]) => {
        for (const node of nodes) {
            const type = String(node.type);
            if (type === "comment" || type === "directive" || type === "cdata") {
                $(node).remove();
                continue;
            }
            if (!isElement(node)) continue;
            const tag = node.name.toLowerCase();
            if (DROP_TAGS.has(tag)) {
                $(node).remove();
                continue;
            }
            // Children first, so an unwrapped element's content is clean too.
            walk([...node.children]);
            if (!KEEP_TAGS.has(tag)) {
                $(node).replaceWith($(node).contents());
                continue;
            }
            const allowed = ALLOWED_ATTRS[tag];
            for (const name of Object.keys(node.attribs)) {
                const value = node.attribs[name] ?? "";
                if (name === "style" && ALIGNABLE.has(tag)) {
                    const align = ALIGN_STYLE.exec(value);
                    if (align) node.attribs.style = `text-align: ${align[1]!.toLowerCase()}`;
                    else delete node.attribs.style;
                    continue;
                }
                if (!allowed?.has(name)) delete node.attribs[name];
            }
            if (tag === "a") {
                const href = (node.attribs.href ?? "").trim();
                if (!SAFE_HREF.test(href)) delete node.attribs.href;
            }
            if (tag === "code" && node.attribs.class) {
                const lang = /(?:^|\s)(language-[\w+-]+)/.exec(node.attribs.class);
                if (lang) node.attribs.class = lang[1]!;
                else delete node.attribs.class;
            }
            if (tag === "img") {
                const src = (node.attribs.src ?? "").trim();
                const keep =
                    DATA_IMAGE.test(src) || (options.allowRemoteImages && REMOTE_IMAGE.test(src));
                if (!keep) $(node).remove();
            }
        }
    };
    if (body.length) {
        walk(body.contents().toArray());
        return body.html() ?? "";
    }
    walk($.root().contents().toArray());
    return $.root().html() ?? "";
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function markdownToHtml(markdown: string): string {
    const html = marked.parse(markdown.replace(/^﻿/, ""), { gfm: true, async: false });
    // Markdown can carry raw HTML; the editor gets only what it can hold.
    return sanitizeEditorHtml(html, { allowRemoteImages: true });
}

function createTurndown(): TurndownService {
    const service = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        emDelimiter: "*",
        strongDelimiter: "**",
        hr: "---",
    });
    service.use(gfm);
    // Turndown pads list markers to four columns ("-   item"); a single
    // space reads like Markdown people write, and nested content indents by
    // the marker's own width so CommonMark still nests it.
    service.addRule("compactListItem", {
        filter: "li",
        replacement(content, node) {
            const parent = node.parentNode as HTMLElement | null;
            let prefix = "- ";
            if (parent?.nodeName === "OL") {
                const start = Number(parent.getAttribute("start") ?? "1") || 1;
                const index = Array.prototype.indexOf.call(parent.children, node);
                prefix = `${start + index}. `;
            }
            const indent = " ".repeat(prefix.length);
            const body = content
                .replace(/^\n+/, "")
                .replace(/\n+$/, "\n")
                .replace(/\n/gm, `\n${indent}`);
            const trailing = node.nextSibling && !body.endsWith("\n") ? "\n" : "";
            return `${prefix}${body}${trailing}`;
        },
    });
    return service;
}

/**
 * The editor's HTML shaped for turndown: a header row of `<th>` cells in
 * `<tbody>` becomes a `<thead>` (GFM tables need one), and a list item that
 * is a single paragraph loses the paragraph, so a tight list stays tight.
 */
function prepareForMarkdown(html: string): string {
    const $ = cheerio.load(html, {}, false);
    $("table").each((_, table) => {
        const $table = $(table);
        if ($table.children("thead").length) return;
        const firstRow = $table.find("tr").first();
        if (!firstRow.length) return;
        const cells = firstRow.children("th,td");
        // GFM has no headerless table: the first row is the header either way.
        cells.each((__, cell) => {
            cell.name = "th";
        });
        const thead = $("<thead></thead>");
        thead.append(firstRow);
        $table.prepend(thead);
    });
    // A cell is one line in GFM: paragraphs inside it join with a break.
    $("th,td").each((_, cell) => {
        const paragraphs = $(cell).children("p");
        if (!paragraphs.length) return;
        const joined = paragraphs
            .toArray()
            .map(p => $(p).html() ?? "")
            .join("<br>");
        $(cell).html(joined);
    });
    $("li").each((_, li) => {
        const paragraphs = $(li)
            .contents()
            .toArray()
            .filter(n => isElement(n) && n.name === "p");
        const [only] = paragraphs;
        if (paragraphs.length === 1 && only) $(only).replaceWith($(only).contents());
    });
    $("colgroup").remove();
    return $.root().html() ?? "";
}

export function htmlToMarkdown(html: string): string {
    const clean = sanitizeEditorHtml(html, { allowRemoteImages: true });
    const markdown = createTurndown().turndown(prepareForMarkdown(clean));
    return `${markdown.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

export function decodeText(bytes: Buffer): string {
    return bytes.toString("utf8").replace(/^﻿/, "");
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

/**
 * Word styles mammoth does not map on its own: underline (dropped by
 * default) and the quote paragraph styles Word and Google Docs use.
 */
const DOCX_STYLE_MAP = [
    "u => u",
    "p[style-name='Quote'] => blockquote > p:fresh",
    "p[style-name='Intense Quote'] => blockquote > p:fresh",
];

export async function docxToHtml(bytes: Buffer): Promise<string> {
    // Images arrive as data URIs (mammoth's default), so they survive a save.
    const result = await mammoth.convertToHtml({ buffer: bytes }, { styleMap: DOCX_STYLE_MAP });
    return sanitizeEditorHtml(result.value, { allowRemoteImages: false });
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** A whole HTML document around editor content — what Drive converts into a Doc. */
export function wrapHtmlDocument(bodyHtml: string, title: string): string {
    return (
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
        `</head><body>${bodyHtml}</body></html>`
    );
}

export class DocxConversionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DocxConversionError";
    }
}

/** html-to-docx's bullet: U+F0B7, a private-use code point drawn by the Symbol font. */
const SYMBOL_BULLET = /<w:lvlText w:val=""\/>/g;
const SYMBOL_FONT = /<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"[^>]*\/>/g;

/**
 * Bullets as a plain "•". The converter writes Word's classic bullet, a
 * private-use character in the Symbol font: Word draws it, but a browser has
 * no Symbol font, so LaunchStack's own Word preview showed an empty box for
 * every bullet of every file saved from the editor.
 */
async function plainBullets(docx: Buffer): Promise<Buffer> {
    const zip = await JSZip.loadAsync(docx);
    const numbering = zip.file("word/numbering.xml");
    if (!numbering) return docx;
    const xml = await numbering.async("string");
    const fixed = xml.replace(SYMBOL_BULLET, '<w:lvlText w:val="•"/>').replace(SYMBOL_FONT, "");
    if (fixed === xml) return docx;
    zip.file("word/numbering.xml", fixed);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Editor HTML → a .docx. Remote images are stripped before conversion so
 * the converter never reaches the network; the result is opened with
 * mammoth before it is returned, so a broken file never becomes a version.
 */
export async function htmlToDocx(html: string, title: string): Promise<Buffer> {
    const clean = sanitizeEditorHtml(html, { allowRemoteImages: false });
    const output = await HTMLtoDOCX(clean || "<p></p>", null, {
        title,
        font: "Calibri",
        fontSize: 22,
        decodeUnicode: true,
        imageProcessing: { suppressSharpWarning: true, maxRetries: 0 },
    });
    let bytes: Buffer;
    if (Buffer.isBuffer(output)) bytes = output;
    else if (output instanceof ArrayBuffer) bytes = Buffer.from(output);
    else bytes = Buffer.from(await output.arrayBuffer());
    bytes = await plainBullets(bytes);
    try {
        await mammoth.convertToHtml({ buffer: bytes });
    } catch (err) {
        throw new DocxConversionError(
            `The Word file written from the editor could not be read back: ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
    return bytes;
}
