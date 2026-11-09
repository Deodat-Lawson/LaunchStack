import { z } from "zod";

import { IdSchema } from "./types";

/**
 * Company-fit rubric, version fit-v1 (Workstream 2), implementing the
 * Scoring specification of the accelerator sourcing plan (R14–R17).
 *
 * The model grades each dimension; everything in this file is plain arithmetic
 * so that results are repeatable and testable.
 */

/** Bump when weights, ratings, cutoff or grading rules change; older results then read as out of date. */
export const FIT_RUBRIC_VERSION = "fit-v1";

/** Keys match Workstream 3's screens. Weights sum to 100. */
export const FIT_DIMENSIONS = [
    { key: "sector", weight: 20 },
    { key: "stage", weight: 15 },
    { key: "businessModel", weight: 15 },
    { key: "portfolio", weight: 15 },
    { key: "deal", weight: 15 },
    { key: "operations", weight: 10 },
    { key: "value", weight: 10 },
] as const;
export type FitDimensionKey = (typeof FIT_DIMENSIONS)[number]["key"];
export const FIT_DIMENSION_KEYS = FIT_DIMENSIONS.map(({ key }) => key) as [
    FitDimensionKey,
    ...FitDimensionKey[],
];

/** Anchored ratings: 0 evidenced incompatibility … 100 direct alignment. */
export const FIT_RATINGS = [0, 25, 50, 75, 100] as const;
export type FitRating = (typeof FIT_RATINGS)[number];

/** Minimum share (percent) of applicable weight that must be rated for an overall score. */
export const MIN_FIT_COVERAGE = 70;

const FitRatingSchema = z.union([
    z.literal(0),
    z.literal(25),
    z.literal(50),
    z.literal(75),
    z.literal(100),
]);

export const FitEvidenceSchema = z
    .object({
        /** IDs from the Program's `sources`. */
        sourceIds: z.array(IdSchema),
        /** Core-profile evidence numbers. */
        companyEvidenceIds: z.array(z.number().int().positive()),
    })
    .strict();
export type FitEvidence = z.infer<typeof FitEvidenceSchema>;

export const FitDimensionResultSchema = z
    .object({
        /** Null means unknown: never 0 and never a neutral 50. */
        score: FitRatingSchema.nullable(),
        /** False only under a documented rubric rule, never because collection failed. */
        applicable: z.boolean(),
        note: z.string().trim().min(1).max(500),
        evidence: FitEvidenceSchema,
    })
    .strict()
    .superRefine((result, ctx) => {
        if (!result.applicable && result.score !== null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["score"],
                message: "A dimension that does not apply cannot be rated",
            });
        }
        if (result.score !== null) {
            if (result.evidence.sourceIds.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["evidence", "sourceIds"],
                    message: "A rating needs Program evidence",
                });
            }
            if (result.evidence.companyEvidenceIds.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["evidence", "companyEvidenceIds"],
                    message: "A rating needs company evidence",
                });
            }
        }
    });
export type FitDimensionResult = z.infer<typeof FitDimensionResultSchema>;

export const FitEligibilitySchema = z
    .object({
        status: z.enum(["eligible", "unknown", "ineligible"]),
        note: z.string().trim().min(1).max(500),
    })
    .strict();
export type FitEligibility = z.infer<typeof FitEligibilitySchema>;

export type FitDimensions = Record<FitDimensionKey, FitDimensionResult>;

/** What is stored per company and Program under rubric fit-v1. */
export const FitAssessmentV1Schema = z
    .object({
        rubricVersion: z.literal(FIT_RUBRIC_VERSION),
        eligibility: FitEligibilitySchema,
        dimensions: z
            .object(
                Object.fromEntries(
                    FIT_DIMENSION_KEYS.map(key => [key, FitDimensionResultSchema])
                ) as Record<FitDimensionKey, typeof FitDimensionResultSchema>
            )
            .strict(),
    })
    .strict();
export type FitAssessmentV1 = z.infer<typeof FitAssessmentV1Schema>;

export interface FitOverall {
    /** Weighted mean of rated dimensions, 0–100; null when coverage is below the cutoff. */
    score: number | null;
    /** Whole-number percent of applicable weight that was rated. */
    coverage: number;
}

/**
 * Overall score and evidence coverage. Dimensions that do not apply leave the
 * total; unknown dimensions stay in the total but add no score, lowering coverage.
 * The cutoff compares the exact share, so 69.6% does not round up to pass.
 */
export function summarizeFit(dimensions: Pick<FitDimensions, FitDimensionKey>): FitOverall {
    let applicableWeight = 0;
    let ratedWeight = 0;
    let weightedSum = 0;
    for (const { key, weight } of FIT_DIMENSIONS) {
        const dimension = dimensions[key];
        if (!dimension.applicable) continue;
        applicableWeight += weight;
        if (dimension.score === null) continue;
        ratedWeight += weight;
        weightedSum += dimension.score * weight;
    }
    if (applicableWeight === 0) return { score: null, coverage: 0 };
    const coverage = Math.round((ratedWeight / applicableWeight) * 100);
    const enough = ratedWeight > 0 && ratedWeight * 100 >= MIN_FIT_COVERAGE * applicableWeight;
    return { score: enough ? Math.round(weightedSum / ratedWeight) : null, coverage };
}

export const FIT_STALE_REASONS = ["profile_changed", "program_changed", "rubric_changed"] as const;
export type FitStaleReason = (typeof FIT_STALE_REASONS)[number];

export type FitFreshness =
    | { status: "current"; reasons: []; assessedAt: string }
    | { status: "out_of_date"; reasons: FitStaleReason[]; assessedAt: string }
    | { status: "not_assessed"; reasons: []; assessedAt: null };

/** What a saved result was based on. `rubricVersion` is null for rows saved before fit-v1. */
export interface FitBasis {
    profileHash: string;
    programHash: string;
    rubricVersion: string | null;
    checkedAt: string;
}

/**
 * Freshness is decided on the server each time a result is served.
 * `currentProfileHash` is null when the company has no profile any more.
 */
export function fitFreshness(
    saved: FitBasis | null,
    current: { profileHash: string | null; programHash: string }
): FitFreshness {
    if (!saved) return { status: "not_assessed", reasons: [], assessedAt: null };
    const reasons: FitStaleReason[] = [];
    if (saved.profileHash !== current.profileHash) reasons.push("profile_changed");
    if (saved.programHash !== current.programHash) reasons.push("program_changed");
    if (saved.rubricVersion !== FIT_RUBRIC_VERSION) reasons.push("rubric_changed");
    return reasons.length
        ? { status: "out_of_date", reasons, assessedAt: saved.checkedAt }
        : { status: "current", reasons: [], assessedAt: saved.checkedAt };
}
