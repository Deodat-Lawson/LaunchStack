/**
 * Intent Detection Module
 * Role: infer user intent/next action from text signals to pick the right tools.
 * Purpose: lightweight routing brain before the graph plans and executes steps.
 */

// ============================================================================
// Types
// ============================================================================

export type DetectedIntent =
  | "general_question"
  | "create_flashcards"
  | "create_quiz"
  | "explain_concept"
  | "create_study_plan"
  | "web_research"
  | "document_question"
  | "track_progress"
  | "manage_tasks"
  | "pomodoro_timer"
  | "take_notes";

export type NextAction = "respond" | "retrieve" | "generate";

export interface IntentResult {
  userIntent: DetectedIntent;
  nextAction: NextAction;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize text for intent matching
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if text contains any of the given patterns
 */
export function hasAny(text: string, needles: Array<string | RegExp>): boolean {
  return needles.some((n) =>
    n instanceof RegExp ? n.test(text) : text.includes(n)
  );
}

// ============================================================================
// Intent Signal Definitions
// ============================================================================

const POMODORO_SIGNALS: Array<string | RegExp> = [
  "pomodoro",
  /focus (session|time)/,
  /study (session|sprint)/,
  "start the timer",
  "stop the timer",
  "time left",
  /how much time( is)? left/,
  "take a break",
  "short break",
  "long break",
  "resume",
  "pause",
];

const TASK_SIGNALS: Array<string | RegExp> = [
  "task",
  "tasks",
  "todo",
  "to-do",
  "to do",
  "checklist",
  "assignment",
  "homework",
  "mark as done",
  "mark done",
  "complete",
  "completed",
  "what do i need to",
  "what should i do next",
];

const TASK_ACTION_SIGNALS: Array<string | RegExp> = [
  /add( a| an)?/,
  "create",
  "make",
  "update",
  "edit",
  "change",
  "delete",
  "remove",
  "list",
  "show",
];

const NOTE_SIGNALS: Array<string | RegExp> = [
  "note",
  "notes",
  "write down",
  "jot down",
  "save this",
  "remember this",
  "add to my notes",
  "my notes",
  /study note(s)?/,
];

const NOTE_ACTION_SIGNALS: Array<string | RegExp> = [
  "take",
  "add",
  "create",
  "make",
  "update",
  "edit",
  "change",
  "show",
  "summarize",
];

const PLAN_SIGNALS: Array<string | RegExp> = [
  "study plan",
  "study schedule",
  "learning schedule",
  "study goal",
  "study goals",
  "organize my study",
  "organise my study",
  "make a plan",
  "plan my study",
  "study roadmap",
  "revision plan",
  "learning plan",
];

const PROGRESS_SIGNALS: Array<string | RegExp> = [
  "my progress",
  "how am i doing",
  "session summary",
  "what did we cover",
  "recap",
  "summary of today",
  "stats",
  "streak",
];

const RESEARCH_SIGNALS: Array<string | RegExp> = [
  "research",
  "find information",
  "look up",
  "search for",
  "google",
  "online",
  "on the web",
  "sources",
  "citations",
];

const DOCUMENT_SIGNALS: Array<string | RegExp> = [
  "in the document",
  "in my document",
  "from my notes",
  "according to",
  "based on the pdf",
  "in the slides",
  "in the lecture notes",
  "in my uploaded",
  "in the reading",
  "from the paper",
];

// ============================================================================
// Main Intent Detection
// ============================================================================

/**
 * Detect user intent from a message
 */
export function detectIntent(
  userMessageRaw: string,
  hasSelectedDocs: boolean
): IntentResult {
  const msg = normalize(userMessageRaw);

  // 1) Pomodoro (specific beats generic)
  const timerIsPomodoro =
    hasAny(msg, POMODORO_SIGNALS) ||
    (msg.includes("timer") &&
      hasAny(msg, ["focus", "study", "pomodoro", "break"]));

  if (timerIsPomodoro) {
    return { userIntent: "pomodoro_timer", nextAction: "generate" };
  }

  // 2) Task management (require task-ish + action-ish)
  if (hasAny(msg, TASK_SIGNALS) && hasAny(msg, TASK_ACTION_SIGNALS)) {
    return { userIntent: "manage_tasks", nextAction: "generate" };
  }

  // 3) Notes (avoid "note that ..." rhetorical)
  const rhetoricalNoteThat = msg.startsWith("note that ");
  if (
    !rhetoricalNoteThat &&
    hasAny(msg, NOTE_SIGNALS) &&
    hasAny(msg, NOTE_ACTION_SIGNALS)
  ) {
    return { userIntent: "take_notes", nextAction: "generate" };
  }

  // 4) Study plan / schedule / goals
  if (hasAny(msg, PLAN_SIGNALS)) {
    return { userIntent: "create_study_plan", nextAction: "generate" };
  }

  // 5) Progress
  if (hasAny(msg, PROGRESS_SIGNALS)) {
    return { userIntent: "track_progress", nextAction: "respond" };
  }

  // 6) Web research (explicit)
  if (hasAny(msg, RESEARCH_SIGNALS)) {
    return { userIntent: "web_research", nextAction: "retrieve" };
  }

  // 7) Document question (ONLY if user indicates doc usage)
  if (hasSelectedDocs && hasAny(msg, DOCUMENT_SIGNALS)) {
    return { userIntent: "document_question", nextAction: "retrieve" };
  }

  return { userIntent: "general_question", nextAction: "respond" };
}

