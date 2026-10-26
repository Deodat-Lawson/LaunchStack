import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotTask } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateTaskSchema } from "~/lib/validation";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { assertChatOwnedByUser } from "~/lib/ai-chat-ownership";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/agent-ai-chatbot/tasks - Create a new task
export async function POST(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "chat.server.aiChat");

    try {
        const validation = await validateRequestBody(request, CreateTaskSchema);
        if (!validation.success) return validation.response;
        const { chatId, description, objective, priority, metadata } = validation.data;

        const owned = await assertChatOwnedByUser(chatId, ctx.data.authUserId, locale);
        if (!owned.success) return owned.response;

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
        return NextResponse.json({ error: t("createTask") }, { status: 500 });
    }
}

// GET /api/agent-ai-chatbot/tasks?chatId=xxx - Get tasks for a chat
export async function GET(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "chat.server.aiChat");
    const tValidation = translatorFor(locale, "errors.validation");

    try {
        const { searchParams } = new URL(request.url);
        const chatId = searchParams.get("chatId");

        if (!chatId) {
            return NextResponse.json({ error: tValidation("chatIdRequired") }, { status: 400 });
        }

        const owned = await assertChatOwnedByUser(chatId, ctx.data.authUserId, locale);
        if (!owned.success) return owned.response;

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
        return NextResponse.json({ error: t("fetchTasks") }, { status: 500 });
    }
}
