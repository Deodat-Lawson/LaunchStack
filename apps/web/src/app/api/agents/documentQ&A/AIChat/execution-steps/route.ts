import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotExecutionStep } from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateRequestBody, CreateExecutionStepSchema } from "~/lib/validation";

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/agent-ai-chatbot/execution-steps - Create an execution step
export async function POST(request: NextRequest) {
  try {
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

    const stepId = randomUUID();

    const insertValues = {
      id: stepId,
      taskId,
      stepNumber,
      stepType: stepType as "reasoning" | "planning" | "execution" | "evaluation" | "decision",
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
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
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

