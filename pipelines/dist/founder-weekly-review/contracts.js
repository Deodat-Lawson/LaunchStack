import { z } from "zod";
export const FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION = "founder-weekly-review-evidence/v1";
export const FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION = "founder-weekly-review/v1";
export const FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION = "founder-weekly-review/v2";
export const FounderWeeklyReviewStatusSchema = z.enum([
    "queued",
    "collecting",
    "generating",
    "draft",
    "published",
    "failed",
]);
/**
 * A date the calendar actually has. The shape regex alone accepts 2026-02-31,
 * which then silently rolls forward into March when it reaches a Date.
 */
function isRealCalendarDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}
const CalendarDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
    .refine(isRealCalendarDate, "Not a real calendar date");
/**
 * An IANA zone the host's ICU data recognizes. Rejecting it at the edge matters
 * because an unknown zone is a permanent user-input error: accepted here, it
 * would be persisted and then fail inside the worker, where Inngest treats it
 * as transient and retries it to exhaustion.
 */
export function isValidTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
}
export const WorkspaceTimezoneSchema = z
    .string()
    .min(1)
    .max(128)
    .refine(isValidTimeZone, "Not a recognized IANA time zone");
/** Durable, request-derived inputs needed to collect evidence after the HTTP response. */
export const FounderWeeklyReviewCollectionInputSchema = z
    .object({
        workspaceTimezone: WorkspaceTimezoneSchema,
        founderContext: z.string().min(1).max(4000).optional(),
        actorExternalUserId: z.string().min(1).max(256),
    })
    .strict();
export const FounderWeeklyReviewOperationTypeSchema = z.enum(["retry"]);
export const ReportingPeriodSchema = z
    .object({
        start: CalendarDateSchema,
        end: CalendarDateSchema,
    })
    .refine(value => value.start <= value.end, {
        message: "Reporting period start must be on or before end",
        path: ["end"],
    });
const SerializableMetadataPrimitiveSchema = z.union([
    z.string().max(512),
    z.number().finite(),
    z.boolean(),
    z.null(),
]);
const SerializableMetadataValueSchema = z.union([
    SerializableMetadataPrimitiveSchema,
    z.array(SerializableMetadataPrimitiveSchema).max(20),
]);
export const FounderWeeklyReviewEvidenceItemSchema = z.object({
    sourceType: z.enum([
        "workspace_document",
        "document_change",
        "customer_feedback",
        "github_activity",
        "manual_note",
        "founder_context",
        "other",
    ]),
    sourceId: z.string().min(1).max(256),
    title: z.string().min(1).max(512),
    sourceTimestamp: z.string().datetime({ offset: true }).optional(),
    excerpt: z.string().min(1).max(4000),
    canonicalUrl: z.string().url().max(2048).optional(),
    workspaceDeepLink: z.string().max(2048).optional(),
    metadata: z.record(z.string().max(64), SerializableMetadataValueSchema).default({}),
});
export const FounderWeeklyReviewEvidenceWarningSchema = z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
    sourceType: FounderWeeklyReviewEvidenceItemSchema.shape.sourceType.optional(),
});
export const FounderWeeklyReviewEvidenceSnapshotSchema = z.object({
    schemaVersion: z.literal(FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION),
    capturedAt: z.string().datetime({ offset: true }),
    reportingPeriod: ReportingPeriodSchema,
    workspaceTimezone: z.string().min(1).max(128),
    items: z.array(FounderWeeklyReviewEvidenceItemSchema).max(500),
    sourceWarnings: z.array(FounderWeeklyReviewEvidenceWarningSchema).max(100).default([]),
});
export const FounderWeeklyReviewConfidenceSchema = z.enum(["high", "medium", "low"]);
export const FounderWeeklyReviewSectionItemSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("observed_fact"),
        text: z.string().min(1).max(2000),
        sourceIds: z.array(z.string().min(1).max(256)).min(1).max(20),
        confidence: FounderWeeklyReviewConfidenceSchema,
    }),
    z.object({
        kind: z.literal("recommended_item"),
        text: z.string().min(1).max(2000),
        rationale: z.string().min(1).max(2000).optional(),
        sourceIds: z.array(z.string().min(1).max(256)).max(20).default([]),
        confidence: FounderWeeklyReviewConfidenceSchema.optional(),
    }),
    z.object({
        kind: z.literal("no_evidence"),
        code: z.enum(["no_relevant_evidence", "source_unavailable", "not_assessed"]),
        note: z.string().min(1).max(512).optional(),
    }),
    z.object({
        kind: z.literal("human_edit"),
        markdown: z.string().min(1).max(12000),
    }),
]);
const FounderWeeklyReviewSectionSchema = z.object({
    heading: z.string().min(1).max(128),
    items: z.array(FounderWeeklyReviewSectionItemSchema).max(100),
});
/**
 * LAU-5 payload. Keep this schema byte-for-byte compatible with persisted v1
 * drafts; LAU-7 generation emits the separate v2 schema below.
 */
