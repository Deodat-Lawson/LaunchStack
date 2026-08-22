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

/**
 * CompanyDNA and its debug info moved to @launchstack/tools/company-context
 * (unification PR-1); re-exported here so the marketing barrel's type surface
 * is unchanged. New code should import from the tool directly.
 */
export { CompanyDNASchema } from "@launchstack/tools/company-context";
export type { CompanyDNA, DNADebugInfo } from "@launchstack/tools/company-context";
import type { CompanyDNA, DNADebugInfo } from "@launchstack/tools/company-context";

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
        })
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

export const PlatformMetaSchema = z
    .object({
        subreddit: z.string().max(100).optional(),
        hashtags: z.array(z.string().max(50)).max(5).optional(),
    })
    .optional();

/**
 * Brand-voice and persona types moved to @launchstack/tools (unification
 * PR-2); re-exported so the marketing barrel's surface is unchanged.
 */
export { BrandVoiceSchema, FormalityLevelEnum } from "@launchstack/tools/brand-voice";
export type { BrandVoice, FormalityLevel } from "@launchstack/tools/brand-voice";
export { TargetPersonaSchema } from "@launchstack/tools/persona";
export type { TargetPersona } from "@launchstack/tools/persona";
import { FormalityLevelEnum } from "@launchstack/tools/brand-voice";
import type { BrandVoice } from "@launchstack/tools/brand-voice";
import type { TargetPersona } from "@launchstack/tools/persona";

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
    /** Debug info about DNA extraction, included when debug mode is on. */
    dnaDebug?: DNADebugInfo;
    /** All generated content variants (multi-variant generation). */
    variants?: ContentVariant[];
    /** All intermediate pipeline stages for transparency. */
    pipelineStages?: PipelineStages;
    /** Claim sources mapped back to KB documents. */
    claimSources?: CheckedClaim[];
}

/* ──────────────────────────────────────────────────────────────
 * Content types, multi-variant types
 * ────────────────────────────────────────────────────────────── */

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

/**
 * Claim checking moved to @launchstack/tools/claim-evidence (unification
 * PR-4) with honest semantics: `relevance` is a retrieval score (never
 * "confidence"), and "no source found" is a null match, not a zero.
 */
export type { CheckedClaim, ClaimSourceMatch } from "@launchstack/tools/claim-evidence";
import type { CheckedClaim } from "@launchstack/tools/claim-evidence";

export interface PipelineStages {
    dna: CompanyDNA;
    competitors: CompetitorAnalysis;
    trends: MarketingResearchResult[];
    strategies: StrategyVariant[];
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    performanceInsights?: string[];
    /**
     * The exact company knowledge-context window fed to the generator
     * (buildCompanyKnowledgeContext output). Surfaced so evaluation can score
     * against the same facts the post was written from, not a re-derived context.
     */
    companyContext?: string;
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
    { id: "verifying-claims", label: "Checking claim sources" },
];

export type PipelineSSEEvent =
    | { type: "step_start"; step: PipelineStepId; label: string; parallelGroup?: number }
    | {
          type: "step_complete";
          step: PipelineStepId;
          durationMs: number;
          detail?: string;
          status?: "completed" | "skipped" | "failed";
      }
    | { type: "step_data"; step: PipelineStepId; data: Record<string, unknown> }
    | { type: "step_thinking"; step: PipelineStepId; text: string }
    | { type: "result"; success: true; data: MarketingPipelineResult }
    | { type: "error"; success: false; message: string; error?: string };

export type OnPipelineProgress = (
    event:
        | { type: "step_start"; step: PipelineStepId; label: string; parallelGroup?: number }
        | {
              type: "step_complete";
              step: PipelineStepId;
              durationMs: number;
              detail?: string;
              status?: "completed" | "skipped" | "failed";
          }
        | { type: "step_data"; step: PipelineStepId; data: Record<string, unknown> }
        | { type: "step_thinking"; step: PipelineStepId; text: string }
) => void;
