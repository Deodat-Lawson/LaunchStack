import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db/index";
import { document } from "@launchstack/store/schema";
import { ChatHistory } from "~/server/db/schema";
import { validateRequestBody, ChatHistoryAddSchema } from "~/lib/validation";
import { forbiddenForPermission, requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";

export async function POST(request: Request) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "chat.server");
    try {
        const validation = await validateRequestBody(request, ChatHistoryAddSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { documentId, question, documentTitle, response, pages } = validation.data;

        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        if (!ctx.data.can("documents.read"))
            return forbiddenForPermission("documents.read", locale);

        // History attaches to a document the caller can read; one outside
        // their scope reads as missing — 404, never 403.
        const scope = await ctx.data.documentScope();
        const [targetDocument] = await db
            .select({ id: document.id, title: document.title })
            .from(document)
            .where(and(eq(document.id, documentId), scopedDocumentWhere(ctx.data.companyId, scope)))
            .limit(1);

        if (!targetDocument) {
            return NextResponse.json(
                {
                    success: false,
                    message: t("documentNotFound"),
                },
                { status: 404 }
            );
        }

        await db.insert(ChatHistory).values({
            UserId: ctx.data.authUserId,
            documentId: BigInt(targetDocument.id),
            documentTitle: targetDocument.title ?? documentTitle,
            question,
            response,
            pages: pages ?? [],
        });

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json(
            {
                success: false,
                error: t("history.saveFailed"),
            },
            { status: 500 }
        );
    }
}
