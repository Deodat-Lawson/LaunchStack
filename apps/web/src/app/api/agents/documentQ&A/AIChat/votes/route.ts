import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { agentAiChatbotVote } from "@launchstack/core/db/schema";
import { eq, and } from "drizzle-orm";
import { validateRequestBody, CreateVoteSchema } from "~/lib/validation";

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/agent-ai-chatbot/votes - Vote on a message
export async function POST(request: NextRequest) {
  try {
    const validation = await validateRequestBody(request, CreateVoteSchema);
    if (!validation.success) return validation.response;
    const { chatId, messageId, isUpvoted, feedback } = validation.data;

    // Check if vote already exists
    const [existingVote] = await db
      .select()
      .from(agentAiChatbotVote)
      .where(
        and(
          eq(agentAiChatbotVote.chatId, chatId),
          eq(agentAiChatbotVote.messageId, messageId)
        )
      );

    if (existingVote) {
      // Update existing vote
      const [updatedVote] = await db
        .update(agentAiChatbotVote)
        .set({
          isUpvoted,
          feedback: feedback ?? existingVote.feedback,
        })
        .where(
          and(
            eq(agentAiChatbotVote.chatId, chatId),
            eq(agentAiChatbotVote.messageId, messageId)
          )
        )
        .returning();

      return NextResponse.json({
        success: true,
        vote: updatedVote,
        updated: true,
      });
    }

    // Create new vote
    const [newVote] = await db
      .insert(agentAiChatbotVote)
      .values({
        chatId,
        messageId,
        isUpvoted,
        feedback,
      })
      .returning();

    return NextResponse.json({
      success: true,
      vote: newVote,
      updated: false,
    });
  } catch (error) {
    console.error("Error voting:", error);
    return NextResponse.json(
      { error: "Failed to vote" },
      { status: 500 }
    );
  }
}

// GET /api/agent-ai-chatbot/votes?messageId=xxx - Get vote for a message
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("messageId");
    const chatId = searchParams.get("chatId");

    if (!messageId || !chatId) {
      return NextResponse.json(
        { error: "messageId and chatId are required" },
        { status: 400 }
      );
    }

    const [vote] = await db
      .select()
      .from(agentAiChatbotVote)
      .where(
        and(
          eq(agentAiChatbotVote.chatId, chatId),
          eq(agentAiChatbotVote.messageId, messageId)
        )
      );

    return NextResponse.json({
      success: true,
      vote: vote ?? null,
    });
  } catch (error) {
    console.error("Error fetching vote:", error);
    return NextResponse.json(
      { error: "Failed to fetch vote" },
      { status: 500 }
    );
  }
}

