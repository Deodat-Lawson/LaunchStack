/**
 * Campaign Planner evaluation suite — contract types.
 *
 * This file is the contract the eval suite builds against, reconstructed as a
 * forward-compatible evolution of `apps/web/src/lib/agents/evals/types.ts`
 * (EvalScenario ≈ Fixture, EvalExpected ≈ ExpectedConstraints,
 * EvalMetric ≈ CriterionScore). See
 * `docs/issues/eval-suite-frozen-contract-missing.md` for background.
 */

import { z } from "zod";

/* ──────────────────────────────────────────────────────────────
 * Shared primitives
 * ────────────────────────────────────────────────────────────── */

/** Platforms the Campaign Planner can target. Mirrors MarketingPlatformEnum. */
export const PlatformEnum = z.enum(["x", "linkedin", "reddit", "bluesky"]);
export type Platform = z.infer<typeof PlatformEnum>;

/** Content shapes the generator supports. Mirrors ContentTypeEnum on v2. */
export const ContentTypeEnum = z.enum(["post", "thread", "ad_copy", "email", "multi_platform"]);
export type ContentType = z.infer<typeof ContentTypeEnum>;

/**
 * How badly a failed criterion should be treated.
 * `error` fails the fixture; `warning` and `info` are reported but non-fatal.
 */
export const SeverityEnum = z.enum(["error", "warning", "info"]);
export type Severity = z.infer<typeof SeverityEnum>;

/** Documented hard limits per platform, used by platform-constraint criteria. */
export const PLATFORM_CHAR_LIMITS: Readonly<Record<Platform, number>> = {
    x: 280,
    bluesky: 300,
    linkedin: 3000,
    reddit: 40000,
};

/** Hashtag ceilings the generator prompt claims to enforce. */
export const PLATFORM_HASHTAG_LIMITS: Readonly<Record<Platform, number>> = {
    x: 2,
    linkedin: 3,
    reddit: 0,
    bluesky: 2,
};

/* ──────────────────────────────────────────────────────────────
 * Source facts
 * ────────────────────────────────────────────────────────────── */

/**
 * Fact classes used to test grounding behaviour.
 *
 * - `supported`     directly backed by one or more fixture documents
 * - `contradictory` conflicts with the fixture documents
 * - `distractor`    true within the fixture universe but irrelevant to the
 *                   target campaign or product claim
 */
export const SourceFactKindEnum = z.enum(["supported", "contradictory", "distractor"]);
export type SourceFactKind = z.infer<typeof SourceFactKindEnum>;

/** What kind of claim a fact encodes — drives which criteria consume it. */
export const FactCategoryEnum = z.enum([
    "numeric",
    "capability",
    "integration",
    "pricing",
    "audience",
    "security",
    "compliance",
    "geography",
    "performance",
    "limitation",
    "comparative",
    "positioning",
]);
export type FactCategory = z.infer<typeof FactCategoryEnum>;

/** Links a fact back to the fixture document that supports or contradicts it. */
export const FactProvenanceSchema = z.object({
    /** Fixture-relative document path, e.g. "docs/product-guide.md". */
    document: z.string().min(1),
    /** Markdown heading or section label within that document. */
    section: z.string().min(1).nullable().default(null),
    /**
     * Verbatim substring from the document. For `supported` facts this MUST
     * appear in the document; tests assert traceability on that basis.
     */
    quote: z.string().min(1).nullable().default(null),
});
export type FactProvenance = z.infer<typeof FactProvenanceSchema>;

export const SourceFactSchema = z.object({
    id: z.string().min(1),
    kind: SourceFactKindEnum,
    category: FactCategoryEnum,
    /** The claim itself, stated plainly. */
    statement: z.string().min(1),
    /**
     * Where this fact comes from. Required for `supported` facts (they must be
     * traceable); optional for `distractor`; for `contradictory` it points at
     * the document the fact conflicts WITH.
     */
    provenance: z.array(FactProvenanceSchema).default([]),
    /**
     * Campaign angles / fixture ids this fact is relevant to. A `distractor` is
     * defined by being true but NOT relevant to the fixture under test, so this
     * is normally empty for distractors.
     */
    relevantTo: z.array(z.string()).default([]),
    /**
     * For `contradictory` facts: the id of the `supported` fact it contradicts.
     */
    contradicts: z.string().nullable().default(null),
    notes: z.string().nullable().default(null),
});
export type SourceFact = z.infer<typeof SourceFactSchema>;

