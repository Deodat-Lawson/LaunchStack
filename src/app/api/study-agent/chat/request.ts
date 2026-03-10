/**
 * Study Agent Chat Request Parsing
 * Role: validate and normalize incoming chat requests before processing.
 * Purpose: keep the route handler lean and defensively typed.
 */

import { z } from "zod";
import type { StudyPlanItem, ConversationMessage } from "./types";

const ConversationMessageSchema: z.ZodSchema<ConversationMessage> = z.object({
  role: z.enum(["user", "teacher", "buddy"]),
  content: z.string().min(1, "content is required"),
});

const StudyPlanItemSchema: z.ZodSchema<StudyPlanItem> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  completed: z.boolean(),
});

const ChatRequestSchema = z.object({
  message: z.string().min(1, "message is required"),
  mode: z.enum(["teacher", "study-buddy"]).default("study-buddy"),
  fieldOfStudy: z.string().optional(),
  selectedDocuments: z.array(z.string()).default([]),
  sessionId: z.number().default(0),
  studyPlan: z.array(StudyPlanItemSchema).optional(),
  conversationHistory: z.array(ConversationMessageSchema).default([]),
});

export type ParsedChatPayload = z.infer<typeof ChatRequestSchema>;

export function parseChatRequest(body: unknown): ParsedChatPayload {
  const result = ChatRequestSchema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid request: ${issues}`);
  }
  return result.data;
}