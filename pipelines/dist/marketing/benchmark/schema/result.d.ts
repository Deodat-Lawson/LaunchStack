import { z } from "zod";
/**
 * Result schema — what a benchmark run emits (the machine-readable artifact).
 *
 * Captures, per the ticket: raw pipeline outputs, per-criterion scores,
 * aggregate scores, latency, failure states, and a reproducibility manifest
 * (model, prompt, config, fixture versions). The human-readable summary
 * (OWNER: member) is rendered FROM this, never in place of it.
 */
export declare const RunManifestSchema: z.ZodObject<{
    runId: z.ZodString;
    createdAt: z.ZodString;
    gitSha: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    mode: z.ZodEnum<["A", "B"]>;
    /** Snapshot of MARKETING_MODELS at run time (stage → model id). */
    pipelineModels: z.ZodRecord<z.ZodString, z.ZodString>;
    promptVersion: z.ZodString;
    judge: z.ZodObject<{
        model: z.ZodString;
        version: z.ZodString;
        temperature: z.ZodNumber;
        samples: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        model: string;
        version: string;
        temperature: number;
        samples: number;
    }, {
        model: string;
        version: string;
        temperature: number;
        samples: number;
    }>;
    configHash: z.ZodString;
    fixtureSetVersion: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mode: "A" | "B";
    createdAt: string;
    promptVersion: string;
    judge: {
        model: string;
        version: string;
        temperature: number;
        samples: number;
    };
    runId: string;
    gitSha: string | null;
    pipelineModels: Record<string, string>;
    configHash: string;
    fixtureSetVersion: string;
}, {
    mode: "A" | "B";
    createdAt: string;
    promptVersion: string;
    judge: {
        model: string;
        version: string;
        temperature: number;
        samples: number;
    };
    runId: string;
    pipelineModels: Record<string, string>;
    configHash: string;
    fixtureSetVersion: string;
    gitSha?: string | null | undefined;
}>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export declare const TokenUsageSchema: z.ZodObject<{
    prompt: z.ZodDefault<z.ZodNumber>;
    completion: z.ZodDefault<z.ZodNumber>;
    total: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    prompt: number;
    completion: number;
    total: number;
}, {
    prompt?: number | undefined;
    completion?: number | undefined;
    total?: number | undefined;
}>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
/**
 * The unit both a deterministic assertion and a judge return (see contracts.ts).
 * `score` is always normalized to [0..1] so criteria aggregate uniformly.
 */
