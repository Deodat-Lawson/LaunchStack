/**
 * Pure helpers over a page's stored ProseMirror JSON.
 *
 * The editor is the only writer of this shape, but the server still has to
 * read it: to build the search projection, to keep the backlink graph in sync,
 * and to render Markdown/HTML exports without booting a browser. Everything
 * here is deliberately dependency-free so it can run in a route handler, a
 * background job, or a test.
 */

import { attrText } from "~/lib/prosemirror-attrs";

export interface DocNode {
    type?: string;
    attrs?: Record<string, unknown> | null;
    content?: DocNode[];
    marks?: Array<{ type: string; attrs?: Record<string, unknown> | null }>;
    text?: string;
}

/** Depth-first walk over every node in the tree, parents before children. */
export function walk(node: DocNode | null | undefined, visit: (n: DocNode) => void): void {
    if (!node) return;
    visit(node);
    for (const child of node.content ?? []) walk(child, visit);
}

/**
 * Flatten a document to plain text for search and embeddings. Block
 * boundaries become newlines so a phrase never silently spans two paragraphs.
 */
export function docToText(doc: DocNode | null | undefined): string {
    if (!doc) return "";
    const out: string[] = [];

    const render = (node: DocNode): void => {
        if (node.type === "text") {
            out.push(node.text ?? "");
            return;
        }
        if (node.type === "hardBreak") {
            out.push("\n");
            return;
        }
        // Nodes that carry their payload in attrs rather than in children.
        if (node.type === "inlineMath" || node.type === "blockMath") {
            out.push(attrText(node.attrs?.latex, ""));
        }
        if (node.type === "mention") {
            out.push(attrText(node.attrs?.label, node.attrs?.id, ""));
        }
        if (node.type === "pageLink") {
            out.push(attrText(node.attrs?.title, ""));
        }
        if (node.type === "bookmark" || node.type === "embed") {
            out.push(attrText(node.attrs?.title, node.attrs?.url, ""));
        }
        if (node.type === "imageBlock" || node.type === "fileBlock") {
            out.push(attrText(node.attrs?.caption, node.attrs?.name, ""));
        }

        for (const child of node.content ?? []) render(child);

        if (isBlock(node.type)) out.push("\n");
    };

    render(doc);
    return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

const BLOCK_TYPES = new Set([
    "paragraph",
    "heading",
    "blockquote",
    "codeBlock",
    "listItem",
    "taskItem",
    "callout",
    "toggleList",
    "toggleSummary",
    "blockMath",
    "horizontalRule",
    "imageBlock",
    "videoBlock",
    "fileBlock",
    "bookmark",
    "embed",
    "tableCell",
    "tableHeader",
    "column",
    "pageLink",
    "tableOfContents",
    "syncedBlock",
]);

function isBlock(type: string | undefined): boolean {
    return type !== undefined && BLOCK_TYPES.has(type);
}

/**
 * Every page this document points at — child page nodes, `@`-mentions of a
 * page, and inline links using our internal `page://` scheme. Deduplicated,
 * order preserved.
 */
export function extractPageLinks(doc: DocNode | null | undefined): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();

    const push = (raw: unknown): void => {
        if (typeof raw !== "string" || raw.length === 0) return;
        if (seen.has(raw)) return;
        seen.add(raw);
        ids.push(raw);
    };

    walk(doc, (node) => {
        if (node.type === "pageLink") push(node.attrs?.pageId);
        if (node.type === "mention" && node.attrs?.kind === "page") push(node.attrs?.id);
        if (node.type === "syncedBlock") push(node.attrs?.sourcePageId);
        for (const mark of node.marks ?? []) {
            if (mark.type !== "link") continue;
            const href = mark.attrs?.href;
            if (typeof href === "string" && href.startsWith("page://")) {
                push(href.slice("page://".length));
            }
        }
    });

    return ids;
}

