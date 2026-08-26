import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db/index";
import { document } from "@launchstack/store/schema";
import { ChatHistory } from "~/server/db/schema";
import { validateRequestBody, ChatHistoryAddSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, ChatHistoryAddSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { documentId, question, documentTitle, response, pages } = validation.data;

        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const [targetDocument] = await db
            .select()
            .from(document)
            .where(eq(document.id, documentId))
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

        if (targetDocument.companyId !== ctx.data.companyId) {
            return NextResponse.json(
                {
                    success: false,
                    message: "You do not have access to this document.",
                },
                { status: 403 }
            );
        }

        await db.insert(ChatHistory).values({
            UserId: ctx.data.clerkUserId,
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
                error: "Failed to save question",
            },
            { status: 500 }
        );
    }
}
