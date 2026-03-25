import { z } from "zod";

// ---------------------------------------------------------------------------
// Company DNA
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Brand Voice (Area 1)
// ---------------------------------------------------------------------------

export const FormalityLevelEnum = z.enum(["formal", "conversational", "technical", "bold"]);
export type FormalityLevel = z.infer<typeof FormalityLevelEnum>;

export interface BrandVoice {
  toneDescriptor: string;
  vocabularyExamples: string[];
  sentenceStyle: string;
  formalityLevel: FormalityLevel;
}

export const BrandVoiceSchema = z.object({
  toneDescriptor: z.string(),
  vocabularyExamples: z.array(z.string()),
  sentenceStyle: z.string(),
  formalityLevel: FormalityLevelEnum,
});

// ---------------------------------------------------------------------------
// Competitor Analysis
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Messaging Strategy + Multi-Variant (Area 2)
// ---------------------------------------------------------------------------

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

export interface StrategyVariant extends MessagingStrategy {
  variantId: string;
  angleRationale: string;
}

export const StrategyVariantSchema = MessagingStrategySchema.extend({
  variantId: z.string(),
  angleRationale: z.string(),
});

export const MultiStrategySchema = z.object({
  variants: z.array(StrategyVariantSchema).min(1).max(3),
});

// ---------------------------------------------------------------------------
// Content Variant output (Area 2)
// ---------------------------------------------------------------------------

export interface ContentVariant {
  variantId: string;
  angleRationale: string;
  message: string;
  mediaType: "image" | "video";
}

// ---------------------------------------------------------------------------
// Audience Persona (Area 5)
// ---------------------------------------------------------------------------

export interface TargetPersona {
  role: string;
  painPoints: string[];
  priorities: string[];
  languageStyle: string;
}

export const TargetPersonaSchema = z.object({
  role: z.string(),
  painPoints: z.array(z.string()),
  priorities: z.array(z.string()),
  languageStyle: z.string(),
});

// ---------------------------------------------------------------------------
// Content Types (Area 6)
// ---------------------------------------------------------------------------

export const ContentTypeEnum = z.enum(["post", "thread", "ad_copy", "email", "multi_platform"]);
export type ContentType = z.infer<typeof ContentTypeEnum>;

// ---------------------------------------------------------------------------
// Claim Source (Area 4)
// ---------------------------------------------------------------------------

export interface ClaimSource {
  claim: string;
  sourceDoc: string;
  chunk: string;
  confidence: number;
}

export const ClaimSourceSchema = z.object({
  claim: z.string(),
  chunk: z.string(),
  sourceDoc: z.string(),
  confidence: z.number(),
});

// ---------------------------------------------------------------------------
// Performance History (Area 8)
// ---------------------------------------------------------------------------

export interface ContentPerformanceRecord {
  content: string;
  platform: MarketingPlatform;
  angle: string;
  publishedAt: string;
  metrics?: {
    impressions?: number;
    engagements?: number;
    clicks?: number;
  };
}

// ---------------------------------------------------------------------------
// Platform + Input
// ---------------------------------------------------------------------------

export const MarketingPlatformEnum = z.enum(["x", "linkedin", "reddit", "bluesky"]);
export type MarketingPlatform = z.infer<typeof MarketingPlatformEnum>;

export const MarketingPipelineInputSchema = z.object({
    platform: MarketingPlatformEnum,
    prompt: z.string().min(1).max(2000).optional(),
    maxResearchResults: z.number().int().min(1).max(12).optional(),
    toneOverride: FormalityLevelEnum.optional(),
    targetAudience: z.string().max(500).optional(),
    contentType: ContentTypeEnum.optional(),
    platforms: z.array(MarketingPlatformEnum).optional(),
});
export type MarketingPipelineInput = z.infer<typeof MarketingPipelineInputSchema>;

export interface MarketingResearchResult {
    title: string;
    url: string;
    snippet: string;
    source: MarketingPlatform;
}

// ---------------------------------------------------------------------------
// Single-variant output (legacy compat)
// ---------------------------------------------------------------------------

export const MarketingPipelineOutputSchema = z.object({
    platform: MarketingPlatformEnum,
    message: z.string().min(1),
    "image/video": z.enum(["image", "video"]),
});
export type MarketingPipelineOutput = z.infer<typeof MarketingPipelineOutputSchema>;

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

export interface DNADebugInfo {
    source: "metadata" | "rag";
    contextUsed: string;
    dna: CompanyDNA;
}

// ---------------------------------------------------------------------------
// Transparent Pipeline Stages (Area 3)
// ---------------------------------------------------------------------------

export interface PipelineStages {
    dna: CompanyDNA;
    competitors: CompetitorAnalysis;
    trends: MarketingResearchResult[];
    strategies: StrategyVariant[];
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    performanceInsights?: string[];
}

// ---------------------------------------------------------------------------
// Full pipeline result (backward-compatible + new fields)
// ---------------------------------------------------------------------------

export interface MarketingPipelineResult extends MarketingPipelineOutput {
    research: MarketingResearchResult[];
    normalizedInput: {
        platform: MarketingPlatform;
        prompt: string;
    };
    competitiveAngle?: string;
    strategyUsed?: MessagingStrategy;
    dnaDebug?: DNADebugInfo;

    variants: ContentVariant[];
    pipelineStages: PipelineStages;
    claimSources?: ClaimSource[];
}

// ---------------------------------------------------------------------------
// Refinement (Area 7)
// ---------------------------------------------------------------------------

export const RefinementInputSchema = z.object({
    platform: MarketingPlatformEnum,
    variantId: z.string(),
    previousMessage: z.string(),
    feedback: z.string().min(1).max(2000),
    pipelineContext: z.object({
        prompt: z.string(),
        companyContext: z.string(),
        research: z.array(z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string(),
            source: MarketingPlatformEnum,
        })),
        strategy: MessagingStrategySchema,
        brandVoice: BrandVoiceSchema.optional(),
    }),
});
export type RefinementInput = z.infer<typeof RefinementInputSchema>;

export interface RefinementResult {
    variantId: string;
    message: string;
    mediaType: "image" | "video";
    feedbackApplied: string;
}

