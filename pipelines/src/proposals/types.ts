/**
 * Grants — shared types (zod + inferred).
 *
 * The vocabulary of the surface: an *organisation profile* is what the
 * workspace can prove about itself, fact by fact with citations; an
 * *opportunity* is one funder's call as a search found it; an *application*
 * is the work of answering one call, section by section; a *library item*
 * is an answer worth reusing; a *run* is one background job over any of
 * them. Nothing here knows about a database or a model.
 */
import { z } from "zod";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const APPLICATION_STATUSES = [
    "draft",
    "in_progress",
    "in_review",
    "ready",
    "submitted",
    "awarded",
    "declined",
    "withdrawn",
] as const;
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

/** Statuses after which the application is no longer being written. */
export const CLOSED_APPLICATION_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
    "submitted",
    "awarded",
    "declined",
    "withdrawn",
]);

export const SECTION_STATUSES = ["empty", "drafted", "edited", "approved"] as const;
export const SectionStatusSchema = z.enum(SECTION_STATUSES);
export type SectionStatus = z.infer<typeof SectionStatusSchema>;

export const OPPORTUNITY_STATUSES = ["candidate", "saved", "dismissed", "applied"] as const;
export const OpportunityStatusSchema = z.enum(OPPORTUNITY_STATUSES);
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

