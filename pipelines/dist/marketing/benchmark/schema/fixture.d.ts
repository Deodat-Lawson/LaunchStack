import { z } from "zod";
/**
 * Fixture schema — the version-controlled definition of one evaluation case.
 *
 * Two file types make up the dataset (OWNER: member):
 *   - fixtures/companies/<ref>/company.json  → CompanyFixtureSchema
 *   - fixtures/cases/*.json                   → FixtureSchema (references a company)
 *
 * Every fixture defines its inputs, relevant source facts, expected
 * constraints, and per-criterion evaluation config (ticket requirement).
 */
/**
 * One atomic ground-truth fact about the fixture company. Groundedness and
 * citation checks resolve a post's claims against these.
 *   - supported:     true and present in the company KB (a claim citing it is grounded)
 *   - contradictory: conflicts with a supported fact (tests contradictory-knowledge handling)
 *   - distractor:    plausible but irrelevant (should not be cited as proof)
 */
export declare const SourceFactSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    kind: z.ZodDefault<z.ZodEnum<["supported", "contradictory", "distractor"]>>;
    /** A concrete metric/number a deterministic groundedness check can string-match. */
    metric: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    text: string;
    kind: "supported" | "contradictory" | "distractor";
    metric: string | null;
}, {
    id: string;
    text: string;
    kind?: "supported" | "contradictory" | "distractor" | undefined;
    metric?: string | null | undefined;
}>;
export type SourceFact = z.infer<typeof SourceFactSchema>;
/**
 * A synthetic company used for generation. In Mode A the runner builds the
 * company-context string from `docs`; in Mode B it seeds these into a test DB.
 * Docs live as real files in the repo (ticket: "documents inside repo").
 */
export declare const CompanyFixtureSchema: z.ZodObject<{
    ref: z.ZodString;
    version: z.ZodString;
    knowledgeState: z.ZodEnum<["strong", "sparse", "missing", "contradictory"]>;
    name: z.ZodString;
    description: z.ZodString;
    industry: z.ZodString;
    categories: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** KB documents relative to this company's folder. */
    docs: z.ZodDefault<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        title: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        title: string;
        path: string;
    }, {
        title: string;
        path: string;
    }>, "many">>;
    /** Ground-truth facts for groundedness/citation scoring. */
    sourceFacts: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        kind: z.ZodDefault<z.ZodEnum<["supported", "contradictory", "distractor"]>>;
        /** A concrete metric/number a deterministic groundedness check can string-match. */
        metric: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        text: string;
        kind: "supported" | "contradictory" | "distractor";
        metric: string | null;
    }, {
        id: string;
        text: string;
        kind?: "supported" | "contradictory" | "distractor" | undefined;
        metric?: string | null | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    industry: string;
    description: string;
    ref: string;
    categories: string[];
    version: string;
    knowledgeState: "missing" | "contradictory" | "strong" | "sparse";
    docs: {
        title: string;
        path: string;
    }[];
    sourceFacts: {
        id: string;
        text: string;
        kind: "supported" | "contradictory" | "distractor";
        metric: string | null;
    }[];
}, {
    name: string;
    industry: string;
    description: string;
    ref: string;
    version: string;
    knowledgeState: "missing" | "contradictory" | "strong" | "sparse";
    categories?: string[] | undefined;
    docs?: {
        title: string;
        path: string;
    }[] | undefined;
    sourceFacts?: {
        id: string;
        text: string;
        kind?: "supported" | "contradictory" | "distractor" | undefined;
        metric?: string | null | undefined;
    }[] | undefined;
}>;
export type CompanyFixture = z.infer<typeof CompanyFixtureSchema>;
/**
 * Generation inputs for a case. Extends the product's MarketingPipelineInput
 * with benchmark-only knobs (category/goal + failure-injection toggles).
 */
