/**
 * Study Agent Chat Types
 * Type definitions and interfaces for the study agent chat API
 */

/**
 * ElevenLabs supports these emotion tags for TTS
 */
export type EmotionTag =
  | "happy"
  | "sad"
  | "angry"
  | "fearful"
  | "surprised"
  | "disgusted"
  | "excited"
  | "calm";

export interface StudyPlanItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

export interface ConversationMessage {
  role: "user" | "teacher" | "buddy";
  content: string;
}

export interface StudyAgentChatRequest {
  message: string;
  mode: "teacher" | "study-buddy";
  fieldOfStudy?: string;
  selectedDocuments?: string[];
  studyPlan?: StudyPlanItem[];
  conversationHistory?: ConversationMessage[];
}

export interface StudyAgentChatResponse {
  response: string;
  originalResponse: string;
  emotion: EmotionTag | null;
  mode: "teacher" | "study-buddy";
}

