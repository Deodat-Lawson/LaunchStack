/**
 * Study Buddy Agent Types
 * Role: shared type contracts for agent state, API IO, and tool payloads.
 * Purpose: keep all agentic shapes centralized so tools, nodes, and routes stay in sync.
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { RAGSearchInput, RAGSearchResult } from "~/lib/tools/rag/types";

export type { RAGSearchInput, RAGSearchResult };

// ============================================================================
// Core Agent Types
// ============================================================================

export type StudyMode = "teacher" | "study-buddy" | "quiz-master" | "coach";

export type EmotionTag =
  | "happy"
  | "sad"
  | "angry"
  | "fearful"
  | "surprised"
  | "disgusted"
  | "excited"
  | "calm"
  | "encouraging"
  | "curious";

export type AgentStep =
  | "understand"      // Understanding user intent
  | "plan"            // Planning the response strategy
  | "retrieve"        // Retrieving relevant information
  | "generate"        // Generating content (flashcards, quizzes, etc.)
  | "respond"         // Formulating the final response
  | "reflect";        // Reflecting on the interaction

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  toolName: string;
  executionTimeMs: number;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  documentReference?: {
    documentId: string;
    page: number;
  };
}

export interface QuizQuestion {
  id: string;
  question: string;
  type: "multiple-choice" | "true-false" | "short-answer" | "fill-blank";
  options?: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  points: number;
  documentReference?: {
    documentId: string;
    page: number;
  };
}

export interface Quiz {
  id: string;
  title: string;
  topic: string;
  questions: QuizQuestion[];
  totalPoints: number;
  estimatedTimeMinutes: number;
  createdAt: Date;
}

export interface ConceptExplanation {
  concept: string;
  simpleExplanation: string;
  detailedExplanation: string;
  analogy?: string;
  examples: string[];
  relatedConcepts: string[];
  prerequisites?: string[];
  commonMisconceptions?: string[];
}

export interface StudySession {
  id: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  mode: StudyMode;
  documentsStudied: string[];
  conceptsCovered: string[];
  quizzesTaken: string[];
  flashcardsReviewed: number;
  notes: string[];
  progressSummary?: string;
}

// ============================================================================
// Agent State Types
// ============================================================================

export interface StudyAgentState {
  // Core conversation
  messages: BaseMessage[];
  currentStep: AgentStep;
  
  // User context
  userId: string;
  mode: StudyMode;
  fieldOfStudy?: string;
  learningStyle?: "visual" | "auditory" | "kinesthetic" | "reading";
  preferredDifficulty?: "beginner" | "intermediate" | "advanced";
  
  // Document context
  selectedDocuments: string[];
  documentTitles: Map<string, string>;
  retrievedContext: RAGSearchResult[];
  
  // Study session context
  currentSession?: StudySession;
  
  // Generated content
  generatedFlashcards: Flashcard[];
  generatedQuizzes: Quiz[];
  conceptExplanations: ConceptExplanation[];
  
  // Tool execution tracking
  toolsUsed: string[];
  toolResults: ToolResult[];
  
  // Response metadata
  emotion: EmotionTag;
  confidence: number; // 0-1 scale
  shouldEndConversation: boolean;
  
  // Planning
  planningThoughts?: string;
  nextAction?: string;
  
  // Error handling
  error?: string;
  retryCount: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface StudyAgentRequest {
  message: string;
  mode: StudyMode;
  userId: string;
  sessionId: number;
  fieldOfStudy?: string;
  selectedDocuments?: string[];
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  preferences?: {
    learningStyle?: "visual" | "auditory" | "kinesthetic" | "reading";
    preferredDifficulty?: "beginner" | "intermediate" | "advanced";
    enableWebSearch?: boolean;
    responseLength?: "brief" | "moderate" | "detailed";
  };
}

export interface StudyAgentResponse {
  response: string;
  displayResponse: string;
  emotion: EmotionTag;
  mode: StudyMode;
  
  // Generated content (if any)
  flashcards?: Flashcard[];
  quiz?: Quiz;
  conceptExplanation?: ConceptExplanation;
  
  // Metadata
  toolsUsed: string[];
  retrievedSources: Array<{
    documentTitle: string;
    page: number;
  }>;
  confidence: number;
  processingTimeMs: number;
  
  // Suggestions for follow-up
  suggestedQuestions?: string[];
  relatedTopics?: string[];
}

// ============================================================================
// Tool Input Types
// ============================================================================

export interface FlashcardGenerationInput {
  topic: string;
  context: string;
  count: number;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
}

export interface QuizGenerationInput {
  topic: string;
  context: string;
  questionCount: number;
  questionTypes?: Array<"multiple-choice" | "true-false" | "short-answer" | "fill-blank">;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
}

export interface ConceptExplanationInput {
  concept: string;
  context?: string;
  targetAudience?: "beginner" | "intermediate" | "advanced";
  includeExamples?: boolean;
  includeAnalogy?: boolean;
}

export interface StudyPlanInput {
  goals: string[];
  availableTime: number; // in minutes
  topics: string[];
}

export interface ProgressTrackingInput {
  sessionId: string;
  action: "start" | "update" | "complete";
  data?: Partial<StudySession>;
}

// ============================================================================
// Study Task Types
// ============================================================================

export interface StudyTask {
  id: string;
  userId: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
  dueDate?: Date;
  estimatedMinutes?: number;
  actualMinutes?: number;
  tags: string[];
  relatedDocuments: string[];
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudyTaskInput {
  action: "create" | "update" | "delete" | "list" | "complete" | "get";
  taskId?: string;
  data?: {
    title?: string;
    description?: string;
    priority?: "high" | "medium" | "low";
    dueDate?: string;
    estimatedMinutes?: number;
    tags?: string[];
    relatedDocuments?: string[];
    status?: "pending" | "in_progress" | "completed" | "cancelled";
  };
  filters?: {
    status?: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: "high" | "medium" | "low";
    dueBefore?: string;
    dueAfter?: string;
  };
}

// ============================================================================
// Pomodoro Timer Types
// ============================================================================

export type PomodoroPhase = "work" | "short_break" | "long_break" | "idle";

export interface PomodoroSettings {
  workDuration: number;      // in minutes (default: 25)
  shortBreakDuration: number; // in minutes (default: 5)
  longBreakDuration: number;  // in minutes (default: 15)
  sessionsBeforeLongBreak: number; // (default: 4)
  autoStartBreaks: boolean;
  autoStartWork: boolean;
}

export interface PomodoroSession {
  id: string;
  userId: string;
  phase: PomodoroPhase;
  isRunning: boolean;
  isPaused: boolean;
  startedAt?: Date;
  pausedAt?: Date;
  endsAt?: Date;
  completedPomodoros: number;
  totalWorkMinutes: number;
  currentTaskId?: string;
  remainingSeconds: number;
  settings: PomodoroSettings;
}

export interface PomodoroInput {
  action: "start" | "pause" | "resume" | "stop" | "skip" | "status" | "configure";
  taskId?: string;
  phase?: PomodoroPhase;
  settings?: Partial<PomodoroSettings>;
}

// ============================================================================
// Note-taking Types
// ============================================================================

export interface StudyNote {
  id: number;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteInput {
  action: "create" | "update" | "delete" | "list" | "search" | "get" | "summarize";
  noteId?: string;
  data?: {
    title?: string;
    content?: string;
    format?: "text" | "markdown" | "bullet_points";
    tags?: string[];
    relatedDocuments?: string[];
    relatedConcepts?: string[];
    isFavorite?: boolean;
    isArchived?: boolean;
  };
  searchQuery?: string;
  filters?: {
    tags?: string[];
    isFavorite?: boolean;
    isArchived?: boolean;
    createdAfter?: string;
    createdBefore?: string;
  };
}

