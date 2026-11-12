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
import { Marked } from "marked";
import mammoth from "mammoth";
import HTMLtoDOCX from "@turbodocx/html-to-docx";
import JSZip from "jszip";
import sharp from "sharp";

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
const DATA_IMAGE_PREFIX = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;
/** Anything that is not base64. A negated class scans once; no backtracking. */
const NOT_BASE64 = /[^a-z0-9+/=\s]/i;

/**
 * An inline picture. Checked in two steps: a single pattern over the whole
 * URI backtracked through a photo's megabytes and blew the stack, so a Word
 * file with one ordinary photo could not be opened.
 */
function isDataImage(src: string): boolean {
    const prefix = DATA_IMAGE_PREFIX.exec(src);
    if (!prefix) return false;
    const payload = src.slice(prefix[0].length);
    return payload.length > 0 && !NOT_BASE64.test(payload);
}
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
                    isDataImage(src) || (options.allowRemoteImages && REMOTE_IMAGE.test(src));
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

/** YAML (`---`) or TOML (`+++`) front matter at the very top of a Markdown file. */
const FRONT_MATTER = /^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n(?:\1|\.\.\.)[ \t]*(?:\r?\n|$)/;
/** A front-matter field: `key: value` (YAML) or `key = value` (TOML). */
const FRONT_MATTER_FIELD = /^[ \t]*["']?[A-Za-z0-9_][\w .-]*["']?[ \t]*[:=]/m;

/**
 * A Markdown file's front matter, kept apart from its body. The editor never
 * sees it (it would come back as a heading and a paragraph); a save puts it
 * back in front of the new body exactly as it was.
 */
export function splitFrontMatter(markdown: string): { frontMatter: string; body: string } {
    const text = markdown.replace(/^\uFEFF/, "");
    const match = FRONT_MATTER.exec(text);
    // Two horizontal rules around ordinary text are not front matter: the
    // block has to hold at least one field.
    if (!match || !FRONT_MATTER_FIELD.test(match[2] ?? "")) return { frontMatter: "", body: text };
    const frontMatter = match[0].endsWith("\n") ? match[0] : `${match[0]}\n`;
    return { frontMatter, body: text.slice(match[0].length) };
}

/** Every element name HTML defines (and the SVG/MathML roots): anything else is just text. */
const HTML_ELEMENTS = new Set(
    (
        "a abbr address area article aside audio b base bdi bdo blockquote body br button " +
        "canvas caption center cite code col colgroup data datalist dd del details dfn dialog " +
        "div dl dt em embed fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 head " +
        "header hgroup hr html i iframe img input ins kbd label legend li link main map mark " +
        "math menu meta meter nav noscript object ol optgroup option output p param picture " +
        "pre progress q rp rt ruby s samp script search section select slot small source span " +
        "strike strong style sub summary sup svg table tbody td template textarea tfoot th " +
        "thead time title tr track tt u ul var video wbr"
    ).split(" ")
);

/**
 * `<Enter>`, `List<String>`: a tag no HTML element answers to. Markdown
 * parses it as raw HTML, a browser would drop it, and so would the editor —
 * but it is someone's words, so it stays text.
 */
function isWordsInBrackets(html: string): boolean {
    const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)[^>]*>$/.exec(html.trim());
    return Boolean(tag && !HTML_ELEMENTS.has(tag[1]!.toLowerCase()));
}

function escapeText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const markdown = new Marked({
    gfm: true,
    // A single newline is a line break, as Obsidian and most note apps show
    // it; a save writes it back as a Markdown hard break, so the lines stay.
    breaks: true,
    async: false,
    renderer: {
        html({ text }) {
            return isWordsInBrackets(text) ? escapeText(text) : text;
        },
    },
});

/** Raw HTML in a Markdown body (comments, `<details>`…), which the editor drops. */
export function markdownHasRawHtml(source: string): boolean {
    const { body } = splitFrontMatter(source);
    let found = false;
    // The callback is synchronous; walkTokens' array of results means nothing here.
    void markdown.walkTokens(markdown.lexer(body), token => {
        if (token.type !== "html") return;
        const raw = token.raw.trim();
        // A line break written as <br> survives as a hard break, and words in
        // angle brackets stay words.
        if (/^<br\s*\/?>$/i.test(raw) || isWordsInBrackets(raw)) return;
        found = true;
    });
    return found;
}

