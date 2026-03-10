/**
 * Study Buddy Agent Tools Index
 * Centralizes tool registration to keep graph setup simple.
 */

import { ragSearchTool, executeRAGSearch } from "~/lib/tools/rag/agentic";
import { webResearchTool, performWebResearch } from "./web-research";
import { flashcardTool, generateFlashcards } from "./UNUSED_flashcard-generator";
import { quizTool, generateQuiz } from "./UNUSED_quiz-generator";
import {
  conceptExplainerTool,
  explainConcept,
} from "./UNUSED_concept-explainer";
import { studyPlanTool, createOrUpdateStudyPlan } from "./UNUSED_study-plan";
import { progressTrackerTool, trackProgress } from "./UNUSED_progress-tracker";
import { taskManagerTool, manageTasks } from "./UNUSED_task-manager";
import { pomodoroTool, managePomodoro } from "./pomodoro-timer";
import { noteTakingTool, manageNotes } from "./note-taking";

// Group tools by concern to keep registry legible.
const learningTools = [ragSearchTool, flashcardTool, quizTool, conceptExplainerTool];
const planningTools = [studyPlanTool, progressTrackerTool];
const productivityTools = [taskManagerTool, pomodoroTool];
const notesAndResearchTools = [noteTakingTool, webResearchTool];

/**
 * All available tools for the Study Buddy Agent.
 * NOTE: Some tools still live in `UNUSED_*` files; confirm before removing them.
 */
export const studyBuddyTools = [
  ...learningTools,
  ...planningTools,
  ...productivityTools,
  ...notesAndResearchTools,
];

/**
 * Tool registry for quick lookup.
 */
export const toolRegistry = new Map(
  studyBuddyTools.map((tool) => [tool.name, tool])
);

/**
 * Tool categories for organization and UI display.
 */
export const toolCategories = {
  learning: learningTools.map((tool) => tool.name),
  planning: planningTools.map((tool) => tool.name),
  productivity: productivityTools.map((tool) => tool.name),
  notes: notesAndResearchTools.map((tool) => tool.name),
};

// Re-export individual tools and helper functions for callers that need them.
export {
  ragSearchTool,
  executeRAGSearch,
  webResearchTool,
  performWebResearch,
  flashcardTool,
  generateFlashcards,
  quizTool,
  generateQuiz,
  conceptExplainerTool,
  explainConcept,
  studyPlanTool,
  createOrUpdateStudyPlan,
  progressTrackerTool,
  trackProgress,
  taskManagerTool,
  manageTasks,
  pomodoroTool,
  managePomodoro,
  noteTakingTool,
  manageNotes,
};
