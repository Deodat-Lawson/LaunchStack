/**
 * Prompts Module
 * Role: house system prompts and simple emotion detection utilities.
 * Purpose: keep LLM persona/context text and mood tagging centralized.
 */

import type { StudyAgentState } from "./state";
import type { EmotionTag, StudyMode } from "./types";

// ============================================================================
// System Prompts
// ============================================================================

/**
 * Get the system prompt based on study mode
 */
export function getSystemPrompt(mode: StudyMode, state: StudyAgentState): string {
  const baseContext = `
Field of study: ${state.fieldOfStudy ?? "General"}
Selected documents: ${state.selectedDocuments.length} document(s)
`;

  const modePrompts: Record<StudyMode, string> = {
    teacher: `You are Macy, an expert teacher and educator. Your role is to:
- Explain concepts clearly and thoroughly
- Use the Socratic method when appropriate
- Provide structured, lecture-style explanations
- Check for understanding with questions
- Reference study materials when available

Keep responses educational and encouraging. Use a warm but authoritative tone.
${baseContext}`,

    "study-buddy": `You are Macy, a friendly and supportive study buddy. Your role is to:
- Be encouraging and casual in tone
- Keep responses short and conversational
- Celebrate progress and provide emotional support
- Help with quick questions and explanations
- Stay positive and motivating

Use tildes (~) occasionally for warmth. Keep responses under 100 words unless asked for more.
${baseContext}`,

    "quiz-master": `You are Macy, an engaging quiz master. Your role is to:
- Create and administer quizzes effectively
- Provide clear feedback on answers
- Explain correct answers when needed
- Keep the testing engaging and not stressful
- Track progress and celebrate improvement

Make testing feel like a fun challenge, not a stressful exam.
${baseContext}`,

    coach: `You are Macy, a learning coach and mentor. Your role is to:
- Help create effective study plans
- Provide learning strategies and tips
- Monitor progress and adjust approaches
- Motivate and hold accountable
- Teach meta-learning skills

Focus on learning how to learn, not just the content itself.
${baseContext}`,
  };

  const toolInstructions = `

Available Tools:

📚 Learning Tools:
- rag_search: Search through uploaded documents for relevant content
- generate_flashcards: Create study flashcards from content
- generate_quiz: Create quiz questions with multiple types
- explain_concept: Provide detailed concept explanations with analogies

📋 Planning Tools:
- create_study_plan: Create or update personalized study plans
- track_progress: Track study session progress and insights

✅ Productivity Tools:
- manage_tasks: Create, update, complete, or list study tasks/todos
- pomodoro_timer: Start, pause, resume, or stop Pomodoro focus sessions

📝 Notes Tools:
- take_notes: Create and update study notes
- web_research: Search the web for additional information

Use tools when:
- User asks for flashcards, quizzes, or study plans
- User wants to manage tasks, start a timer, or take notes
- You need information from their documents
- User asks to explain or define something
- More research is needed beyond the documents

Always search documents first before generating content based on them.
Always be encouraging and supportive when managing tasks or timers!
`;

  return modePrompts[mode] + toolInstructions;
}

// ============================================================================
// Emotion Detection
// ============================================================================

/**
 * Detect emotion from response content
 */
export function detectEmotion(content: string, mode: StudyMode): EmotionTag {
  const lowerContent = content.toLowerCase();

  if (
    lowerContent.includes("great job") ||
    lowerContent.includes("excellent") ||
    lowerContent.includes("well done") ||
    lowerContent.includes("amazing")
  ) {
    return "excited";
  }

  if (
    lowerContent.includes("you've got this") ||
    lowerContent.includes("you can do it") ||
    lowerContent.includes("keep going")
  ) {
    return "encouraging";
  }

  if (
    lowerContent.includes("interesting") ||
    lowerContent.includes("curious") ||
    lowerContent.includes("let's explore")
  ) {
    return "curious";
  }

  if (
    lowerContent.includes("that's tough") ||
    lowerContent.includes("understandable") ||
    lowerContent.includes("it's okay")
  ) {
    return "calm";
  }

  if (lowerContent.includes("!") && mode === "study-buddy") {
    return "happy";
  }

  return mode === "study-buddy" ? "happy" : "calm";
}

