import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db/index";
import { document } from "@launchstack/core/db/schema";
import { ChatHistory } from "~/server/db/schema";
import { validateRequestBody, ChatHistoryFetchSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, ChatHistoryFetchSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { documentId } = validation.data;

        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const [targetDocument] = await db
            .select()
            .from(document)
            .where(eq(document.id, documentId))
            .limit(1);

        if (!targetDocument) {
            return NextResponse.json({
                success: false,
                message: "Document not found."
            }, { status: 404 });
        }

        if (targetDocument.companyId !== ctx.data.companyId) {
            return NextResponse.json({
                success: false,
                message: "You do not have access to this document."
            }, { status: 403 });
        }

        const userChatHistory = await db
            .select()
            .from(ChatHistory)
            .where(
                and(
                    eq(ChatHistory.UserId, ctx.data.clerkUserId),
                    eq(ChatHistory.documentId, BigInt(targetDocument.id))
                )
            );

        return NextResponse.json({
            success: true,
            chatHistory: userChatHistory,
        });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({
            success: false,
            error: "Failed to fetch questions"
        }, { status: 500 });
    }
}