/* ──────────────────────────────────────────────────────────────
 * Company fixture
 * ────────────────────────────────────────────────────────────── */

/** Whether a fixture is a well-documented company or a deliberately sparse one. */
export const KnowledgeDepthEnum = z.enum(["rich", "sparse"]);
export type KnowledgeDepth = z.infer<typeof KnowledgeDepthEnum>;

export const BrandVoiceSchema = z.object({
    tone: z.string().min(1),
    formality: z.enum(["formal", "conversational", "technical", "bold"]),
    sentenceStyle: z.string().min(1),
    vocabulary: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
});
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

export const ProductSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    capabilities: z.array(z.string()).default([]),
    /** Honest limitations — used to test that copy does not overclaim. */
    limitations: z.array(z.string()).default([]),
    integrations: z.array(z.string()).default([]),
});
export type Product = z.infer<typeof ProductSchema>;

export const AudienceSchema = z.object({
    label: z.string().min(1),
    role: z.string().min(1).nullable().default(null),
    painPoints: z.array(z.string()).default([]),
    priorities: z.array(z.string()).default([]),
});
export type Audience = z.infer<typeof AudienceSchema>;

export const FixtureDocumentSchema = z.object({
    /** Path relative to the company fixture directory. */
    path: z.string().min(1),
    title: z.string().min(1),
    kind: z.enum([
        "overview",
        "product_guide",
        "feature_doc",
        "case_study",
        "pricing",
        "brand_voice",
        "faq",
        "security",
        "campaign_brief",
        "spec",
        "positioning",
        "notes",
    ]),
    summary: z.string().min(1),
});
export type FixtureDocument = z.infer<typeof FixtureDocumentSchema>;

export const CompanyFixtureSchema = z.object({
    /** Stable slug, matches the fixture directory name. */
    id: z
        .string()
        .min(1)
        .regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
    name: z.string().min(1),
    /** One-line description of what this fixture is FOR, evaluation-wise. */
    archetype: z.string().min(1),
    knowledgeDepth: KnowledgeDepthEnum,

    /** Deliberately nullable — the sparse fixture leaves most of these unset. */
    summary: z.string().nullable().default(null),
    industry: z.string().nullable().default(null),
    foundedYear: z.number().int().nullable().default(null),
    headquarters: z.string().nullable().default(null),
    size: z.string().nullable().default(null),
    website: z.string().nullable().default(null),

    products: z.array(ProductSchema).default([]),
    audiences: z.array(AudienceSchema).default([]),
    differentiators: z.array(z.string()).default([]),
    proofPoints: z.array(z.string()).default([]),
    markets: z
        .object({
            primary: z.array(z.string()).default([]),
            verticals: z.array(z.string()).default([]),
            geographies: z.array(z.string()).default([]),
        })
        .default({ primary: [], verticals: [], geographies: [] }),
    people: z.array(z.object({ name: z.string().min(1), role: z.string().min(1) })).default([]),
    certifications: z.array(z.string()).default([]),
    brandVoice: BrandVoiceSchema.nullable().default(null),

    /** Competitor names that must never appear in generated copy. */
    prohibitedCompetitors: z.array(z.string()).default([]),
    /**
     * The complete set of product names that legitimately belong to this
     * company. Anything else that looks like a product name is a hallucination.
     */
    allowedProductNames: z.array(z.string()).default([]),

    documents: z.array(FixtureDocumentSchema).default([]),
    sourceFacts: z.array(SourceFactSchema).default([]),
});
export type CompanyFixture = z.infer<typeof CompanyFixtureSchema>;

/* ──────────────────────────────────────────────────────────────
 * Expected constraints
 * ────────────────────────────────────────────────────────────── */

/**
 * Declarative expectations for a fixture's generated output.
 *
 * Everything here is deterministically checkable. Subjective qualities
 * (hook strength, brand-voice fidelity, persuasiveness, creativity,
 * audience fit, campaign-goal alignment, platform-native tone) are
 * deliberately absent — those belong to the LLM judge, not this suite.
 */
