import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { agentAiChatbotChat, agentAiChatbotDocument } from "~/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateChatSchema } from "~/lib/validation";

export const runtime = 'nodejs';
export const maxDuration = 300;

// GET /api/agent-ai-chatbot/chats - Get all chats for the session user
export async function GET(request: NextRequest) {
  try {
    // Identity comes from the Clerk session; the legacy `userId` query
    // parameter is still accepted for wire-compat but ignored.
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryUserId = searchParams.get("userId");
    if (queryUserId && queryUserId !== userId) {
      console.warn(
        `[AIChat] Ignoring query userId=${queryUserId}; using session userId=${userId}`
      );
    }

    const chats = await db
      .select()
      .from(agentAiChatbotChat)
      .where(eq(agentAiChatbotChat.userId, userId))
      .orderBy(desc(agentAiChatbotChat.updatedAt));

    return NextResponse.json({
      success: true,
      chats,
    });
  } catch (error) {
    console.error("Error fetching chats:", error);
    return NextResponse.json(
      { error: "Failed to fetch chats" },
      { status: 500 }
    );
  }
}

// POST /api/agent-ai-chatbot/chats - Create a new chat
export async function POST(request: NextRequest) {
  try {
    // Identity comes from the Clerk session, never the request body.
    // `userId` stays in the schema for wire-compat but is overridden.
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await validateRequestBody(request, CreateChatSchema);
    if (!validation.success) return validation.response;
    const {
      userId: bodyUserId,
      title,
      agentMode,
      visibility,
      aiStyle,
      aiPersona,
      documentId
    } = validation.data;

    if (bodyUserId && bodyUserId !== userId) {
      console.warn(
        `[AIChat] Ignoring body userId=${bodyUserId}; using session userId=${userId}`
      );
    }

    const chatId = randomUUID();
    const insertValues = {
      id: chatId,
      userId,
      title,
      agentMode: agentMode!,
      visibility: visibility!,
      status: "active" as const,
      aiStyle: aiStyle,
      aiPersona: aiPersona,
    };

    const [newChat] = await db
      .insert(agentAiChatbotChat)
      .values(insertValues)
      .returning();

    // If documentId is provided, bind it to the chat
    if (documentId) {
      await db.insert(agentAiChatbotDocument).values({
        id: documentId.toString(),
        chatId: chatId,
        userId: userId,
        title: title, // Use chat title as doc ref title for now
        kind: "text",
      });
    }

    return NextResponse.json({
      success: true,
      chat: newChat,
    });
  } catch (error) {
    console.error("Error creating chat:", error);
    return NextResponse.json(
      { error: "Failed to create chat" },
      { status: 500 }
    );
  }
}
