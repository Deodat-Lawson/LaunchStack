import { z } from "zod";
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
    companyName: string;
    whatItDoes: string;
    targetAudience: string[];
    keyDifferentiators: string[];
    proofPoints: string[];
    capabilities: string[];
    customerPainPoints: string[];
    outcomes: string[];
    brandValues: string[];
    founderStory: string;
    technicalEdge: string;
    risksOrUnknowns: string[];
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
    missingInformation: string[];
}, {
    summary: string;
    companyName: string;
    whatItDoes: string;
    founderStory: string;
    technicalEdge: string;
    categories?: string[] | undefined;
    targetAudience?: string[] | undefined;
    keyDifferentiators?: string[] | undefined;
    proofPoints?: string[] | undefined;
    capabilities?: string[] | undefined;
    customerPainPoints?: string[] | undefined;
    outcomes?: string[] | undefined;
    brandValues?: string[] | undefined;
    risksOrUnknowns?: string[] | undefined;
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
/** Structured company profile distilled from KB for marketing (issue #232). */
export interface CompanyDNA {
    coreMission: string;
    keyDifferentiators: string[];
    provenResults: string[];
    humanStory: string;
    technicalEdge: string;
}
export declare const CompanyDNASchema: z.ZodObject<{
    coreMission: z.ZodString;
    keyDifferentiators: z.ZodArray<z.ZodString, "many">;
    provenResults: z.ZodArray<z.ZodString, "many">;
    humanStory: z.ZodString;
    technicalEdge: z.ZodString;
}, "strip", z.ZodTypeAny, {
    keyDifferentiators: string[];
    technicalEdge: string;
    coreMission: string;
    provenResults: string[];
    humanStory: string;
}, {
    keyDifferentiators: string[];
    technicalEdge: string;
    coreMission: string;
    provenResults: string[];
    humanStory: string;
}>;
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
export declare const MarketingPlatformEnum: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
export type MarketingPlatform = z.infer<typeof MarketingPlatformEnum>;
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
export declare const FormalityLevelEnum: z.ZodEnum<["formal", "conversational", "technical", "bold"]>;
export type FormalityLevel = z.infer<typeof FormalityLevelEnum>;
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
    /** All generated content variants (multi-variant generation). */
    variants?: ContentVariant[];
    /** All intermediate pipeline stages for transparency. */
    pipelineStages?: PipelineStages;
    /** Claim sources mapped back to KB documents. */
    claimSources?: ClaimSource[];
}
export declare const BrandVoiceSchema: z.ZodObject<{
    toneDescriptor: z.ZodString;
    vocabularyExamples: z.ZodArray<z.ZodString, "many">;
    sentenceStyle: z.ZodString;
    formalityLevel: z.ZodEnum<["formal", "conversational", "technical", "bold"]>;
}, "strip", z.ZodTypeAny, {
    toneDescriptor: string;
    vocabularyExamples: string[];
    sentenceStyle: string;
    formalityLevel: "bold" | "technical" | "formal" | "conversational";
}, {
    toneDescriptor: string;
    vocabularyExamples: string[];
    sentenceStyle: string;
    formalityLevel: "bold" | "technical" | "formal" | "conversational";
}>;
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;
export declare const TargetPersonaSchema: z.ZodObject<{
    role: z.ZodString;
    painPoints: z.ZodArray<z.ZodString, "many">;
    priorities: z.ZodArray<z.ZodString, "many">;
    languageStyle: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: string;
    painPoints: string[];
    priorities: string[];
    languageStyle: string;
}, {
    role: string;
    painPoints: string[];
    priorities: string[];
    languageStyle: string;
}>;
export type TargetPersona = z.infer<typeof TargetPersonaSchema>;
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
export type PipelineSSEEvent = {
    type: "step_start";
    step: PipelineStepId;
    label: string;
    parallelGroup?: number;
} | {
    type: "step_complete";
    step: PipelineStepId;
    durationMs: number;
    detail?: string;
    status?: "completed" | "skipped" | "failed";
} | {
    type: "step_data";
    step: PipelineStepId;
    data: Record<string, unknown>;
} | {
    type: "step_thinking";
    step: PipelineStepId;
    text: string;
} | {
    type: "result";
    success: true;
    data: MarketingPipelineResult;
} | {
    type: "error";
    success: false;
    message: string;
    error?: string;
};
export type OnPipelineProgress = (event: {
    type: "step_start";
    step: PipelineStepId;
    label: string;
    parallelGroup?: number;
} | {
    type: "step_complete";
    step: PipelineStepId;
    durationMs: number;
    detail?: string;
    status?: "completed" | "skipped" | "failed";
} | {
    type: "step_data";
    step: PipelineStepId;
    data: Record<string, unknown>;
} | {
    type: "step_thinking";
    step: PipelineStepId;
    text: string;
}) => void;
//# sourceMappingURL=types.d.ts.map