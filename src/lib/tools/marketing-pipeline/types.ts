import { z } from "zod";

/** Structured company profile distilled from KB for marketing (issue #232). */
export interface CompanyDNA {
  coreMission: string;
  keyDifferentiators: string[];
  provenResults: string[];
  humanStory: string;
  technicalEdge: string;
}

export const CompanyDNASchema = z.object({
  coreMission: z.string(),
  keyDifferentiators: z.array(z.string()),
  provenResults: z.array(z.string()),
  humanStory: z.string(),
  technicalEdge: z.string(),
});

/** Competitor landscape for marketing (issue #232). */
export interface CompetitorAnalysis {
  competitors: Array<{
    name: string;
    positioning: string;
    weaknesses: string[];
  }>;
  ourAdvantages: string[];
  marketGaps: string[];
  messagingAntiPatterns: string[];
}

export const CompetitorAnalysisSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      positioning: z.string(),
      weaknesses: z.array(z.string()),
    }),
  ),
  ourAdvantages: z.array(z.string()),
  marketGaps: z.array(z.string()),
  messagingAntiPatterns: z.array(z.string()),
});

/** Messaging strategy derived from DNA + competitors + trends (issue #232). */
export interface MessagingStrategy {
  angle: string;
  keyProof: string[];
  humanHook: string;
  avoidList: string[];
}

export const MessagingStrategySchema = z.object({
  angle: z.string(),
  keyProof: z.array(z.string()),
  humanHook: z.string(),
  avoidList: z.array(z.string()),
});

export const MarketingPlatformEnum = z.enum(["x", "linkedin", "reddit", "bluesky"]);
export type MarketingPlatform = z.infer<typeof MarketingPlatformEnum>;

export const MarketingPipelineInputSchema = z.object({
    platform: MarketingPlatformEnum,
    prompt: z.string().min(1).max(2000).optional(),
    maxResearchResults: z.number().int().min(1).max(12).optional(),
});
export type MarketingPipelineInput = z.infer<typeof MarketingPipelineInputSchema>;

export interface MarketingResearchResult {
    title: string;
    url: string;
    snippet: string;
    source: MarketingPlatform;
}

export const MarketingPipelineOutputSchema = z.object({
    platform: MarketingPlatformEnum,
    message: z.string().min(1),
    "image/video": z.enum(["image", "video"]),
});
export type MarketingPipelineOutput = z.infer<typeof MarketingPipelineOutputSchema>;

/** Debug info about the DNA extraction source, included when ?debug=true. */
export interface DNADebugInfo {
    source: "metadata" | "rag";
    contextUsed: string;
    dna: CompanyDNA;
}

export interface MarketingPipelineResult extends MarketingPipelineOutput {
    research: MarketingResearchResult[];
    normalizedInput: {
        platform: MarketingPlatform;
        prompt: string;
    };
    /** Positioning angle used for this campaign (issue #232). */
    competitiveAngle?: string;
    /** Optional summary of strategy (angle + proof + hook) for transparency. */
    strategyUsed?: MessagingStrategy;
    /** Debug info about DNA extraction, included when debug mode is on. */
    dnaDebug?: DNADebugInfo;
}

