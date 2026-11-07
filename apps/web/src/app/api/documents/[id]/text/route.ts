import { NextResponse } from "next/server";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { and, eq, asc } from "drizzle-orm";
import { db } from "~/server/db";
import { document, documentContextChunks } from "@launchstack/store/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { readableMarkdown } from "~/lib/indexed-text";

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * The text ingestion read from a document, in reading order.
 *
 * `?format=markdown` returns it as Markdown, with the headings the stored
 * breadcrumbs carry put back (the website viewer renders it); the default is
 * the older escaped-HTML rendering.
 */
export async function GET(request: Request, { params }: RouteParams) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { id } = await params;
        const docId = parseInt(id, 10);
        if (isNaN(docId)) {
            return NextResponse.json(
                { error: translatorFor(locale, "errors.api")("invalidDocumentId") },
                { status: 400 }
            );
        }

        const [doc] = await db
            .select({
                id: document.id,
                title: document.title,
                currentVersionId: document.currentVersionId,
            })
            .from(document)
            .where(
                and(
                    eq(document.id, docId),
                    scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
                )
            );

        if (!doc) {
            return NextResponse.json(
                { error: translatorFor(locale, "errors.api")("documentNotFound") },
                { status: 404 }
            );
        }

        // A document without a current pointer has no current text. Never fall
        // back to historical or legacy unversioned chunks.
        const chunks =
            doc.currentVersionId === null
                ? []
                : await db
                      .select({
                          content: documentContextChunks.content,
                          pageNumber: documentContextChunks.pageNumber,
                      })
                      .from(documentContextChunks)
                      .where(
                          and(
                              eq(documentContextChunks.documentId, BigInt(docId)),
                              eq(documentContextChunks.versionId, doc.currentVersionId)
                          )
                      )
                      .orderBy(
                          asc(documentContextChunks.pageNumber),
                          asc(documentContextChunks.id)
                      );

        if (new URL(request.url).searchParams.get("format") === "markdown") {
            return NextResponse.json({
                markdown: readableMarkdown(
                    chunks.map(c => c.content),
                    doc.title
                ),
                chunkCount: chunks.length,
                documentId: docId,
            });
        }

        if (chunks.length === 0) {
            return NextResponse.json({
                html: `<p>${t("noExtractedText")}</p>`,
                chunkCount: 0,
                documentId: docId,
            });
        }

        const html = chunks
            .map(c => {
                const text = c.content
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

                const lines = text.split("\n");
                const formatted = lines
                    .map(line => {
                        if (line.startsWith("--- File:") && line.endsWith("---")) {
                            const filename = line
                                .replace(/^--- File:\s*/, "")
                                .replace(/\s*---$/, "");
                            return `<h3 class="file-header">${filename}</h3>`;
                        }
                        if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
                        if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
                        if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
                        if (line.trim() === "") return "";
                        return `<p>${line}</p>`;
                    })
                    .filter(Boolean)
                    .join("\n");

                return formatted;
            })
            .join('\n<hr class="chunk-divider" />\n');

        return NextResponse.json({
            html,
            chunkCount: chunks.length,
            documentId: docId,
        });
    } catch (error) {
        console.error("[DocumentText] Error:", error);
        return NextResponse.json({ error: t("documentTextFailed") }, { status: 500 });
    }
}
