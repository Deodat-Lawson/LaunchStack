import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { agentAiChatbotExecutionStep } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { validateRequestBody, UpdateExecutionStepSchema } from "~/lib/validation";
import { userOwnsExecutionStep } from "~/server/security/aichat-authz";

export const runtime = 'nodejs';
export const maxDuration = 300;

// PATCH /api/agent-ai-chatbot/execution-steps/[stepId] - Update execution step
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ stepId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { stepId } = await params;

    // Ownership walks step -> task -> chat; foreign rows read as 404.
    if (!(await userOwnsExecutionStep(stepId, userId))) {
      return NextResponse.json({ error: "Execution step not found" }, { status: 404 });
    }

    const validation = await validateRequestBody(request, UpdateExecutionStepSchema);
    if (!validation.success) return validation.response;
    const { status, output, reasoning } = validation.data;

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (output) updateData.output = output;
    if (reasoning) updateData.reasoning = reasoning;
    if (status === "completed" || status === "failed" || status === "skipped") {
      updateData.completedAt = new Date();
    }

    const [updatedStep] = await db
      .update(agentAiChatbotExecutionStep)
      .set(updateData)
      .where(eq(agentAiChatbotExecutionStep.id, stepId))
      .returning();

    if (!updatedStep) {
      return NextResponse.json(
        { error: "Execution step not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      step: updatedStep,
    });
  } catch (error) {
    console.error("Error updating execution step:", error);
    return NextResponse.json(
      { error: "Failed to update execution step" },
      { status: 500 }
    );
  }
}
