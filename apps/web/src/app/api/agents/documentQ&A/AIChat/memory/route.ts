import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotMemory } from "~/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateMemorySchema } from "~/lib/validation";

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/agent-ai-chatbot/memory - Store memory
export async function POST(request: NextRequest) {
  try {
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

    const memoryId = randomUUID();

    const insertValues = {
      id: memoryId,
      chatId,
      memoryType: memoryType as "short_term" | "long_term" | "working" | "episodic",
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
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");
    const memoryType = searchParams.get("memoryType");

    if (!chatId) {
      return NextResponse.json(
        { error: "chatId is required" },
        { status: 400 }
      );
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

