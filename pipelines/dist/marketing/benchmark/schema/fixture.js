import { z } from "zod";
import { MarketingPlatformEnum, ContentTypeEnum, FormalityLevelEnum } from "../../types.js";
import {
    KnowledgeStateEnum,
    ContentCategoryEnum,
    CampaignGoalEnum,
    CriterionIdEnum,
    ScoringMethodEnum,
    ExpectedFailureModeEnum,
} from "./enums.js";
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
/* ────────────────────────── Source facts ────────────────────────── */
/**
 * One atomic ground-truth fact about the fixture company. Groundedness and
 * citation checks resolve a post's claims against these.
 *   - supported:     true and present in the company KB (a claim citing it is grounded)
 *   - contradictory: conflicts with a supported fact (tests contradictory-knowledge handling)
 *   - distractor:    plausible but irrelevant (should not be cited as proof)
 */
export const SourceFactSchema = z.object({
    id: z.string(), // stable id, referenced by Fixture.relevantFactIds
    text: z.string().min(1),
    kind: z.enum(["supported", "contradictory", "distractor"]).default("supported"),
    /** A concrete metric/number a deterministic groundedness check can string-match. */
    metric: z.string().nullable().default(null),
});
/* ────────────────────────── Company fixture ────────────────────────── */
/**
 * A synthetic company used for generation. In Mode A the runner builds the
 * company-context string from `docs`; in Mode B it seeds these into a test DB.
 * Docs live as real files in the repo (ticket: "documents inside repo").
 */
export const CompanyFixtureSchema = z.object({
    ref: z.string(), // folder name, referenced by Fixture.companyRef
    version: z.string(), // bump when identity/docs/facts change (reproducibility)
    knowledgeState: KnowledgeStateEnum,
    name: z.string(),
    description: z.string(),
    industry: z.string(),
    categories: z.array(z.string()).default([]),
    /** KB documents relative to this company's folder. */
    docs: z.array(z.object({ path: z.string(), title: z.string() })).default([]),
    /** Ground-truth facts for groundedness/citation scoring. */
    sourceFacts: z.array(SourceFactSchema).default([]),
});
/* ────────────────────────── Inputs ────────────────────────── */
/**
 * Generation inputs for a case. Extends the product's MarketingPipelineInput
 * with benchmark-only knobs (category/goal + failure-injection toggles).
 */
export const FixtureInputsSchema = z.object({
    platform: MarketingPlatformEnum,
    prompt: z.string().min(1),
    contentType: ContentTypeEnum.default("post"),
    contentCategory: ContentCategoryEnum,
    campaignGoal: CampaignGoalEnum,
    targetAudience: z.string().nullable().default(null),
    toneOverride: FormalityLevelEnum.nullable().default(null),
    /** Failure/fallback injection (ticket: unavailable research, missing history). */
    simulateNoResearch: z.boolean().default(false),
    simulateNoPerformanceHistory: z.boolean().default(false),
});
/* ────────────────────────── Expected constraints ────────────────────────── */
/**
 * Deterministic expectations for the output. Everything here can be checked
 * without a model — this is where most of the member's assertions read from.
 */
export const ExpectedConstraintsSchema = z.object({
    maxChars: z.number().int().positive().nullable().default(null),
    minChars: z.number().int().positive().nullable().default(null),
    requireCta: z.boolean().default(false),
    requireLink: z.boolean().default(false),
    hashtags: z
        .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
        .nullable()
        .default(null),
    requireCitations: z.boolean().default(false),
    minCitations: z.number().int().min(0).default(0),
    /** Must appear (e.g. product name) — feeds specificity. */
    requiredKeywords: z.array(z.string()).default([]),
    /** Must NOT appear — fixture-specific clichés or claims known to be unsupported. */
    forbiddenPhrases: z.array(z.string()).default([]),
    /** Max pairwise similarity [0..1] between variants — feeds diversity. */
    maxVariantSimilarity: z.number().min(0).max(1).nullable().default(null),
    /** Groundedness gate: if false, any unsupported claim fails the case. */
    allowUnsupportedClaims: z.boolean().default(false),
});
/* ────────────────────────── Criterion config ────────────────────────── */
/** Per-fixture config for one criterion: how to score it and how to pass/fail. */
export const CriterionSpecSchema = z.object({
    id: CriterionIdEnum,
    method: ScoringMethodEnum,
    enabled: z.boolean().default(true),
    weight: z.number().min(0).default(1),
    /** Minimum acceptable normalized score [0..1] on this fixture (null = no gate). */
    minScore: z.number().min(0).max(1).nullable().default(null),
    /** If true, failing this criterion fails the whole case regardless of aggregate. */
    required: z.boolean().default(false),
});
/* ────────────────────────── Fixture ────────────────────────── */
export const FixtureSchema = z.object({
    id: z.string(), // e.g. "linkedin-launch-strong-01"
    fixtureVersion: z.string(), // bump on any change (reproducibility)
    description: z.string(),
    companyRef: z.string(), // → CompanyFixture.ref
    inputs: FixtureInputsSchema,
    expectedConstraints: ExpectedConstraintsSchema,
    criteria: z.array(CriterionSpecSchema).min(1),
    expectedFailureMode: ExpectedFailureModeEnum.default("none"),
    /** Fact ids (from the company) this post may legitimately cite. */
    relevantFactIds: z.array(z.string()).default([]),
    notes: z.string().nullable().default(null),
});
/** Top-level dataset manifest — pins the whole fixture set for reproducibility. */
export const FixtureSetSchema = z.object({
    version: z.string(),
    fixtures: z.array(FixtureSchema).min(1),
});
//# sourceMappingURL=fixture.js.map
