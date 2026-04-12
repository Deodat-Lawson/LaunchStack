import { NextResponse } from "next/server";
import { auth } from "~/lib/auth-server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db/index";
import { ChatHistory, users, document } from "~/server/db/schema";
import { validateRequestBody, ChatHistoryFetchSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, ChatHistoryFetchSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { documentId } = validation.data;

        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({
                success: false,
                message: "Unauthorized"
            }, { status: 401 });
        }

        const [requestingUser] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (!requestingUser) {
            return NextResponse.json({
                success: false,
                message: "Invalid user."
            }, { status: 401 });
        }

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

        if (targetDocument.companyId !== requestingUser.companyId) {
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
                    eq(ChatHistory.UserId, userId),
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
