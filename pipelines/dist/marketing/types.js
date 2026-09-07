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
export const NormalizedClaimSchema = z.object({
    claim: z.string(),
    category: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    citations: z.array(EvidenceCitationSchema).default([]),
});
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
export const KnowledgeValidationReportSchema = z.object({
    groundednessScore: z.number().min(0).max(10),
    completenessScore: z.number().min(0).max(10),
    consistencyScore: z.number().min(0).max(10),
    needsRevision: z.boolean(),
    unsupportedClaims: z.array(z.string()).default([]),
    missingCriticalFields: z.array(z.string()).default([]),
    revisionNotes: z.array(z.string()).default([]),
});
/**
 * CompanyDNA and its debug info moved to @launchstack/tools/company-context
 * (unification PR-1); re-exported here so the marketing barrel's type surface
 * is unchanged. New code should import from the tool directly.
 */
export { CompanyDNASchema } from "@launchstack/tools/company-context";
export const CompetitorAnalysisSchema = z.object({
    competitors: z.array(z.object({
        name: z.string(),
        positioning: z.string(),
        weaknesses: z.array(z.string()),
    })),
    ourAdvantages: z.array(z.string()),
    marketGaps: z.array(z.string()),
    messagingAntiPatterns: z.array(z.string()),
});
export const MessagingStrategySchema = z.object({
    angle: z.string(),
    keyProof: z.array(z.string()),
    humanHook: z.string(),
    avoidList: z.array(z.string()),
});
// Platform vocabulary moved to @launchstack/tools/platform-profiles (PR-5).
export { MarketingPlatformEnum } from "@launchstack/tools/platform-profiles";
import { MarketingPlatformEnum } from "@launchstack/tools/platform-profiles";
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
export { TargetPersonaSchema } from "@launchstack/tools/persona";
import { FormalityLevelEnum } from "@launchstack/tools/brand-voice";
export const ContentTypeEnum = z.enum(["post", "thread", "ad_copy", "email", "multi_platform"]);
export const MarketingPipelineInputSchema = z.object({
    platform: MarketingPlatformEnum,
    prompt: z.string().min(1).max(2000).optional(),
    maxResearchResults: z.number().int().min(1).max(12).optional(),
    platformMeta: PlatformMetaSchema,
    toneOverride: FormalityLevelEnum.optional(),
    targetAudience: z.string().max(200).optional(),
    contentType: ContentTypeEnum.optional(),
    /**
     * Score every variant with the content-scoring rubric and select the best
     * instead of blindly taking the first (P2). Default OFF: it costs one
     * extra LLM call per variant, and flipping the default awaits benchmark
     * evidence (design doc OQ-1; RUN_LLM_BENCHMARK=1).
     */
    enableVariantRanking: z.boolean().optional(),
});
export const MarketingPipelineOutputSchema = z.object({
    platform: MarketingPlatformEnum,
    message: z.string().min(1),
    "image/video": z.enum(["image", "video"]),
});
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
export const MultiStrategySchema = z.object({
    variants: z.array(StrategyVariantSchema).min(1).max(3),
});
export const PIPELINE_STEPS = [
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
//# sourceMappingURL=types.js.map