/**
 * Flashcard Generator Tool
 * Creates study flashcards from document content using AI
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { v4 as uuidv4 } from "uuid";
import type { Flashcard, FlashcardGenerationInput } from "../types";

const FlashcardSchema = z.object({
  topic: z.string().describe("The topic or subject for the flashcards"),
  context: z.string().describe("The source content to generate flashcards from"),
  count: z.number().min(1).max(20).default(5).describe("Number of flashcards to generate"),
  difficulty: z
    .enum(["easy", "medium", "hard", "mixed"])
    .optional()
    .default("mixed")
    .describe("Difficulty level of the flashcards"),
});

const FLASHCARD_SYSTEM_PROMPT = `You are an expert educational content creator specializing in creating effective study flashcards.

Your task is to create high-quality flashcards that:
1. Focus on key concepts, definitions, and important facts
2. Use clear, concise language on both sides
3. Include only ONE concept per card
4. Make the front (question) specific enough to have a clear answer
5. Make the back (answer) complete but concise
6. Include helpful context or memory aids when appropriate

Output ONLY valid JSON array with this structure:
[
  {
    "front": "Question or prompt",
    "back": "Answer or explanation",
    "topic": "Specific sub-topic",
    "difficulty": "easy" | "medium" | "hard",
    "tags": ["tag1", "tag2"]
  }
]

Do not include any text outside the JSON array.`;

/**
 * Generate flashcards from content using AI
 */
export async function generateFlashcards(
  input: FlashcardGenerationInput
): Promise<Flashcard[]> {
  const startTime = Date.now();

  try {
    const chat = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      timeout: 30000,
    });

    const difficultyInstruction =
      input.difficulty === "mixed"
        ? "Create a mix of easy, medium, and hard flashcards."
        : `Create flashcards at the ${input.difficulty} difficulty level.`;

    const response = await chat.invoke([
      { role: "system", content: FLASHCARD_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create ${input.count} flashcards about "${input.topic}".

${difficultyInstruction}

Source content:
${input.context.substring(0, 6000)}`,
      },
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Parse JSON response
    const jsonMatch = /\[[\s\S]*\]/.exec(content);
    if (!jsonMatch) {
      throw new Error("Failed to parse flashcard response");
    }

    const rawFlashcards = JSON.parse(jsonMatch[0]) as Array<{
      front: string;
      back: string;
      topic: string;
      difficulty: "easy" | "medium" | "hard";
      tags: string[];
    }>;

    // Transform to our Flashcard type with IDs
    const flashcards: Flashcard[] = rawFlashcards.map((card) => ({
      id: uuidv4(),
      front: card.front,
      back: card.back,
      topic: card.topic || input.topic,
      difficulty: card.difficulty || "medium",
      tags: card.tags || [],
    }));

    console.log(
      `🃏 [Flashcard Generator] Created ${flashcards.length} flashcards in ${Date.now() - startTime}ms`
    );

    return flashcards;
  } catch (error) {
    console.error("❌ [Flashcard Generator] Error:", error);
    throw error;
  }
}

/**
 * Flashcard Generation Tool for LangChain
 */
export const flashcardTool = tool(
  async (input): Promise<string> => {
    try {
      const flashcards = await generateFlashcards({
        topic: input.topic,
        context: input.context,
        count: input.count,
        difficulty: input.difficulty,
      });

      return JSON.stringify({
        success: true,
        flashcardCount: flashcards.length,
        flashcards: flashcards,
        summary: `Created ${flashcards.length} flashcards about "${input.topic}"`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        flashcards: [],
      });
    }
  },
  {
    name: "generate_flashcards",
    description:
      "Generate study flashcards from document content. Use this when the user wants to create flashcards for memorization or review. Always search documents first to get context.",
    schema: FlashcardSchema,
  }
);

