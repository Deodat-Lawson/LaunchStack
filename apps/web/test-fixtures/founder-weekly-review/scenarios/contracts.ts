/**
 * Founder Weekly Review scenario fixtures: inputs *and* expected results.
 *
 * A scenario describes a world to seed (companies, documents, versions,
 * chunks) and, in `expect`, what collecting evidence over that world must
 * produce. The expectations are the point. A fixture that only describes
 * inputs cannot fail — the cross-company isolation scenario would "pass"
 * while another company's evidence leaked into the snapshot — so `expect` is
 * required, and every field in it is asserted by
 * `__tests__/founderWeeklyReview/scenario-collection.integration.test.ts`.
 *
 * The vocabulary here is deliberately limited to what the shipped evidence
 * snapshot (`founder-weekly-review-evidence/v1`) actually exposes: source-type
 * counts, warning codes, and the semantic invariants derivable from item
 * metadata. Two things a reader might expect are absent on purpose:
 *
 *   - Document-change *grouping* assertions (group counts, per-group
 *     categories, "no invented baseline" as a group-level claim) need the
 *     `documentChangeAudit` block from evidence snapshot v2, which this
 *     codebase does not emit. The baseline case is still covered here through
 *     `warningCodes` + a `document_change` count of zero.
 *   - Review *content* assertions (required/forbidden themes) need a model
 *     call. `review.sectionStates` is supported because the empty-evidence
 *     path builds its review without one; anything richer would be asserting
 *     a stub.
 *
 * Add a field here only alongside the assertion that enforces it.
 */

import { z } from "zod";

import {
    ReportingPeriodSchema,
    type FounderWeeklyReviewEvidenceItem,
} from "@launchstack/features/founder-weekly-review";

export const FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION =
    "founder-weekly-review-scenario/v1" as const;

/**
 * Column widths from `packages/core/src/db/schema/base.ts`. The contract caps
 * match the database exactly so a schema-valid fixture cannot fail at seeding
 * time — the failure mode where a 512-character title parses fine and then
 * blows up on INSERT.
 */
const DB_COMPANY_NAME_MAX = 256;
const DB_DOCUMENT_TITLE_MAX = 256;
const DB_DOCUMENT_CATEGORY_MAX = 256;
const DB_UPLOADED_BY_MAX = 256;

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

const CountExpectationSchema = z
    .object({
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
        exact: z.number().int().nonnegative().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.min === undefined && value.max === undefined && value.exact === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "a count expectation must constrain something: set min, max, or exact",
            });
        }
        if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "min must not exceed max" });
        }
        if (
            value.exact !== undefined &&
            ((value.min !== undefined && value.exact < value.min) ||
                (value.max !== undefined && value.exact > value.max))
        ) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exact must satisfy min/max" });
        }
    });
export type ScenarioCountExpectation = z.infer<typeof CountExpectationSchema>;

export const ScenarioExpectSchema = z
    .object({
        evidence: z
            .object({
                /** Per-source-type item counts in the collected snapshot. */
                sourceTypeCounts: z
                    .record(ScenarioSourceTypeSchema, CountExpectationSchema)
                    .optional(),
                /** Warning codes the snapshot must report. */
                warningCodes: z.array(z.string().min(1).max(64)).max(32).optional(),
                /** Warning codes the snapshot must not report. */
                forbiddenWarningCodes: z.array(z.string().min(1).max(64)).max(32).optional(),
            })
            .strict()
            .optional(),
        sourceSemantics: z
            .object({
                /**
                 * Only `customer_feedback` items may carry customer testimony —
                 * asserted as: no other source type is sourced from a document
                 * in the Customer Feedback category.
                 */
                customerFeedbackOnly: z.boolean().optional(),
                /** Every `document_change` item carries a `sourceTimestamp`. */
                temporalEvidenceRequired: z.boolean().optional(),
                /**
                 * No item references a document owned by a company other than
                 * the one under review. Requires a second, non-under-review
                 * company in `companies` to be a real test.
                 */
                noCrossCompanyLeakage: z.boolean().optional(),
                /**
                 * Retrieved `workspace_document` items are current-state reads,
                 * so they must not double as temporal change evidence.
                 */
                currentWorkspaceOnly: z.boolean().optional(),
            })
            .strict()
            .optional(),
        review: z
            .object({
                /**
                 * Section states of the generated review. Only assertable when
                 * generation is deterministic — today that means the
                 * empty-evidence path, which builds its review without calling
                 * a model. The harness fails if a fixture declares this and
                 * generation would need one.
                 */
                sectionStates: z
                    .record(ScenarioSectionNameSchema, z.enum(["evidence", "no_evidence"]))
                    .optional(),
            })
            .strict()
            .optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (Object.keys(value).length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "expect must assert something; an empty expect block cannot fail",
            });
        }
    });
