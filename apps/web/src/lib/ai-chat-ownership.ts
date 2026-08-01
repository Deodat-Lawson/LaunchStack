/**
 * Ownership checks for AI Chat resources.
 *
 * Chat rows are keyed by Clerk userId (no companyId on this table). Every
 * by-id / chatId-scoped handler must call one of these helpers after
 * requireWorkspaceContext so a verified user cannot IDOR another user's chat.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  agentAiChatbotChat,
  agentAiChatbotMessage,
  agentAiChatbotTask,
  agentAiChatbotToolCall,
  agentAiChatbotExecutionStep,
} from "@launchstack/core/db/schema";

type OwnedSuccess<T> = { success: true; data: T };
type OwnedFailure = { success: false; response: NextResponse };
export type OwnedResult<T> = OwnedSuccess<T> | OwnedFailure;

function notFound(entity = "Chat"): OwnedFailure {
  return {
    success: false,
    response: NextResponse.json({ error: `${entity} not found` }, { status: 404 }),
  };
}

export async function assertChatOwnedByUser(
  chatId: string,
  clerkUserId: string,
): Promise<OwnedResult<{ id: string; userId: string }>> {
  const [chat] = await db
    .select({ id: agentAiChatbotChat.id, userId: agentAiChatbotChat.userId })
    .from(agentAiChatbotChat)
    .where(
      and(
        eq(agentAiChatbotChat.id, chatId),
        eq(agentAiChatbotChat.userId, clerkUserId),
      ),
    )
    .limit(1);

  if (!chat) return notFound("Chat");
  return { success: true, data: chat };
}

export async function assertTaskOwnedByUser(
  taskId: string,
  clerkUserId: string,
): Promise<OwnedResult<{ id: string; chatId: string }>> {
  const [row] = await db
    .select({
      id: agentAiChatbotTask.id,
      chatId: agentAiChatbotTask.chatId,
    })
    .from(agentAiChatbotTask)
    .innerJoin(
      agentAiChatbotChat,
      and(
        eq(agentAiChatbotChat.id, agentAiChatbotTask.chatId),
        eq(agentAiChatbotChat.userId, clerkUserId),
      ),
    )
    .where(eq(agentAiChatbotTask.id, taskId))
    .limit(1);

  if (!row) return notFound("Task");
  return { success: true, data: row };
}

export async function assertMessageOwnedByUser(
  messageId: string,
  clerkUserId: string,
): Promise<OwnedResult<{ id: string; chatId: string }>> {
  const [row] = await db
    .select({
      id: agentAiChatbotMessage.id,
      chatId: agentAiChatbotMessage.chatId,
    })
    .from(agentAiChatbotMessage)
    .innerJoin(
      agentAiChatbotChat,
      and(
        eq(agentAiChatbotChat.id, agentAiChatbotMessage.chatId),
        eq(agentAiChatbotChat.userId, clerkUserId),
      ),
    )
    .where(eq(agentAiChatbotMessage.id, messageId))
    .limit(1);

  if (!row) return notFound("Message");
  return { success: true, data: row };
}

export async function assertToolCallOwnedByUser(
  toolCallId: string,
  clerkUserId: string,
): Promise<OwnedResult<{ id: string }>> {
  const [toolCall] = await db
    .select({
      id: agentAiChatbotToolCall.id,
      messageId: agentAiChatbotToolCall.messageId,
      taskId: agentAiChatbotToolCall.taskId,
    })
    .from(agentAiChatbotToolCall)
    .where(eq(agentAiChatbotToolCall.id, toolCallId))
    .limit(1);

  if (!toolCall) return notFound("Tool call");

  if (toolCall.taskId) {
    const owned = await assertTaskOwnedByUser(toolCall.taskId, clerkUserId);
    if (!owned.success) return owned;
    return { success: true, data: { id: toolCall.id } };
  }

  if (toolCall.messageId) {
    const owned = await assertMessageOwnedByUser(toolCall.messageId, clerkUserId);
    if (!owned.success) return owned;
    return { success: true, data: { id: toolCall.id } };
  }

  return notFound("Tool call");
}

export async function assertStepOwnedByUser(
  stepId: string,
  clerkUserId: string,
): Promise<OwnedResult<{ id: string; taskId: string }>> {
  const [step] = await db
    .select({
      id: agentAiChatbotExecutionStep.id,
      taskId: agentAiChatbotExecutionStep.taskId,
    })
    .from(agentAiChatbotExecutionStep)
    .where(eq(agentAiChatbotExecutionStep.id, stepId))
    .limit(1);

  if (!step) return notFound("Execution step");

  const owned = await assertTaskOwnedByUser(step.taskId, clerkUserId);
  if (!owned.success) return owned;

  return { success: true, data: step };
}