export declare const FixtureInputsSchema: z.ZodObject<{
    platform: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
    prompt: z.ZodString;
    contentType: z.ZodDefault<z.ZodEnum<["post", "thread", "ad_copy", "email", "multi_platform"]>>;
    contentCategory: z.ZodEnum<["product_launch", "thought_leadership", "educational", "customer_proof", "community_discussion"]>;
    campaignGoal: z.ZodEnum<["awareness", "engagement", "conversion", "signups", "community"]>;
    targetAudience: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    toneOverride: z.ZodDefault<z.ZodNullable<z.ZodEnum<["formal", "conversational", "technical", "bold"]>>>;
    /** Failure/fallback injection (ticket: unavailable research, missing history). */
    simulateNoResearch: z.ZodDefault<z.ZodBoolean>;
    simulateNoPerformanceHistory: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    contentType: "email" | "post" | "thread" | "ad_copy" | "multi_platform";
    prompt: string;
    targetAudience: string | null;
    toneOverride: "bold" | "technical" | "formal" | "conversational" | null;
    contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
    campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
    simulateNoResearch: boolean;
    simulateNoPerformanceHistory: boolean;
}, {
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    prompt: string;
    contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
    campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
    contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
    targetAudience?: string | null | undefined;
    toneOverride?: "bold" | "technical" | "formal" | "conversational" | null | undefined;
    simulateNoResearch?: boolean | undefined;
    simulateNoPerformanceHistory?: boolean | undefined;
}>;
export type FixtureInputs = z.infer<typeof FixtureInputsSchema>;
/**
 * Deterministic expectations for the output. Everything here can be checked
 * without a model — this is where most of the member's assertions read from.
 */
