import { NextResponse } from "next/server";

import {
    docToHtml,
    docToMarkdown,
    docToText,
    type DocNode,
} from "~/server/workspace/content";
import { getPage } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

/** Filesystem-safe name derived from the page title. */
function filename(title: string, extension: string): string {
    const base = title.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-") || "Untitled";
    return `${base.slice(0, 80)}.${extension}`;
}

/** Export a page as Markdown, HTML, or plain text. */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const page = await getPage(session.userId, pageId);
        if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        const format = new URL(request.url).searchParams.get("format") ?? "markdown";
        const doc = page.content as DocNode | null;
        const title = page.title || "Untitled";

        let body: string;
        let contentType: string;
        let extension: string;

        switch (format) {
            case "html":
                body = [
                    "<!doctype html>",
                    '<html><head><meta charset="utf-8">',
                    `<title>${title.replace(/</g, "&lt;")}</title>`,
                    "</head><body>",
                    `<h1>${title.replace(/</g, "&lt;")}</h1>`,
                    docToHtml(doc),
                    "</body></html>",
                ].join("");
                contentType = "text/html; charset=utf-8";
                extension = "html";
                break;
            case "text":
                body = `${title}\n\n${docToText(doc)}`;
                contentType = "text/plain; charset=utf-8";
                extension = "txt";
                break;
            case "markdown":
            default:
                body = `# ${title}\n\n${docToMarkdown(doc)}\n`;
                contentType = "text/markdown; charset=utf-8";
                extension = "md";
                break;
        }

        return new NextResponse(body, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filename(title, extension)}"`,
            },
        });
    } catch (error) {
        console.error("[workspace/export] failed:", error);
        return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }
}
