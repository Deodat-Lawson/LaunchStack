import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db/index";
import { ChatHistory, users, document } from "@launchstack/core/db/schema";
import { validateRequestBody, ChatHistoryAddSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, ChatHistoryAddSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { documentId, question, documentTitle, response, pages } = validation.data;

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

        await db.insert(ChatHistory).values({
            UserId: userId,
            documentId: BigInt(targetDocument.id),
            documentTitle: targetDocument.title ?? documentTitle,
            question,
            response,
            pages: pages ?? [],
        });

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({
            success: false,
            error: "Failed to save question"
        }, { status: 500 });
    }
}
