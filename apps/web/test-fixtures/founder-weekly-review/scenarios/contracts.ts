import { z } from "zod";

import { ReportingPeriodSchema } from "@launchstack/features/founder-weekly-review";

export const FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION = "founder-weekly-review-scenario/v1" as const;

export const ScenarioChunkSchema = z
    .object({
        section: z.string().min(1).max(256),
        content: z.string().min(1).max(2000),
        pageNumber: z.number().int().positive().optional(),
    })
    .strict();
export type FounderWeeklyReviewScenarioChunk = z.infer<typeof ScenarioChunkSchema>;

export const ScenarioVersionSchema = z
    .object({
        versionNumber: z.number().int().positive(),
        timestamp: z.string().datetime({ offset: true }),
        changelog: z.string().max(1000).optional(),
        uploadedBy: z.string().min(1).max(256).optional(),
        chunks: z.array(ScenarioChunkSchema).max(200).default([]),
    })
    .strict();
export type FounderWeeklyReviewScenarioVersion = z.infer<typeof ScenarioVersionSchema>;

export const ScenarioDocumentSchema = z
    .object({
        title: z.string().min(1).max(512),
        category: z.string().min(1).max(256),
        versions: z.array(ScenarioVersionSchema).max(50),
    })
    .strict();
export type FounderWeeklyReviewScenarioDocument = z.infer<typeof ScenarioDocumentSchema>;

// underReview marks the single company whose snapshot is being created
// every other company should be isolated and absent from the snapshot
export const ScenarioCompanySchema = z
    .object({
        name: z.string().min(1).max(256),
        underReview: z.boolean().default(false),
        documents: z.array(ScenarioDocumentSchema).max(200).default([]),
    })
    .strict();
export type FounderWeeklyReviewScenarioCompany = z.infer<typeof ScenarioCompanySchema>;

export const FounderWeeklyReviewScenarioSchema = z
    .object({
        schemaVersion: z.literal(FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION).default(FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION),
        name: z.string().min(1).max(128),
        description: z.string().max(1000).optional(),
        reportingPeriod: ReportingPeriodSchema,
        workspaceTimezone: z.string().min(1).max(128),
        founderContext: z.string().min(1).max(1000).optional(),
        companies: z.array(ScenarioCompanySchema).min(1).max(10),
    })
    .strict()
    .superRefine((scenario, ctx) => {
        const underReview = scenario.companies.filter((company) => company.underReview);
        if (underReview.length !== 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["companies"],
                message: "Exactly one company must have underReview: true",
            });
        }

        for (const [companyIndex, company] of scenario.companies.entries()) {
            for (const [documentIndex, doc] of company.documents.entries()) {
                const versionNumbers = doc.versions.map((version) => version.versionNumber);
                if (new Set(versionNumbers).size !== versionNumbers.length) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["companies", companyIndex, "documents", documentIndex, "versions"],
                        message: "versionNumber must be unique within a document",
                    });
                }
            }
        }
    });
export type FounderWeeklyReviewScenario = z.infer<typeof FounderWeeklyReviewScenarioSchema>;
