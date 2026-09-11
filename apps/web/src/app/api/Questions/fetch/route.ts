import { NextResponse } from "next/server";
import { and, eq, getTableColumns } from "drizzle-orm";

import { db } from "~/server/db/index";
import { document } from "@launchstack/store/schema";
import { ChatHistory } from "~/server/db/schema";
import { validateRequestBody, ChatHistoryFetchSchema } from "~/lib/validation";
import { forbiddenForPermission, requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, ChatHistoryFetchSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { documentId } = validation.data;

        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        if (!ctx.data.can("documents.read")) return forbiddenForPermission("documents.read");

        // A document outside the caller's scope reads as missing — 404, never 403.
        const scope = await ctx.data.documentScope();
        const scoped = scopedDocumentWhere(ctx.data.companyId, scope);
        const [targetDocument] = await db
            .select({ id: document.id })
            .from(document)
            .where(and(eq(document.id, documentId), scoped))
            .limit(1);

        if (!targetDocument) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Document not found.",
                },
                { status: 404 }
            );
        }

        // The history rows join the document under the same predicate, so a
        // row for a document the caller cannot read is never listed even if
        // the check above is ever bypassed.
        const userChatHistory = await db
            .select(getTableColumns(ChatHistory))
            .from(ChatHistory)
            .innerJoin(document, eq(document.id, ChatHistory.documentId))
            .where(
                and(
                    eq(ChatHistory.UserId, ctx.data.authUserId),
                    eq(ChatHistory.documentId, BigInt(targetDocument.id)),
                    scoped
                )
            );

        return NextResponse.json({
            success: true,
            chatHistory: userChatHistory,
        });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json(
            {
                success: false,
                error: "Failed to fetch questions",
            },
            { status: 500 }
        );
    }
}
