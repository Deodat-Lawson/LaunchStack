/**
 * Study Buddy Agent Request Helpers
 * Role: validate/normalize incoming HTTP JSON for the study-agent endpoint.
 * Purpose: keep request shaping and defaults out of the route so the handler stays lean.
 */

import { z } from "zod";
import type { StudyAgentRequest, StudyMode } from "./types";

const StudyModeSchema = z.enum(["teacher", "study-buddy", "quiz-master", "coach"]);

const PreferencesSchema = z.object({
  learningStyle: z
    .enum(["visual", "auditory", "kinesthetic", "reading"])
    .optional(),
  preferredDifficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  enableWebSearch: z.boolean().optional(),
  responseLength: z.enum(["brief", "moderate", "detailed"]).optional(),
});

const ConversationHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1, "content is required"),
    })
  )
  .default([]);

const IncomingStudyAgentSchema = z.object({
  message: z.string().min(1, "message is required"),
  mode: StudyModeSchema.default("study-buddy"),
  sessionId: z.number().int().positive("sessionId must be a positive number"),
  fieldOfStudy: z.string().optional(),
  selectedDocuments: z.array(z.string()).default([]),
  conversationHistory: ConversationHistorySchema,
  preferences: PreferencesSchema.optional(),
});

export type IncomingStudyAgentPayload = z.infer<typeof IncomingStudyAgentSchema>;

/**
 * Parse and normalize the incoming JSON body.
 * Returns a typed payload without `userId`; the caller must add it.
 */
export function parseIncomingStudyAgentPayload(
  body: unknown
): IncomingStudyAgentPayload {
  const result = IncomingStudyAgentSchema.safeParse(body);

  if (!result.success) {
    // This is intentionally terse; the route turns this into a 400 response.
    const issues = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid request: ${issues}`);
  }

  return result.data;
}

/**
 * Merge the validated body with the authenticated user to form the agent request.
 */
export function buildAgentRequest(
  userId: string,
  payload: IncomingStudyAgentPayload
): StudyAgentRequest {
  if (payload.sessionId === undefined || Number.isNaN(payload.sessionId)) {
    throw new Error("Invalid request: sessionId is required");
  }

  return {
    ...payload,
    userId,
    // Provide a small convenience default when the client did not send a mode.
    mode: (payload.mode ?? "study-buddy") as StudyMode,
  };
}

