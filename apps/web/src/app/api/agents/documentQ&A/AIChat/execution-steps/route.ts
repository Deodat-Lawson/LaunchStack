import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotExecutionStep } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateExecutionStepSchema } from "~/lib/validation";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { assertTaskOwnedByUser } from "~/lib/ai-chat-ownership";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/agent-ai-chatbot/execution-steps - Create an execution step
export async function POST(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "chat.server.aiChat");

    try {
        const validation = await validateRequestBody(request, CreateExecutionStepSchema);
        if (!validation.success) return validation.response;
        const { taskId, stepNumber, stepType, description, reasoning, input, output } =
            validation.data;

        const owned = await assertTaskOwnedByUser(taskId, ctx.data.authUserId, locale);
        if (!owned.success) return owned.response;

        const stepId = randomUUID();

        const insertValues = {
            id: stepId,
            taskId,
            stepNumber,
            stepType,
            description,
            reasoning,
            input,
            output,
            status: "pending" as const,
        };

        const [newStep] = await db
            .insert(agentAiChatbotExecutionStep)
            .values(insertValues)
            .returning();

        return NextResponse.json({
            success: true,
            step: newStep,
        });
    } catch (error) {
        console.error("Error creating execution step:", error);
        return NextResponse.json({ error: t("createStep") }, { status: 500 });
    }
}

// GET /api/agent-ai-chatbot/execution-steps?taskId=xxx - Get execution steps for a task
export async function GET(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "chat.server.aiChat");
    const tValidation = translatorFor(locale, "errors.validation");

    try {
        const { searchParams } = new URL(request.url);
        const taskId = searchParams.get("taskId");

        if (!taskId) {
            return NextResponse.json({ error: tValidation("taskIdRequired") }, { status: 400 });
        }

        const owned = await assertTaskOwnedByUser(taskId, ctx.data.authUserId, locale);
        if (!owned.success) return owned.response;

        const steps = await db
            .select()
            .from(agentAiChatbotExecutionStep)
            .where(eq(agentAiChatbotExecutionStep.taskId, taskId))
            .orderBy(agentAiChatbotExecutionStep.stepNumber);

        return NextResponse.json({
            success: true,
            steps,
        });
    } catch (error) {
        console.error("Error fetching execution steps:", error);
        return NextResponse.json({ error: t("fetchSteps") }, { status: 500 });
    }
}
