/**
 * Study Agent Chat API
 * Role: handle chat requests; route to agentic workflow when tool-like triggers appear.
 * Purpose: provide friendly responses with optional RAG and emotion-aware TTS scripts.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";

import type { EmotionTag } from "./types";
import {
  detectEmotion,
  startsWithEmotionTag,
  hasAnyEmotionTag,
  extractFirstEmotionTag,
  stripEmotionTags,
} from "./emotion";
import { ensureTrailingEllipses, extractTextContent } from "./utils";
import { getSystemPrompt } from "./prompts";
import { parseChatRequest } from "./request";
import {
  multiDocEnsembleSearch,
  validateDocumentAccess,
  formatResultsForPrompt,
} from "~/lib/tools/rag";
import { runStudyBuddyAgent } from "../agentic/orchestrator";
import type { StudyMode } from "../agentic/types";

// Keywords that trigger the agentic workflow
const AGENTIC_TRIGGERS = [
  // Task management
  "task", "todo", "to-do", "to do", "add a", "create a task", "mark as done",
  "complete the", "my tasks", "what do i need", "finish", "finished",
  // Pomodoro timer - expanded triggers
  "pomodoro", "timer", "focus session", "start studying", "take a break",
  "pause", "resume", "how much time", "time left", "stop timer", "skip break",
  "start a timer", "start the timer", "stop the timer", "pause the timer",
  "start a pomodoro", "start pomodoro", "begin a pomodoro", "start focus",
  "let's focus", "let me focus", "focus time", "study session",
  // Note-taking
  "note", "write down", "remember this", "jot down", "save this", "my notes",
  "find my", "search notes", "take a note", "add a note",
];

// Research keywords for detecting research-type questions
const RESEARCH_KEYWORDS = [
  "research",
  "find",
  "learn about",
  "explore",
  "discover",
  "what is",
  "tell me about",
  "information about",
];

// Introduction keywords
const INTRO_KEYWORDS = ["introduce", "discuss the study materials", "study plan"];

/**
 * Check if message should use agentic workflow
 */
function shouldUseAgenticWorkflow(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return AGENTIC_TRIGGERS.some((trigger) => lowerMessage.includes(trigger));
}

/**
 * Process and normalize AI response for TTS
 */
