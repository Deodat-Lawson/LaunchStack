/**
 * Concept Explainer Tool
 * Provides detailed explanations of concepts with analogies and examples
 */

// TODO: Concept explain output modification

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import type { ConceptExplanation, ConceptExplanationInput } from "../types";

const ConceptSchema = z.object({
  concept: z.string().describe("The concept or term to explain"),
  context: z
    .string()
    .optional()
    .describe("Additional context from documents to inform the explanation"),
  targetAudience: z
    .enum(["beginner", "intermediate", "advanced"])
    .optional()
    .default("intermediate")
    .describe("The target audience level"),
  includeExamples: z.boolean().optional().default(true).describe("Whether to include examples"),
  includeAnalogy: z.boolean().optional().default(true).describe("Whether to include an analogy"),
});


const CONCEPT_SYSTEM_PROMPT = `You are an expert educator who excels at explaining complex concepts in clear, understandable ways.

Your explanations should:
1. Start with a simple, one-sentence definition
2. Build up to more detailed understanding
3. Use relatable analogies when helpful
4. Provide concrete, practical examples
5. Identify common misconceptions
6. Connect to related concepts

Output ONLY valid JSON with this structure:
{
  "concept": "The concept name",
  "simpleExplanation": "A brief, one-sentence explanation suitable for beginners",
  "detailedExplanation": "A comprehensive explanation with more depth",
  "analogy": "A relatable analogy that helps understand the concept",
  "examples": ["Example 1", "Example 2", "Example 3"],
  "relatedConcepts": ["Related concept 1", "Related concept 2"],
  "prerequisites": ["What you need to know first"],
  "commonMisconceptions": ["Common mistake 1", "Common mistake 2"]
}

Do not include any text outside the JSON object.`;

/**
 * Generate a detailed concept explanation using AI
 */
export async function explainConcept(
  input: ConceptExplanationInput
): Promise<ConceptExplanation> {
  const startTime = Date.now();

  try {
    const chat = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      timeout: 30000,
    });

    const audienceInstructions = {
      beginner:
        "Explain this for someone completely new to the subject. Use simple language and avoid jargon.",
      intermediate:
        "Explain this for someone with basic knowledge. Balance accessibility with depth.",
      advanced:
        "Explain this for someone with strong background knowledge. Include technical details and nuances.",
    };

    const contextSection = input.context
      ? `\n\nRelevant context from study materials:\n${input.context.substring(0, 4000)}`
      : "";

    const response = await chat.invoke([
      { role: "system", content: CONCEPT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Explain the concept: "${input.concept}"

Target audience: ${audienceInstructions[input.targetAudience ?? "intermediate"]}
Include examples: ${input.includeExamples ?? true}
Include analogy: ${input.includeAnalogy ?? true}
${contextSection}`,
      },
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Parse JSON response
    const jsonMatch = /\{[\s\S]*\}/.exec(content);
    if (!jsonMatch) {
      throw new Error("Failed to parse concept explanation response");
    }

    const rawExplanation = JSON.parse(jsonMatch[0]) as ConceptExplanation;

    console.log(
      `💡 [Concept Explainer] Generated explanation for "${input.concept}" in ${Date.now() - startTime}ms`
    );

    return rawExplanation;
  } catch (error) {
    console.error("❌ [Concept Explainer] Error:", error);
    throw error;
  }
}

/**
 * Concept Explainer Tool for LangChain
 */
export const conceptExplainerTool = tool(
  async (input): Promise<string> => {
    try {
      const explanation = await explainConcept({
        concept: input.concept,
        context: input.context,
        targetAudience: input.targetAudience,
        includeExamples: input.includeExamples,
        includeAnalogy: input.includeAnalogy,
      });

      return JSON.stringify({
        success: true,
        explanation,
        summary: `Generated detailed explanation for "${input.concept}"`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        explanation: null,
      });
    }
  },
  {
    name: "explain_concept",
    description:
      "Provide a detailed explanation of a concept, including simple and detailed explanations, analogies, examples, and related concepts. Use this when the user asks 'what is...', 'explain...', or 'help me understand...'",
    schema: ConceptSchema,
  }
);

