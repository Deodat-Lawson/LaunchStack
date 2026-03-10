/**
 * Study Buddy Agent Orchestrator
 * Main service for running the agentic workflow
 *
 * MODS:
 * - Added inline “how orchestration works” comments + a lightweight trace object
 * - Actually uses suggestedQuestions + relatedTopics helpers in the response
 * - More explicit, structured logging + optional trace return
 * - Keeps core behavior the same (graph.invoke / graph.stream)
 */

import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { getStudyBuddyGraph } from "./graph";
import { createInitialState, type StudyAgentState } from "./state";
import type {
  StudyAgentRequest,
  StudyAgentResponse,
  EmotionTag,
} from "./types";

// ============================================================================
// Emotion Processing
// ============================================================================

/**
 * Emotion tags supported by ElevenLabs TTS
 */
const EMOTION_TAGS: EmotionTag[] = [
  "happy",
  "sad",
  "angry",
  "fearful",
  "surprised",
  "disgusted",
  "excited",
  "calm",
  "encouraging",
  "curious",
];

/**
 * Strip emotion tags from text for display
 */
function stripEmotionTags(text: string): string {
  let result = text;
  for (const tag of EMOTION_TAGS) {
    result = result.replace(new RegExp(`\\[${tag}\\]`, "gi"), "");
  }
  return result.trim();
}

/**
 * Add emotion tag to response for TTS
 */
function addEmotionTag(text: string, emotion: EmotionTag): string {
  // Check if already has emotion tag
  for (const tag of EMOTION_TAGS) {
    if (text.toLowerCase().includes(`[${tag}]`)) return text;
  }
  return `[${emotion}] ${text}`;
}

/**
 * Ensure trailing ellipses for natural TTS pauses
 */
function ensureTrailingEllipses(text: string): string {
  return text
    .replace(/\.(\s+)(?=[A-Z])/g, "...$1")
    .replace(/\?(\s+)(?=[A-Z])/g, "?...$1")
    .replace(/!(\s+)(?=[A-Z])/g, "!...$1");
}

// ============================================================================
// Orchestration Trace (optional, for debugging/observability)
// ============================================================================

type OrchestrationTrace = {
  startedAtMs: number;
  finishedAtMs?: number;
  mode: string;
  steps: Array<{
    atMs: number;
    type:
      | "init_state"
      | "build_messages"
      | "invoke_graph_start"
      | "invoke_graph_end"
      | "final_response"
      | "error";
    detail?: Record<string, unknown>;
  }>;
};

function newTrace(mode: string): OrchestrationTrace {
  return { startedAtMs: Date.now(), mode, steps: [] };
}

function traceStep(
  trace: OrchestrationTrace,
  type: OrchestrationTrace["steps"][number]["type"],
  detail?: Record<string, unknown>
) {
  trace.steps.push({ atMs: Date.now(), type, detail });
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Run the Study Buddy Agent workflow
 *
 * High-level orchestration:
 * 1) Compile/load the LangGraph (getStudyBuddyGraph)
 * 2) Build initial agent state (createInitialState)
 * 3) Build message history (conversationHistory + current message)
 * 4) Invoke the graph with { state + messages }, and pass userId via configurable
 * 5) Read final state + last message => response text
 * 6) Post-process for UI + TTS (emotion tags + ellipses)
 * 7) Return structured response metadata (toolsUsed, sources, confidence, etc.)
 */