export const FounderWeeklyReviewV1PayloadSchema = z.object({
    schemaVersion: z.literal(FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION),
    sections: z.object({
        whatChanged: FounderWeeklyReviewSectionSchema,
        whatShipped: FounderWeeklyReviewSectionSchema,
        whatCustomersSaid: FounderWeeklyReviewSectionSchema,
        currentBlockers: FounderWeeklyReviewSectionSchema,
        nextPriorities: FounderWeeklyReviewSectionSchema,
    }),
});
const V2ConfidenceSchema = z.number().min(0).max(1);
function v2SourceIdsSchema(minimum) {
    return z
        .array(z.string().min(1).max(256))
        .min(minimum)
        .max(20)
        .superRefine((sourceIds, context) => {
            if (new Set(sourceIds).size !== sourceIds.length) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "sourceIds must be unique",
                });
            }
        });
}
export const FounderWeeklyReviewV2ObservedFactSchema = z
    .object({
        kind: z.literal("observed_fact"),
        text: z.string().min(1).max(2000),
        sourceIds: v2SourceIdsSchema(1),
        confidence: V2ConfidenceSchema,
    })
    .strict();
export const FounderWeeklyReviewV2ContradictoryEvidenceSchema = z
    .object({
        kind: z.literal("contradictory_evidence"),
        text: z.string().min(1).max(2000),
        sourceIds: v2SourceIdsSchema(2),
        confidence: V2ConfidenceSchema,
    })
    .strict();
export const FounderWeeklyReviewV2RecommendationSchema = z
    .object({
        kind: z.literal("recommendation"),
        label: z.literal("Recommendation"),
        text: z.string().min(1).max(2000),
        rationale: z.string().min(1).max(2000).optional(),
        sourceIds: v2SourceIdsSchema(1),
        confidence: V2ConfidenceSchema,
    })
    .strict();
export const FounderWeeklyReviewV2NoEvidenceSchema = z
    .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(512),
        cta: z.string().min(1).max(512),
    })
    .strict();
const FounderWeeklyReviewV2NoEvidenceSectionSchema = z
    .object({
        state: z.literal("no_evidence"),
        noEvidence: FounderWeeklyReviewV2NoEvidenceSchema,
    })
    .strict();
const FounderWeeklyReviewV2FactualItemSchema = z.union([
    FounderWeeklyReviewV2ObservedFactSchema,
    FounderWeeklyReviewV2ContradictoryEvidenceSchema,
]);
const FounderWeeklyReviewV2FactualSectionSchema = z.union([
    z
        .object({
            state: z.literal("evidence"),
            items: z.array(FounderWeeklyReviewV2FactualItemSchema).min(1).max(100),
        })
        .strict(),
    FounderWeeklyReviewV2NoEvidenceSectionSchema,
]);
const FounderWeeklyReviewV2PrioritySectionSchema = z.union([
    z
        .object({
            state: z.literal("evidence"),
            items: z.array(FounderWeeklyReviewV2RecommendationSchema).min(1).max(100),
        })
        .strict(),
    FounderWeeklyReviewV2NoEvidenceSectionSchema,
]);
export const FounderWeeklyReviewV2PayloadSchema = z
    .object({
        schemaVersion: z.literal(FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION),
        sections: z
            .object({
                whatChanged: FounderWeeklyReviewV2FactualSectionSchema,
                whatShipped: FounderWeeklyReviewV2FactualSectionSchema,
                whatCustomersSaid: FounderWeeklyReviewV2FactualSectionSchema,
                currentBlockers: FounderWeeklyReviewV2FactualSectionSchema,
                nextPriorities: FounderWeeklyReviewV2PrioritySectionSchema,
            })
            .strict(),
    })
    .strict();
export const FounderWeeklyReviewPayloadSchema = z.union([
    FounderWeeklyReviewV1PayloadSchema,
    FounderWeeklyReviewV2PayloadSchema,
]);
export const FounderWeeklyReviewModelMetadataSchema = z.object({
    provider: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(256).optional(),
    promptVersion: z.string().min(1).max(128).optional(),
    temperature: z.number().finite().optional(),
    capability: z.string().min(1).max(128).optional(),
    promptHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    evidenceSchemaVersion: z.string().min(1).max(128).optional(),
    reviewPayloadSchemaVersion: z.string().min(1).max(128).optional(),
    completionId: z.string().min(1).max(256).optional(),
    notes: z.string().min(1).max(1024).optional(),
    attributes: z.record(z.string().max(64), SerializableMetadataValueSchema).default({}),
});
export function buildFounderWeeklyReviewActorId(actor) {
    return `user:${actor.externalUserId}`;
}
export function parseFounderWeeklyReviewPayload(value) {
    return FounderWeeklyReviewPayloadSchema.parse(value);
}
export function parseFounderWeeklyReviewEvidenceSnapshot(value) {
    return FounderWeeklyReviewEvidenceSnapshotSchema.parse(value);
}
export function parseFounderWeeklyReviewCollectionInput(value) {
    return FounderWeeklyReviewCollectionInputSchema.parse(value);
}
export function parseFounderWeeklyReviewModelMetadata(value) {
    return FounderWeeklyReviewModelMetadataSchema.parse(value);
}
//# sourceMappingURL=contracts.js.map