const ExpectedConstraintsBaseSchema = z.object({
    /* Length */
    minChars: z.number().int().positive().nullable().default(null),
    maxChars: z.number().int().positive().nullable().default(null),
    maxWords: z.number().int().positive().nullable().default(null),
    /** Enforce the documented platform ceiling for the fixture's platform. */
    enforcePlatformCharLimit: z.boolean().default(true),

    /* Variants */
    minVariants: z.number().int().positive().nullable().default(null),
    maxVariants: z.number().int().positive().nullable().default(null),
    forbidDuplicateVariants: z.boolean().default(true),
    /** Jaccard/similarity ceiling between any two variants, 0..1. */
    maxVariantSimilarity: z.number().min(0).max(1).nullable().default(null),
    forbidRepeatedOpeningHooks: z.boolean().default(true),

    /* Surface formatting */
    maxHashtags: z.number().int().nonnegative().nullable().default(null),
    enforcePlatformHashtagLimit: z.boolean().default(false),
    maxEmojis: z.number().int().nonnegative().nullable().default(null),
    requireUrl: z.boolean().default(false),
    forbidUrl: z.boolean().default(false),
    maxQuestions: z.number().int().nonnegative().nullable().default(null),

    /* Content requirements */
    mustMention: z.array(z.string()).default([]),
    mustNotMention: z.array(z.string()).default([]),
    requiredPhrases: z.array(z.string()).default([]),
    forbiddenTerms: z.array(z.string()).default([]),
    requireDisclaimer: z.array(z.string()).default([]),

    /* Grounding */
    mustUseFactIds: z.array(z.string()).default([]),
    mustNotUseFactIds: z.array(z.string()).default([]),
    forbidContradictoryFacts: z.boolean().default(true),
    forbidDistractorFacts: z.boolean().default(false),
    forbidUnsupportedNumerics: z.boolean().default(true),
    forbidUnsupportedSuperlatives: z.boolean().default(true),
    forbidHallucinatedProductNames: z.boolean().default(true),
    forbidProhibitedCompetitors: z.boolean().default(true),
    /**
     * Ceiling on verbatim copying from source documents, as the longest
     * copied run measured in words.
     */
    maxCopiedSourceRunWords: z.number().int().positive().nullable().default(null),

    /* Structure */
    forbidEmptyOutput: z.boolean().default(true),
});
export const ExpectedConstraintsSchema = ExpectedConstraintsBaseSchema.refine(
    v => !(v.requireUrl && v.forbidUrl),
    { message: "requireUrl and forbidUrl cannot both be true" }
);
export type ExpectedConstraints = z.infer<typeof ExpectedConstraintsSchema>;

/* ──────────────────────────────────────────────────────────────
 * Criterion specs and scores
 * ────────────────────────────────────────────────────────────── */

/**
 * A declarative request to run one registered deterministic assertion,
 * optionally overriding its severity or parameters.
 */
export const CriterionSpecSchema = z.object({
    /** Registry key of a DeterministicAssertion. */
    assertion: z.string().min(1),
    /** Defaults to the assertion's own id when omitted. */
    id: z.string().min(1).nullable().default(null),
    enabled: z.boolean().default(true),
    severity: SeverityEnum.default("error"),
    /** Assertion-specific parameters, validated by the assertion itself. */
    params: z.record(z.string(), z.unknown()).default({}),
});
export type CriterionSpec = z.infer<typeof CriterionSpecSchema>;

/**
 * The result of running one deterministic assertion.
 *
 * `score` is normalised to 0..1 so criteria aggregate cleanly regardless of
 * how many sub-checks each performs. The existing `EvalMetric` in
 * `apps/web/src/lib/agents/evals/types.ts` uses raw score/maxScore; `toEvalMetric`
 * below bridges the two.
 */
export const CriterionScoreSchema = z.object({
    criterionId: z.string().min(1),
    assertion: z.string().min(1),
    passed: z.boolean(),
    score: z.number().min(0).max(1),
    severity: SeverityEnum.default("error"),
    /** Human-readable reason. Must be non-empty, including on pass. */
    explanation: z.string().min(1),
    /** Offending (or confirming) excerpts, for debugging. */
    evidence: z.array(z.string()).default([]),
    /** Index of the variant this score refers to, when variant-specific. */
    variantIndex: z.number().int().nonnegative().nullable().default(null),
});
export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

/* ──────────────────────────────────────────────────────────────
 * Generated output under evaluation
 * ────────────────────────────────────────────────────────────── */

export const GeneratedVariantSchema = z.object({
    variantId: z.string().min(1),
    message: z.string(),
    mediaType: z.enum(["image", "video"]).nullable().default(null),
    angle: z.string().nullable().default(null),
});
export type GeneratedVariant = z.infer<typeof GeneratedVariantSchema>;

/**
 * The Campaign Planner output being evaluated. Kept deliberately loose so a
 * malformed or empty generation can still be passed to assertions safely —
 * assertions are required to handle that rather than throw.
 */
