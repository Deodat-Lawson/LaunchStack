import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotMessage, agentAiChatbotChat } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateMessageSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
  assertChatOwnedByUser,
  assertMessageInChat,
} from "~/lib/ai-chat-ownership";

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/agent-ai-chatbot/messages - Send a message
export async function POST(request: NextRequest) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  try {
    const validation = await validateRequestBody(request, CreateMessageSchema);
    if (!validation.success) return validation.response;
    const { chatId, role, content, messageType, parentMessageId } = validation.data;

    const owned = await assertChatOwnedByUser(chatId, ctx.data.clerkUserId);
    if (!owned.success) return owned.response;

    if (parentMessageId) {
      const parent = await assertMessageInChat(
        parentMessageId,
        chatId,
        ctx.data.clerkUserId,
      );
      if (!parent.success) return parent.response;
    }

    const messageId = randomUUID();

    const insertValues = {
      id: messageId,
      chatId,
      role,
      content,
      messageType: messageType!,
      parentMessageId,
    };

    const [newMessage] = await db
      .insert(agentAiChatbotMessage)
      .values(insertValues)
      .returning();

    // Update chat's updatedAt timestamp
    await db
      .update(agentAiChatbotChat)
      .set({ updatedAt: new Date() })
      .where(eq(agentAiChatbotChat.id, chatId));

    return NextResponse.json({
      success: true,
      message: newMessage,
    });
  } catch (error) {
    console.error("Error creating message:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}

// GET /api/agent-ai-chatbot/messages?chatId=xxx - Get messages for a chat
export async function GET(request: NextRequest) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return NextResponse.json(
        { error: "chatId is required" },
        { status: 400 }
      );
    }

    const owned = await assertChatOwnedByUser(chatId, ctx.data.clerkUserId);
    if (!owned.success) return owned.response;

    const messages = await db
      .select()
      .from(agentAiChatbotMessage)
      .where(eq(agentAiChatbotMessage.chatId, chatId))
      .orderBy(agentAiChatbotMessage.createdAt);

    return NextResponse.json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
