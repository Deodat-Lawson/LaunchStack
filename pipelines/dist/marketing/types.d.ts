import { z } from "zod";
import type { PipelineProgressEvent } from "@launchstack/tools/contract";
/**
 * till company DNA - adds a lower level structured layer before CompanyDNA
 * this layer gives normalized structured facts, citations, confidence, validation
 * so model has to be stricter
 */
/** OpenAI structured outputs require .nullable() instead of .optional() - all fields must be present. */
export declare const EvidenceCitationSchema: z.ZodObject<{
    documentId: z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
    title: z.ZodNullable<z.ZodString>;
    page: z.ZodNullable<z.ZodNumber>;
    sectionPath: z.ZodNullable<z.ZodString>;
    snippet: z.ZodString;
    sourceType: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sourceType: string | null;
    title: string | null;
    documentId: string | number | null;
    page: number | null;
    sectionPath: string | null;
    snippet: string;
}, {
    sourceType: string | null;
    title: string | null;
    documentId: string | number | null;
    page: number | null;
    sectionPath: string | null;
    snippet: string;
}>;
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;
export declare const NormalizedClaimSchema: z.ZodObject<{
    claim: z.ZodString;
    category: z.ZodString;
    confidence: z.ZodEnum<["high", "medium", "low"]>;
    citations: z.ZodDefault<z.ZodArray<z.ZodObject<{
        documentId: z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        title: z.ZodNullable<z.ZodString>;
        page: z.ZodNullable<z.ZodNumber>;
        sectionPath: z.ZodNullable<z.ZodString>;
        snippet: z.ZodString;
        sourceType: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sourceType: string | null;
        title: string | null;
        documentId: string | number | null;
        page: number | null;
        sectionPath: string | null;
        snippet: string;
    }, {
        sourceType: string | null;
        title: string | null;
        documentId: string | number | null;
        page: number | null;
        sectionPath: string | null;
        snippet: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    confidence: "high" | "medium" | "low";
    category: string;
    claim: string;
    citations: {
        sourceType: string | null;
        title: string | null;
        documentId: string | number | null;
        page: number | null;
        sectionPath: string | null;
        snippet: string;
    }[];
}, {
    confidence: "high" | "medium" | "low";
    category: string;
    claim: string;
    citations?: {
        sourceType: string | null;
        title: string | null;
        documentId: string | number | null;
        page: number | null;
        sectionPath: string | null;
        snippet: string;
    }[] | undefined;
}>;
export type NormalizedClaim = z.infer<typeof NormalizedClaimSchema>;
export declare const NormalizedCompanyKnowledgeSchema: z.ZodObject<{
    companyName: z.ZodString;
    whatItDoes: z.ZodString;
    targetAudience: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    categories: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    keyDifferentiators: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    proofPoints: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    capabilities: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    customerPainPoints: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    outcomes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    brandValues: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    founderStory: z.ZodString;
    technicalEdge: z.ZodString;
    risksOrUnknowns: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
        claim: z.ZodString;
        category: z.ZodString;
        confidence: z.ZodEnum<["high", "medium", "low"]>;
        citations: z.ZodDefault<z.ZodArray<z.ZodObject<{
            documentId: z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
            title: z.ZodNullable<z.ZodString>;
            page: z.ZodNullable<z.ZodNumber>;
            sectionPath: z.ZodNullable<z.ZodString>;
            snippet: z.ZodString;
            sourceType: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            sourceType: string | null;
            title: string | null;
            documentId: string | number | null;
            page: number | null;
            sectionPath: string | null;
            snippet: string;
        }, {
            sourceType: string | null;
            title: string | null;
            documentId: string | number | null;
            page: number | null;
            sectionPath: string | null;
            snippet: string;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        confidence: "high" | "medium" | "low";
        category: string;
        claim: string;
        citations: {
            sourceType: string | null;
            title: string | null;
            documentId: string | number | null;
            page: number | null;
            sectionPath: string | null;
            snippet: string;
        }[];
    }, {
        confidence: "high" | "medium" | "low";
        category: string;
        claim: string;
        citations?: {
            sourceType: string | null;
            title: string | null;
            documentId: string | number | null;
            page: number | null;
            sectionPath: string | null;
            snippet: string;
        }[] | undefined;
    }>, "many">>;
    summary: z.ZodString;
    missingInformation: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    categories: string[];
    summary: string;
    keyDifferentiators: string[];
    technicalEdge: string;
    claims: {
        confidence: "high" | "medium" | "low";
        category: string;
        claim: string;
        citations: {
            sourceType: string | null;
            title: string | null;
            documentId: string | number | null;
            page: number | null;
            sectionPath: string | null;
            snippet: string;
        }[];
    }[];
    companyName: string;
    whatItDoes: string;
    targetAudience: string[];
    proofPoints: string[];
    capabilities: string[];
    customerPainPoints: string[];
    outcomes: string[];
    brandValues: string[];
    founderStory: string;
    risksOrUnknowns: string[];
    missingInformation: string[];
}, {
    summary: string;
    technicalEdge: string;
    companyName: string;
    whatItDoes: string;
    founderStory: string;
    categories?: string[] | undefined;
    keyDifferentiators?: string[] | undefined;
    claims?: {
        confidence: "high" | "medium" | "low";
        category: string;
        claim: string;
        citations?: {
            sourceType: string | null;
            title: string | null;
            documentId: string | number | null;
            page: number | null;
            sectionPath: string | null;
            snippet: string;
        }[] | undefined;
    }[] | undefined;
    targetAudience?: string[] | undefined;
    proofPoints?: string[] | undefined;
    capabilities?: string[] | undefined;
    customerPainPoints?: string[] | undefined;
    outcomes?: string[] | undefined;
    brandValues?: string[] | undefined;
    risksOrUnknowns?: string[] | undefined;
    missingInformation?: string[] | undefined;
}>;
export type NormalizedCompanyKnowledge = z.infer<typeof NormalizedCompanyKnowledgeSchema>;
export declare const KnowledgeValidationReportSchema: z.ZodObject<{
    groundednessScore: z.ZodNumber;
    completenessScore: z.ZodNumber;
    consistencyScore: z.ZodNumber;
    needsRevision: z.ZodBoolean;
    unsupportedClaims: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    missingCriticalFields: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    revisionNotes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    groundednessScore: number;
    completenessScore: number;
    consistencyScore: number;
    needsRevision: boolean;
    unsupportedClaims: string[];
    missingCriticalFields: string[];
    revisionNotes: string[];
}, {
    groundednessScore: number;
    completenessScore: number;
    consistencyScore: number;
    needsRevision: boolean;
    unsupportedClaims?: string[] | undefined;
    missingCriticalFields?: string[] | undefined;
    revisionNotes?: string[] | undefined;
}>;
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
export declare const CompetitorAnalysisSchema: z.ZodObject<{
    competitors: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        positioning: z.ZodString;
        weaknesses: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        positioning: string;
        weaknesses: string[];
    }, {
        name: string;
        positioning: string;
        weaknesses: string[];
    }>, "many">;
    ourAdvantages: z.ZodArray<z.ZodString, "many">;
    marketGaps: z.ZodArray<z.ZodString, "many">;
    messagingAntiPatterns: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    competitors: {
        name: string;
        positioning: string;
        weaknesses: string[];
    }[];
    ourAdvantages: string[];
    marketGaps: string[];
    messagingAntiPatterns: string[];
}, {
    competitors: {
        name: string;
        positioning: string;
        weaknesses: string[];
    }[];
    ourAdvantages: string[];
    marketGaps: string[];
    messagingAntiPatterns: string[];
}>;
/** Messaging strategy derived from DNA + competitors + trends (issue #232). */
export interface MessagingStrategy {
    angle: string;
    keyProof: string[];
    humanHook: string;
    avoidList: string[];
}
export declare const MessagingStrategySchema: z.ZodObject<{
    angle: z.ZodString;
    keyProof: z.ZodArray<z.ZodString, "many">;
    humanHook: z.ZodString;
    avoidList: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    angle: string;
    keyProof: string[];
    humanHook: string;
    avoidList: string[];
}, {
    angle: string;
    keyProof: string[];
    humanHook: string;
    avoidList: string[];
}>;
export { MarketingPlatformEnum } from "@launchstack/tools/platform-profiles";
export type { MarketingPlatform } from "@launchstack/tools/platform-profiles";
import type { MarketingPlatform } from "@launchstack/tools/platform-profiles";
export declare const PlatformMetaSchema: z.ZodOptional<z.ZodObject<{
    subreddit: z.ZodOptional<z.ZodString>;
    hashtags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    subreddit?: string | undefined;
    hashtags?: string[] | undefined;
}, {
    subreddit?: string | undefined;
    hashtags?: string[] | undefined;
}>>;
/**
 * Brand-voice and persona types moved to @launchstack/tools (unification
 * PR-2); re-exported so the marketing barrel's surface is unchanged.
 */
