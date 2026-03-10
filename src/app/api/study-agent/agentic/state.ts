/**
 * Study Buddy Agent State Management
 * Role: define the annotated state schema flowing through the LangGraph.
 * Purpose: centralize agent memory shapes (messages, context, tools, planning).
 */

import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type {
  StudyMode,
  EmotionTag,
  AgentStep,
  ToolResult,
  RAGSearchResult,
  Flashcard,
  Quiz,
  ConceptExplanation,
  StudySession,
} from "./types";

/**
 * The main state annotation for the Study Buddy Agent graph.
 * This defines all the state that flows through the agent workflow.
 */
export const StudyAgentStateAnnotation = Annotation.Root({
  // ============================================================================
  // Core Conversation State
  // ============================================================================
  
  /**
   * The conversation message history.
   * Uses the messagesStateReducer to properly merge new messages.
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * Current step in the agent workflow
   */
  currentStep: Annotation<AgentStep>({
    reducer: (_, y) => y,
    default: () => "understand",
  }),

  // ============================================================================
  // User Context
  // ============================================================================

  /**
   * The authenticated user's ID
   */
  userId: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  /**
   * The current study mode
   */
  mode: Annotation<StudyMode>({
    reducer: (_, y) => y,
    default: () => "study-buddy",
  }),

  /**
   * User's field of study (e.g., "Computer Science", "Biology")
   */
  fieldOfStudy: Annotation<string | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  /**
   * User's preferred learning style
   */
  learningStyle: Annotation<"visual" | "auditory" | "kinesthetic" | "reading" | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  /**
   * User's preferred difficulty level
   */
  preferredDifficulty: Annotation<"beginner" | "intermediate" | "advanced" | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  // ============================================================================
  // Document Context
  // ============================================================================

  /**
   * IDs of documents the user has selected for this study session
   */
  selectedDocuments: Annotation<string[]>({
    reducer: (x, y) => [...new Set([...x, ...y])], // Merge unique
    default: () => [],
  }),

  /**
   * Map of document IDs to their titles
   */
  documentTitles: Annotation<Record<string, string>>({
    reducer: (x, y) => ({ ...x, ...y }), // Merge maps
    default: () => ({}),
  }),

  /**
   * Retrieved document context from RAG search
   */
  retrievedContext: Annotation<RAGSearchResult[]>({
    reducer: (_, y) => y, // Replace with new context
    default: () => [],
  }),

  /**
   * Formatted context string for prompt injection
   */
  formattedContext: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  // ============================================================================
  // Study Session Context
  // ============================================================================

  /**
   * Current active study session
   */
  currentSession: Annotation<StudySession | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  /**
   * Session ID provided by the caller (frontend/api), used by tools
   */
  sessionId: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),

  // ============================================================================
  // Generated Content
  // ============================================================================

  /**
   * Flashcards generated during this session
   */
  generatedFlashcards: Annotation<Flashcard[]>({
    reducer: (x, y) => [...x, ...y], // Accumulate flashcards
    default: () => [],
  }),

  /**
   * Quizzes generated during this session
   */
  generatedQuizzes: Annotation<Quiz[]>({
    reducer: (x, y) => [...x, ...y], // Accumulate quizzes
    default: () => [],
  }),

  /**
   * Concept explanations provided during this session
   */
  conceptExplanations: Annotation<ConceptExplanation[]>({
    reducer: (x, y) => [...x, ...y], // Accumulate explanations
    default: () => [],
  }),

  // ============================================================================
  // Tool Execution Tracking
  // ============================================================================

  /**
   * List of tools used in this turn
   */
  toolsUsed: Annotation<string[]>({
    reducer: (x, y) => [...new Set([...x, ...y])], // Merge unique
    default: () => [],
  }),

  /**
   * Results from tool executions
   */
  toolResults: Annotation<ToolResult[]>({
    reducer: (x, y) => [...x, ...y], // Accumulate results
    default: () => [],
  }),

  // ============================================================================
  // Response Metadata
  // ============================================================================

  /**
   * Current emotional tone for TTS
   */
  emotion: Annotation<EmotionTag>({
    reducer: (_, y) => y,
    default: () => "calm",
  }),

  /**
   * Confidence level in the response (0-1)
   */
  confidence: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0.8,
  }),

  /**
   * Whether to end the conversation turn
   */
  shouldContinue: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => true,
  }),

  // ============================================================================
  // Planning & Reasoning
  // ============================================================================

  /**
   * Agent's internal planning thoughts
   */
  planningThoughts: Annotation<string | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  /**
   * Determined next action to take
   */
  nextAction: Annotation<string | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  /**
   * User intent extracted from the message
   */
  userIntent: Annotation<string | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  // ============================================================================
  // Error Handling
  // ============================================================================

  /**
   * Current error message if any
   */
  error: Annotation<string | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  /**
   * Number of retries attempted
   */
  retryCount: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
});

/**
 * Type for the complete agent state
 */
export type StudyAgentState = typeof StudyAgentStateAnnotation.State;

/**
 * Helper to create initial state from a request
 */
export function createInitialState(
  userId: string,
  mode: StudyMode,
  options?: {
    fieldOfStudy?: string;
    selectedDocuments?: string[];
    learningStyle?: "visual" | "auditory" | "kinesthetic" | "reading";
    preferredDifficulty?: "beginner" | "intermediate" | "advanced";
    sessionId: number;
  }
): Partial<StudyAgentState> {
  return {
    userId,
    mode,
    fieldOfStudy: options?.fieldOfStudy,
    selectedDocuments: options?.selectedDocuments ?? [],
    learningStyle: options?.learningStyle,
    preferredDifficulty: options?.preferredDifficulty,
    sessionId: options?.sessionId,
    currentStep: "understand",
    emotion: "calm",
    confidence: 0.8,
    shouldContinue: true,
    retryCount: 0,
    messages: [],
    toolsUsed: [],
    toolResults: [],
    retrievedContext: [],
    generatedFlashcards: [],
    generatedQuizzes: [],
    conceptExplanations: [],
  };
}

