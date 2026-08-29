/**
 * Document Generator - Export API
 *
 * Export documents to various formats:
 * - PDF (the styled HTML rendered through the Gotenberg service, ADR-009;
 *   a typed 503 when the service is not deployed — Gotenberg is the one
 *   PDF owner)
 * - Markdown (raw markdown)
 * - HTML (rendered from markdown or raw HTML)
 * - Plain Text
 *
 * Supports both Markdown and HTML input (WYSIWYG editor saves HTML to preserve formatting).
 */

import { NextResponse } from "next/server";
import TurndownService from "turndown";
import { PAPER_SIZES, RenderingServiceError } from "@launchstack/rendering";
import { getGotenbergClient } from "~/server/rendering";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

const turndown = new TurndownService({ headingStyle: "atx" });
turndown.keep(["u"]);

import { z } from "zod";

/** Detect if content is HTML (from WYSIWYG editor). */
function isHtml(content: string): boolean {
    const trimmed = content.trim();
    return trimmed.startsWith("<") && trimmed.includes(">");
}

/** Convert HTML to plain text by stripping tags. */
function htmlToText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<\/tr>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Normalize content to Markdown (handles both HTML and Markdown input). */
function toMarkdown(content: string): string {
    if (isHtml(content)) {
        try {
            return turndown.turndown(content);
        } catch {
            return htmlToText(content);
        }
    }
    return content;
}

/** Normalize content to plain text (handles both HTML and Markdown input). */
function toPlainText(content: string): string {
    if (isHtml(content)) {
        return htmlToText(content);
    }
    return markdownToText(content);
}

export const runtime = "nodejs";
export const maxDuration = 30;

// Export format types - used in validation schema
// type ExportFormat = "pdf" | "markdown" | "html" | "text";

// Validation schema
const ExportSchema = z.object({
    format: z.enum(["pdf", "markdown", "html", "text"]),
    title: z.string().min(1).max(512),
    content: z.string(),
    options: z
        .object({
            includeCitations: z.boolean().optional(),
            includeMetadata: z.boolean().optional(),
            pageSize: z.enum(["letter", "a4"]).optional(),
            fontSize: z.number().min(8).max(24).optional(),
            bibliography: z.string().optional(),
        })
        .optional(),
});

