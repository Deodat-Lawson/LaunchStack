import { z } from "zod";

/**
 * till company DNA - adds a lower level structured layer before CompanyDNA
 * this layer gives normalized structured facts, citations, confidence, validation
 * so model has to be stricter
 */

/** OpenAI structured outputs require .nullable() instead of .optional() - all fields must be present. */
export const EvidenceCitationSchema = z.object({
  documentId: z.union([z.string(), z.number()]).nullable(),
  title: z.string().nullable(),
  page: z.number().int().nullable(),
  sectionPath: z.string().nullable(),
  snippet: z.string().min(1),
  sourceType: z.string().nullable(),
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

export const PlatformMetaSchema = z.object({
    subreddit: z.string().max(100).optional(),
    hashtags: z.array(z.string().max(50)).max(5).optional(),
}).optional();

export const FormalityLevelEnum = z.enum(["formal", "conversational", "technical", "bold"]);
export type FormalityLevel = z.infer<typeof FormalityLevelEnum>;

export const ContentTypeEnum = z.enum(["post", "thread", "ad_copy", "email", "multi_platform"]);
export type ContentType = z.infer<typeof ContentTypeEnum>;

export const MarketingPipelineInputSchema = z.object({
    platform: MarketingPlatformEnum,
    prompt: z.string().min(1).max(2000).optional(),
    maxResearchResults: z.number().int().min(1).max(12).optional(),
    platformMeta: PlatformMetaSchema,
    toneOverride: FormalityLevelEnum.optional(),
    targetAudience: z.string().max(200).optional(),
    contentType: ContentTypeEnum.optional(),
    /** Restrict RAG context to specific documents. Omit or empty = all company docs. */
    documentIds: z.array(z.number().int().positive()).max(50).optional(),
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
    /** Document IDs used as context (empty = all company docs). */
    sourceDocumentIds?: number[];
    /** Positioning angle used for this campaign (issue #232). */
    competitiveAngle?: string;
    /** Optional summary of strategy (angle + proof + hook) for transparency. */
    strategyUsed?: MessagingStrategy;
    /** Debug info about DNA extraction, included when debug mode is on. */
    dnaDebug?: DNADebugInfo;
    /** All generated content variants (multi-variant generation). */
    variants?: ContentVariant[];
    /** All intermediate pipeline stages for transparency. */
    pipelineStages?: PipelineStages;
    /** Claim sources mapped back to KB documents. */
    claimSources?: ClaimSource[];
}

/* ──────────────────────────────────────────────────────────────
 * Brand voice, persona, content types, multi-variant types
 * ────────────────────────────────────────────────────────────── */

export const BrandVoiceSchema = z.object({
    toneDescriptor: z.string(),
    vocabularyExamples: z.array(z.string()),
    sentenceStyle: z.string(),
    formalityLevel: FormalityLevelEnum,
});
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

export const TargetPersonaSchema = z.object({
    role: z.string(),
    painPoints: z.array(z.string()),
    priorities: z.array(z.string()),
    languageStyle: z.string(),
});
export type TargetPersona = z.infer<typeof TargetPersonaSchema>;

export const StrategyVariantSchema = z.object({
    variantId: z.string(),
    angleRationale: z.string(),
    angle: z.string(),
    keyProof: z.array(z.string()),
    humanHook: z.string(),
    avoidList: z.array(z.string()),
});
export type StrategyVariant = z.infer<typeof StrategyVariantSchema>;

export const MultiStrategySchema = z.object({
    variants: z.array(StrategyVariantSchema).min(1).max(3),
});

export interface ContentVariant {
    variantId: string;
    angleRationale: string;
    message: string;
    mediaType: "image" | "video";
}

export interface ClaimSource {
    claim: string;
    sourceDoc: string;
    chunk: string;
    confidence: number;
}

export interface PipelineStages {
    dna: CompanyDNA;
    competitors: CompetitorAnalysis;
    trends: MarketingResearchResult[];
    strategies: StrategyVariant[];
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    performanceInsights?: string[];
}

export interface RefinementResult {
    variantId: string;
    message: string;
    mediaType: "image" | "video";
    feedbackApplied: string;
}

/* ──────────────────────────────────────────────────────────────
 * Pipeline progress / SSE streaming types
 * ────────────────────────────────────────────────────────────── */

export type PipelineStepId =
    | "loading-context"
    | "extracting-dna"
    | "analyzing-competitors"
    | "researching-trends"
    | "extracting-voice"
    | "extracting-persona"
    | "checking-performance"
    | "building-strategy"
    | "generating-content"
    | "verifying-claims";

export const PIPELINE_STEPS: ReadonlyArray<{ id: PipelineStepId; label: string }> = [
    { id: "loading-context", label: "Loading company knowledge" },
    { id: "extracting-dna", label: "Extracting company DNA" },
    { id: "analyzing-competitors", label: "Analyzing competitors" },
    { id: "researching-trends", label: "Researching platform trends" },
    { id: "extracting-voice", label: "Detecting brand voice" },
    { id: "extracting-persona", label: "Building target persona" },
    { id: "checking-performance", label: "Checking performance history" },
    { id: "building-strategy", label: "Building messaging strategies" },
    { id: "generating-content", label: "Generating content variants" },
    { id: "verifying-claims", label: "Verifying claim sources" },
];

export type PipelineSSEEvent =
    | { type: "step_start"; step: PipelineStepId; label: string; parallelGroup?: number }
    | { type: "step_complete"; step: PipelineStepId; durationMs: number; detail?: string; status?: "completed" | "skipped" | "failed" }
    | { type: "step_data"; step: PipelineStepId; data: Record<string, unknown> }
    | { type: "step_thinking"; step: PipelineStepId; text: string }
    | { type: "result"; success: true; data: MarketingPipelineResult }
    | { type: "error"; success: false; message: string; error?: string };

export type OnPipelineProgress = (event:
    | { type: "step_start"; step: PipelineStepId; label: string; parallelGroup?: number }
    | { type: "step_complete"; step: PipelineStepId; durationMs: number; detail?: string; status?: "completed" | "skipped" | "failed" }
    | { type: "step_data"; step: PipelineStepId; data: Record<string, unknown> }
    | { type: "step_thinking"; step: PipelineStepId; text: string }
) => void;