/** The first line of body text, used as the sidebar/search preview. */
export function docPreview(doc: DocNode | null | undefined, max = 160): string {
    const text = docToText(doc).split("\n").find((l) => l.trim().length > 0) ?? "";
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

const MARK_WRAPPERS: Record<string, [string, string]> = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    strike: ["~~", "~~"],
    code: ["`", "`"],
    underline: ["<u>", "</u>"],
};

function inlineToMarkdown(nodes: DocNode[] | undefined): string {
    if (!nodes) return "";
    return nodes
        .map((node) => {
            if (node.type === "hardBreak") return "  \n";
            if (node.type === "inlineMath") return `$${attrText(node.attrs?.latex, "")}$`;
            if (node.type === "mention") return `@${attrText(node.attrs?.label, "")}`;
            if (node.type === "emoji") {
                const name = attrText(node.attrs?.name);
                return name ? `:${name}:` : "";
            }
            if (node.type !== "text") return inlineToMarkdown(node.content);

            let text = node.text ?? "";
            let href: string | null = null;
            for (const mark of node.marks ?? []) {
                if (mark.type === "link") {
                    href = typeof mark.attrs?.href === "string" ? mark.attrs.href : null;
                    continue;
                }
                const wrap = MARK_WRAPPERS[mark.type];
                if (wrap) text = `${wrap[0]}${text}${wrap[1]}`;
            }
            return href ? `[${text}](${href})` : text;
        })
        .join("");
}

/**
 * Render the document as Markdown. Blocks Markdown cannot express (callouts,
 * columns, embeds) degrade to the closest readable equivalent rather than
 * vanishing — an export should never lose content silently.
 */