export function markdownToHtml(source: string): string {
    const { body } = splitFrontMatter(source);
    // A footnote definition ("[^1]: text") would read as a link definition
    // and vanish; escaped, it stays text and a save writes it back as it was.
    // Each definition its own paragraph, or consecutive ones run together.
    const prepared = body.replace(/^( {0,3})\[\^([^\]\s]+)\]:/gm, "\n$1\\[^$2]:");
    const html = markdown.parse(prepared) as string;
    // Task-list boxes become their literal markers, which the editor can hold
    // and a save turns back into "- [ ]" / "- [x]".
    const withTasks = html.replace(/<input\b[^>]*\btype="checkbox"[^>]*>\s?/g, input =>
        /\bchecked\b/.test(input) ? "[x] " : "[ ] "
    );
    // Markdown can carry raw HTML; the editor gets only what it can hold.
    return sanitizeEditorHtml(withTasks, { allowRemoteImages: true });
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
    // Text that looks like HTML ("Press <Enter>", "List<String>") or like an
    // entity ("&copy;") is escaped, or the next open would read it as markup.
    const escapeMarkdown = service.escape.bind(service);
    service.escape = (text: string) =>
        escapeMarkdown(text)
            .replace(/</g, "\\<")
            .replace(/&(?=#?[a-z0-9]+;)/gi, "\\&");
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

/** Undo turndown's escaping where it would break Markdown people rely on. */
function restoreMarkdownSyntax(markdown: string): string {
    return (
        markdown
            // [[Wiki links]] (Obsidian and friends), with their own text as typed.
            .replace(/\\\[\\\[([^\n]+?)\\\]\\\]/g, (_, inner: string) => {
                const plain = inner.replace(/\\([\\`*_{}[\]()#+\-.!|<>~&])/g, "$1");
                return `[[${plain}]]`;
            })
            // Task-list markers at the start of a list item.
            .replace(/^(\s*(?:[-*+]|\d+[.)]) )\\\[([ xX])\\\] /gm, "$1[$2] ")
            // Footnote references and definitions.
            .replace(/\\\[\^([^\]\s\\]+)\\\]/g, "[^$1]")
    );
}

export function htmlToMarkdown(html: string): string {
    const clean = sanitizeEditorHtml(html, { allowRemoteImages: true });
    const markdown = restoreMarkdownSyntax(createTurndown().turndown(prepareForMarkdown(clean)));
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
/**
 * Pictures at least this large (in base64 characters) go through the Word
 * converter as stand-ins. Its data-URL pattern, `(.+)$`, keeps a backtrack
 * entry per character: an ordinary phone photo ran it out of regexp stack and
 * every save of a Word file with one failed.
 */
const STAND_IN_FROM_CHARS = 256 * 1024;

interface HeldPicture {
    /** What the converter was given: the same size and format, one solid colour. */
    standIn: Buffer;
    /** What goes back into the .docx in its place. */
    original: Buffer;
}

/**
 * Swap each large inline picture for a stand-in of the same pixel size and
 * format, so the converter lays it out exactly as the original. Each stand-in
 * is a colour of its own, so its bytes find it again in the finished file.
 */
async function holdBackLargePictures(html: string): Promise<{ html: string; held: HeldPicture[] }> {
    const $ = cheerio.load(html, {}, false);
    const held: HeldPicture[] = [];
    for (const img of $("img").toArray()) {
        const src = $(img).attr("src") ?? "";
        const prefix = DATA_IMAGE_PREFIX.exec(src);
        if (!prefix || src.length - prefix[0].length < STAND_IN_FROM_CHARS) continue;
        const format = prefix[1]!.toLowerCase();
        if (format === "bmp") continue; // sharp cannot write one; left to the converter
        const original = Buffer.from(src.slice(prefix[0].length), "base64");
        let width: number | undefined;
        let height: number | undefined;
        try {
            ({ width, height } = await sharp(original).metadata());
        } catch {
            continue; // not a picture sharp can read; the converter decides
        }
        if (!width || !height) continue;
        const n = held.length + 1;
        const canvas = sharp({
            create: {
                width,
                height,
                channels: 3,
                background: { r: n & 255, g: (n >> 8) & 255, b: 101 },
            },
        });
        const standIn = await (
            format === "png"
                ? canvas.png()
                : format === "gif"
                  ? canvas.gif()
                  : format === "webp"
                    ? canvas.webp()
                    : canvas.jpeg()
        ).toBuffer();
        held.push({ standIn, original });
        $(img).attr("src", `data:image/${prefix[1]};base64,${standIn.toString("base64")}`);
    }
    return { html: held.length ? ($.root().html() ?? html) : html, held };
}

/** Put the real pictures back where their stand-ins landed. */
async function restorePictures(docx: Buffer, held: HeldPicture[]): Promise<Buffer> {
    if (!held.length) return docx;
    const zip = await JSZip.loadAsync(docx);
    const media = Object.values(zip.files).filter(
        file => !file.dir && file.name.startsWith("word/media/")
    );
    for (const file of media) {
        const bytes = await file.async("nodebuffer");
        const picture = held.find(item => item.standIn.equals(bytes));
        if (picture) zip.file(file.name, picture.original);
    }
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

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
    const { html: light, held } = await holdBackLargePictures(clean);
    const output = await HTMLtoDOCX(light || "<p></p>", null, {
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
    bytes = await plainBullets(await restorePictures(bytes, held));
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
