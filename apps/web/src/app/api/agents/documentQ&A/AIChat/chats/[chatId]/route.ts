import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { agentAiChatbotChat, agentAiChatbotMessage, agentAiChatbotTask, agentAiChatbotDocument } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { validateRequestBody, UpdateChatSchema } from "~/lib/validation";

export const runtime = 'nodejs';
export const maxDuration = 300;

// All handlers scope the chat to the Clerk session user; a chat owned by
// someone else is indistinguishable from a missing one (404).

// GET /api/agent-ai-chatbot/chats/[chatId] - Get a specific chat with its messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { chatId } = await params;

    // Get chat details (scoped to the session user)
    const [chat] = await db
      .select()
      .from(agentAiChatbotChat)
      .where(and(eq(agentAiChatbotChat.id, chatId), eq(agentAiChatbotChat.userId, userId)));

    if (!chat) {
      return NextResponse.json(
        { error: "Chat not found" },
        { status: 404 }
      );
    }

    // Get messages for this chat
    const messages = await db
      .select()
      .from(agentAiChatbotMessage)
      .where(eq(agentAiChatbotMessage.chatId, chatId))
      .orderBy(agentAiChatbotMessage.createdAt);

    // Get tasks for this chat
    const tasks = await db
      .select()
      .from(agentAiChatbotTask)
      .where(eq(agentAiChatbotTask.chatId, chatId))
      .orderBy(agentAiChatbotTask.createdAt);

    // Get documents for this chat
    const documents = await db
      .select()
      .from(agentAiChatbotDocument)
      .where(eq(agentAiChatbotDocument.chatId, chatId));

    return NextResponse.json({
      success: true,
      chat,
      messages,
      tasks,
      documents,
    });
  } catch (error) {
    console.error("Error fetching chat:", error);
    return NextResponse.json(
      { error: "Failed to fetch chat" },
      { status: 500 }
    );
  }
}

// PATCH /api/agent-ai-chatbot/chats/[chatId] - Update chat
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { chatId } = await params;
    const validation = await validateRequestBody(request, UpdateChatSchema);
    if (!validation.success) return validation.response;
    const { title, status, agentMode, visibility, aiStyle, aiPersona } = validation.data;

    const updateData: Record<string, unknown> = {};
    if (title) updateData.title = title;
    if (status) updateData.status = status;
    if (agentMode) updateData.agentMode = agentMode;
    if (visibility) updateData.visibility = visibility;
    if (aiStyle !== undefined) updateData.aiStyle = aiStyle;
    if (aiPersona !== undefined) updateData.aiPersona = aiPersona;

    const [updatedChat] = await db
      .update(agentAiChatbotChat)
      .set(updateData)
      .where(and(eq(agentAiChatbotChat.id, chatId), eq(agentAiChatbotChat.userId, userId)))
      .returning();

    if (!updatedChat) {
      return NextResponse.json(
        { error: "Chat not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      chat: updatedChat,
    });
  } catch (error) {
    console.error("Error updating chat:", error);
    return NextResponse.json(
      { error: "Failed to update chat" },
      { status: 500 }
    );
  }
}

// DELETE /api/agent-ai-chatbot/chats/[chatId] - Delete chat
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { chatId } = await params;

    await db
      .delete(agentAiChatbotChat)
      .where(and(eq(agentAiChatbotChat.id, chatId), eq(agentAiChatbotChat.userId, userId)));

    return NextResponse.json({
      success: true,
      message: "Chat deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting chat:", error);
    return NextResponse.json(
      { error: "Failed to delete chat" },
      { status: 500 }
    );
  }
}