// Simple markdown to text converter for the plain-text export
function markdownToText(markdown: string): string {
    return (
        markdown
            // Remove headers but keep text
            .replace(/^#{1,6}\s+/gm, "")
            // Convert bold
            .replace(/\*\*(.+?)\*\*/g, "$1")
            // Convert italic
            .replace(/\*(.+?)\*/g, "$1")
            // Convert links
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            // Convert code blocks
            .replace(/```[\s\S]*?```/g, match => match.replace(/```\w*\n?/g, "").trim())
            // Convert inline code
            .replace(/`([^`]+)`/g, "$1")
            // Convert bullet points
            .replace(/^[-*]\s+/gm, "• ")
            // Convert numbered lists
            .replace(/^\d+\.\s+/gm, "")
            // Clean up extra newlines
            .replace(/\n{3,}/g, "\n\n")
    );
}

// Simple markdown to HTML converter
function markdownToHtml(markdown: string, title: string, extraCss = ""): string {
    const html = markdown
        // Escape HTML
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // Headers
        .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
        .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
        .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
        .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
        .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
        .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
        // Bold
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // Italic
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        // Code blocks
        .replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
        // Inline code
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        // Bullet lists
        .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
        // Wrap consecutive list items
        .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
        // Numbered lists
        .replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>")
        // Paragraphs
        .replace(/^(?!<[hluop]|$)(.+)$/gm, "<p>$1</p>")
        // Line breaks
        .replace(/\n\n/g, "\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: Georgia, 'Times New Roman', Times, serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            color: #333;
        }
        h1, h2, h3, h4, h5, h6 {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
        }
        h1 { font-size: 2em; border-bottom: 2px solid #333; padding-bottom: 0.3em; }
        h2 { font-size: 1.5em; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
        h3 { font-size: 1.25em; }
        p { margin: 1em 0; }
        ul, ol { margin: 1em 0; padding-left: 2em; }
        li { margin: 0.5em 0; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
        pre { background: #f4f4f4; padding: 1em; border-radius: 5px; overflow-x: auto; }
        pre code { background: none; padding: 0; }
        a { color: #0066cc; }
        blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding-left: 1em; color: #666; }
        @media print {
            body { max-width: none; padding: 0; }
        }${extraCss}
    </style>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * The complete standalone HTML document the html and pdf exports share —
 * one styling so "export as HTML" and "export as PDF" cannot drift apart.
 */
function buildHtmlDocument(
    title: string,
    content: string,
    options?: { includeCitations?: boolean; bibliography?: string; fontSize?: number }
): string {
    const extraCss = options?.fontSize
        ? `\n        body { font-size: ${options.fontSize}pt; }`
        : "";

    if (isHtml(content)) {
        const refs =
            options?.includeCitations && options.bibliography
                ? `\n<hr>\n<h2>References</h2>\n<p>${options.bibliography.replace(/\n/g, "</p><p>")}</p>\n`
                : "";
        const bodyContent = content.trim() + refs;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: Georgia, serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #333; }
        h1,h2,h3,h4,h5,h6 { font-family: system-ui, sans-serif; margin-top: 1.5em; margin-bottom: 0.5em; }
        p { margin: 1em 0; }
        ul,ol { margin: 1em 0; padding-left: 2em; }
        li { margin: 0.5em 0; }
        [style*="text-align:center"] { text-align: center; }
        [style*="text-align:right"] { text-align: right; }${extraCss}
    </style>
</head>
<body>${bodyContent}</body>
</html>`;
    }

    let htmlContent = content;
    if (options?.includeCitations && options.bibliography) {
        htmlContent += `\n\n---\n\n## References\n\n${options.bibliography}`;
    }
    return markdownToHtml(htmlContent, title, extraCss);
}

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const body = (await request.json()) as unknown;
        const validation = ExportSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { format, title, content, options } = validation.data;
        const startTime = Date.now();

        let exportedContent: string | Uint8Array;
        let contentType: string;
        let filename: string;

        switch (format) {
            case "pdf": {
                // The same styled HTML the html export ships, printed by
                // Gotenberg's Chromium (ADR-009). Gotenberg is the one PDF
                // owner — without it this format is a typed 503, same as the
                // documents and legal-generate routes.
                const gotenberg = getGotenbergClient();
                if (!gotenberg) {
                    return NextResponse.json(
                        {
                            success: false,
                            error: "service_not_configured",
                            message:
                                "PDF rendering is not configured. Set GOTENBERG_SERVICE_URL " +
                                "(and its basic-auth pair), or export as HTML instead.",
                        },
                        { status: 503 }
                    );
                }
                const html = buildHtmlDocument(title, content, {
                    // The old renderer always appended a provided
                    // bibliography; keep that contract.
                    includeCitations: Boolean(options?.bibliography),
                    bibliography: options?.bibliography,
                    fontSize: options?.fontSize,
                });
                try {
                    const result = await gotenberg.htmlToPdf({
                        html,
                        pageProperties: {
                            ...(options?.pageSize === "a4" ? PAPER_SIZES.a4 : PAPER_SIZES.letter),
                            printBackground: true,
                        },
                    });
                    exportedContent = result.pdf;
                } catch (err) {
                    if (err instanceof RenderingServiceError) {
                        const status =
                            err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 502;
                        const trace = err.trace ? ` (trace ${err.trace})` : "";
                        return NextResponse.json(
                            {
                                success: false,
                                error: "rendering_failed",
                                message: `${err.detail}${trace}`,
                            },
                            { status }
                        );
                    }
                    throw err;
                }
                contentType = "application/pdf";
                filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
                break;
            }

            case "markdown":
                let mdContent = toMarkdown(content);
                if (options?.includeCitations && options.bibliography) {
                    mdContent += `\n\n---\n\n## References\n\n${options.bibliography}`;
                }
                exportedContent = mdContent;
                contentType = "text/markdown";
                filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
                break;

            case "html":
                exportedContent = buildHtmlDocument(title, content, {
                    includeCitations: options?.includeCitations,
                    bibliography: options?.bibliography,
                });
                contentType = "text/html";
                filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.html`;
                break;

            case "text":
                let textContent = toPlainText(content);
                if (options?.includeCitations && options.bibliography) {
                    textContent += `\n\n---\n\nReferences\n\n${markdownToText(options.bibliography)}`;
                }
                exportedContent = textContent;
                contentType = "text/plain";
                filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.txt`;
                break;

            default:
                return NextResponse.json(
                    { success: false, message: "Invalid format" },
                    { status: 400 }
                );
        }

        const processingTimeMs = Date.now() - startTime;
        console.log(`✅ [Export] Generated ${format} in ${processingTimeMs}ms`);

        // For binary formats (PDF), return the file directly
        if (format === "pdf") {
            const pdfBuffer = Buffer.from(exportedContent as Uint8Array);
            return new NextResponse(pdfBuffer, {
                headers: {
                    "Content-Type": contentType,
                    "Content-Disposition": `attachment; filename="${filename}"`,
                },
            });
        }

        // For text formats, return JSON with the content
        return NextResponse.json({
            success: true,
            format,
            content: exportedContent,
            filename,
            contentType,
            processingTimeMs,
        });
    } catch (error) {
        console.error("❌ [Export] Error:", error);
        return NextResponse.json(
            {
                success: false,
                message: "Failed to export document",
                error: "Failed to export document",
            },
            { status: 500 }
        );
    }
}
