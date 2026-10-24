/**
 * Ownership checks for AI Chat resources.
 *
 * Chat rows are keyed by auth userId (no companyId on this table). Every
 * by-id / chatId-scoped handler must call one of these helpers after
 * requireWorkspaceContext so a verified user cannot IDOR another user's chat.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import type { Locale } from "~/i18n/locales";
import { translatorFor } from "~/i18n/translate";
import { db } from "~/server/db";
import {
    agentAiChatbotChat,
    agentAiChatbotMessage,
    agentAiChatbotTask,
    agentAiChatbotToolCall,
    agentAiChatbotExecutionStep,
} from "~/server/db/schema";

type OwnedSuccess<T> = { success: true; data: T };
type OwnedFailure = { success: false; response: NextResponse };
export type OwnedResult<T> = OwnedSuccess<T> | OwnedFailure;

type MissingEntity =
    | "chatNotFound"
    | "taskNotFound"
    | "messageNotFound"
    | "toolCallNotFound"
    | "stepNotFound";

/** `"Chat not found"` and the rest, in the reader's language (`chat.server.aiChat`). */
function notFound(entity: MissingEntity, locale: Locale): OwnedFailure {
    const t = translatorFor(locale, "chat.server.aiChat");
    return {
        success: false,
        response: NextResponse.json({ error: t(entity) }, { status: 404 }),
    };
}

export async function assertChatOwnedByUser(
    chatId: string,
    authUserId: string,
    locale: Locale = "en"
): Promise<OwnedResult<{ id: string; userId: string }>> {
    const [chat] = await db
        .select({ id: agentAiChatbotChat.id, userId: agentAiChatbotChat.userId })
        .from(agentAiChatbotChat)
        .where(and(eq(agentAiChatbotChat.id, chatId), eq(agentAiChatbotChat.userId, authUserId)))
        .limit(1);

    if (!chat) return notFound("chatNotFound", locale);
    return { success: true, data: chat };
}

export async function assertTaskOwnedByUser(
    taskId: string,
    authUserId: string,
    locale: Locale = "en"
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
                eq(agentAiChatbotChat.userId, authUserId)
            )
        )
        .where(eq(agentAiChatbotTask.id, taskId))
        .limit(1);

    if (!row) return notFound("taskNotFound", locale);
    return { success: true, data: row };
}

export async function assertMessageOwnedByUser(
    messageId: string,
    authUserId: string,
    locale: Locale = "en"
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
                eq(agentAiChatbotChat.userId, authUserId)
            )
        )
        .where(eq(agentAiChatbotMessage.id, messageId))
        .limit(1);

    if (!row) return notFound("messageNotFound", locale);
    return { success: true, data: row };
}

/**
 * A tool call hangs off a message and optionally off a task. Both are
 * independent FKs, so each has to be authorized and both have to name the
 * same chat — otherwise an owned task can be paired with a foreign message,
 * making that message visible (and later mutable) through the owned parent.
 */
export async function assertToolCallParentsOwnedByUser(
    messageId: string | null | undefined,
    taskId: string | null | undefined,
    authUserId: string,
    locale: Locale = "en"
): Promise<OwnedResult<{ chatId: string }>> {
    if (!messageId && !taskId) return notFound("toolCallNotFound", locale);

    let chatId: string | null = null;

    if (messageId) {
        const owned = await assertMessageOwnedByUser(messageId, authUserId, locale);
        if (!owned.success) return owned;
        chatId = owned.data.chatId;
    }

    if (taskId) {
        const owned = await assertTaskOwnedByUser(taskId, authUserId, locale);
        if (!owned.success) return owned;
        if (chatId !== null && chatId !== owned.data.chatId) {
            return notFound("toolCallNotFound", locale);
        }
        chatId = owned.data.chatId;
    }

    return { success: true, data: { chatId: chatId! } };
}

/**
 * Ownership plus containment: the message must belong to the caller *and*
 * live in the chat the handler already authorized. Callers that accept a
 * chatId and a messageId separately need this — checking the chat alone lets
 * a foreign message ride along on an owned chat.
 */
export async function assertMessageInChat(
    messageId: string,
    chatId: string,
    authUserId: string,
    locale: Locale = "en"
): Promise<OwnedResult<{ id: string; chatId: string }>> {
    const owned = await assertMessageOwnedByUser(messageId, authUserId, locale);
    if (!owned.success) return owned;

    if (owned.data.chatId !== chatId) return notFound("messageNotFound", locale);

    return owned;
}

export async function assertToolCallOwnedByUser(
    toolCallId: string,
    authUserId: string,
    locale: Locale = "en"
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

    if (!toolCall) return notFound("toolCallNotFound", locale);

    // Rows written before the dual-parent rule may be malformed; requiring both
    // parents here keeps them from being mutated through the owned one.
    const owned = await assertToolCallParentsOwnedByUser(
        toolCall.messageId,
        toolCall.taskId,
        authUserId,
        locale
    );
    if (!owned.success) return owned;

    return { success: true, data: { id: toolCall.id } };
}

export async function assertStepOwnedByUser(
    stepId: string,
    authUserId: string,
    locale: Locale = "en"
): Promise<OwnedResult<{ id: string; taskId: string }>> {
    const [step] = await db
        .select({
            id: agentAiChatbotExecutionStep.id,
            taskId: agentAiChatbotExecutionStep.taskId,
        })
        .from(agentAiChatbotExecutionStep)
        .where(eq(agentAiChatbotExecutionStep.id, stepId))
        .limit(1);

    if (!step) return notFound("stepNotFound", locale);

    const owned = await assertTaskOwnedByUser(step.taskId, authUserId, locale);
    if (!owned.success) return owned;

    return { success: true, data: step };
}
