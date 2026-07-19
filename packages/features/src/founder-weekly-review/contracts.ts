import { z } from "zod";

export const FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION =
    "founder-weekly-review-evidence/v1" as const;
export const FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION =
    "founder-weekly-review/v1" as const;

export const FounderWeeklyReviewStatusSchema = z.enum([
    "queued",
    "generating",
    "draft",
    "published",
    "failed",
]);
export type FounderWeeklyReviewStatus = z.infer<typeof FounderWeeklyReviewStatusSchema>;

export const FounderWeeklyReviewOperationTypeSchema = z.enum(["retry"]);
export type FounderWeeklyReviewOperationType = z.infer<
    typeof FounderWeeklyReviewOperationTypeSchema
>;

export const ReportingPeriodSchema = z
    .object({
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .refine((value) => value.start <= value.end, {
        message: "Reporting period start must be on or before end",
        path: ["end"],
    });
export type ReportingPeriod = z.infer<typeof ReportingPeriodSchema>;

const SerializableMetadataPrimitiveSchema = z.union([
    z.string().max(512),
    z.number().finite(),
    z.boolean(),
    z.null(),
]);

const SerializableMetadataValueSchema: z.ZodType<
    string | number | boolean | null | Array<string | number | boolean | null>
> = z.union([
    SerializableMetadataPrimitiveSchema,
    z.array(SerializableMetadataPrimitiveSchema).max(20),
]);

export const FounderWeeklyReviewEvidenceItemSchema = z.object({
    sourceType: z.enum([
        "workspace_document",
        "customer_feedback",
        "github_activity",
        "manual_note",
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
export type FounderWeeklyReviewEvidenceItem = z.infer<
    typeof FounderWeeklyReviewEvidenceItemSchema
>;

export const FounderWeeklyReviewEvidenceWarningSchema = z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
    sourceType: FounderWeeklyReviewEvidenceItemSchema.shape.sourceType.optional(),
});
export type FounderWeeklyReviewEvidenceWarning = z.infer<
    typeof FounderWeeklyReviewEvidenceWarningSchema
>;

export const FounderWeeklyReviewEvidenceSnapshotSchema = z.object({
    schemaVersion: z.literal(FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION),
    capturedAt: z.string().datetime({ offset: true }),
    reportingPeriod: ReportingPeriodSchema,
    workspaceTimezone: z.string().min(1).max(128),
    items: z.array(FounderWeeklyReviewEvidenceItemSchema).max(500),
    sourceWarnings: z.array(FounderWeeklyReviewEvidenceWarningSchema).max(100).default([]),
});
export type FounderWeeklyReviewEvidenceSnapshot = z.infer<
    typeof FounderWeeklyReviewEvidenceSnapshotSchema
>;

export const FounderWeeklyReviewConfidenceSchema = z.enum(["high", "medium", "low"]);
export type FounderWeeklyReviewConfidence = z.infer<
    typeof FounderWeeklyReviewConfidenceSchema
>;

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
export type FounderWeeklyReviewSectionItem = z.infer<
    typeof FounderWeeklyReviewSectionItemSchema
>;

const FounderWeeklyReviewSectionSchema = z.object({
    heading: z.string().min(1).max(128),
    items: z.array(FounderWeeklyReviewSectionItemSchema).max(100),
});

export const FounderWeeklyReviewPayloadSchema = z.object({
    schemaVersion: z.literal(FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION),
    sections: z.object({
        whatChanged: FounderWeeklyReviewSectionSchema,
        whatShipped: FounderWeeklyReviewSectionSchema,
        whatCustomersSaid: FounderWeeklyReviewSectionSchema,
        currentBlockers: FounderWeeklyReviewSectionSchema,
        nextPriorities: FounderWeeklyReviewSectionSchema,
    }),
});
export type FounderWeeklyReviewPayload = z.infer<typeof FounderWeeklyReviewPayloadSchema>;

export const FounderWeeklyReviewModelMetadataSchema = z.object({
    provider: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(256).optional(),
    promptVersion: z.string().min(1).max(128).optional(),
    temperature: z.number().finite().optional(),
    completionId: z.string().min(1).max(256).optional(),
    notes: z.string().min(1).max(1024).optional(),
    attributes: z.record(z.string().max(64), SerializableMetadataValueSchema).default({}),
});
export type FounderWeeklyReviewModelMetadata = z.infer<
    typeof FounderWeeklyReviewModelMetadataSchema
>;

export interface FounderWeeklyReviewRunRecord {
    id: string;
    companyId: bigint;
    requestKey: string;
    reportingPeriod: ReportingPeriod;
    status: FounderWeeklyReviewStatus;
    reviewPayload: FounderWeeklyReviewPayload | null;
    reviewSchemaVersion: typeof FOUNDER_WEEKLY_REVIEW_SCHEMA_VERSION;
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot;
    evidenceSchemaVersion: typeof FOUNDER_WEEKLY_REVIEW_EVIDENCE_SCHEMA_VERSION;
    modelMetadata: FounderWeeklyReviewModelMetadata | null;
    createdByActorId: string;
    retryCount: number;
    failureSequence: number;
    generationAttempt: number;
    generationClaimId: string | null;
    generationJobId: string | null;
    queuedAt: Date;
    claimedAt: Date | null;
    generationStartedAt: Date | null;
    generatedAt: Date | null;
    publishedAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date | null;
}

export interface FounderWeeklyReviewOperationRecord {
    id: string;
    runId: string;
    companyId: bigint;
    operationType: FounderWeeklyReviewOperationType;
    requestKey: string;
    sourceFailureSequence: number;
    actorId: string;
    createdAt: Date;
}

export interface CreateFounderWeeklyReviewRunInput {
    id: string;
    companyId: bigint;
    requestKey: string;
    reportingPeriod: ReportingPeriod;
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot;
    createdByActorId: string;
}

export interface FounderWeeklyReviewRetryInput {
    operationId: string;
    companyId: bigint;
    runId: string;
    requestKey: string;
    actorId: string;
}

export interface FounderWeeklyReviewClaimInput {
    companyId: bigint;
    runId: string;
    generationClaimId: string;
    generationJobId?: string;
}

export interface FounderWeeklyReviewGenerationFailure {
    errorCode: string;
    errorMessage?: string;
}

export interface FounderWeeklyReviewUserActor {
    externalUserId: string;
    internalUserId?: bigint;
    companyId: bigint;
    role: string;
}

export function buildFounderWeeklyReviewActorId(
    actor: Pick<FounderWeeklyReviewUserActor, "externalUserId">
): string {
    return `user:${actor.externalUserId}`;
}

export function parseFounderWeeklyReviewPayload(
    value: unknown
): FounderWeeklyReviewPayload {
    return FounderWeeklyReviewPayloadSchema.parse(value);
}

export function parseFounderWeeklyReviewEvidenceSnapshot(
    value: unknown
): FounderWeeklyReviewEvidenceSnapshot {
    return FounderWeeklyReviewEvidenceSnapshotSchema.parse(value);
}

export function parseFounderWeeklyReviewModelMetadata(
    value: unknown
): FounderWeeklyReviewModelMetadata {
    return FounderWeeklyReviewModelMetadataSchema.parse(value);
}
