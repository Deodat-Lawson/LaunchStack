/**
 * Ownership checks for the AIChat CRUD family
 * (/api/agents/documentQ&A/AIChat/**).
 *
 * Chats are keyed by `agentAiChatbotChat.userId` (a Clerk user id). Child
 * rows (messages, tasks, tool calls, execution steps, memory, votes) carry no
 * user id of their own, so authorization walks the foreign-key chain up to
 * the owning chat and compares its userId against the session user.
 *
 * All helpers return booleans; routes translate a failed check into 404 so
 * cross-tenant probes cannot distinguish "not yours" from "does not exist"
 * (matching the convention in e.g. /api/documents/[id]).
 */

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
    agentAiChatbotChat,
    agentAiChatbotExecutionStep,
    agentAiChatbotMessage,
    agentAiChatbotTask,
    agentAiChatbotToolCall,
} from "~/server/db/schema";

/** True when `chatId` exists and belongs to `userId`. */
export async function userOwnsChat(chatId: string, userId: string): Promise<boolean> {
    const [chat] = await db
        .select({ id: agentAiChatbotChat.id })
        .from(agentAiChatbotChat)
        .where(and(eq(agentAiChatbotChat.id, chatId), eq(agentAiChatbotChat.userId, userId)));
    return chat !== undefined;
}

/** True when `taskId` exists and its chat belongs to `userId`. */
export async function userOwnsTask(taskId: string, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: agentAiChatbotTask.id })
        .from(agentAiChatbotTask)
        .innerJoin(agentAiChatbotChat, eq(agentAiChatbotTask.chatId, agentAiChatbotChat.id))
        .where(and(eq(agentAiChatbotTask.id, taskId), eq(agentAiChatbotChat.userId, userId)));
    return row !== undefined;
}

/** True when `messageId` exists and its chat belongs to `userId`. */
export async function userOwnsMessage(messageId: string, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: agentAiChatbotMessage.id })
        .from(agentAiChatbotMessage)
        .innerJoin(agentAiChatbotChat, eq(agentAiChatbotMessage.chatId, agentAiChatbotChat.id))
        .where(and(eq(agentAiChatbotMessage.id, messageId), eq(agentAiChatbotChat.userId, userId)));
    return row !== undefined;
}

/** True when `stepId` exists and its task's chat belongs to `userId`. */
export async function userOwnsExecutionStep(stepId: string, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: agentAiChatbotExecutionStep.id })
        .from(agentAiChatbotExecutionStep)
        .innerJoin(
            agentAiChatbotTask,
            eq(agentAiChatbotExecutionStep.taskId, agentAiChatbotTask.id)
        )
        .innerJoin(agentAiChatbotChat, eq(agentAiChatbotTask.chatId, agentAiChatbotChat.id))
        .where(
            and(eq(agentAiChatbotExecutionStep.id, stepId), eq(agentAiChatbotChat.userId, userId))
        );
    return row !== undefined;
}

/** True when `toolCallId` exists and its message's chat belongs to `userId`. */
export async function userOwnsToolCall(toolCallId: string, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: agentAiChatbotToolCall.id })
        .from(agentAiChatbotToolCall)
        .innerJoin(
            agentAiChatbotMessage,
            eq(agentAiChatbotToolCall.messageId, agentAiChatbotMessage.id)
        )
        .innerJoin(agentAiChatbotChat, eq(agentAiChatbotMessage.chatId, agentAiChatbotChat.id))
        .where(
            and(eq(agentAiChatbotToolCall.id, toolCallId), eq(agentAiChatbotChat.userId, userId))
        );
    return row !== undefined;
}