export declare const CriterionScoreSchema: z.ZodObject<{
    criterionId: z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>;
    method: z.ZodEnum<["deterministic", "judge"]>;
    score: z.ZodNumber;
    passed: z.ZodBoolean;
    weight: z.ZodNumber;
    /** Deterministic detail ("chars=412 > max 280") or judge rationale. */
    detail: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    /** Judge stability: score spread across samples (null for deterministic). */
    stdDev: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    /** Raw judge JSON / assertion evidence, kept for audit. */
    raw: z.ZodDefault<z.ZodNullable<z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    detail: string | null;
    weight: number;
    score: number;
    method: "judge" | "deterministic";
    criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
    passed: boolean;
    stdDev: number | null;
    raw?: unknown;
}, {
    weight: number;
    score: number;
    method: "judge" | "deterministic";
    criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
    passed: boolean;
    raw?: unknown;
    detail?: string | null | undefined;
    stdDev?: number | null | undefined;
}>;
export type CriterionScore = z.infer<typeof CriterionScoreSchema>;
export declare const VariantOutputSchema: z.ZodObject<{
    variantId: z.ZodString;
    message: z.ZodString;
    mediaType: z.ZodDefault<z.ZodNullable<z.ZodEnum<["image", "video"]>>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    variantId: string;
    mediaType: "image" | "video" | null;
}, {
    message: string;
    variantId: string;
    mediaType?: "image" | "video" | null | undefined;
}>;
export type VariantOutput = z.infer<typeof VariantOutputSchema>;
export declare const CaseFailureSchema: z.ZodObject<{
    failed: z.ZodDefault<z.ZodBoolean>;
    stage: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    message: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    message: string | null;
    failed: boolean;
    stage: string | null;
}, {
    message?: string | null | undefined;
    failed?: boolean | undefined;
    stage?: string | null | undefined;
}>;
export type CaseFailure = z.infer<typeof CaseFailureSchema>;
export declare const CaseResultSchema: z.ZodObject<{
    fixtureId: z.ZodString;
    fixtureVersion: z.ZodString;
    platform: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
    variants: z.ZodDefault<z.ZodArray<z.ZodObject<{
        variantId: z.ZodString;
        message: z.ZodString;
        mediaType: z.ZodDefault<z.ZodNullable<z.ZodEnum<["image", "video"]>>>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        variantId: string;
        mediaType: "image" | "video" | null;
    }, {
        message: string;
        variantId: string;
        mediaType?: "image" | "video" | null | undefined;
    }>, "many">>;
    scores: z.ZodDefault<z.ZodArray<z.ZodObject<{
        criterionId: z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>;
        method: z.ZodEnum<["deterministic", "judge"]>;
        score: z.ZodNumber;
        passed: z.ZodBoolean;
        weight: z.ZodNumber;
        /** Deterministic detail ("chars=412 > max 280") or judge rationale. */
        detail: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        /** Judge stability: score spread across samples (null for deterministic). */
        stdDev: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        /** Raw judge JSON / assertion evidence, kept for audit. */
        raw: z.ZodDefault<z.ZodNullable<z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        detail: string | null;
        weight: number;
        score: number;
        method: "judge" | "deterministic";
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        passed: boolean;
        stdDev: number | null;
        raw?: unknown;
    }, {
        weight: number;
        score: number;
        method: "judge" | "deterministic";
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        passed: boolean;
        raw?: unknown;
        detail?: string | null | undefined;
        stdDev?: number | null | undefined;
    }>, "many">>;
    aggregate: z.ZodObject<{
        weighted: z.ZodNumber;
        passed: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        passed: boolean;
        weighted: number;
    }, {
        passed: boolean;
        weighted: number;
    }>;
    latencyMs: z.ZodNumber;
    tokenUsage: z.ZodObject<{
        prompt: z.ZodDefault<z.ZodNumber>;
        completion: z.ZodDefault<z.ZodNumber>;
        total: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        prompt: number;
        completion: number;
        total: number;
    }, {
        prompt?: number | undefined;
        completion?: number | undefined;
        total?: number | undefined;
    }>;
    costUsd: z.ZodDefault<z.ZodNumber>;
    failure: z.ZodObject<{
        failed: z.ZodDefault<z.ZodBoolean>;
        stage: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        message: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        message: string | null;
        failed: boolean;
        stage: string | null;
    }, {
        message?: string | null | undefined;
        failed?: boolean | undefined;
        stage?: string | null | undefined;
    }>;
    /** Echoed from the fixture so failure-mode expectations can be diffed. */
    expectedFailureMode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    scores: {
        detail: string | null;
        weight: number;
        score: number;
        method: "judge" | "deterministic";
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        passed: boolean;
        stdDev: number | null;
        raw?: unknown;
    }[];
    variants: {
        message: string;
        variantId: string;
        mediaType: "image" | "video" | null;
    }[];
    fixtureVersion: string;
    expectedFailureMode: string;
    fixtureId: string;
    aggregate: {
        passed: boolean;
        weighted: number;
    };
    latencyMs: number;
    tokenUsage: {
        prompt: number;
        completion: number;
        total: number;
    };
    costUsd: number;
    failure: {
        message: string | null;
        failed: boolean;
        stage: string | null;
    };
}, {
    platform: "x" | "linkedin" | "reddit" | "bluesky";
    fixtureVersion: string;
    expectedFailureMode: string;
    fixtureId: string;
    aggregate: {
        passed: boolean;
        weighted: number;
    };
    latencyMs: number;
    tokenUsage: {
        prompt?: number | undefined;
        completion?: number | undefined;
        total?: number | undefined;
    };
    failure: {
        message?: string | null | undefined;
        failed?: boolean | undefined;
        stage?: string | null | undefined;
    };
    scores?: {
        weight: number;
        score: number;
        method: "judge" | "deterministic";
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
        passed: boolean;
        raw?: unknown;
        detail?: string | null | undefined;
        stdDev?: number | null | undefined;
    }[] | undefined;
    variants?: {
        message: string;
        variantId: string;
        mediaType?: "image" | "video" | null | undefined;
    }[] | undefined;
    costUsd?: number | undefined;
}>;
export type CaseResult = z.infer<typeof CaseResultSchema>;
export declare const BenchmarkRunSchema: z.ZodObject<{
    manifest: z.ZodObject<{
        runId: z.ZodString;
        createdAt: z.ZodString;
        gitSha: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        mode: z.ZodEnum<["A", "B"]>;
        /** Snapshot of MARKETING_MODELS at run time (stage → model id). */
        pipelineModels: z.ZodRecord<z.ZodString, z.ZodString>;
        promptVersion: z.ZodString;
        judge: z.ZodObject<{
            model: z.ZodString;
            version: z.ZodString;
            temperature: z.ZodNumber;
            samples: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            model: string;
            version: string;
            temperature: number;
            samples: number;
        }, {
            model: string;
            version: string;
            temperature: number;
            samples: number;
        }>;
        configHash: z.ZodString;
        fixtureSetVersion: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        mode: "A" | "B";
        createdAt: string;
        promptVersion: string;
        judge: {
            model: string;
            version: string;
            temperature: number;
            samples: number;
        };
        runId: string;
        gitSha: string | null;
        pipelineModels: Record<string, string>;
        configHash: string;
        fixtureSetVersion: string;
    }, {
        mode: "A" | "B";
        createdAt: string;
        promptVersion: string;
        judge: {
            model: string;
            version: string;
            temperature: number;
            samples: number;
        };
        runId: string;
        pipelineModels: Record<string, string>;
        configHash: string;
        fixtureSetVersion: string;
        gitSha?: string | null | undefined;
    }>;
    results: z.ZodArray<z.ZodObject<{
        fixtureId: z.ZodString;
        fixtureVersion: z.ZodString;
        platform: z.ZodEnum<["x", "linkedin", "reddit", "bluesky"]>;
        variants: z.ZodDefault<z.ZodArray<z.ZodObject<{
            variantId: z.ZodString;
            message: z.ZodString;
            mediaType: z.ZodDefault<z.ZodNullable<z.ZodEnum<["image", "video"]>>>;
        }, "strip", z.ZodTypeAny, {
            message: string;
            variantId: string;
            mediaType: "image" | "video" | null;
        }, {
            message: string;
            variantId: string;
            mediaType?: "image" | "video" | null | undefined;
        }>, "many">>;
        scores: z.ZodDefault<z.ZodArray<z.ZodObject<{
            criterionId: z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>;
            method: z.ZodEnum<["deterministic", "judge"]>;
            score: z.ZodNumber;
            passed: z.ZodBoolean;
            weight: z.ZodNumber;
            /** Deterministic detail ("chars=412 > max 280") or judge rationale. */
            detail: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            /** Judge stability: score spread across samples (null for deterministic). */
            stdDev: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            /** Raw judge JSON / assertion evidence, kept for audit. */
            raw: z.ZodDefault<z.ZodNullable<z.ZodUnknown>>;
        }, "strip", z.ZodTypeAny, {
            detail: string | null;
            weight: number;
            score: number;
            method: "judge" | "deterministic";
            criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            passed: boolean;
            stdDev: number | null;
            raw?: unknown;
        }, {
            weight: number;
            score: number;
            method: "judge" | "deterministic";
            criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            passed: boolean;
            raw?: unknown;
            detail?: string | null | undefined;
            stdDev?: number | null | undefined;
        }>, "many">>;
        aggregate: z.ZodObject<{
            weighted: z.ZodNumber;
            passed: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            passed: boolean;
            weighted: number;
        }, {
            passed: boolean;
            weighted: number;
        }>;
        latencyMs: z.ZodNumber;
        tokenUsage: z.ZodObject<{
            prompt: z.ZodDefault<z.ZodNumber>;
            completion: z.ZodDefault<z.ZodNumber>;
            total: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            prompt: number;
            completion: number;
            total: number;
        }, {
            prompt?: number | undefined;
            completion?: number | undefined;
            total?: number | undefined;
        }>;
        costUsd: z.ZodDefault<z.ZodNumber>;
        failure: z.ZodObject<{
            failed: z.ZodDefault<z.ZodBoolean>;
            stage: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            message: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            message: string | null;
            failed: boolean;
            stage: string | null;
        }, {
            message?: string | null | undefined;
            failed?: boolean | undefined;
            stage?: string | null | undefined;
        }>;
        /** Echoed from the fixture so failure-mode expectations can be diffed. */
        expectedFailureMode: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        scores: {
            detail: string | null;
            weight: number;
            score: number;
            method: "judge" | "deterministic";
            criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            passed: boolean;
            stdDev: number | null;
            raw?: unknown;
        }[];
        variants: {
            message: string;
            variantId: string;
            mediaType: "image" | "video" | null;
        }[];
        fixtureVersion: string;
        expectedFailureMode: string;
        fixtureId: string;
        aggregate: {
            passed: boolean;
            weighted: number;
        };
        latencyMs: number;
        tokenUsage: {
            prompt: number;
            completion: number;
            total: number;
        };
        costUsd: number;
        failure: {
            message: string | null;
            failed: boolean;
            stage: string | null;
        };
    }, {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        fixtureVersion: string;
        expectedFailureMode: string;
        fixtureId: string;
        aggregate: {
            passed: boolean;
            weighted: number;
        };
        latencyMs: number;
        tokenUsage: {
            prompt?: number | undefined;
            completion?: number | undefined;
            total?: number | undefined;
        };
        failure: {
            message?: string | null | undefined;
            failed?: boolean | undefined;
            stage?: string | null | undefined;
        };
        scores?: {
            weight: number;
            score: number;
            method: "judge" | "deterministic";
            criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            passed: boolean;
            raw?: unknown;
            detail?: string | null | undefined;
            stdDev?: number | null | undefined;
        }[] | undefined;
        variants?: {
            message: string;
            variantId: string;
            mediaType?: "image" | "video" | null | undefined;
        }[] | undefined;
        costUsd?: number | undefined;
    }>, "many">;
    summary: z.ZodObject<{
        caseCount: z.ZodNumber;
        passCount: z.ZodNumber;
        meanScore: z.ZodNumber;
        meanCostUsd: z.ZodNumber;
        meanLatencyMs: z.ZodNumber;
        /** platform → mean score, criterionId → mean score (for the summary + chart). */
        byPlatform: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        byCriterion: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        caseCount: number;
        passCount: number;
        meanScore: number;
        meanCostUsd: number;
        meanLatencyMs: number;
        byPlatform: Record<string, number>;
        byCriterion: Record<string, number>;
    }, {
        caseCount: number;
        passCount: number;
        meanScore: number;
        meanCostUsd: number;
        meanLatencyMs: number;
        byPlatform?: Record<string, number> | undefined;
        byCriterion?: Record<string, number> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    summary: {
        caseCount: number;
        passCount: number;
        meanScore: number;
        meanCostUsd: number;
        meanLatencyMs: number;
        byPlatform: Record<string, number>;
        byCriterion: Record<string, number>;
    };
    results: {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        scores: {
            detail: string | null;
            weight: number;
            score: number;
            method: "judge" | "deterministic";
            criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            passed: boolean;
            stdDev: number | null;
            raw?: unknown;
        }[];
        variants: {
            message: string;
            variantId: string;
            mediaType: "image" | "video" | null;
        }[];
        fixtureVersion: string;
        expectedFailureMode: string;
        fixtureId: string;
        aggregate: {
            passed: boolean;
            weighted: number;
        };
        latencyMs: number;
        tokenUsage: {
            prompt: number;
            completion: number;
            total: number;
        };
        costUsd: number;
        failure: {
            message: string | null;
            failed: boolean;
            stage: string | null;
        };
    }[];
    manifest: {
        mode: "A" | "B";
        createdAt: string;
        promptVersion: string;
        judge: {
            model: string;
            version: string;
            temperature: number;
            samples: number;
        };
        runId: string;
        gitSha: string | null;
        pipelineModels: Record<string, string>;
        configHash: string;
        fixtureSetVersion: string;
    };
}, {
    summary: {
        caseCount: number;
        passCount: number;
        meanScore: number;
        meanCostUsd: number;
        meanLatencyMs: number;
        byPlatform?: Record<string, number> | undefined;
        byCriterion?: Record<string, number> | undefined;
    };
    results: {
        platform: "x" | "linkedin" | "reddit" | "bluesky";
        fixtureVersion: string;
        expectedFailureMode: string;
        fixtureId: string;
        aggregate: {
            passed: boolean;
            weighted: number;
        };
        latencyMs: number;
        tokenUsage: {
            prompt?: number | undefined;
            completion?: number | undefined;
            total?: number | undefined;
        };
        failure: {
            message?: string | null | undefined;
            failed?: boolean | undefined;
            stage?: string | null | undefined;
        };
        scores?: {
            weight: number;
            score: number;
            method: "judge" | "deterministic";
            criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity";
            passed: boolean;
            raw?: unknown;
            detail?: string | null | undefined;
            stdDev?: number | null | undefined;
        }[] | undefined;
        variants?: {
            message: string;
            variantId: string;
            mediaType?: "image" | "video" | null | undefined;
        }[] | undefined;
        costUsd?: number | undefined;
    }[];
    manifest: {
        mode: "A" | "B";
        createdAt: string;
        promptVersion: string;
        judge: {
            model: string;
            version: string;
            temperature: number;
            samples: number;
        };
        runId: string;
        pipelineModels: Record<string, string>;
        configHash: string;
        fixtureSetVersion: string;
        gitSha?: string | null | undefined;
    };
}>;
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;
/** Thresholds a candidate run must not exceed vs. the approved baseline. */
export declare const RegressionThresholdsSchema: z.ZodObject<{
    maxMeanScoreDrop: z.ZodDefault<z.ZodNumber>;
    maxPerCriterionDrop: z.ZodDefault<z.ZodNumber>;
    maxNewFailures: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    maxMeanScoreDrop: number;
    maxPerCriterionDrop: number;
    maxNewFailures: number;
}, {
    maxMeanScoreDrop?: number | undefined;
    maxPerCriterionDrop?: number | undefined;
    maxNewFailures?: number | undefined;
}>;
export type RegressionThresholds = z.infer<typeof RegressionThresholdsSchema>;
export declare const BaselineComparisonSchema: z.ZodObject<{
    baselineRunId: z.ZodString;
    candidateRunId: z.ZodString;
    thresholds: z.ZodObject<{
        maxMeanScoreDrop: z.ZodDefault<z.ZodNumber>;
        maxPerCriterionDrop: z.ZodDefault<z.ZodNumber>;
        maxNewFailures: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxMeanScoreDrop: number;
        maxPerCriterionDrop: number;
        maxNewFailures: number;
    }, {
        maxMeanScoreDrop?: number | undefined;
        maxPerCriterionDrop?: number | undefined;
        maxNewFailures?: number | undefined;
    }>;
    meanScoreDelta: z.ZodNumber;
    regressions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        fixtureId: z.ZodString;
        criterionId: z.ZodNullable<z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>>;
        delta: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity" | null;
        fixtureId: string;
        delta: number;
    }, {
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity" | null;
        fixtureId: string;
        delta: number;
    }>, "many">>;
    newFailures: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** CI fails iff true — set only when a defined threshold is breached. */
    regressed: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    baselineRunId: string;
    candidateRunId: string;
    thresholds: {
        maxMeanScoreDrop: number;
        maxPerCriterionDrop: number;
        maxNewFailures: number;
    };
    meanScoreDelta: number;
    regressions: {
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity" | null;
        fixtureId: string;
        delta: number;
    }[];
    newFailures: string[];
    regressed: boolean;
}, {
    baselineRunId: string;
    candidateRunId: string;
    thresholds: {
        maxMeanScoreDrop?: number | undefined;
        maxPerCriterionDrop?: number | undefined;
        maxNewFailures?: number | undefined;
    };
    meanScoreDelta: number;
    regressed: boolean;
    regressions?: {
        criterionId: "brand_voice" | "groundedness" | "specificity" | "audience_relevance" | "goal_alignment" | "platform_structure" | "hook_strength" | "cta_quality" | "cliche_generic" | "citation_coverage" | "unsupported_claims" | "variant_quality" | "variant_diversity" | null;
        fixtureId: string;
        delta: number;
    }[] | undefined;
    newFailures?: string[] | undefined;
}>;
export type BaselineComparison = z.infer<typeof BaselineComparisonSchema>;
//# sourceMappingURL=result.d.ts.map