export declare const ExpectedConstraintsSchema: z.ZodObject<{
    maxChars: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    minChars: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    requireCta: z.ZodDefault<z.ZodBoolean>;
    requireLink: z.ZodDefault<z.ZodBoolean>;
    hashtags: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        min: z.ZodNumber;
        max: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        min: number;
        max: number;
    }, {
        min: number;
        max: number;
    }>>>;
    requireCitations: z.ZodDefault<z.ZodBoolean>;
    minCitations: z.ZodDefault<z.ZodNumber>;
    /** Must appear (e.g. product name) — feeds specificity. */
    requiredKeywords: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Must NOT appear — fixture-specific clichés or claims known to be unsupported. */
    forbiddenPhrases: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Max pairwise similarity [0..1] between variants — feeds diversity. */
    maxVariantSimilarity: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    /** Groundedness gate: if false, any unsupported claim fails the case. */
    allowUnsupportedClaims: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    hashtags: {
        min: number;
        max: number;
    } | null;
    maxChars: number | null;
    minChars: number | null;
    requireCta: boolean;
    requireLink: boolean;
    requireCitations: boolean;
    minCitations: number;
    requiredKeywords: string[];
    forbiddenPhrases: string[];
    maxVariantSimilarity: number | null;
    allowUnsupportedClaims: boolean;
}, {
    hashtags?: {
        min: number;
        max: number;
    } | null | undefined;
    maxChars?: number | null | undefined;
    minChars?: number | null | undefined;
    requireCta?: boolean | undefined;
    requireLink?: boolean | undefined;
    requireCitations?: boolean | undefined;
    minCitations?: number | undefined;
    requiredKeywords?: string[] | undefined;
    forbiddenPhrases?: string[] | undefined;
    maxVariantSimilarity?: number | null | undefined;
    allowUnsupportedClaims?: boolean | undefined;
}>;
export type ExpectedConstraints = z.infer<typeof ExpectedConstraintsSchema>;
/** Per-fixture config for one criterion: how to score it and how to pass/fail. */
export declare const CriterionSpecSchema: z.ZodObject<{
    id: z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>;
    method: z.ZodEnum<["deterministic", "judge"]>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    weight: z.ZodDefault<z.ZodNumber>;
    /** Minimum acceptable normalized score [0..1] on this fixture (null = no gate). */
    minScore: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    /** If true, failing this criterion fails the whole case regardless of aggregate. */
    required: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
    weight: number;
    method: "judge" | "deterministic";
    required: boolean;
    enabled: boolean;
    minScore: number | null;
}, {
    id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
    method: "judge" | "deterministic";
    weight?: number | undefined;
    required?: boolean | undefined;
    enabled?: boolean | undefined;
    minScore?: number | null | undefined;
}>;
export type CriterionSpec = z.infer<typeof CriterionSpecSchema>;
export declare const FixtureSchema: z.ZodObject<{
    id: z.ZodString;
    fixtureVersion: z.ZodString;
    description: z.ZodString;
    companyRef: z.ZodString;
    inputs: z.ZodObject<{
        platform: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
        prompt: z.ZodString;
        contentType: z.ZodDefault<z.ZodEnum<["post", "thread", "ad_copy", "email", "multi_platform"]>>;
        contentCategory: z.ZodEnum<["product_launch", "thought_leadership", "educational", "customer_proof", "community_discussion"]>;
        campaignGoal: z.ZodEnum<["awareness", "engagement", "conversion", "signups", "community"]>;
        targetAudience: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        toneOverride: z.ZodDefault<z.ZodNullable<z.ZodEnum<["formal", "conversational", "technical", "bold"]>>>;
        /** Failure/fallback injection (ticket: unavailable research, missing history). */
        simulateNoResearch: z.ZodDefault<z.ZodBoolean>;
        simulateNoPerformanceHistory: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        contentType: "email" | "post" | "thread" | "ad_copy" | "multi_platform";
        prompt: string;
        targetAudience: string | null;
        toneOverride: "bold" | "technical" | "formal" | "conversational" | null;
        contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
        campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
        simulateNoResearch: boolean;
        simulateNoPerformanceHistory: boolean;
    }, {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        prompt: string;
        contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
        campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
        contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
        targetAudience?: string | null | undefined;
        toneOverride?: "bold" | "technical" | "formal" | "conversational" | null | undefined;
        simulateNoResearch?: boolean | undefined;
        simulateNoPerformanceHistory?: boolean | undefined;
    }>;
    expectedConstraints: z.ZodObject<{
        maxChars: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        minChars: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        requireCta: z.ZodDefault<z.ZodBoolean>;
        requireLink: z.ZodDefault<z.ZodBoolean>;
        hashtags: z.ZodDefault<z.ZodNullable<z.ZodObject<{
            min: z.ZodNumber;
            max: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            min: number;
            max: number;
        }, {
            min: number;
            max: number;
        }>>>;
        requireCitations: z.ZodDefault<z.ZodBoolean>;
        minCitations: z.ZodDefault<z.ZodNumber>;
        /** Must appear (e.g. product name) — feeds specificity. */
        requiredKeywords: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Must NOT appear — fixture-specific clichés or claims known to be unsupported. */
        forbiddenPhrases: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Max pairwise similarity [0..1] between variants — feeds diversity. */
        maxVariantSimilarity: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        /** Groundedness gate: if false, any unsupported claim fails the case. */
        allowUnsupportedClaims: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        hashtags: {
            min: number;
            max: number;
        } | null;
        maxChars: number | null;
        minChars: number | null;
        requireCta: boolean;
        requireLink: boolean;
        requireCitations: boolean;
        minCitations: number;
        requiredKeywords: string[];
        forbiddenPhrases: string[];
        maxVariantSimilarity: number | null;
        allowUnsupportedClaims: boolean;
    }, {
        hashtags?: {
            min: number;
            max: number;
        } | null | undefined;
        maxChars?: number | null | undefined;
        minChars?: number | null | undefined;
        requireCta?: boolean | undefined;
        requireLink?: boolean | undefined;
        requireCitations?: boolean | undefined;
        minCitations?: number | undefined;
        requiredKeywords?: string[] | undefined;
        forbiddenPhrases?: string[] | undefined;
        maxVariantSimilarity?: number | null | undefined;
        allowUnsupportedClaims?: boolean | undefined;
    }>;
    criteria: z.ZodArray<z.ZodObject<{
        id: z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>;
        method: z.ZodEnum<["deterministic", "judge"]>;
        enabled: z.ZodDefault<z.ZodBoolean>;
        weight: z.ZodDefault<z.ZodNumber>;
        /** Minimum acceptable normalized score [0..1] on this fixture (null = no gate). */
        minScore: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        /** If true, failing this criterion fails the whole case regardless of aggregate. */
        required: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        weight: number;
        method: "judge" | "deterministic";
        required: boolean;
        enabled: boolean;
        minScore: number | null;
    }, {
        id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        method: "judge" | "deterministic";
        weight?: number | undefined;
        required?: boolean | undefined;
        enabled?: boolean | undefined;
        minScore?: number | null | undefined;
    }>, "many">;
    expectedFailureMode: z.ZodDefault<z.ZodEnum<["none", "graceful_degrade", "hard_fail"]>>;
    /** Fact ids (from the company) this post may legitimately cite. */
    relevantFactIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    notes: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    description: string;
    id: string;
    fixtureVersion: string;
    companyRef: string;
    inputs: {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        contentType: "email" | "post" | "thread" | "ad_copy" | "multi_platform";
        prompt: string;
        targetAudience: string | null;
        toneOverride: "bold" | "technical" | "formal" | "conversational" | null;
        contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
        campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
        simulateNoResearch: boolean;
        simulateNoPerformanceHistory: boolean;
    };
    expectedConstraints: {
        hashtags: {
            min: number;
            max: number;
        } | null;
        maxChars: number | null;
        minChars: number | null;
        requireCta: boolean;
        requireLink: boolean;
        requireCitations: boolean;
        minCitations: number;
        requiredKeywords: string[];
        forbiddenPhrases: string[];
        maxVariantSimilarity: number | null;
        allowUnsupportedClaims: boolean;
    };
    criteria: {
        id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        weight: number;
        method: "judge" | "deterministic";
        required: boolean;
        enabled: boolean;
        minScore: number | null;
    }[];
    expectedFailureMode: "none" | "graceful_degrade" | "hard_fail";
    relevantFactIds: string[];
    notes: string | null;
}, {
    description: string;
    id: string;
    fixtureVersion: string;
    companyRef: string;
    inputs: {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        prompt: string;
        contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
        campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
        contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
        targetAudience?: string | null | undefined;
        toneOverride?: "bold" | "technical" | "formal" | "conversational" | null | undefined;
        simulateNoResearch?: boolean | undefined;
        simulateNoPerformanceHistory?: boolean | undefined;
    };
    expectedConstraints: {
        hashtags?: {
            min: number;
            max: number;
        } | null | undefined;
        maxChars?: number | null | undefined;
        minChars?: number | null | undefined;
        requireCta?: boolean | undefined;
        requireLink?: boolean | undefined;
        requireCitations?: boolean | undefined;
        minCitations?: number | undefined;
        requiredKeywords?: string[] | undefined;
        forbiddenPhrases?: string[] | undefined;
        maxVariantSimilarity?: number | null | undefined;
        allowUnsupportedClaims?: boolean | undefined;
    };
    criteria: {
        id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        method: "judge" | "deterministic";
        weight?: number | undefined;
        required?: boolean | undefined;
        enabled?: boolean | undefined;
        minScore?: number | null | undefined;
    }[];
    expectedFailureMode?: "none" | "graceful_degrade" | "hard_fail" | undefined;
    relevantFactIds?: string[] | undefined;
    notes?: string | null | undefined;
}>;
export type Fixture = z.infer<typeof FixtureSchema>;
/** Top-level dataset manifest — pins the whole fixture set for reproducibility. */
export declare const FixtureSetSchema: z.ZodObject<{
    version: z.ZodString;
    fixtures: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        fixtureVersion: z.ZodString;
        description: z.ZodString;
        companyRef: z.ZodString;
        inputs: z.ZodObject<{
            platform: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
            prompt: z.ZodString;
            contentType: z.ZodDefault<z.ZodEnum<["post", "thread", "ad_copy", "email", "multi_platform"]>>;
            contentCategory: z.ZodEnum<["product_launch", "thought_leadership", "educational", "customer_proof", "community_discussion"]>;
            campaignGoal: z.ZodEnum<["awareness", "engagement", "conversion", "signups", "community"]>;
            targetAudience: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            toneOverride: z.ZodDefault<z.ZodNullable<z.ZodEnum<["formal", "conversational", "technical", "bold"]>>>;
            /** Failure/fallback injection (ticket: unavailable research, missing history). */
            simulateNoResearch: z.ZodDefault<z.ZodBoolean>;
            simulateNoPerformanceHistory: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            platform: "x" | "linkedin" | "reddit" | "bluesky";
            contentType: "email" | "post" | "thread" | "ad_copy" | "multi_platform";
            prompt: string;
            targetAudience: string | null;
            toneOverride: "bold" | "technical" | "formal" | "conversational" | null;
            contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
            campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
            simulateNoResearch: boolean;
            simulateNoPerformanceHistory: boolean;
        }, {
            platform: "x" | "linkedin" | "reddit" | "bluesky";
            prompt: string;
            contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
            campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
            contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
            targetAudience?: string | null | undefined;
            toneOverride?: "bold" | "technical" | "formal" | "conversational" | null | undefined;
            simulateNoResearch?: boolean | undefined;
            simulateNoPerformanceHistory?: boolean | undefined;
        }>;
        expectedConstraints: z.ZodObject<{
            maxChars: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            minChars: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            requireCta: z.ZodDefault<z.ZodBoolean>;
            requireLink: z.ZodDefault<z.ZodBoolean>;
            hashtags: z.ZodDefault<z.ZodNullable<z.ZodObject<{
                min: z.ZodNumber;
                max: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                min: number;
                max: number;
            }, {
                min: number;
                max: number;
            }>>>;
            requireCitations: z.ZodDefault<z.ZodBoolean>;
            minCitations: z.ZodDefault<z.ZodNumber>;
            /** Must appear (e.g. product name) — feeds specificity. */
            requiredKeywords: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            /** Must NOT appear — fixture-specific clichés or claims known to be unsupported. */
            forbiddenPhrases: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            /** Max pairwise similarity [0..1] between variants — feeds diversity. */
            maxVariantSimilarity: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            /** Groundedness gate: if false, any unsupported claim fails the case. */
            allowUnsupportedClaims: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            hashtags: {
                min: number;
                max: number;
            } | null;
            maxChars: number | null;
            minChars: number | null;
            requireCta: boolean;
            requireLink: boolean;
            requireCitations: boolean;
            minCitations: number;
            requiredKeywords: string[];
            forbiddenPhrases: string[];
            maxVariantSimilarity: number | null;
            allowUnsupportedClaims: boolean;
        }, {
            hashtags?: {
                min: number;
                max: number;
            } | null | undefined;
            maxChars?: number | null | undefined;
            minChars?: number | null | undefined;
            requireCta?: boolean | undefined;
            requireLink?: boolean | undefined;
            requireCitations?: boolean | undefined;
            minCitations?: number | undefined;
            requiredKeywords?: string[] | undefined;
            forbiddenPhrases?: string[] | undefined;
            maxVariantSimilarity?: number | null | undefined;
            allowUnsupportedClaims?: boolean | undefined;
        }>;
        criteria: z.ZodArray<z.ZodObject<{
            id: z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>;
            method: z.ZodEnum<["deterministic", "judge"]>;
            enabled: z.ZodDefault<z.ZodBoolean>;
            weight: z.ZodDefault<z.ZodNumber>;
            /** Minimum acceptable normalized score [0..1] on this fixture (null = no gate). */
            minScore: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            /** If true, failing this criterion fails the whole case regardless of aggregate. */
            required: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            weight: number;
            method: "judge" | "deterministic";
            required: boolean;
            enabled: boolean;
            minScore: number | null;
        }, {
            id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            method: "judge" | "deterministic";
            weight?: number | undefined;
            required?: boolean | undefined;
            enabled?: boolean | undefined;
            minScore?: number | null | undefined;
        }>, "many">;
        expectedFailureMode: z.ZodDefault<z.ZodEnum<["none", "graceful_degrade", "hard_fail"]>>;
        /** Fact ids (from the company) this post may legitimately cite. */
        relevantFactIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        id: string;
        fixtureVersion: string;
        companyRef: string;
        inputs: {
            platform: "x" | "linkedin" | "reddit" | "bluesky";
            contentType: "email" | "post" | "thread" | "ad_copy" | "multi_platform";
            prompt: string;
            targetAudience: string | null;
            toneOverride: "bold" | "technical" | "formal" | "conversational" | null;
            contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
            campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
            simulateNoResearch: boolean;
            simulateNoPerformanceHistory: boolean;
        };
        expectedConstraints: {
            hashtags: {
                min: number;
                max: number;
            } | null;
            maxChars: number | null;
            minChars: number | null;
            requireCta: boolean;
            requireLink: boolean;
            requireCitations: boolean;
            minCitations: number;
            requiredKeywords: string[];
            forbiddenPhrases: string[];
            maxVariantSimilarity: number | null;
            allowUnsupportedClaims: boolean;
        };
        criteria: {
            id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            weight: number;
            method: "judge" | "deterministic";
            required: boolean;
            enabled: boolean;
            minScore: number | null;
        }[];
        expectedFailureMode: "none" | "graceful_degrade" | "hard_fail";
        relevantFactIds: string[];
        notes: string | null;
    }, {
        description: string;
        id: string;
        fixtureVersion: string;
        companyRef: string;
        inputs: {
            platform: "x" | "linkedin" | "reddit" | "bluesky";
            prompt: string;
            contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
            campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
            contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
            targetAudience?: string | null | undefined;
            toneOverride?: "bold" | "technical" | "formal" | "conversational" | null | undefined;
            simulateNoResearch?: boolean | undefined;
            simulateNoPerformanceHistory?: boolean | undefined;
        };
        expectedConstraints: {
            hashtags?: {
                min: number;
                max: number;
            } | null | undefined;
            maxChars?: number | null | undefined;
            minChars?: number | null | undefined;
            requireCta?: boolean | undefined;
            requireLink?: boolean | undefined;
            requireCitations?: boolean | undefined;
            minCitations?: number | undefined;
            requiredKeywords?: string[] | undefined;
            forbiddenPhrases?: string[] | undefined;
            maxVariantSimilarity?: number | null | undefined;
            allowUnsupportedClaims?: boolean | undefined;
        };
        criteria: {
            id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            method: "judge" | "deterministic";
            weight?: number | undefined;
            required?: boolean | undefined;
            enabled?: boolean | undefined;
            minScore?: number | null | undefined;
        }[];
        expectedFailureMode?: "none" | "graceful_degrade" | "hard_fail" | undefined;
        relevantFactIds?: string[] | undefined;
        notes?: string | null | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    version: string;
    fixtures: {
        description: string;
        id: string;
        fixtureVersion: string;
        companyRef: string;
        inputs: {
            platform: "x" | "linkedin" | "reddit" | "bluesky";
            contentType: "email" | "post" | "thread" | "ad_copy" | "multi_platform";
            prompt: string;
            targetAudience: string | null;
            toneOverride: "bold" | "technical" | "formal" | "conversational" | null;
            contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
            campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
            simulateNoResearch: boolean;
            simulateNoPerformanceHistory: boolean;
        };
        expectedConstraints: {
            hashtags: {
                min: number;
                max: number;
            } | null;
            maxChars: number | null;
            minChars: number | null;
            requireCta: boolean;
            requireLink: boolean;
            requireCitations: boolean;
            minCitations: number;
            requiredKeywords: string[];
            forbiddenPhrases: string[];
            maxVariantSimilarity: number | null;
            allowUnsupportedClaims: boolean;
        };
        criteria: {
            id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            weight: number;
            method: "judge" | "deterministic";
            required: boolean;
            enabled: boolean;
            minScore: number | null;
        }[];
        expectedFailureMode: "none" | "graceful_degrade" | "hard_fail";
        relevantFactIds: string[];
        notes: string | null;
    }[];
}, {
    version: string;
    fixtures: {
        description: string;
        id: string;
        fixtureVersion: string;
        companyRef: string;
        inputs: {
            platform: "x" | "linkedin" | "reddit" | "bluesky";
            prompt: string;
            contentCategory: "product_launch" | "thought_leadership" | "educational" | "customer_proof" | "community_discussion";
            campaignGoal: "awareness" | "engagement" | "conversion" | "signups" | "community";
            contentType?: "email" | "post" | "thread" | "ad_copy" | "multi_platform" | undefined;
            targetAudience?: string | null | undefined;
            toneOverride?: "bold" | "technical" | "formal" | "conversational" | null | undefined;
            simulateNoResearch?: boolean | undefined;
            simulateNoPerformanceHistory?: boolean | undefined;
        };
        expectedConstraints: {
            hashtags?: {
                min: number;
                max: number;
            } | null | undefined;
            maxChars?: number | null | undefined;
            minChars?: number | null | undefined;
            requireCta?: boolean | undefined;
            requireLink?: boolean | undefined;
            requireCitations?: boolean | undefined;
            minCitations?: number | undefined;
            requiredKeywords?: string[] | undefined;
            forbiddenPhrases?: string[] | undefined;
            maxVariantSimilarity?: number | null | undefined;
            allowUnsupportedClaims?: boolean | undefined;
        };
        criteria: {
            id: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            method: "judge" | "deterministic";
            weight?: number | undefined;
            required?: boolean | undefined;
            enabled?: boolean | undefined;
            minScore?: number | null | undefined;
        }[];
        expectedFailureMode?: "none" | "graceful_degrade" | "hard_fail" | undefined;
        relevantFactIds?: string[] | undefined;
        notes?: string | null | undefined;
    }[];
}>;
export type FixtureSet = z.infer<typeof FixtureSetSchema>;
//# sourceMappingURL=fixture.d.ts.map