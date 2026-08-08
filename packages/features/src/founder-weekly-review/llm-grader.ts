import { z } from "zod";

export const LLMGraderResultSchema = z.object({
  overallScore: z.number().min(0).max(1),

  dimensions: z.object({
    groundedness: z.number().min(0).max(1),
    materiality: z.number().min(0).max(1),
    temporalAccuracy: z.number().min(0).max(1),
    synthesisQuality: z.number().min(0).max(1),
    actionability: z.number().min(0).max(1),
  }),

  findings: z.array(
    z.object({
      section: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      sourceIds: z.array(z.string()),
      explanation: z.string(),
    })
  ),

  summary: z.string(),

  metadata: z.object({
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string(),
  }),
});

export type LLMGraderResult = z.infer<typeof LLMGraderResultSchema>;