import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { agentAiChatbotTask } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateTaskSchema } from "~/lib/validation";
import { userOwnsChat } from "~/server/security/aichat-authz";

export const runtime = 'nodejs';
export const maxDuration = 300;

// Handlers require a Clerk session and verify the target chat belongs to the
// session user; foreign chats read as 404.

// POST /api/agent-ai-chatbot/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await validateRequestBody(request, CreateTaskSchema);
    if (!validation.success) return validation.response;
    const { chatId, description, objective, priority, metadata } = validation.data;

    if (!(await userOwnsChat(chatId, userId))) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const taskId = randomUUID();

    const [newTask] = await db
      .insert(agentAiChatbotTask)
      .values({
        id: taskId,
        chatId,
        description,
        objective,
        priority,
        status: "pending",
        metadata,
      })
      .returning();

    return NextResponse.json({
      success: true,
      task: newTask,
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    );
  }
}

// GET /api/agent-ai-chatbot/tasks?chatId=xxx - Get tasks for a chat
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

    const tasks = await db
      .select()
      .from(agentAiChatbotTask)
      .where(eq(agentAiChatbotTask.chatId, chatId))
      .orderBy(agentAiChatbotTask.priority, agentAiChatbotTask.createdAt);

    return NextResponse.json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}