function processResponseForTTS(rawScript: string): {
  scriptForTTS: string;
  displayScript: string;
  emotion: EmotionTag | null;
} {
  let scriptForTTS = ensureTrailingEllipses(rawScript.trim());

  const scriptHasAnyTag = hasAnyEmotionTag(scriptForTTS);
  const scriptStartsWithTag = startsWithEmotionTag(scriptForTTS);

  let emotion: EmotionTag | null = null;

  if (scriptStartsWithTag) {
    emotion = extractFirstEmotionTag(scriptForTTS);
  } else {
    const detected = detectEmotion(scriptForTTS) ?? "calm";
    emotion = detected;
    scriptForTTS = `[${detected}] ${scriptForTTS}`;
  }

  if (scriptHasAnyTag && !scriptStartsWithTag && !startsWithEmotionTag(scriptForTTS)) {
    scriptForTTS = `[calm] ${scriptForTTS}`;
    emotion = emotion ?? "calm";
  }

  scriptForTTS = ensureTrailingEllipses(scriptForTTS);
  const displayScript = stripEmotionTags(scriptForTTS);

  return { scriptForTTS, displayScript, emotion };
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsedBody = parseChatRequest(await request.json());
    const {
      message,
      mode,
      fieldOfStudy,
      selectedDocuments,
      studyPlan,
      conversationHistory,
      sessionId,
    } =
      parsedBody;

    console.log("💬 [StudyAgent Chat API] Received request:");
    console.log("   Message:", message);
    console.log("   Mode:", mode);
    console.log("   Field of Study:", fieldOfStudy);
    console.log("   Selected Documents:", selectedDocuments?.length ?? 0);
    console.log("   Study Plan Items:", studyPlan?.length ?? 0);
    console.log("   Conversation History:", conversationHistory?.length ?? 0, "messages");

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Check if we should use the agentic workflow
    const useAgenticWorkflow = shouldUseAgenticWorkflow(message);

    if (useAgenticWorkflow) {
      console.log("🤖 [StudyAgent Chat API] Using AGENTIC workflow for this request");
      
      // Convert mode to agentic mode type
      const agenticMode: StudyMode = mode === "teacher" ? "teacher" : "study-buddy";

      // Run the agentic workflow
      const agentResponse = await runStudyBuddyAgent({
        message,
        mode: agenticMode,
        userId,
        sessionId,
        fieldOfStudy,
        selectedDocuments,
        conversationHistory: conversationHistory?.map((msg) => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        })),
      });

      console.log("🤖 [StudyAgent Chat API] Agentic response generated:");
      console.log("   Tools used:", agentResponse.toolsUsed.join(", ") || "none");
      console.log("   Processing time:", agentResponse.processingTimeMs, "ms");
      console.log("   Emotion:", agentResponse.emotion);

      // Return the agentic response
      return NextResponse.json(
        {
          response: agentResponse.response,
          originalResponse: agentResponse.displayResponse,
          emotion: agentResponse.emotion,
          mode: agentResponse.mode,
          // Include generated content for frontend to handle
          toolsUsed: agentResponse.toolsUsed,
          // Indicate this was an agentic response
          isAgenticResponse: true,
        },
        { status: 200 }
      );
    }

    // Standard chat flow for non-agentic requests
    console.log("💬 [StudyAgent Chat API] Using STANDARD chat workflow");

    // Detect message intent
    const lowerMessage = message.toLowerCase();
    const needsResearch = RESEARCH_KEYWORDS.some((kw) => lowerMessage.includes(kw));
    const isIntroduction = INTRO_KEYWORDS.some((kw) => lowerMessage.includes(kw));

    // Use RAG to fetch relevant document content based on user's query
    let documentContent = "";
    let documentTitles: string[] = [];

    if (selectedDocuments && selectedDocuments.length > 0) {
      console.log("🔍 [StudyAgent Chat API] Using RAG to retrieve relevant content...");
      
      // Validate document access and get titles
      const { validDocIds, documentTitles: titleMap } = await validateDocumentAccess(
        userId,
        selectedDocuments
      );
      
      documentTitles = Array.from(titleMap.values());

      if (validDocIds.length > 0) {
        // Use RAG search to find relevant chunks based on the user's message
        const ragResults = await multiDocEnsembleSearch(message, {
          documentIds: validDocIds,
          topK: 8,
          weights: [0.4, 0.6], // BM25 weight, Vector weight
        });

        // Format RAG results for the prompt
        documentContent = formatResultsForPrompt(ragResults, titleMap);
        
        console.log(
          `📄 [StudyAgent Chat API] RAG retrieved ${ragResults.length} relevant chunks from ${validDocIds.length} documents`
        );
      }
    }

    // Build docs info string
    const docsInfo =
      selectedDocuments && selectedDocuments.length > 0
        ? documentTitles.length > 0
          ? `${selectedDocuments.length} document(s): ${documentTitles.join(", ")}`
          : `${selectedDocuments.length} document(s) available`
        : "No documents selected yet";

    // Get system prompt
    const systemPrompt = getSystemPrompt(mode, {
      fieldOfStudy,
      docsInfo,
      documentContent: documentContent || undefined,
      studyPlan,
      needsResearch,
      isIntroduction,
    });

    // Build conversation messages
    const messages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(systemPrompt),
    ];

    if (conversationHistory && conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-5);
      for (const msg of recentHistory) {
        if (msg.role === "user") {
          messages.push(new HumanMessage(msg.content));
        } else {
          messages.push(new AIMessage(msg.content));
        }
      }
    }

    messages.push(new HumanMessage(message));

    // Initialize OpenAI and generate response
    const chat = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      timeout: 30000,
    });

    console.log("🤖 [StudyAgent Chat API] Generating AI response...");
    const response = await chat.invoke(messages);

    const rawScript = extractTextContent(response.content).trim();
    const { scriptForTTS, displayScript, emotion } = processResponseForTTS(rawScript);

    console.log("🤖 [StudyAgent Chat API] AI response generated:");
    console.log("   TTS Script:", scriptForTTS);
    console.log("   Display Script:", displayScript);
    console.log("   Length:", scriptForTTS.length, "characters");
    console.log("   Mode:", mode);
    console.log("   Emotion (metadata):", emotion ?? "unknown");

    return NextResponse.json(
      {
        response: scriptForTTS,
        originalResponse: displayScript,
        emotion,
        mode,
        isAgenticResponse: false,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid request")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error in study agent chat:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