export const PROFILE_STATUSES = ["empty", "building", "ready", "failed"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const RUN_KINDS = ["profile", "funders", "extract", "draft", "rewrite", "review"] as const;
export const RunKindSchema = z.enum(RUN_KINDS);
export type RunKind = z.infer<typeof RunKindSchema>;

export const RUN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const REQUIREMENT_KINDS = [
    "eligibility",
    "section",
    "attachment",
    "format",
    "deadline",
    "budget",
] as const;
export const RequirementKindSchema = z.enum(REQUIREMENT_KINDS);
export type RequirementKind = z.infer<typeof RequirementKindSchema>;

export const APPLICANT_TYPES = [
    "nonprofit",
    "small_business",
    "for_profit",
    "individual",
    "any",
] as const;
export const ApplicantTypeSchema = z.enum(APPLICANT_TYPES);
export type ApplicantType = z.infer<typeof ApplicantTypeSchema>;

// ─── Evidence ────────────────────────────────────────────────────────────────

/** One numbered piece of evidence a fact or a draft can cite. */
export const EvidenceSchema = z.object({
    n: z.number().int().positive(),
    documentId: z.number().int().nullable(),
    title: z.string(),
    page: z.number().int().nullable(),
    quote: z.string(),
    /** A web page, for evidence that came from a funder's site. */
    url: z.string().nullable(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ─── Organisation profile ────────────────────────────────────────────────────

export const ProfileFactSchema = z.object({
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(2_000),
    cites: z.array(z.number().int().positive()).default([]),
    /** Where the value came from: the documents, the company profile, or a person. */
    source: z.enum(["documents", "profile", "manual"]).default("documents"),
});
export type ProfileFact = z.infer<typeof ProfileFactSchema>;

export const OrgProfileSchema = z.object({
    summary: z.string(),
    applicantType: ApplicantTypeSchema,
    focusAreas: z.array(z.string()).max(10).default([]),
    geography: z.array(z.string()).max(8).default([]),
    facts: z.array(ProfileFactSchema).max(40).default([]),
    evidence: z.array(EvidenceSchema).default([]),
    builtFrom: z.object({ documents: z.number().int(), snippets: z.number().int() }),
    builtAt: z.string(),
    modelId: z.string().optional(),
    promptVersion: z.string(),
});
export type OrgProfile = z.infer<typeof OrgProfileSchema>;

/** What the model returns for a profile; the tool adds evidence and provenance. */
export const OrgProfileDraftSchema = z.object({
    summary: z
        .string()
        .describe("Two to four sentences on who the organisation is and what it does."),
    applicantType: ApplicantTypeSchema,
    focusAreas: z.array(z.string()).max(10),
    geography: z.array(z.string()).max(8),
    facts: z.array(
        z.object({
            key: z.string(),
            label: z.string(),
            value: z.string(),
            cites: z.array(z.number().int()),
        })
    ),
});
export type OrgProfileDraft = z.infer<typeof OrgProfileDraftSchema>;

// ─── Opportunities ───────────────────────────────────────────────────────────

export const FitSchema = z.object({
    score: z.number().int().min(0).max(100),
    why: z.array(z.string()).max(4),
    concerns: z.array(z.string()).max(4),
});
export type Fit = z.infer<typeof FitSchema>;

export const FunderPlanSchema = z.object({
    keywords: z.array(z.string()).min(1).max(6),
    applicantType: ApplicantTypeSchema,
    geography: z.string().nullable(),
    rationale: z.string(),
});
export type FunderPlan = z.infer<typeof FunderPlanSchema>;

export const FitBatchSchema = z.object({
    scores: z.array(
        z.object({
            externalId: z.string(),
            score: z.number().int().min(0).max(100),
            why: z.array(z.string()).max(4),
            concerns: z.array(z.string()).max(4),
        })
    ),
});

export const FunderSearchInputSchema = z.object({
    /** Overrides for the planned search; empty means "from the profile". */
    keywords: z.array(z.string().min(1).max(80)).max(8).optional(),
    geography: z.string().max(120).optional(),
    applicantType: ApplicantTypeSchema.optional(),
    includeWeb: z.boolean().optional(),
});
export type FunderSearchInput = z.infer<typeof FunderSearchInputSchema>;

// ─── Requests and requirements ───────────────────────────────────────────────

export const ExtractedSectionSchema = z.object({
    key: z.string().min(1).max(64),
    question: z.string().min(1).max(1_000),
    guidance: z.string().max(2_000).nullable(),
    wordLimit: z.number().int().positive().nullable(),
    required: z.boolean(),
});
export type ExtractedSection = z.infer<typeof ExtractedSectionSchema>;

/** What the model reads out of a funder's request. */
export const ExtractedRequestSchema = z.object({
    title: z.string().nullable(),
    funder: z.string().nullable(),
    summary: z.string().nullable(),
    /** ISO day, or null when the text names none. */
    deadline: z.string().nullable(),
    amountMin: z.number().nullable(),
    amountMax: z.number().nullable(),
    eligibility: z.array(z.string()),
    sections: z.array(ExtractedSectionSchema),
    attachments: z.array(z.string()),
    format: z.array(z.string()),
});
export type ExtractedRequest = z.infer<typeof ExtractedRequestSchema>;

export const RequirementSchema = z.object({
    id: z.string(),
    kind: RequirementKindSchema,
    text: z.string(),
    done: z.boolean(),
    /** For `section` requirements: the section this row stands for. */
    sectionKey: z.string().nullable(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

// ─── Sections and drafts ─────────────────────────────────────────────────────

export const DraftResultSchema = z.object({
    draft: z.string(),
    cites: z.array(z.number().int()),
    gaps: z.array(z.string()),
});

export const RewriteResultSchema = z.object({
    draft: z.string(),
    cites: z.array(z.number().int()),
    /** What the instruction asked for that the evidence could not supply. */
    gaps: z.array(z.string()),
});

export const DraftMetaSchema = z.object({
    cites: z.array(z.number().int()).default([]),
    gaps: z.array(z.string()).default([]),
    evidence: z.array(EvidenceSchema).default([]),
    libraryItemIds: z.array(z.string()).default([]),
    modelId: z.string().optional(),
    promptVersion: z.string().optional(),
    draftedAt: z.string().optional(),
});
export type DraftMeta = z.infer<typeof DraftMetaSchema>;

// ─── Review ──────────────────────────────────────────────────────────────────

export const FINDING_SEVERITIES = ["blocker", "warning", "note"] as const;
export const FINDING_KINDS = [
    "missing",
    "weak",
    "unsupported",
    "over_limit",
    "eligibility",
    "deadline",
    "inconsistent",
    "attachment",
] as const;

export const ReviewFindingSchema = z.object({
    id: z.string(),
    severity: z.enum(FINDING_SEVERITIES),
    kind: z.enum(FINDING_KINDS),
    sectionKey: z.string().nullable(),
    message: z.string(),
    suggestion: z.string().nullable(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewSchema = z.object({
    readiness: z.number().int().min(0).max(100),
    summary: z.string(),
    findings: z.array(ReviewFindingSchema),
    reviewedAt: z.string(),
    modelId: z.string().optional(),
    promptVersion: z.string().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;

/** What the model returns for a review; ids and deterministic checks are added after. */
export const ReviewDraftSchema = z.object({
    summary: z.string(),
    findings: z.array(
        z.object({
            severity: z.enum(FINDING_SEVERITIES),
            kind: z.enum(FINDING_KINDS),
            sectionKey: z.string().nullable(),
            message: z.string(),
            suggestion: z.string().nullable(),
        })
    ),
});

// ─── Runs ────────────────────────────────────────────────────────────────────

export const RUN_STEP_STATUSES = ["waiting", "running", "done", "failed", "skipped"] as const;
export type RunStepStatus = (typeof RUN_STEP_STATUSES)[number];

export interface RunStep {
    id: string;
    label: string;
    status: RunStepStatus;
    detail: string | null;
    startedAt?: string;
    completedAt?: string;
}

export interface RunSummary {
    /** One line for the history feed and the run sheet. */
    headline: string;
    counts?: Record<string, number>;
    durationMs?: number;
}

/** The rewrites a person can ask for without typing; `custom` carries their own words. */
export const REWRITE_PRESETS = ["tighten", "specific", "plainer", "stronger", "custom"] as const;
export const RewritePresetSchema = z.enum(REWRITE_PRESETS);
export type RewritePreset = z.infer<typeof RewritePresetSchema>;

export const RunInputSchema = z.object({
    applicationId: z.string().optional(),
    sectionIds: z.array(z.string()).optional(),
    funders: FunderSearchInputSchema.optional(),
    rewrite: z
        .object({ preset: RewritePresetSchema, instruction: z.string().max(600).optional() })
        .optional(),
});
export type RunInput = z.infer<typeof RunInputSchema>;

/** Inngest payload; bigint travels as a string. */
export const ProposalRunEventDataSchema = z.object({
    runId: z.string().min(1),
    companyId: z.string().min(1),
    userId: z.string().min(1),
});
export type ProposalRunEventData = z.infer<typeof ProposalRunEventDataSchema>;

// ─── Records ─────────────────────────────────────────────────────────────────

export interface ProfileRecord {
    id: string;
    companyId: bigint;
    status: ProfileStatus;
    profile: OrgProfile | null;
    error: string | null;
    builtAt: Date | null;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface OpportunityRecord {
    id: string;
    companyId: bigint;
    source: "grants_gov" | "web" | "manual";
    externalId: string;
    title: string;
    funder: string;
    url: string | null;
    summary: string | null;
    opensOn: string | null;
    closesOn: string | null;
    status: OpportunityStatus;
    amountMin: number | null;
    amountMax: number | null;
    eligibility: string | null;
    categories: string[];
    fit: Fit | null;
    runId: string | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface ApplicationRecord {
    id: string;
    companyId: bigint;
    opportunityId: string | null;
    title: string;
    funder: string | null;
    status: ApplicationStatus;
    deadline: string | null;
    ownerUserId: string | null;
    requestText: string | null;
    requestUrl: string | null;
    requestDocumentId: number | null;
    extracted: ExtractedRequest | null;
    requirements: Requirement[];
    review: Review | null;
    readiness: number;
    notes: string | null;
    exportedDocumentId: number | null;
    submittedAt: Date | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface SectionRecord {
    id: string;
    companyId: bigint;
    applicationId: string;
    position: number;
    key: string;
    question: string;
    guidance: string | null;
    wordLimit: number | null;
    required: boolean;
    status: SectionStatus;
    draft: string | null;
    draftMeta: DraftMeta | null;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface LibraryItemRecord {
    id: string;
    companyId: bigint;
    question: string;
    answer: string;
    tags: string[];
    evidence: Evidence[];
    sourceApplicationId: string | null;
    sourceSectionKey: string | null;
    uses: number;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface RunRecord {
    id: string;
    companyId: bigint;
    kind: RunKind;
    status: RunStatus;
    applicationId: string | null;
    userId: string;
    input: RunInput;
    steps: RunStep[];
    summary: RunSummary | null;
    error: string | null;
    creditsUsed: number;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    updatedAt: Date | null;
}