export const GeneratedOutputSchema = z.object({
    platform: PlatformEnum,
    variants: z.array(GeneratedVariantSchema).default([]),
});
export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;

/* ──────────────────────────────────────────────────────────────
 * Evaluation fixture
 * ────────────────────────────────────────────────────────────── */

export const FixtureSchema = z.object({
    id: z
        .string()
        .min(1)
        .regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
    name: z.string().min(1),
    description: z.string().min(1),
    /** `CompanyFixture.id` this case runs against. */
    companyId: z.string().min(1),
    platform: PlatformEnum,
    contentType: ContentTypeEnum.default("post"),
    /** The campaign angle / marketing objective under test. */
    campaignAngle: z.string().min(1),
    /** The user prompt handed to the pipeline. */
    prompt: z.string().min(1),
    targetAudience: z.string().nullable().default(null),
    expected: ExpectedConstraintsSchema,
    criteria: z.array(CriterionSpecSchema).default([]),
    tags: z.array(z.string()).default([]),
});
export type Fixture = z.infer<typeof FixtureSchema>;

/* ──────────────────────────────────────────────────────────────
 * Evaluation context
 * ────────────────────────────────────────────────────────────── */

/**
 * Everything a deterministic assertion is allowed to consult. Assertions must
 * be pure functions of (output, context, params) — no network, no clock, no
 * filesystem — so results are reproducible.
 */
export interface EvalContext {
    fixture: Fixture;
    company: CompanyFixture;
    /** Raw document text keyed by fixture-relative path. */
    documents: Readonly<Record<string, string>>;
    /** Convenience: `company.sourceFacts` indexed by id. */
    factsById: Readonly<Record<string, SourceFact>>;
}

/* ──────────────────────────────────────────────────────────────
 * Deterministic assertions
 * ────────────────────────────────────────────────────────────── */

/**
 * A single deterministic check.
 *
 * Contract for implementers:
 *   - MUST return a valid CriterionScore (never throw, never return null).
 *   - MUST handle empty, whitespace-only, and malformed output safely.
 *   - MUST NOT make network calls or read wall-clock time.
 *   - MUST produce a non-empty explanation on both pass and fail.
 */
export interface DeterministicAssertion {
    /** Registry key. Stable; referenced by CriterionSpec.assertion. */
    id: string;
    description: string;
    /** Grouping for reporting only. */
    category: "length" | "variants" | "formatting" | "content" | "grounding" | "structure";
    run(
        output: GeneratedOutput,
        context: EvalContext,
        params?: Record<string, unknown>
    ): CriterionScore;
}

/* ──────────────────────────────────────────────────────────────
 * Interop with the existing eval framework
 * ────────────────────────────────────────────────────────────── */

/**
 * Bridge a CriterionScore into the shape the existing runner in
 * `apps/web/src/lib/agents/evals/runner.ts` already aggregates.
 */
export function toEvalMetric(score: CriterionScore): {
    name: string;
    score: number;
    maxScore: number;
    details?: string;
} {
    return {
        name: score.criterionId,
        score: score.score,
        maxScore: 1,
        details: score.explanation,
    };
}

/** Build a passing CriterionScore. */
export function pass(
    assertion: DeterministicAssertion,
    criterionId: string,
    explanation: string,
    extra: Partial<CriterionScore> = {}
): CriterionScore {
    return CriterionScoreSchema.parse({
        criterionId,
        assertion: assertion.id,
        passed: true,
        score: 1,
        explanation,
        ...extra,
    });
}

/** Build a failing CriterionScore. */
export function fail(
    assertion: DeterministicAssertion,
    criterionId: string,
    explanation: string,
    extra: Partial<CriterionScore> = {}
): CriterionScore {
    return CriterionScoreSchema.parse({
        criterionId,
        assertion: assertion.id,
        passed: false,
        score: 0,
        explanation,
        ...extra,
    });
}

/**
 * Build a partially-credited CriterionScore. `score` is `hits / total`
 * (clamped to 0..1), and `passed` is true only when every sub-check passed
 * (score reaches 1).
 */
export function partial(
    assertion: DeterministicAssertion,
    criterionId: string,
    hits: number,
    total: number,
    explanation: string,
    extra: Partial<CriterionScore> = {}
): CriterionScore {
    const score = total <= 0 ? 1 : Math.max(0, Math.min(1, hits / total));
    return CriterionScoreSchema.parse({
        criterionId,
        assertion: assertion.id,
        passed: score >= 1,
        score,
        explanation,
        ...extra,
    });
}
