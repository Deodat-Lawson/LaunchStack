import { z } from "zod";

import {
    DOCUMENT_CHANGE_CATEGORIES,
    ReportingPeriodSchema,
    type FounderWeeklyReviewEvidenceItem,
} from "@launchstack/features/founder-weekly-review";

export const FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION = "founder-weekly-review-scenario/v1" as const;

const ScenarioSourceTypeSchema = z.enum([
    "workspace_document",
    "document_change",
    "customer_feedback",
    "github_activity",
    "manual_note",
    "founder_context",
    "other",
]);
export type ScenarioSourceType = z.infer<typeof ScenarioSourceTypeSchema>;

const ScenarioSectionNameSchema = z.enum([
    "whatChanged",
    "whatShipped",
    "whatCustomersSaid",
    "currentBlockers",
    "nextPriorities",
]);
export type ScenarioSectionName = z.infer<typeof ScenarioSectionNameSchema>;

const CountExpectationSchema = z.object({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
    exact: z.number().int().nonnegative().optional(),
}).strict().superRefine((value, ctx) => {
    if (value.min !== undefined && value.max !== undefined && value.min > value.max) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "min must not exceed max" });
    if (value.exact !== undefined && ((value.min !== undefined && value.exact < value.min) || (value.max !== undefined && value.exact > value.max))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exact must satisfy min/max" });
});

export const ScenarioExpectSchema = z.object({
    evidence: z.object({
        sourceTypeCounts: z.record(ScenarioSourceTypeSchema, CountExpectationSchema).optional(),
        warningCodes: z.array(z.string().min(1).max(128)).max(32).optional(),
    }).strict().optional(),
    documentChanges: z.object({
        minGroups: z.number().int().nonnegative().optional(),
        maxGroups: z.number().int().nonnegative().optional(),
        requiredCategories: z.array(z.enum(DOCUMENT_CHANGE_CATEGORIES)).max(16).optional(),
        requireNoInventedBaseline: z.boolean().optional(),
    }).strict().optional(),
    sourceSemantics: z.object({
        customerFeedbackOnly: z.boolean().optional(),
        temporalEvidenceRequired: z.boolean().optional(),
        noCrossCompanyLeakage: z.boolean().optional(),
        currentWorkspaceOnly: z.boolean().optional(),
    }).strict().optional(),
    review: z.object({
        sectionStates: z.record(ScenarioSectionNameSchema, z.enum(["evidence", "no_evidence"])).optional(),
        requiredThemes: z.array(z.string().min(1).max(256)).max(16).optional(),
        forbiddenThemes: z.array(z.string().min(1).max(256)).max(16).optional(),
    }).strict().optional(),
}).strict();
export type FounderWeeklyReviewScenarioExpect = z.infer<typeof ScenarioExpectSchema>;

export const ScenarioChunkSchema = z.object({
    section: z.string().min(1).max(256),
    content: z.string().min(1).max(2000),
    pageNumber: z.number().int().positive().optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
}).strict();
export type FounderWeeklyReviewScenarioChunk = z.infer<typeof ScenarioChunkSchema>;

export const ScenarioVersionSchema = z.object({
    versionNumber: z.number().int().positive(),
    timestamp: z.string().datetime({ offset: true }),
    changelog: z.string().max(1000).optional(),
    uploadedBy: z.string().min(1).max(256).optional(),
    chunks: z.array(ScenarioChunkSchema).max(200).default([]),
}).strict();
export type FounderWeeklyReviewScenarioVersion = z.infer<typeof ScenarioVersionSchema>;

export const ScenarioDocumentSchema = z.object({
    title: z.string().min(1).max(512),
    category: z.string().min(1).max(256),
    versions: z.array(ScenarioVersionSchema).max(50),
}).strict();
export type FounderWeeklyReviewScenarioDocument = z.infer<typeof ScenarioDocumentSchema>;

export const ScenarioCompanySchema = z.object({
    name: z.string().min(1).max(256),
    underReview: z.boolean().default(false),
    documents: z.array(ScenarioDocumentSchema).max(200).default([]),
}).strict();
export type FounderWeeklyReviewScenarioCompany = z.infer<typeof ScenarioCompanySchema>;

export const FounderWeeklyReviewScenarioSchema = z.object({
    schemaVersion: z.literal(FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION).default(FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION),
    name: z.string().min(1).max(128),
    description: z.string().max(1000).optional(),
    reportingPeriod: ReportingPeriodSchema,
    workspaceTimezone: z.string().min(1).max(128),
    founderContext: z.string().min(1).max(1000).optional(),
    companies: z.array(ScenarioCompanySchema).min(1).max(10),
    expect: ScenarioExpectSchema.optional(),
}).strict().superRefine((scenario, ctx) => {
    const underReview = scenario.companies.filter((company) => company.underReview);
    if (underReview.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companies"], message: "Exactly one company must have underReview: true" });
    for (const [companyIndex, company] of scenario.companies.entries()) {
        for (const [documentIndex, doc] of company.documents.entries()) {
            const versionNumbers = doc.versions.map((version) => version.versionNumber);
            if (new Set(versionNumbers).size !== versionNumbers.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companies", companyIndex, "documents", documentIndex, "versions"], message: "versionNumber must be unique within a document" });
        }
    }
});
export type FounderWeeklyReviewScenario = z.infer<typeof FounderWeeklyReviewScenarioSchema>;

export type ScenarioEvidenceSourceType = FounderWeeklyReviewEvidenceItem["sourceType"];
