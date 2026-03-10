/**
 * Graph Nodes Module
 * Role: LangGraph node implementations (understand → plan → agent → tools → respond).
 * Purpose: define the stepwise agent behavior and routing logic in the compiled graph.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  SystemMessage,
  HumanMessage,
  type AIMessage,
  type BaseMessage,
} from "@langchain/core/messages";

import type { StudyAgentState } from "./state";
import { studyBuddyTools } from "./tools";
import { detectIntent } from "./intent-detection";
import { getSystemPrompt, detectEmotion } from "./prompts";

// ============================================================================
// Tool Node
// ============================================================================

/**
 * Tool execution node (pre-built from LangGraph)
 */
export const toolNode = new ToolNode(studyBuddyTools);

// ============================================================================
// Understand Node
// ============================================================================

/**
 * Understand Node: Analyze user intent and determine next action
 */
export async function understandNode(
  state: StudyAgentState
): Promise<Partial<StudyAgentState>> {
  console.log("🧠 [Understand Node] Analyzing user intent...");

  const lastMessage = state.messages[state.messages.length - 1];
  const rawUserMessage =
    typeof lastMessage?.content === "string" ? lastMessage.content : "";

  const { userIntent, nextAction } = detectIntent(
    rawUserMessage,
    state.selectedDocuments.length > 0
  );

  return {
    currentStep: "plan",
    userIntent,
    nextAction,
    planningThoughts: `User intent: ${userIntent}. Next action: ${nextAction}.`,
  };
}

// ============================================================================
// Plan Node
// ============================================================================

/**
 * Plan Node: Create execution plan based on intent
 */
export async function planNode(
  state: StudyAgentState
): Promise<Partial<StudyAgentState>> {
  console.log(`📋 [Plan Node] Planning for intent: ${state.userIntent}`);

  const toolsToUse: string[] = [];

  switch (state.userIntent) {
    case "create_study_plan":
      toolsToUse.push("create_study_plan");
      break;

    case "web_research":
      toolsToUse.push("web_research");
      break;

    case "document_question":
      toolsToUse.push("rag_search");
      break;

    case "track_progress":
      toolsToUse.push("track_progress");
      break;

    case "manage_tasks":
      toolsToUse.push("manage_tasks");
      break;

    case "pomodoro_timer":
      toolsToUse.push("pomodoro_timer");
      break;

    case "take_notes":
      toolsToUse.push("take_notes");
      break;

    default:
      if (state.selectedDocuments.length > 0) toolsToUse.push("rag_search");
  }

  return {
    currentStep: state.nextAction === "retrieve" ? "retrieve" : "generate",
    toolsUsed: toolsToUse,
    planningThoughts: `Planned tools: ${toolsToUse.join(", ") || "none (direct response)"}`,
  };
}

// ============================================================================
// Agent Node
// ============================================================================

/**
 * Build a tool instruction message based on planned tools
 */
function buildToolInstructionMessage(state: StudyAgentState): string | null {
  const plannedTools = state.toolsUsed;
  const userMessage = state.messages[state.messages.length - 1];
  const messageText =
    typeof userMessage?.content === "string"
      ? userMessage.content.toLowerCase()
      : "";

  if (plannedTools.includes("pomodoro_timer")) {
    let action = "status";
    if (
      messageText.includes("start") ||
      messageText.includes("begin") ||
      messageText.includes("let's focus")
    ) {
      action = "start";
    } else if (
      messageText.includes("pause") ||
      messageText.includes("hold")
    ) {
      action = "pause";
    } else if (
      messageText.includes("resume") ||
      messageText.includes("continue")
    ) {
      action = "resume";
    } else if (
      messageText.includes("stop") ||
      messageText.includes("end") ||
      messageText.includes("finish")
    ) {
      action = "stop";
    } else if (messageText.includes("skip")) {
      action = "skip";
    } else if (
      messageText.includes("time left") ||
      messageText.includes("how much") ||
      messageText.includes("status")
    ) {
      action = "status";
    } else if (
      messageText.includes("configure") ||
      messageText.includes("set") ||
      messageText.includes("change")
    ) {
      action = "configure";
    }

    return `IMPORTANT: You MUST use the pomodoro_timer tool to handle this request.
The user wants to ${action} their Pomodoro timer.
Call the pomodoro_timer tool with:
- action: "${action}"
- userId: "${state.userId}"

After calling the tool, respond with the result in an encouraging way.`;
  }

  if (plannedTools.includes("manage_tasks")) {
    let action = "list";
    if (
      messageText.includes("add") ||
      messageText.includes("create") ||
      messageText.includes("new")
    ) {
      action = "create";
    } else if (
      messageText.includes("complete") ||
      messageText.includes("done") ||
      messageText.includes("finish")
    ) {
      action = "complete";
    } else if (
      messageText.includes("delete") ||
      messageText.includes("remove")
    ) {
      action = "delete";
    } else if (
      messageText.includes("update") ||
      messageText.includes("edit") ||
      messageText.includes("change")
    ) {
      action = "update";
    }

    return `IMPORTANT: You MUST use the manage_tasks tool to handle this request.
The user wants to ${action} tasks.
Call the manage_tasks tool with:
- action: "${action}"
- userId: "${state.userId}"

Extract any task title, description, priority, or due date from the user's message.
After calling the tool, respond with the result in an encouraging way.`;
  }

  if (plannedTools.includes("take_notes")) {
    // Only create + update supported
    let action: "create" | "update" = "create";
    if (
      messageText.includes("update") ||
      messageText.includes("edit") ||
      messageText.includes("change")
    ) {
      action = "update";
    }

    return `IMPORTANT: You MUST use the take_notes tool to handle this request.
Only supported note actions are: "create" and "update".
Call the take_notes tool with:
- action: "${action}"
- userId: "${state.userId}"
- sessionId: "${state.sessionId ?? ""}"

Extract any note content, title, or tags from the user's message.
After calling the tool, respond with the result in an encouraging way.`;
  }

  return null;
}

