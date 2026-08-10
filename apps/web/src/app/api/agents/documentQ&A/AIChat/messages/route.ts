import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { agentAiChatbotMessage, agentAiChatbotChat } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateMessageSchema } from "~/lib/validation";
import { userOwnsChat } from "~/server/security/aichat-authz";

export const runtime = 'nodejs';
export const maxDuration = 300;

// Handlers require a Clerk session and verify the target chat belongs to the
// session user; foreign chats read as 404.

// POST /api/agent-ai-chatbot/messages - Send a message
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await validateRequestBody(request, CreateMessageSchema);
    if (!validation.success) return validation.response;
    const { chatId, role, content, messageType, parentMessageId } = validation.data;

    if (!(await userOwnsChat(chatId, userId))) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const messageId = randomUUID();

    const insertValues = {
      id: messageId,
      chatId,
      role: role,
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
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return NextResponse.json(
        { error: "chatId is required" },
        { status: 400 }
      );
    }

    if (!(await userOwnsChat(chatId, userId))) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

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
