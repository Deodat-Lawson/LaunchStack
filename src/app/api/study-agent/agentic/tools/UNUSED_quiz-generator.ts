/**
 * Quiz Generator Tool
 * Creates quizzes with various question types from document content
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { v4 as uuidv4 } from "uuid";
import type { Quiz, QuizQuestion, QuizGenerationInput } from "../types";

const QuizSchema = z.object({
  topic: z.string().describe("The topic or subject for the quiz"),
  context: z.string().describe("The source content to generate quiz questions from"),
  questionCount: z.number().min(1).max(15).default(5).describe("Number of questions to generate"),
  questionTypes: z
    .array(z.enum(["multiple-choice", "true-false", "short-answer", "fill-blank"]))
    .optional()
    .default(["multiple-choice", "true-false"])
    .describe("Types of questions to include"),
  difficulty: z
    .enum(["easy", "medium", "hard", "mixed"])
    .optional()
    .default("mixed")
    .describe("Difficulty level of the questions"),
});

const QUIZ_SYSTEM_PROMPT = `You are an expert educational assessment creator specializing in creating effective quiz questions.

Create quiz questions that:
1. Test understanding, not just memorization
2. Have clear, unambiguous answers
3. Include helpful explanations for each answer
4. Cover key concepts from the provided content
5. Are appropriate for the specified difficulty level

Question Type Guidelines:
- multiple-choice: 4 options (A, B, C, D), one correct answer
- true-false: Statement that is clearly true or false
- short-answer: Question requiring a brief written response
- fill-blank: Sentence with a key term blanked out

Output ONLY valid JSON with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "type": "multiple-choice" | "true-false" | "short-answer" | "fill-blank",
      "options": ["A. Option 1", "B. Option 2", "C. Option 3", "D. Option 4"],
      "correctAnswer": "The correct answer",
      "explanation": "Why this is the correct answer",
      "topic": "Specific sub-topic",
      "difficulty": "easy" | "medium" | "hard",
      "points": 1-3
    }
  ]
}

For true-false questions, options should be ["True", "False"].
For short-answer and fill-blank, options can be omitted.

Do not include any text outside the JSON object.`;

/**
 * Generate a quiz from content using AI
 */
export async function generateQuiz(input: QuizGenerationInput): Promise<Quiz> {
  const startTime = Date.now();

  try {
    const chat = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      timeout: 45000,
    });

    const typesList = input.questionTypes?.join(", ") ?? "multiple-choice, true-false";
    const difficultyInstruction =
      input.difficulty === "mixed"
        ? "Create a mix of easy, medium, and hard questions."
        : `Create questions at the ${input.difficulty} difficulty level.`;

    const response = await chat.invoke([
      { role: "system", content: QUIZ_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create a quiz with ${input.questionCount} questions about "${input.topic}".

Question types to include: ${typesList}
${difficultyInstruction}

Source content:
${input.context.substring(0, 8000)}`,
      },
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Parse JSON response
    const jsonMatch = /\{[\s\S]*\}/.exec(content);
    if (!jsonMatch) {
      throw new Error("Failed to parse quiz response");
    }

    const rawQuiz = JSON.parse(jsonMatch[0]) as {
      questions: Array<{
        question: string;
        type: "multiple-choice" | "true-false" | "short-answer" | "fill-blank";
        options?: string[];
        correctAnswer: string;
        explanation: string;
        topic: string;
        difficulty: "easy" | "medium" | "hard";
        points: number;
      }>;
    };

    // Transform to our Quiz type
    const questions: QuizQuestion[] = rawQuiz.questions.map((q) => ({
      id: uuidv4(),
      question: q.question,
      type: q.type,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      topic: q.topic || input.topic,
      difficulty: q.difficulty || "medium",
      points: q.points || 1,
    }));

    const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
    const estimatedTime = questions.length * 2; // ~2 minutes per question

    const quiz: Quiz = {
      id: uuidv4(),
      title: `Quiz: ${input.topic}`,
      topic: input.topic,
      questions,
      totalPoints,
      estimatedTimeMinutes: estimatedTime,
      createdAt: new Date(),
    };

    console.log(
      `📝 [Quiz Generator] Created quiz with ${questions.length} questions in ${Date.now() - startTime}ms`
    );

    return quiz;
  } catch (error) {
    console.error("❌ [Quiz Generator] Error:", error);
    throw error;
  }
}

/**
 * Quiz Generation Tool for LangChain
 */
export const quizTool = tool(
  async (input): Promise<string> => {
    try {
      const quiz = await generateQuiz({
        topic: input.topic,
        context: input.context,
        questionCount: input.questionCount,
        questionTypes: input.questionTypes,
        difficulty: input.difficulty,
      });

      return JSON.stringify({
        success: true,
        quiz: {
          id: quiz.id,
          title: quiz.title,
          topic: quiz.topic,
          questionCount: quiz.questions.length,
          totalPoints: quiz.totalPoints,
          estimatedTimeMinutes: quiz.estimatedTimeMinutes,
          questions: quiz.questions,
        },
        summary: `Created quiz "${quiz.title}" with ${quiz.questions.length} questions (${quiz.totalPoints} total points)`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        quiz: null,
      });
    }
  },
  {
    name: "generate_quiz",
    description:
      "Generate a quiz with various question types to test understanding of a topic. Use this when the user wants to test their knowledge or practice. Always search documents first to get context.",
    schema: QuizSchema,
  }
);

