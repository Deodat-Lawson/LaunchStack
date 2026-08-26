import { z } from "zod";
import { MarketingPlatformEnum } from "../../types.js";
import { CriterionIdEnum, ScoringMethodEnum } from "./enums.js";
/**
 * Result schema — what a benchmark run emits (the machine-readable artifact).
 *
 * Captures, per the ticket: raw pipeline outputs, per-criterion scores,
 * aggregate scores, latency, failure states, and a reproducibility manifest
 * (model, prompt, config, fixture versions). The human-readable summary
 * (OWNER: member) is rendered FROM this, never in place of it.
 */
/* ────────────────────────── Reproducibility manifest ────────────────────────── */
export const RunManifestSchema = z.object({
    runId: z.string(),
    createdAt: z.string(), // ISO 8601
    gitSha: z.string().nullable().default(null),
    mode: z.enum(["A", "B"]), // A = offline generation, B = true end-to-end
    /** Snapshot of MARKETING_MODELS at run time (stage → model id). */
    pipelineModels: z.record(z.string(), z.string()),
    promptVersion: z.string(),
    judge: z.object({
        model: z.string(),
        version: z.string(), // rubric/prompt version — pinned for comparability
        temperature: z.number(),
        samples: z.number().int().positive(), // N samples per judge call (stability)
    }),
    configHash: z.string(), // hash of the fully-resolved config
    fixtureSetVersion: z.string(),
});
/* ────────────────────────── Per-criterion score ────────────────────────── */
export const TokenUsageSchema = z.object({
    prompt: z.number().int().min(0).default(0),
    completion: z.number().int().min(0).default(0),
    total: z.number().int().min(0).default(0),
});
/**
 * The unit both a deterministic assertion and a judge return (see contracts.ts).
 * `score` is always normalized to [0..1] so criteria aggregate uniformly.
 */
export const CriterionScoreSchema = z.object({
    criterionId: CriterionIdEnum,
    method: ScoringMethodEnum,
    score: z.number().min(0).max(1),
    passed: z.boolean(),
    weight: z.number().min(0),
    /** Deterministic detail ("chars=412 > max 280") or judge rationale. */
    detail: z.string().nullable().default(null),
    /** Judge stability: score spread across samples (null for deterministic). */
    stdDev: z.number().min(0).nullable().default(null),
    /** Raw judge JSON / assertion evidence, kept for audit. */
    raw: z.unknown().nullable().default(null),
});
/* ────────────────────────── Raw output + case result ────────────────────────── */
export const VariantOutputSchema = z.object({
    variantId: z.string(),
    message: z.string(),
    mediaType: z.enum(["image", "video"]).nullable().default(null),
});
export const CaseFailureSchema = z.object({
    failed: z.boolean().default(false),
    stage: z.string().nullable().default(null),
    message: z.string().nullable().default(null),
});
export const CaseResultSchema = z.object({
    fixtureId: z.string(),
    fixtureVersion: z.string(),
    platform: MarketingPlatformEnum,
    variants: z.array(VariantOutputSchema).default([]), // raw pipeline output
    scores: z.array(CriterionScoreSchema).default([]),
    aggregate: z.object({
        weighted: z.number().min(0).max(1), // weighted mean of enabled criteria
        passed: z.boolean(), // required criteria met AND thresholds satisfied
    }),
    latencyMs: z.number().min(0),
    tokenUsage: TokenUsageSchema,
    costUsd: z.number().min(0).default(0),
    failure: CaseFailureSchema,
    /** Echoed from the fixture so failure-mode expectations can be diffed. */
    expectedFailureMode: z.string(),
});
/* ────────────────────────── Run + summary ────────────────────────── */
export const BenchmarkRunSchema = z.object({
    manifest: RunManifestSchema,
    results: z.array(CaseResultSchema),
    summary: z.object({
        caseCount: z.number().int().min(0),
        passCount: z.number().int().min(0),
        meanScore: z.number().min(0).max(1),
        meanCostUsd: z.number().min(0),
        meanLatencyMs: z.number().min(0),
        /** platform → mean score, criterionId → mean score (for the summary + chart). */
        byPlatform: z.record(z.string(), z.number()).default({}),
        byCriterion: z.record(z.string(), z.number()).default({}),
    }),
});
/* ────────────────────────── Baseline comparison (CI gate) ────────────────────────── */
/** Thresholds a candidate run must not exceed vs. the approved baseline. */
export const RegressionThresholdsSchema = z.object({
    maxMeanScoreDrop: z.number().min(0).max(1).default(0.03),
    maxPerCriterionDrop: z.number().min(0).max(1).default(0.05),
    maxNewFailures: z.number().int().min(0).default(0),
});
export const BaselineComparisonSchema = z.object({
    baselineRunId: z.string(),
    candidateRunId: z.string(),
    thresholds: RegressionThresholdsSchema,
    meanScoreDelta: z.number(), // candidate - baseline (negative = worse)
    regressions: z
        .array(
            z.object({
                fixtureId: z.string(),
                criterionId: CriterionIdEnum.nullable(), // null = aggregate regression
                delta: z.number(),
            })
        )
        .default([]),
    newFailures: z.array(z.string()).default([]), // fixtureIds newly failing
    /** CI fails iff true — set only when a defined threshold is breached. */
    regressed: z.boolean(),
});
//# sourceMappingURL=result.js.map