export type FounderWeeklyReviewScenarioExpect = z.infer<typeof ScenarioExpectSchema>;

export const ScenarioChunkSchema = z
    .object({
        section: z.string().min(1).max(256),
        content: z.string().min(1).max(2000),
        pageNumber: z.number().int().positive().optional(),
        lineStart: z.number().int().positive().optional(),
        lineEnd: z.number().int().positive().optional(),
    })
    .strict();
export type FounderWeeklyReviewScenarioChunk = z.infer<typeof ScenarioChunkSchema>;

export const ScenarioVersionSchema = z
    .object({
        versionNumber: z.number().int().positive(),
        timestamp: z.string().datetime({ offset: true }),
        changelog: z.string().max(1000).optional(),
        uploadedBy: z.string().min(1).max(DB_UPLOADED_BY_MAX).optional(),
        chunks: z.array(ScenarioChunkSchema).max(200).default([]),
    })
    .strict();
export type FounderWeeklyReviewScenarioVersion = z.infer<typeof ScenarioVersionSchema>;

export const ScenarioDocumentSchema = z
    .object({
        title: z.string().min(1).max(DB_DOCUMENT_TITLE_MAX),
        category: z.string().min(1).max(DB_DOCUMENT_CATEGORY_MAX),
        versions: z.array(ScenarioVersionSchema).max(50),
    })
    .strict();
export type FounderWeeklyReviewScenarioDocument = z.infer<typeof ScenarioDocumentSchema>;

export const ScenarioCompanySchema = z
    .object({
        name: z.string().min(1).max(DB_COMPANY_NAME_MAX),
        underReview: z.boolean().default(false),
        documents: z.array(ScenarioDocumentSchema).max(200).default([]),
    })
    .strict();
export type FounderWeeklyReviewScenarioCompany = z.infer<typeof ScenarioCompanySchema>;

export const FounderWeeklyReviewScenarioSchema = z
    .object({
        schemaVersion: z
            .literal(FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION)
            .default(FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION),
        name: z.string().min(1).max(128),
        description: z.string().max(1000).optional(),
        reportingPeriod: ReportingPeriodSchema,
        workspaceTimezone: z.string().min(1).max(128),
        founderContext: z.string().min(1).max(1000).optional(),
        companies: z.array(ScenarioCompanySchema).min(1).max(10),
        /**
         * Required, not optional. An expectation-free scenario is the defect
         * this contract exists to prevent.
         */
        expect: ScenarioExpectSchema,
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
        // A leakage claim with nothing to leak from passes vacuously, which is
        // worse than not claiming it: it reads as coverage in the fixture.
        if (scenario.expect.sourceSemantics?.noCrossCompanyLeakage && scenario.companies.length < 2) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["expect", "sourceSemantics", "noCrossCompanyLeakage"],
                message:
                    "noCrossCompanyLeakage needs a second, non-under-review company to assert against",
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

export type ScenarioEvidenceSourceType = FounderWeeklyReviewEvidenceItem["sourceType"];
