import { z } from "zod";

/**
 * till company DNA - adds a lower level structured layer before CompanyDNA
 * this layer gives normalized structured facts, citations, confidence, validation
 * so model has to be stricter
 */

export const EvidenceCitationSchema = z.object({
  documentId: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(),
  page: z.number().int().optional(),
  sectionPath: z.string().optional(),
  snippet: z.string().min(1),
  sourceType: z.string().optional(),
});

export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;

export const NormalizedClaimSchema = z.object({
  claim: z.string(),
  category: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  citations: z.array(EvidenceCitationSchema).default([]),
});

export type NormalizedClaim = z.infer<typeof NormalizedClaimSchema>;

export const NormalizedCompanyKnowledgeSchema = z.object({
  companyName: z.string(),
  whatItDoes: z.string(),
  targetAudience: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  keyDifferentiators: z.array(z.string()).default([]),
  proofPoints: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  customerPainPoints: z.array(z.string()).default([]),
  outcomes: z.array(z.string()).default([]),
  brandValues: z.array(z.string()).default([]),
  founderStory: z.string(),
  technicalEdge: z.string(),
  risksOrUnknowns: z.array(z.string()).default([]),
  claims: z.array(NormalizedClaimSchema).default([]),
  summary: z.string(),
  missingInformation: z.array(z.string()).default([]),
});

export type NormalizedCompanyKnowledge = z.infer<typeof NormalizedCompanyKnowledgeSchema>;

export const KnowledgeValidationReportSchema = z.object({
  groundednessScore: z.number().min(0).max(10),
  completenessScore: z.number().min(0).max(10),
  consistencyScore: z.number().min(0).max(10),
  needsRevision: z.boolean(),
  unsupportedClaims: z.array(z.string()).default([]),
  missingCriticalFields: z.array(z.string()).default([]),
  revisionNotes: z.array(z.string()).default([]),
});

export type KnowledgeValidationReport = z.infer<typeof KnowledgeValidationReportSchema>;

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
}

