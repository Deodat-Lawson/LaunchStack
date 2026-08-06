import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotToolCall } from "@launchstack/core/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateToolCallSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { assertToolCallParentsOwnedByUser } from "~/lib/ai-chat-ownership";

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/agent-ai-chatbot/tools - Create a tool call
export async function POST(request: NextRequest) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  try {
    const validation = await validateRequestBody(request, CreateToolCallSchema);
    if (!validation.success) return validation.response;
    const { messageId, taskId, toolName, toolInput } = validation.data;

    const owned = await assertToolCallParentsOwnedByUser(
      messageId,
      taskId,
      ctx.data.clerkUserId,
    );
    if (!owned.success) return owned.response;

    const toolCallId = randomUUID();

    const [newToolCall] = await db
      .insert(agentAiChatbotToolCall)
      .values({
        id: toolCallId,
        messageId,
        taskId,
        toolName,
        toolInput,
        status: "pending",
      })
      .returning();

    return NextResponse.json({
      success: true,
      toolCall: newToolCall,
    });
  } catch (error) {
    console.error("Error creating tool call:", error);
    return NextResponse.json(
      { error: "Failed to create tool call" },
      { status: 500 }
    );
  }
}

// GET /api/agent-ai-chatbot/tools?messageId=xxx - Get tool calls for a message
export async function GET(request: NextRequest) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  try {
    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("messageId");
    const taskId = searchParams.get("taskId");

    if (!messageId && !taskId) {
      return NextResponse.json(
        { error: "messageId or taskId is required" },
        { status: 400 }
      );
    }

    const owned = await assertToolCallParentsOwnedByUser(
      messageId,
      taskId,
      ctx.data.clerkUserId,
    );
    if (!owned.success) return owned.response;

    const filter =
      taskId && messageId
        ? and(
            eq(agentAiChatbotToolCall.taskId, taskId),
            eq(agentAiChatbotToolCall.messageId, messageId),
          )
        : taskId
          ? eq(agentAiChatbotToolCall.taskId, taskId)
          : eq(agentAiChatbotToolCall.messageId, messageId!);

    const toolCalls = await db
      .select()
      .from(agentAiChatbotToolCall)
      .where(filter)
      .orderBy(agentAiChatbotToolCall.createdAt);

    const authorizedToolCalls = [];
    for (const toolCall of toolCalls) {
      const rowOwned = await assertToolCallParentsOwnedByUser(
        toolCall.messageId,
        toolCall.taskId,
        ctx.data.clerkUserId,
      );
      if (rowOwned.success) authorizedToolCalls.push(toolCall);
    }

    return NextResponse.json({
      success: true,
      toolCalls: authorizedToolCalls,
    });
  } catch (error) {
    console.error("Error fetching tool calls:", error);
    return NextResponse.json(
      { error: "Failed to fetch tool calls" },
      { status: 500 }
    );
  }
}
