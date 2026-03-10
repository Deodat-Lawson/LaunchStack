/**
 * Study Buddy Agentic Module
 * Main entry point for the agentic AI workflow
 */

// Types
export type {
  StudyMode,
  EmotionTag,
  AgentStep,
  ToolResult,
  RAGSearchResult,
  Flashcard,
  QuizQuestion,
  Quiz,
  ConceptExplanation,
  StudySession,
  StudyAgentRequest,
  StudyAgentResponse,
  RAGSearchInput,
  FlashcardGenerationInput,
  QuizGenerationInput,
  ConceptExplanationInput,
  StudyPlanInput,
  ProgressTrackingInput,
  // New types for tasks, pomodoro, and notes
  StudyTask,
  StudyTaskInput,
  PomodoroPhase,
  PomodoroSettings,
  PomodoroSession,
  PomodoroInput,
  StudyNote,
  NoteInput,
} from "./types";

// State
export {
  StudyAgentStateAnnotation,
  createInitialState,
  type StudyAgentState,
} from "./state";

// Graph
export { createStudyBuddyGraph, getStudyBuddyGraph } from "./graph";

// Orchestrator
export { runStudyBuddyAgent, streamStudyBuddyAgent } from "./orchestrator";

// HTTP helpers
export {
  parseIncomingStudyAgentPayload,
  buildAgentRequest,
  type IncomingStudyAgentPayload,
} from "./request";

// Tools
export {
  studyBuddyTools,
  toolRegistry,
  toolCategories,
  // Learning tools
  ragSearchTool,
  flashcardTool,
  quizTool,
  conceptExplainerTool,
  // Planning tools
  studyPlanTool,
  progressTrackerTool,
  // Productivity tools
  taskManagerTool,
  pomodoroTool,
  // Notes tools
  noteTakingTool,
  webResearchTool,
  // Tool execution functions
  executeRAGSearch,
  generateFlashcards,
  generateQuiz,
  explainConcept,
  createOrUpdateStudyPlan,
  trackProgress,
  performWebResearch,
  manageTasks,
  managePomodoro,
  manageNotes,
} from "./tools";