export function docToMarkdown(doc: DocNode | null | undefined): string {
    if (!doc) return "";
    const lines: string[] = [];

    const renderBlocks = (nodes: DocNode[] | undefined, indent = ""): void => {
        for (const node of nodes ?? []) renderBlock(node, indent);
    };

    const renderBlock = (node: DocNode, indent: string): void => {
        switch (node.type) {
            case "paragraph":
                lines.push(indent + inlineToMarkdown(node.content), "");
                break;
            case "heading": {
                const level = Number(node.attrs?.level ?? 1);
                lines.push(`${indent}${"#".repeat(level)} ${inlineToMarkdown(node.content)}`, "");
                break;
            }
            case "blockquote":
                for (const child of node.content ?? []) renderBlock(child, `${indent}> `);
                break;
            case "codeBlock":
                lines.push(
                    `${indent}\`\`\`${attrText(node.attrs?.language, "")}`,
                    ...(node.content ?? []).map((c) => indent + (c.text ?? "")),
                    `${indent}\`\`\``,
                    ""
                );
                break;
            case "bulletList":
                for (const item of node.content ?? []) {
                    const [first, ...rest] = item.content ?? [];
                    lines.push(`${indent}- ${inlineToMarkdown(first?.content)}`);
                    renderBlocks(rest, `${indent}  `);
                }
                lines.push("");
                break;
            case "orderedList": {
                let n = Number(node.attrs?.start ?? 1);
                for (const item of node.content ?? []) {
                    const [first, ...rest] = item.content ?? [];
                    lines.push(`${indent}${n}. ${inlineToMarkdown(first?.content)}`);
                    renderBlocks(rest, `${indent}   `);
                    n += 1;
                }
                lines.push("");
                break;
            }
            case "taskList":
                for (const item of node.content ?? []) {
                    const [first, ...rest] = item.content ?? [];
                    const box = item.attrs?.checked ? "x" : " ";
                    lines.push(`${indent}- [${box}] ${inlineToMarkdown(first?.content)}`);
                    renderBlocks(rest, `${indent}  `);
                }
                lines.push("");
                break;
            case "callout": {
                const emoji = attrText(node.attrs?.emoji, "💡");
                lines.push(`${indent}> ${emoji} `.trimEnd());
                for (const child of node.content ?? []) renderBlock(child, `${indent}> `);
                lines.push("");
                break;
            }
            case "toggleList": {
                const [summary, ...body] = node.content ?? [];
                lines.push(`${indent}<details>`, `${indent}<summary>${inlineToMarkdown(summary?.content)}</summary>`, "");
                renderBlocks(body, indent);
                lines.push(`${indent}</details>`, "");
                break;
            }
            case "horizontalRule":
                lines.push(`${indent}---`, "");
                break;
            case "blockMath":
                lines.push(`${indent}$$`, `${indent}${attrText(node.attrs?.latex, "")}`, `${indent}$$`, "");
                break;
            case "imageBlock": {
                const caption = attrText(node.attrs?.caption, "");
                lines.push(`${indent}![${caption}](${attrText(node.attrs?.src, "")})`, "");
                break;
            }
            case "videoBlock":
            case "embed":
            case "bookmark":
                lines.push(`${indent}[${attrText(node.attrs?.title, node.attrs?.url, "")}](${attrText(node.attrs?.url, "")})`, "");
                break;
            case "fileBlock":
                lines.push(`${indent}[${attrText(node.attrs?.name, "file")}](${attrText(node.attrs?.src, "")})`, "");
                break;
            case "pageLink":
                lines.push(`${indent}- [${attrText(node.attrs?.title, "Untitled")}](page://${attrText(node.attrs?.pageId, "")})`, "");
                break;
            case "columns":
                for (const column of node.content ?? []) renderBlocks(column.content, indent);
                break;
            case "table": {
                const rows = node.content ?? [];
                rows.forEach((row, rowIndex) => {
                    const cells = (row.content ?? []).map((cell) =>
                        inlineToMarkdown(cell.content?.[0]?.content).replace(/\|/g, "\\|")
                    );
                    lines.push(`${indent}| ${cells.join(" | ")} |`);
                    if (rowIndex === 0) {
                        lines.push(`${indent}| ${cells.map(() => "---").join(" | ")} |`);
                    }
                });
                lines.push("");
                break;
            }
            case "tableOfContents":
            case "breadcrumb":
                break;
            default:
                if (node.content) renderBlocks(node.content, indent);
                else if (node.text) lines.push(indent + node.text, "");
        }
    };

    renderBlocks(doc.content);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Escape text destined for an HTML export. */
function esc(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const MARK_TAGS: Record<string, string> = {
    bold: "strong",
    italic: "em",
    strike: "s",
    code: "code",
    underline: "u",
};

function inlineToHtml(nodes: DocNode[] | undefined): string {
    if (!nodes) return "";
    return nodes
        .map((node) => {
            if (node.type === "hardBreak") return "<br>";
            if (node.type === "inlineMath") return `<code>${esc(attrText(node.attrs?.latex, ""))}</code>`;
            if (node.type === "mention") return `<span class="mention">@${esc(attrText(node.attrs?.label, ""))}</span>`;
            if (node.type !== "text") return inlineToHtml(node.content);

            let html = esc(node.text ?? "");
            for (const mark of node.marks ?? []) {
                if (mark.type === "link") {
                    html = `<a href="${esc(attrText(mark.attrs?.href, ""))}">${html}</a>`;
                    continue;
                }
                if (mark.type === "textStyle") {
                    const color = mark.attrs?.color;
                    const background = mark.attrs?.backgroundColor;
                    const style = [
                        typeof color === "string" ? `color:${esc(color)}` : "",
                        typeof background === "string" ? `background:${esc(background)}` : "",
                    ]
                        .filter(Boolean)
                        .join(";");
                    if (style) html = `<span style="${style}">${html}</span>`;
                    continue;
                }
                const tag = MARK_TAGS[mark.type];
                if (tag) html = `<${tag}>${html}</${tag}>`;
            }
            return html;
        })
        .join("");
}

/** Render the document as a standalone HTML fragment. */
export function docToHtml(doc: DocNode | null | undefined): string {
    if (!doc) return "";
    const out: string[] = [];

    const renderBlocks = (nodes: DocNode[] | undefined): void => {
        for (const node of nodes ?? []) renderBlock(node);
    };

    const renderBlock = (node: DocNode): void => {
        switch (node.type) {
            case "paragraph":
                out.push(`<p>${inlineToHtml(node.content)}</p>`);
                break;
            case "heading":
                out.push(`<h${attrText(node.attrs?.level, 1)}>${inlineToHtml(node.content)}</h${attrText(node.attrs?.level, 1)}>`);
                break;
            case "blockquote":
                out.push("<blockquote>");
                renderBlocks(node.content);
                out.push("</blockquote>");
                break;
            case "codeBlock":
                out.push(
                    `<pre><code>${esc((node.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`
                );
                break;
            case "bulletList":
            case "taskList":
                out.push("<ul>");
                renderBlocks(node.content);
                out.push("</ul>");
                break;
            case "orderedList":
                out.push("<ol>");
                renderBlocks(node.content);
                out.push("</ol>");
                break;
            case "listItem":
                out.push("<li>");
                renderBlocks(node.content);
                out.push("</li>");
                break;
            case "taskItem":
                out.push(`<li><input type="checkbox" disabled${node.attrs?.checked ? " checked" : ""}> `);
                renderBlocks(node.content);
                out.push("</li>");
                break;
            case "callout":
                out.push(`<aside data-emoji="${esc(attrText(node.attrs?.emoji, "💡"))}">`);
                renderBlocks(node.content);
                out.push("</aside>");
                break;
            case "toggleList": {
                const [summary, ...body] = node.content ?? [];
                out.push("<details>", `<summary>${inlineToHtml(summary?.content)}</summary>`);
                renderBlocks(body);
                out.push("</details>");
                break;
            }
            case "horizontalRule":
                out.push("<hr>");
                break;
            case "blockMath":
                out.push(`<pre class="math">${esc(attrText(node.attrs?.latex, ""))}</pre>`);
                break;
            case "imageBlock":
                out.push(
                    `<figure><img src="${esc(attrText(node.attrs?.src, ""))}" alt="${esc(attrText(node.attrs?.caption, ""))}">` +
                    (node.attrs?.caption ? `<figcaption>${esc(attrText(node.attrs.caption))}</figcaption>` : "") +
                    "</figure>"
                );
                break;
            case "videoBlock":
            case "embed":
                out.push(`<iframe src="${esc(attrText(node.attrs?.url, ""))}"></iframe>`);
                break;
            case "bookmark":
            case "fileBlock":
                out.push(
                    `<p><a href="${esc(attrText(node.attrs?.url, node.attrs?.src, ""))}">${esc(
                        attrText(node.attrs?.title, node.attrs?.name, node.attrs?.url, "")
                    )}</a></p>`
                );
                break;
            case "pageLink":
                out.push(
                    `<p><a href="page://${esc(attrText(node.attrs?.pageId, ""))}">${esc(attrText(node.attrs?.title, "Untitled"))}</a></p>`
                );
                break;
            case "columns":
                out.push('<div class="columns">');
                for (const column of node.content ?? []) {
                    out.push('<div class="column">');
                    renderBlocks(column.content);
                    out.push("</div>");
                }
                out.push("</div>");
                break;
            case "table":
                out.push("<table><tbody>");
                for (const row of node.content ?? []) {
                    out.push("<tr>");
                    for (const cell of row.content ?? []) {
                        const tag = cell.type === "tableHeader" ? "th" : "td";
                        out.push(`<${tag}>`);
                        renderBlocks(cell.content);
                        out.push(`</${tag}>`);
                    }
                    out.push("</tr>");
                }
                out.push("</tbody></table>");
                break;
            default:
                if (node.content) renderBlocks(node.content);
        }
    };

    renderBlocks(doc.content);
    return out.join("");
}

/** Rough word count for the page-info popover. */
export function docWordCount(doc: DocNode | null | undefined): number {
    const text = docToText(doc);
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}