/**
 * Agent Node: Run the LLM with tools to process the request
 */
export async function agentNode(
  state: StudyAgentState
): Promise<Partial<StudyAgentState>> {
  console.log(`🤖 [Agent Node] Processing with mode: ${state.mode}`);
  console.log(`   Planned tools: ${state.toolsUsed.join(", ") || "none"}`);
  console.log(`   User intent: ${state.userIntent}`);

  const model = new ChatOpenAI({
    modelName: "gpt-5.2",
    temperature: 0.7,
    timeout: 60000,
  }).bindTools(studyBuddyTools);

  const systemPrompt = getSystemPrompt(state.mode, state);

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...state.messages,
  ];

  if (state.formattedContext) {
    messages.push(
      new HumanMessage(
        `[Context from documents]\n${state.formattedContext}\n\n[End of context]`
      )
    );
  }

  if (state.toolsUsed.length > 0) {
    const toolInstructionMessage = buildToolInstructionMessage(state);
    if (toolInstructionMessage) {
      messages.push(new SystemMessage(toolInstructionMessage));
    }
  }

  const response = await model.invoke(messages, {
    configurable: { userId: state.userId },
  });

  return {
    messages: [response],
    currentStep: "respond",
  };
}

// ============================================================================
// Respond Node
// ============================================================================

/**
 * Respond Node: Format the final response
 */
export async function respondNode(
  state: StudyAgentState
): Promise<Partial<StudyAgentState>> {
  console.log("💬 [Respond Node] Formatting final response...");

  const lastMessage = state.messages[state.messages.length - 1];
  const content =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? "");

  const emotion = detectEmotion(content, state.mode);

  let flashcards = state.generatedFlashcards;
  let quizzes = state.generatedQuizzes;
  let explanations = state.conceptExplanations;

  for (const result of state.toolResults) {
    if (result.toolName === "generate_flashcards" && result.data) {
      const data = result.data as { flashcards?: typeof flashcards };
      if (data.flashcards) {
        flashcards = [...flashcards, ...data.flashcards];
      }
    }
    if (result.toolName === "generate_quiz" && result.data) {
      const data = result.data as { quiz?: (typeof quizzes)[0] };
      if (data.quiz) {
        quizzes = [...quizzes, data.quiz];
      }
    }
    if (result.toolName === "explain_concept" && result.data) {
      const data = result.data as { explanation?: (typeof explanations)[0] };
      if (data.explanation) {
        explanations = [...explanations, data.explanation];
      }
    }
  }

  return {
    currentStep: "respond",
    emotion,
    generatedFlashcards: flashcards,
    generatedQuizzes: quizzes,
    conceptExplanations: explanations,
    shouldContinue: false,
    confidence: 0.85,
  };
}

// ============================================================================
// Routing Functions
// ============================================================================

/**
 * Determine if we should continue to tools or end
 */
export function shouldContinue(state: StudyAgentState): string {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage && "tool_calls" in lastMessage) {
    const toolCalls = (lastMessage as AIMessage).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      console.log(
        `🔧 [Router] Tool calls detected: ${toolCalls.map((t) => t.name).join(", ")}`
      );
      return "tools";
    }
  }

  return "respond";
}

