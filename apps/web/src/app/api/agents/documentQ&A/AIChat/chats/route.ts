import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotChat, agentAiChatbotDocument } from "~/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateChatSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/agent-ai-chatbot/chats - Get all chats for a user
export async function GET(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const chats = await db
            .select()
            .from(agentAiChatbotChat)
            .where(eq(agentAiChatbotChat.userId, ctx.data.clerkUserId))
            .orderBy(desc(agentAiChatbotChat.updatedAt));

        return NextResponse.json({
            success: true,
            chats,
        });
    } catch (error) {
        console.error("Error fetching chats:", error);
        return NextResponse.json({ error: "Failed to fetch chats" }, { status: 500 });
    }
}

// POST /api/agent-ai-chatbot/chats - Create a new chat
export async function POST(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    try {
        const validation = await validateRequestBody(request, CreateChatSchema);
        if (!validation.success) return validation.response;
        const { title, agentMode, visibility, aiStyle, aiPersona, documentId } = validation.data;

        const chatId = randomUUID();
        const insertValues = {
            id: chatId,
            userId: ctx.data.clerkUserId,
            title,
            // CreateChatSchema already narrows these to their literal unions; the
            // non-null assertions cover the schema's optional-with-default fields.
            agentMode: agentMode!,
            visibility: visibility!,
            status: "active" as const,
            aiStyle,
            aiPersona,
        };

        const [newChat] = await db.insert(agentAiChatbotChat).values(insertValues).returning();

        // If documentId is provided, bind it to the chat
        if (documentId) {
            await db.insert(agentAiChatbotDocument).values({
                id: documentId.toString(),
                chatId: chatId,
                userId: ctx.data.clerkUserId,
                title: title,
                kind: "text",
            });
        }

        return NextResponse.json({
            success: true,
            chat: newChat,
        });
    } catch (error) {
        console.error("Error creating chat:", error);
        return NextResponse.json({ error: "Failed to create chat" }, { status: 500 });
    }
}