export async function runStudyBuddyAgent(
  request: StudyAgentRequest,
  opts?: { includeTrace?: boolean }
): Promise<StudyAgentResponse & { trace?: OrchestrationTrace }> {
  const startTime = Date.now();
  const trace = newTrace(request.mode);

  console.log("🚀 [Study Buddy Agent] Starting workflow...");
  console.log(`   Mode: ${request.mode}`);
  console.log(`   User ID: ${request.userId}`);
  console.log(`   Documents: ${request.selectedDocuments?.length ?? 0}`);
  console.log(`   Message: ${request.message.substring(0, 100)}...`);

  try {
    // 1) Graph compilation/loading
    //    - getStudyBuddyGraph typically builds a LangGraph/StateGraph with nodes:
    //      retrieve -> reason -> tool calls -> synthesize -> finalize (example)
    const graph = getStudyBuddyGraph();

    // 2) Initial state construction
    //    - this is the “working memory” for the whole run
    //    - includes mode, user prefs, retrieved context placeholders, generated assets, etc.
    const initialState = createInitialState(request.userId, request.mode, {
      fieldOfStudy: request.fieldOfStudy,
      selectedDocuments: request.selectedDocuments,
      learningStyle: request.preferences?.learningStyle,
      preferredDifficulty: request.preferences?.preferredDifficulty,
      sessionId: request.sessionId,
    });

    traceStep(trace, "init_state", {
      fieldOfStudy: request.fieldOfStudy,
      selectedDocumentsCount: request.selectedDocuments?.length ?? 0,
      learningStyle: request.preferences?.learningStyle,
      preferredDifficulty: request.preferences?.preferredDifficulty,
    });

    // 3) Message history (short context window)
    const messages: Array<HumanMessage | AIMessage> = [];

    if (request.conversationHistory) {
      // Keep last 10 to control token usage and reduce drift
      for (const msg of request.conversationHistory.slice(-10)) {
        messages.push(
          msg.role === "user"
            ? new HumanMessage(msg.content)
            : new AIMessage(msg.content)
        );
      }
    }

    // Always add the current user message at the end
    messages.push(new HumanMessage(request.message));

    traceStep(trace, "build_messages", {
      historyIncluded: Boolean(request.conversationHistory?.length),
      messagesCount: messages.length,
    });

    // 4) Graph invocation
    //    - graph.invoke executes the whole workflow until it reaches an END node
    //    - configurable.userId is a common LangChain pattern for per-user tool config,
    //      memory scoping, or tracing
    traceStep(trace, "invoke_graph_start");

    const result = await graph.invoke(
      {
        ...initialState,
        messages,
      },
      {
        configurable: {
          userId: request.userId,
        },
      }
    );

    traceStep(trace, "invoke_graph_end");

    // 5) Extract final response from the final state
    const finalState = result;
    const lastMessage = finalState.messages[finalState.messages.length - 1];

    const rawResponseText =
      typeof lastMessage?.content === "string"
        ? lastMessage.content
        : extractTextFromContent(lastMessage?.content);

    // 6) Post-process response for UI + TTS
    const displayResponse = stripEmotionTags(rawResponseText);
    const ttsResponse = ensureTrailingEllipses(
      addEmotionTag(rawResponseText, finalState.emotion)
    );

    // Optional “extra UX” fields using your helpers
    const suggestedQuestions = generateSuggestedQuestions(
      request.message,
      finalState
    );
    const relatedTopics = extractRelatedTopics(finalState);

    // 7) Build response object
    const response: StudyAgentResponse & { trace?: OrchestrationTrace } = {
      response: ttsResponse,
      displayResponse,
      emotion: finalState.emotion,
      mode: request.mode,

      // Metadata
      toolsUsed: finalState.toolsUsed,
      retrievedSources: finalState.retrievedContext.map((ctx) => ({
        documentTitle: ctx.documentTitle,
        page: ctx.page,
      })),
      confidence: finalState.confidence,
      processingTimeMs: Date.now() - startTime,

      // If your StudyAgentResponse type doesn’t include these, remove them
      // or extend the type. They’re very useful in a UI.
      ...(suggestedQuestions.length ? { suggestedQuestions } : {}),
      ...(relatedTopics.length ? { relatedTopics } : {}),

      ...(opts?.includeTrace ? { trace } : {}),
    };

    traceStep(trace, "final_response", {
      emotion: response.emotion,
      toolsUsed: response.toolsUsed,
      retrievedSourcesCount: response.retrievedSources.length,
      confidence: response.confidence,
    });
    trace.finishedAtMs = Date.now();

    console.log(
      `✅ [Study Buddy Agent] Completed in ${response.processingTimeMs}ms`
    );
    console.log(`   Tools used: ${response.toolsUsed.join(", ") || "none"}`);
    console.log(`   Emotion: ${response.emotion}`);

    return response;
  } catch (error) {
    console.error("❌ [Study Buddy Agent] Error:", error);

    traceStep(trace, "error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    trace.finishedAtMs = Date.now();

    return {
      response:
        "[calm] I encountered an issue processing your request... Let me try again in a moment...",
      displayResponse:
        "I encountered an issue processing your request. Let me try again in a moment.",
      emotion: "calm",
      mode: request.mode,
      toolsUsed: [],
      retrievedSources: [],
      confidence: 0.3,
      processingTimeMs: Date.now() - startTime,
      ...(opts?.includeTrace ? { trace } : {}),
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const textItem = item as { text: unknown };
          return String(textItem.text);
        }
        return "";
      })
      .join("");
  }

  if (content && typeof content === "object" && "text" in content) {
    const textContent = content as { text: unknown };
    return String(textContent.text);
  }

  return "";
}