export { BrandVoiceSchema, FormalityLevelEnum } from "@launchstack/tools/brand-voice";
export type { BrandVoice, FormalityLevel } from "@launchstack/tools/brand-voice";
export { TargetPersonaSchema } from "@launchstack/tools/persona";
export type { TargetPersona } from "@launchstack/tools/persona";
import type { BrandVoice } from "@launchstack/tools/brand-voice";
import type { TargetPersona } from "@launchstack/tools/persona";
export declare const ContentTypeEnum: z.ZodEnum<["post", "thread", "ad_copy", "email", "multi_platform"]>;
export type ContentType = z.infer<typeof ContentTypeEnum>;
export declare const MarketingPipelineInputSchema: z.ZodObject<{
    platform: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
    prompt: z.ZodOptional<z.ZodString>;
    maxResearchResults: z.ZodOptional<z.ZodNumber>;
    platformMeta: z.ZodOptional<z.ZodObject<{
        subreddit: z.ZodOptional<z.ZodString>;
        hashtags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        subreddit?: string | undefined;
        hashtags?: string[] | undefined;
    }, {
        subreddit?: string | undefined;
        hashtags?: string[] | undefined;
    }>>;
    toneOverride: z.ZodOptional<z.ZodEnum<["formal", "conversational", "technical", "bold"]>>;
    targetAudience: z.ZodOptional<z.ZodString>;
    contentType: z.ZodOptional<z.ZodEnum<["post", "thread", "ad_copy", "email", "multi_platform"]>>;
    /**
     * Score every variant with the content-scoring rubric and select the best
     * instead of blindly taking the first (P2). Default OFF: it costs one
     * extra LLM call per variant, and flipping the default awaits benchmark
     * evidence (design doc OQ-1; RUN_LLM_BENCHMARK=1).
     */
    enableVariantRanking: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
    prompt?: string | undefined;
    targetAudience?: string | undefined;
    maxResearchResults?: number | undefined;
    platformMeta?: {
        subreddit?: string | undefined;
        hashtags?: string[] | undefined;
    } | undefined;
    toneOverride?: "bold" | "technical" | "formal" | "conversational" | undefined;
    enableVariantRanking?: boolean | undefined;
}, {
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
    prompt?: string | undefined;
    targetAudience?: string | undefined;
    maxResearchResults?: number | undefined;
    platformMeta?: {
        subreddit?: string | undefined;
        hashtags?: string[] | undefined;
    } | undefined;
    toneOverride?: "bold" | "technical" | "formal" | "conversational" | undefined;
    enableVariantRanking?: boolean | undefined;
}>;
export type MarketingPipelineInput = z.infer<typeof MarketingPipelineInputSchema>;
export interface MarketingResearchResult {
    title: string;
    url: string;
    snippet: string;
    source: MarketingPlatform;
}
export declare const MarketingPipelineOutputSchema: z.ZodObject<{
    platform: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
    message: z.ZodString;
    "image/video": z.ZodEnum<["image", "video"]>;
}, "strip", z.ZodTypeAny, {
    message: string;
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    "image/video": "image" | "video";
}, {
    message: string;
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    "image/video": "image" | "video";
}>;
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
export declare const StrategyVariantSchema: z.ZodObject<{
    variantId: z.ZodString;
    angleRationale: z.ZodString;
    angle: z.ZodString;
    keyProof: z.ZodArray<z.ZodString, "many">;
    humanHook: z.ZodString;
    avoidList: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    angle: string;
    keyProof: string[];
    humanHook: string;
    avoidList: string[];
    variantId: string;
    angleRationale: string;
}, {
    angle: string;
    keyProof: string[];
    humanHook: string;
    avoidList: string[];
    variantId: string;
    angleRationale: string;
}>;
export type StrategyVariant = z.infer<typeof StrategyVariantSchema>;
export declare const MultiStrategySchema: z.ZodObject<{
    variants: z.ZodArray<z.ZodObject<{
        variantId: z.ZodString;
        angleRationale: z.ZodString;
        angle: z.ZodString;
        keyProof: z.ZodArray<z.ZodString, "many">;
        humanHook: z.ZodString;
        avoidList: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        angle: string;
        keyProof: string[];
        humanHook: string;
        avoidList: string[];
        variantId: string;
        angleRationale: string;
    }, {
        angle: string;
        keyProof: string[];
        humanHook: string;
        avoidList: string[];
        variantId: string;
        angleRationale: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    variants: {
        angle: string;
        keyProof: string[];
        humanHook: string;
        avoidList: string[];
        variantId: string;
        angleRationale: string;
    }[];
}, {
    variants: {
        angle: string;
        keyProof: string[];
        humanHook: string;
        avoidList: string[];
        variantId: string;
        angleRationale: string;
    }[];
}>;
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
export type PipelineStepId = "loading-context" | "extracting-dna" | "analyzing-competitors" | "researching-trends" | "extracting-voice" | "extracting-persona" | "checking-performance" | "building-strategy" | "generating-content" | "verifying-claims";
export declare const PIPELINE_STEPS: ReadonlyArray<{
    id: PipelineStepId;
    label: string;
}>;
/**
 * Both unions derive from the shared PipelineProgressEvent (unification P2,
 * design D5) — previously the same four variants were hand-maintained twice.
 * The SSE protocol is the progress union plus its result/error arms.
 */
export type PipelineSSEEvent = PipelineProgressEvent<PipelineStepId> | {
    type: "result";
    success: true;
    data: MarketingPipelineResult;
} | {
    type: "error";
    success: false;
    message: string;
    error?: string;
};
export type OnPipelineProgress = (event: PipelineProgressEvent<PipelineStepId>) => void;
//# sourceMappingURL=types.d.ts.map