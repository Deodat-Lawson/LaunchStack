/**
 * Study Plan Tool
 * Role: LangChain tool to draft/update AI-generated study plans.
 * Purpose: turn goals/topics/time into structured sessions plus recommendations.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import type { StudyPlanInput } from "../types";

const StudyPlanSchema = z.object({
  goals: z.array(z.string()).describe("Learning goals or objectives"),
  availableTime: z
    .number()
    .describe("Total available study time in minutes"),
  topics: z.array(z.string()).describe("Topics to cover"),
  existingPlan: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        completed: z.boolean(),
      })
    )
    .optional()
    .describe("Existing study plan items to update"),
});

const STUDY_PLAN_SYSTEM_PROMPT = `You are an expert learning coach who creates effective, personalized study plans.

Your study plans should:
1. Break down learning into manageable sessions
2. Prioritize based on importance and dependencies
3. Include specific, actionable objectives
4. Estimate realistic time requirements
5. Build progressively from foundational to advanced concepts
6. Include review and practice sessions

Output ONLY valid JSON with this structure:
{
  "studyPlan": [
    {
      "title": "Session title",
      "description": "What this session covers",
      "objectives": ["Specific objective 1", "Specific objective 2"],
      "estimatedDuration": 30,
      "priority": "high" | "medium" | "low",
      "materials": ["Material 1", "Material 2"],
      "prerequisites": ["What to complete first"]
    }
  ],
  "recommendations": ["Study tip 1", "Study tip 2"],
  "totalEstimatedTime": 120
}

Do not include any text outside the JSON object.`;

/**
 * Create or update a study plan using AI
 */
export async function createOrUpdateStudyPlan(
  input: StudyPlanInput
): Promise<{
  recommendations: string[];
  totalEstimatedTime: number;
}> {
  const startTime = Date.now();

  try {
    const chat = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      timeout: 30000,
    });

    const response = await chat.invoke([
      { role: "system", content: STUDY_PLAN_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Create a study plan with the following parameters:

Goals:
${input.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Topics to cover:
${input.topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Available study time: ${input.availableTime} minutes total
`,
      },
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Parse JSON response
    const jsonMatch = /\{[\s\S]*\}/.exec(content);
    if (!jsonMatch) {
      throw new Error("Failed to parse study plan response");
    }

    const rawPlan = JSON.parse(jsonMatch[0]) as {
      studyPlan: Array<{
        title: string;
        description: string;
        objectives: string[];
        estimatedDuration: number;
        priority: "high" | "medium" | "low";
        materials: string[];
        prerequisites?: string[];
      }>;
      recommendations: string[];
      totalEstimatedTime: number;
    };

    console.log(
      `📋 [Study Plan] Created plan with ${rawPlan.studyPlan.length} items in ${Date.now() - startTime}ms`
    );

    return {
      recommendations: rawPlan.recommendations,
      totalEstimatedTime: rawPlan.totalEstimatedTime,
    };
  } catch (error) {
    console.error("❌ [Study Plan] Error:", error);
    throw error;
  }
}

/**
 * Study Plan Tool for LangChain
 */
export const studyPlanTool = tool(
  async (input): Promise<string> => {
    try {
      const result = await createOrUpdateStudyPlan({
        goals: input.goals,
        availableTime: input.availableTime,
        topics: input.topics,
      });

      return JSON.stringify({
        success: true,
        recommendations: result.recommendations,
        totalEstimatedTime: result.totalEstimatedTime,
        summary: `Created study plan with ${result.recommendations.length} items (${result.totalEstimatedTime} min total)`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        studyPlan: [],
      });
    }
  },
  {
    name: "create_study_plan",
    description:
      "Create or update a personalized study plan based on goals, available time, and topics. Use this when the user wants help organizing their study sessions or creating a learning roadmap.",
    schema: StudyPlanSchema,
  }
);

