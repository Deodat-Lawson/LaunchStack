import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotToolCall } from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";
import { validateRequestBody, UpdateToolCallSchema } from "~/lib/validation";

export const runtime = 'nodejs';
export const maxDuration = 300;

// PATCH /api/agent-ai-chatbot/tools/[toolCallId] - Update tool call result
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ toolCallId: string }> }
) {
  try {
    const { toolCallId } = await params;
    const validation = await validateRequestBody(request, UpdateToolCallSchema);
    if (!validation.success) return validation.response;
    const { toolOutput, status, errorMessage, executionTimeMs } = validation.data;

    const updateData: Record<string, unknown> = {};
    if (toolOutput) updateData.toolOutput = toolOutput;
    if (status) updateData.status = status;
    if (errorMessage) updateData.errorMessage = errorMessage;
    if (executionTimeMs) updateData.executionTimeMs = executionTimeMs;
    if (status === "completed" || status === "failed") {
      updateData.completedAt = new Date();
    }

    const [updatedToolCall] = await db
      .update(agentAiChatbotToolCall)
      .set(updateData)
      .where(eq(agentAiChatbotToolCall.id, toolCallId))
      .returning();

    if (!updatedToolCall) {
      return NextResponse.json(
        { error: "Tool call not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      toolCall: updatedToolCall,
    });
  } catch (error) {
    console.error("Error updating tool call:", error);
    return NextResponse.json(
      { error: "Failed to update tool call" },
      { status: 500 }
    );
  }
}

