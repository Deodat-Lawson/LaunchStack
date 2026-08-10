import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { agentAiChatbotMemory } from "~/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateMemorySchema } from "~/lib/validation";
import { userOwnsChat } from "~/server/security/aichat-authz";

export const runtime = 'nodejs';
export const maxDuration = 300;

// Handlers require a Clerk session and verify the target chat belongs to the
// session user; foreign chats read as 404.

// POST /api/agent-ai-chatbot/memory - Store memory
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await validateRequestBody(request, CreateMemorySchema);
    if (!validation.success) return validation.response;
    const {
      chatId,
      memoryType,
      key,
      value,
      importance,
      embedding,
      expiresAt
    } = validation.data;

    if (!(await userOwnsChat(chatId, userId))) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const memoryId = randomUUID();

    const insertValues = {
      id: memoryId,
      chatId,
      memoryType: memoryType,
      key,
      value,
      importance,
      embedding: embedding ?? null,
      expiresAt: expiresAt ? (expiresAt instanceof Date ? expiresAt : new Date(expiresAt)) : null,
    };

    const [newMemory] = await db
      .insert(agentAiChatbotMemory)
      .values(insertValues)
      .returning();

    return NextResponse.json({
      success: true,
      memory: newMemory,
    });
  } catch (error) {
    console.error("Error storing memory:", error);
    return NextResponse.json(
      { error: "Failed to store memory" },
      { status: 500 }
    );
  }
}

// GET /api/agent-ai-chatbot/memory?chatId=xxx - Get memories for a chat
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");
    const memoryType = searchParams.get("memoryType");

    if (!chatId) {
      return NextResponse.json(
        { error: "chatId is required" },
        { status: 400 }
      );
    }

    if (!(await userOwnsChat(chatId, userId))) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const whereConditions = memoryType
      ? and(
          eq(agentAiChatbotMemory.chatId, chatId),
          eq(agentAiChatbotMemory.memoryType, memoryType as "short_term" | "long_term" | "working" | "episodic")
        )
      : eq(agentAiChatbotMemory.chatId, chatId);

    const memories = await db
      .select()
      .from(agentAiChatbotMemory)
      .where(whereConditions)
      .orderBy(
        desc(agentAiChatbotMemory.importance),
        desc(agentAiChatbotMemory.accessedAt)
      );


    // Update accessedAt for retrieved memories
    const memoryIds = memories.map((m) => m.id);
    if (memoryIds.length > 0) {
      await db
        .update(agentAiChatbotMemory)
        .set({ accessedAt: new Date() })
        .where(eq(agentAiChatbotMemory.chatId, chatId));
    }

    return NextResponse.json({
      success: true,
      memories,
    });
  } catch (error) {
    console.error("Error fetching memories:", error);
    return NextResponse.json(
      { error: "Failed to fetch memories" },
      { status: 500 }
    );
  }
}
