import { z } from "zod";

import { IdSchema } from "./types";

/**
 * Company-fit rubric, version fit-v1 (Workstream 2), implementing the
 * Scoring specification of the accelerator sourcing plan (R14–R17).
 *
 * The model grades each dimension; everything in this file is plain arithmetic
 * so that results are repeatable and testable.
 */

/**
 * Bump when weights, ratings, cutoff or grading rules change; older results then read as out of date.
 * fit-v2: the portfolio dimension is graded for Supported accelerators from similar past companies.
 */
export const FIT_RUBRIC_VERSION = "fit-v2";

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

/** Most Programs one scoring run may cover; the user chooses which. */
export const MAX_PROGRAMS_PER_RUN = 100;

const FitRatingSchema = z.union([
    z.literal(0),
    z.literal(25),
    z.literal(50),
    z.literal(75),
    z.literal(100),
]);

/** A past accepted company cited as portfolio evidence, with how close it is to the profile. */
export const PortfolioMatchSchema = z
    .object({
        /** `PastCompany.id` (`${programId}:${slug}`). */
        companyId: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1),
        batch: z.string(),
        /** Cosine similarity of the profile and the company embeddings. */
        similarity: z.number().min(-1).max(1),
        /** Industries and tags the profile also names. */
        sharedTerms: z.array(z.string()),
    })
    .strict();
export type PortfolioMatch = z.infer<typeof PortfolioMatchSchema>;

export const FitEvidenceSchema = z
    .object({
        /** IDs from the Program's `sources` or its dossier evidence. */
        sourceIds: z.array(IdSchema),
        /** Core-profile evidence numbers. */
        companyEvidenceIds: z.array(z.number().int().positive()),
        /** Portfolio dimension only: the past companies the rating rests on (fit-v2). */
        portfolioCompanies: z.array(PortfolioMatchSchema).optional(),
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
            if (
                result.evidence.sourceIds.length === 0 &&
                !result.evidence.portfolioCompanies?.length
            ) {
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

/**
 * What the portfolio dimension rests on, looked up per Program. Passed in rather than
 * looked up here, so scoring never depends on how or where past-company data is stored.
 * `matches` are the past companies nearest the profile, closest first;
 * `companyEvidenceIds` are the profile excerpts behind the text that was compared.
 */
export type PortfolioEvidence =
    | { supported: false }
    | { supported: true; matches: PortfolioMatch[]; companyEvidenceIds: number[] };
export type PortfolioEvidenceLookup = (programId: string) => Promise<PortfolioEvidence>;

/** How many of the nearest past companies the portfolio rating averages over. */
export const PORTFOLIO_TOP_MATCHES = 5;

/**
 * Mean cosine similarity of the five nearest past companies → anchored rating,
 * highest threshold first. Calibrated on the YC portfolio (6,364 companies,
 * text-embedding-3-large): an unrelated bakery profile averages 0.39, a profile
 * with no product facts 0.45, adjacent markets 0.52–0.59, and a product that YC
 * funded several times over 0.70. Recalibrate when the embedding model changes.
 * Dissimilar past companies never prove incompatibility, so the rule never returns 0.
 */
export const PORTFOLIO_SIMILARITY_ANCHORS: readonly { min: number; score: FitRating }[] = [
    { min: 0.68, score: 100 },
    { min: 0.6, score: 75 },
    { min: 0.52, score: 50 },
    { min: Number.NEGATIVE_INFINITY, score: 25 },
];

/** The anchored rating for the mean similarity of the nearest matches; null without matches. */
export function portfolioRating(matches: readonly Pick<PortfolioMatch, "similarity">[]): {
    score: FitRating | null;
    similarity: number | null;
} {
    const top = matches.slice(0, PORTFOLIO_TOP_MATCHES);
    if (top.length === 0) return { score: null, similarity: null };
    const similarity = top.reduce((sum, match) => sum + match.similarity, 0) / top.length;
    const anchor = PORTFOLIO_SIMILARITY_ANCHORS.find(({ min }) => similarity >= min)!;
    return { score: anchor.score, similarity };
}

/**
 * The portfolio dimension is decided by rubric rule, not by the model. It does not
 * apply outside the Supported set (no past-company data is collected there). Inside
 * it, the nearest past companies are rated by `portfolioRating`; without them, or
 * without profile excerpts behind the compared text, the dimension is unknown.
 */
export async function portfolioDimension(
    programId: string,
    lookup: PortfolioEvidenceLookup
): Promise<FitDimensionResult> {
    const found = await lookup(programId);
    if (!found.supported) {
        return {
            score: null,
            applicable: false,
            note: "Past-company data is not collected for this accelerator.",
            evidence: { sourceIds: [], companyEvidenceIds: [] },
        };
    }
    const matches = found.matches.slice(0, PORTFOLIO_TOP_MATCHES);
    const { score, similarity } = portfolioRating(matches);
    if (score === null || similarity === null || found.companyEvidenceIds.length === 0) {
        return {
            score: null,
            applicable: true,
            note:
                matches.length === 0
                    ? "No past company of this accelerator could be compared with the profile."
                    : "The profile's product and market facts cite no source excerpt to compare.",
            evidence: { sourceIds: [], companyEvidenceIds: [] },
        };
    }
    const names = matches.map(match => match.name).join(", ");
    return {
        score,
        applicable: true,
        note: `The ${matches.length} closest past companies (${names}) average ${Math.round(similarity * 100)}% similarity to the profile.`.slice(
            0,
            500
        ),
        evidence: {
            sourceIds: [],
            companyEvidenceIds: [...new Set(found.companyEvidenceIds)].sort((a, b) => a - b),
            portfolioCompanies: matches,
        },
    };
}

/** One Program's fit as served: the stored assessment plus the computed overall result. */
export type ProgramFit = FitAssessmentV1 & { overall: FitOverall };

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

/**
 * The fit and freshness one Program serves. A saved row that cannot be read under
 * the current rubric shows no grades and is out of date with `rubric_changed`.
 */
export function programFit(
    saved: (FitBasis & { assessment: FitAssessmentV1 | null }) | null,
    current: { profileHash: string | null; programHash: string }
): { fit: ProgramFit | null; freshness: FitFreshness } {
    if (!saved) return { fit: null, freshness: fitFreshness(null, current) };
    const { assessment } = saved;
    const freshness = fitFreshness(assessment ? saved : { ...saved, rubricVersion: null }, current);
    return {
        fit: assessment ? { ...assessment, overall: summarizeFit(assessment.dimensions) } : null,
        freshness,
    };
}
