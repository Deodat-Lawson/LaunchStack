/**
 * GET /s/<token>.md (rewritten here by the middleware) — the shared file as
 * one Markdown document for an AI agent: its title, one line saying where it
 * is from, then its text. `text/markdown`, no JavaScript, no sign-in.
 */

import { localeOfRequest } from "~/i18n/server";
import {
    agentMarkdown,
    publicDocumentText,
    toPublicDocument,
} from "~/server/public-share/document";
import { PUBLIC_READ_LIMIT, publicShareRoute, publicShareWords } from "~/server/public-share/http";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(
        request,
        params,
        PUBLIC_READ_LIMIT,
        "markdown",
        async ({ link, row }) => {
            const doc = await toPublicDocument(link, row);
            const text = await publicDocumentText(link, row, doc.displayType);
            const t = publicShareWords(request);
            const updated = new Intl.DateTimeFormat(localeOfRequest(request), {
                dateStyle: "long",
                timeZone: "UTC",
            }).format(new Date(doc.updatedAt));
            const body = agentMarkdown(doc, text, {
                sharedFrom: t("agent.sharedFrom", { workspace: doc.workspaceName, updated }),
                noText: t("agent.noText"),
                truncated: t("agent.truncated"),
            });
            return new Response(body, {
                status: 200,
                headers: {
                    "Content-Type": "text/markdown; charset=utf-8",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Disposition": "inline",
                },
            });
        }
    );
}
