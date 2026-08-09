import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { agentAiChatbotExecutionStep } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateExecutionStepSchema } from "~/lib/validation";
import { userOwnsTask } from "~/server/security/aichat-authz";

export const runtime = 'nodejs';
export const maxDuration = 300;

// Handlers require a Clerk session and verify the referenced task belongs
// (via its chat) to the session user; foreign tasks read as 404.

// POST /api/agent-ai-chatbot/execution-steps - Create an execution step
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await validateRequestBody(request, CreateExecutionStepSchema);
    if (!validation.success) return validation.response;
    const {
      taskId,
      stepNumber,
      stepType,
      description,
      reasoning,
      input,
      output
    } = validation.data;

    if (!(await userOwnsTask(taskId, userId))) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const stepId = randomUUID();

    const insertValues = {
      id: stepId,
      taskId,
      stepNumber,
      stepType: stepType,
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
    return NextResponse.json(
      { error: "Failed to create execution step" },
      { status: 500 }
    );
  }
}

// GET /api/agent-ai-chatbot/execution-steps?taskId=xxx - Get execution steps for a task
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    if (!(await userOwnsTask(taskId, userId))) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

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
    return NextResponse.json(
      { error: "Failed to fetch execution steps" },
      { status: 500 }
    );
  }
}