/**
 * Generate suggested follow-up questions
 */
function generateSuggestedQuestions(
  userMessage: string,
  state: StudyAgentState
): string[] {
  const suggestions: string[] = [];
  const lowerMessage = userMessage.toLowerCase();

  if (state.generatedFlashcards.length > 0) {
    suggestions.push("Quiz me on these flashcards!");
    suggestions.push("Can you make more flashcards on a related topic?");
  }

  if (state.generatedQuizzes.length > 0) {
    suggestions.push("Explain the answers to the quiz questions");
    suggestions.push("Create a harder quiz on this topic");
  }

  if (state.conceptExplanations.length > 0) {
    const lastConcept =
      state.conceptExplanations[state.conceptExplanations.length - 1];
    if (lastConcept?.relatedConcepts && lastConcept.relatedConcepts.length > 0) {
      suggestions.push(`Explain ${lastConcept.relatedConcepts[0]} to me`);
    }
    suggestions.push("Can you give me more examples?");
  }

  if (state.mode === "study-buddy") {
    if (!lowerMessage.includes("flashcard")) {
      suggestions.push("Create flashcards for this topic");
    }
    if (!lowerMessage.includes("quiz")) {
      suggestions.push("Test my understanding with a quick quiz");
    }
  }

  if (state.mode === "teacher") {
    suggestions.push("Can you explain this in simpler terms?");
    suggestions.push("What are the key takeaways?");
  }

  return suggestions.slice(0, 3);
}

/**
 * Extract related topics from generated content
 */
function extractRelatedTopics(state: StudyAgentState): string[] {
  const topics = new Set<string>();

  for (const explanation of state.conceptExplanations) {
    for (const related of explanation.relatedConcepts ?? []) {
      topics.add(related);
    }
  }

  for (const card of state.generatedFlashcards) {
    if (card.topic) topics.add(card.topic);
  }

  for (const quiz of state.generatedQuizzes) {
    for (const question of quiz.questions) {
      if (question.topic) topics.add(question.topic);
    }
  }

  return Array.from(topics).slice(0, 5);
}

// ============================================================================
// Streaming Support (Future Enhancement)
// ============================================================================

/**
 * Run the Study Buddy Agent with streaming support
 * Returns an async generator for streaming responses
 */
export async function* streamStudyBuddyAgent(
  request: StudyAgentRequest
): AsyncGenerator<{
  type: "thinking" | "tool_start" | "tool_end" | "response" | "complete";
  data: unknown;
}> {
  const startTime = Date.now();

  yield {
    type: "thinking",
    data: { step: "understanding", message: "Analyzing your request..." },
  };

  try {
    const graph = getStudyBuddyGraph();

    const initialState = createInitialState(request.userId, request.mode, {
      fieldOfStudy: request.fieldOfStudy,
      selectedDocuments: request.selectedDocuments,
      sessionId: request.sessionId,
    });

    const messages = [new HumanMessage(request.message)];

    // graph.stream emits intermediate states as the graph progresses node-by-node
    const stream = await graph.stream(
      { ...initialState, messages },
      {
        configurable: { userId: request.userId },
        streamMode: "values",
      }
    );

    let lastState: StudyAgentState | null = null;
    let sawRetrieveStart = false;

    for await (const state of stream) {
      lastState = state;
      const typedState = state;

      // Example: emit tool start when we enter retrieve step
      if (typedState.currentStep === "retrieve" && !sawRetrieveStart) {
        sawRetrieveStart = true;
        yield {
          type: "tool_start",
          data: { tool: "rag_search", message: "Searching documents..." },
        };
      }

      // Example: emit tool end whenever we have tool usage updates
      if (typedState.toolsUsed.length > 0) {
        yield {
          type: "tool_end",
          data: {
            tools: typedState.toolsUsed,
            results: typedState.toolResults.length,
          },
        };
      }
    }

    if (lastState) {
      const lastMessage = lastState.messages[lastState.messages.length - 1];
      const responseText =
        typeof lastMessage?.content === "string"
          ? lastMessage.content
          : extractTextFromContent(lastMessage?.content);

      yield {
        type: "response",
        data: {
          text: stripEmotionTags(responseText),
          emotion: lastState.emotion,
        },
      };
    }

    yield {
      type: "complete",
      data: { processingTimeMs: Date.now() - startTime },
    };
  } catch (error) {
    yield {
      type: "complete",
      data: {
        error: error instanceof Error ? error.message : "Unknown error",
        processingTimeMs: Date.now() - startTime,
      },
    };
  }
}
