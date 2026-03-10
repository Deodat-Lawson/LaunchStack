/**
 * Progress Tracker Tool
 * Tracks study session progress and provides insights
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { StudySession, ProgressTrackingInput } from "../types";

// In-memory session store (in production, this would be in the database)
const sessionStore = new Map<string, StudySession>();

const ProgressSchema = z.object({
  sessionId: z.string().optional().describe("The session ID (auto-generated if starting)"),
  action: z
    .enum(["start", "update", "complete", "summary"])
    .describe("The tracking action to perform"),
  userId: z.string().describe("The user ID"),
  data: z
    .object({
      mode: z.enum(["teacher", "study-buddy", "quiz-master", "coach"]).optional(),
      documentsStudied: z.array(z.string()).optional(),
      conceptsCovered: z.array(z.string()).optional(),
      quizzesTaken: z.array(z.string()).optional(),
      flashcardsReviewed: z.number().optional(),
      notes: z.array(z.string()).optional(),
    })
    .optional()
    .describe("Session data to update"),
});

/**
 * Track study session progress
 */
export async function trackProgress(
  input: ProgressTrackingInput & { userId: string }
): Promise<{
  session: StudySession | null;
  summary?: string;
  insights?: string[];
}> {
  try {
    switch (input.action) {
      case "start": {
        const newSession: StudySession = {
          id: uuidv4(),
          userId: input.userId,
          startTime: new Date(),
          mode: input.data?.mode ?? "study-buddy",
          documentsStudied: input.data?.documentsStudied ?? [],
          conceptsCovered: input.data?.conceptsCovered ?? [],
          quizzesTaken: input.data?.quizzesTaken ?? [],
          flashcardsReviewed: input.data?.flashcardsReviewed ?? 0,
          notes: input.data?.notes ?? [],
        };
        sessionStore.set(newSession.id, newSession);
        
        console.log(`📊 [Progress Tracker] Started session ${newSession.id}`);
        
        return {
          session: newSession,
          summary: `Started new study session (ID: ${newSession.id})`,
        };
      }

      case "update": {
        const sessionId = input.sessionId ?? "";
        const session = sessionStore.get(sessionId);
        
        if (!session) {
          return {
            session: null,
            summary: "Session not found",
          };
        }

        // Update session with new data
        if (input.data?.documentsStudied) {
          session.documentsStudied = [
            ...new Set([...session.documentsStudied, ...input.data.documentsStudied]),
          ];
        }
        if (input.data?.conceptsCovered) {
          session.conceptsCovered = [
            ...new Set([...session.conceptsCovered, ...input.data.conceptsCovered]),
          ];
        }
        if (input.data?.quizzesTaken) {
          session.quizzesTaken = [
            ...new Set([...session.quizzesTaken, ...input.data.quizzesTaken]),
          ];
        }
        if (input.data?.flashcardsReviewed !== undefined) {
          session.flashcardsReviewed += input.data.flashcardsReviewed;
        }
        if (input.data?.notes) {
          session.notes = [...session.notes, ...input.data.notes];
        }

        sessionStore.set(sessionId, session);
        
        console.log(`📊 [Progress Tracker] Updated session ${sessionId}`);
        
        return {
          session,
          summary: `Updated session progress`,
        };
      }

      case "complete": {
        const sessionId = input.sessionId ?? "";
        const session = sessionStore.get(sessionId);
        
        if (!session) {
          return {
            session: null,
            summary: "Session not found",
          };
        }

        session.endTime = new Date();
        const durationMinutes = Math.round(
          (session.endTime.getTime() - session.startTime.getTime()) / 60000
        );

        session.progressSummary = generateProgressSummary(session, durationMinutes);
        sessionStore.set(sessionId, session);

        console.log(
          `📊 [Progress Tracker] Completed session ${sessionId} (${durationMinutes} min)`
        );

        return {
          session,
          summary: session.progressSummary,
          insights: generateInsights(session, durationMinutes),
        };
      }

      default:
        return {
          session: null,
          summary: "Unknown action",
        };
    }
  } catch (error) {
    console.error("❌ [Progress Tracker] Error:", error);
    throw error;
  }
}

/**
 * Generate a progress summary for a completed session
 */
function generateProgressSummary(session: StudySession, durationMinutes: number): string {
  const parts = [`Study session completed in ${durationMinutes} minutes.`];

  if (session.documentsStudied.length > 0) {
    parts.push(`Studied ${session.documentsStudied.length} document(s).`);
  }
  if (session.conceptsCovered.length > 0) {
    parts.push(`Covered ${session.conceptsCovered.length} concept(s).`);
  }
  if (session.quizzesTaken.length > 0) {
    parts.push(`Completed ${session.quizzesTaken.length} quiz(zes).`);
  }
  if (session.flashcardsReviewed > 0) {
    parts.push(`Reviewed ${session.flashcardsReviewed} flashcard(s).`);
  }
  if (session.notes.length > 0) {
    parts.push(`Took ${session.notes.length} note(s).`);
  }

  return parts.join(" ");
}

/**
 * Generate insights based on session activity
 */
function generateInsights(session: StudySession, durationMinutes: number): string[] {
  const insights: string[] = [];

  // Time-based insights
  if (durationMinutes < 15) {
    insights.push("Consider longer study sessions (25-50 minutes) for better retention.");
  } else if (durationMinutes > 90) {
    insights.push("Great dedication! Remember to take breaks every 50 minutes.");
  }

  // Activity-based insights
  if (session.flashcardsReviewed > 20) {
    insights.push("Excellent flashcard practice! Spaced repetition will help long-term memory.");
  }

  if (session.quizzesTaken.length > 0 && session.conceptsCovered.length > 3) {
    insights.push("Good mix of learning and testing - this active recall strengthens memory.");
  }

  if (session.conceptsCovered.length > 5) {
    insights.push(
      "You covered many concepts. Consider reviewing the most challenging ones tomorrow."
    );
  }

  return insights;
}

/**
 * Progress Tracker Tool for LangChain
 */
export const progressTrackerTool = tool(
  async (input): Promise<string> => {
    try {
      // Filter action to only allowed values
      const validAction = input.action === "summary" ? "complete" : input.action;
      
      const result = await trackProgress({
        sessionId: input.sessionId ?? "",
        action: validAction,
        userId: input.userId,
        data: input.data,
      });

      return JSON.stringify({
        success: true,
        session: result.session,
        summary: result.summary,
        insights: result.insights,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        session: null,
      });
    }
  },
  {
    name: "track_progress",
    description:
      "Track study session progress, start new sessions, update progress, or complete sessions with summaries. Use this to help users monitor their learning journey.",
    schema: ProgressSchema,
  }
);

