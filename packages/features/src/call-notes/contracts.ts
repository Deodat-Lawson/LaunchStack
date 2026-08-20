import { z } from "zod";

export const CALL_NOTES_SCHEMA_VERSION = "call-notes/v1" as const;
export const CALL_NOTES_ENRICHMENT_SCHEMA_VERSION = "call-notes-enrichment/v1" as const;

const IdSchema = z.string().min(1).max(64);
const ProviderKeySchema = z.string().min(1).max(256);
const TimestampSchema = z.string().datetime({ offset: true });
const CompanyIdSchema = z.string().regex(/^\d+$/);
const MarkdownSchema = z.string().max(120_000);
const RichTextSchema = z.record(z.unknown());

export const CallNotesProviderSchema = z.literal("zoom");
export type CallNotesProvider = z.infer<typeof CallNotesProviderSchema>;

export const CallStatusSchema = z.enum(["active", "finalizing", "completed", "failed"]);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const CaptureDesiredModeSchema = z.enum(["running", "paused"]);
export type CaptureDesiredMode = z.infer<typeof CaptureDesiredModeSchema>;

export const CaptureLifecycleSchema = z.enum([
    "connecting",
    "live",
    "interrupted",
    "finalizing",
    "completed",
    "failed",
]);
export type CaptureLifecycle = z.infer<typeof CaptureLifecycleSchema>;

export const CaptureOutcomeSchema = z.enum(["complete", "partial", "failed"]);
export type CaptureOutcome = z.infer<typeof CaptureOutcomeSchema>;

export const CaptureAttemptLifecycleSchema = z.enum([
    "connecting",
    "live",
    "reconnecting",
    "ended",
    "failed",
]);
export type CaptureAttemptLifecycle = z.infer<typeof CaptureAttemptLifecycleSchema>;

export const GapKindSchema = z.enum([
    "user_paused",
    "capture_user_absent",
    "transport_interruption",
    "worker_unavailable",
    "provider_unknown",
]);
export type GapKind = z.infer<typeof GapKindSchema>;

export const NoteVisibilitySchema = z.enum(["company", "private"]);
export type NoteVisibility = z.infer<typeof NoteVisibilitySchema>;

export const EnrichmentStatusSchema = z.enum([
    "queued",
    "generating",
    "ready",
    "rejected",
    "accepted",
    "failed",
]);
export type EnrichmentStatus = z.infer<typeof EnrichmentStatusSchema>;

export const ParticipantIdentitySchema = z.object({
    providerParticipantKey: ProviderKeySchema,
    providerSessionKey: ProviderKeySchema.optional(),
    displayName: z.string().min(1).max(512),
});
export type ParticipantIdentity = z.infer<typeof ParticipantIdentitySchema>;

export const CaptureSourceCapabilitiesSchema = z.object({
    attributedTranscript: z.boolean(),
    nativePauseResume: z.boolean(),
    transportReconnect: z.boolean(),
    observesCaptureUserReturn: z.boolean(),
});
export type CaptureSourceCapabilities = z.infer<typeof CaptureSourceCapabilitiesSchema>;

const CaptureEventBaseSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    eventId: IdSchema,
    provider: CallNotesProviderSchema,
    occurrenceKey: ProviderKeySchema,
    attemptKey: ProviderKeySchema.optional(),
    occurredAt: TimestampSchema,
});

export const CaptureEventSchema = z.discriminatedUnion("kind", [
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_connected"),
        attemptKey: ProviderKeySchema,
        streamKey: ProviderKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_paused"),
        attemptKey: ProviderKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_resumed"),
        attemptKey: ProviderKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("transport_interrupted"),
        attemptKey: ProviderKeySchema,
        reason: z.string().max(512).optional(),
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("transport_reconnected"),
        attemptKey: ProviderKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_ended"),
        attemptKey: ProviderKeySchema,
        reason: z.enum(["capture_user_left", "meeting_ended", "provider_stopped"]),
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_failed"),
        attemptKey: ProviderKeySchema,
        code: z.string().min(1).max(128),
        message: z.string().max(1024).optional(),
    }),
    CaptureEventBaseSchema.extend({
        kind: z.enum(["participant_joined", "participant_left", "participant_returned"]),
        attemptKey: ProviderKeySchema,
        participant: ParticipantIdentitySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("transcript_segment"),
        attemptKey: ProviderKeySchema,
        providerEventKey: ProviderKeySchema.optional(),
        sourcePacketHash: z.string().regex(/^[a-f0-9]{64}$/),
        sourceKind: z.enum(["provider_transcript", "derived_asr"]),
        participant: ParticipantIdentitySchema.nullable(),
        providerStartMs: z.number().int().nonnegative().optional(),
        providerEndMs: z.number().int().nonnegative().optional(),
        receivedAt: TimestampSchema,
        receiveOrder: z.number().int().nonnegative(),
        text: z.string().min(1).max(20_000),
        language: z.string().min(1).max(32).optional(),
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("occurrence_ended"),
        reason: z.string().max(512).optional(),
    }),
]);
export type CaptureEvent = z.infer<typeof CaptureEventSchema>;

export const StartCaptureInputSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    provider: CallNotesProviderSchema,
    occurrenceKey: ProviderKeySchema,
    attemptKey: ProviderKeySchema,
    authorizationRef: IdSchema,
    captureUser: ParticipantIdentitySchema,
});
export type StartCaptureInput = z.infer<typeof StartCaptureInputSchema>;

export const CaptureControlInputSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    provider: CallNotesProviderSchema,
    occurrenceKey: ProviderKeySchema,
    attemptKey: ProviderKeySchema,
});
export type CaptureControlInput = z.infer<typeof CaptureControlInputSchema>;

export const TranscriptSegmentSchema = z.object({
    id: IdSchema,
    attemptId: IdSchema,
    participantId: IdSchema.nullable(),
    speakerName: z.string().min(1).max(512).nullable(),
    providerStartMs: z.number().int().nonnegative().nullable(),
    providerEndMs: z.number().int().nonnegative().nullable(),
    receivedAt: TimestampSchema,
    receiveOrder: z.number().int().nonnegative(),
    text: z.string().min(1).max(20_000),
    language: z.string().min(1).max(32).nullable(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const GapSchema = z.object({
    id: IdSchema,
    attemptId: IdSchema.nullable(),
    kind: GapKindSchema,
    startedAt: TimestampSchema,
    endedAt: TimestampSchema.nullable(),
});
export type Gap = z.infer<typeof GapSchema>;

export const BookmarkSchema = z.object({
    id: IdSchema,
    segmentId: IdSchema,
    comment: z.string().max(2000).nullable(),
    createdAt: TimestampSchema,
});
export type Bookmark = z.infer<typeof BookmarkSchema>;

export const CallNoteSchema = z.object({
    documentNoteId: z.number().int().positive().nullable(),
    ownerUserId: z.string().min(1).max(256).nullable(),
    visibility: NoteVisibilitySchema,
    knowledgeIncluded: z.boolean(),
    revision: z.number().int().nonnegative(),
    title: z.string().max(512),
    contentMarkdown: MarkdownSchema,
    contentRich: RichTextSchema,
    saveState: z.enum(["saved", "saving", "failed"]),
});
export type CallNote = z.infer<typeof CallNoteSchema>;

export const BookmarkCitationSchema = z.object({
    bookmarkId: IdSchema,
    segmentId: IdSchema,
    speakerName: z.string().min(1).max(512).nullable(),
    providerStartMs: z.number().int().nonnegative().nullable(),
});
export type BookmarkCitation = z.infer<typeof BookmarkCitationSchema>;

export const EnrichedNoteProposalSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION),
    chronologicalSections: z
        .array(
            z.object({
                heading: z.string().min(1).max(256),
                markdown: z.string().min(1).max(20_000),
                ownerContextLabels: z.array(z.string().min(1).max(512)).max(20).default([]),
            })
        )
        .min(1)
        .max(100),
    summary: z.string().min(1).max(20_000),
    actionItems: z
        .array(
            z.object({
                text: z.string().min(1).max(2000),
                ownerName: z.string().min(1).max(512).nullable(),
                dueDate: z
                    .string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/)
                    .nullable(),
            })
        )
        .max(100),
    bookmarkPassages: z
        .array(
            z.object({
                markdown: z.string().min(1).max(10_000),
                citations: z.array(BookmarkCitationSchema).min(1).max(20),
            })
        )
        .max(100),
    conflicts: z
        .array(
            z.object({
                ownerText: z.string().min(1).max(4000),
                explanation: z.string().min(1).max(4000),
            })
        )
        .max(100),
    contentMarkdown: MarkdownSchema,
    contentRich: RichTextSchema,
});
export type EnrichedNoteProposal = z.infer<typeof EnrichedNoteProposalSchema>;

export const ModelMetadataSchema = z.object({
    provider: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(256),
    promptVersion: z.string().min(1).max(128),
    completionId: z.string().min(1).max(256).optional(),
});
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

export const EnrichmentRunSchema = z.object({
    id: IdSchema,
    status: EnrichmentStatusSchema,
    baseNoteRevision: z.number().int().nonnegative(),
    transcriptFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    proposal: EnrichedNoteProposalSchema.nullable(),
    modelMetadata: ModelMetadataSchema.nullable(),
    createdAt: TimestampSchema,
    resolvedAt: TimestampSchema.nullable(),
});
export type EnrichmentRun = z.infer<typeof EnrichmentRunSchema>;

export const CaptureSnapshotSchema = z.object({
    id: IdSchema,
    desiredMode: CaptureDesiredModeSchema,
    lifecycle: CaptureLifecycleSchema,
    outcome: CaptureOutcomeSchema.nullable(),
    activeAttemptId: IdSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
});
export type CaptureSnapshot = z.infer<typeof CaptureSnapshotSchema>;

export const CallSnapshotSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    id: IdSchema,
    companyId: CompanyIdSchema,
    provider: CallNotesProviderSchema,
    occurrenceKey: ProviderKeySchema,
    title: z.string().min(1).max(512),
    status: CallStatusSchema,
    capture: CaptureSnapshotSchema,
    transcript: z.array(TranscriptSegmentSchema),
    gaps: z.array(GapSchema),
    bookmarks: z.array(BookmarkSchema),
    note: CallNoteSchema.nullable(),
    enrichment: EnrichmentRunSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
});
export type CallSnapshot = z.infer<typeof CallSnapshotSchema>;
export const DetectedCallCandidateSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    provider: CallNotesProviderSchema,
    occurrenceKey: ProviderKeySchema,
    title: z.string().min(1).max(512),
    detectedAt: TimestampSchema,
    endsAt: TimestampSchema.nullable(),
});
export type DetectedCallCandidate = z.infer<typeof DetectedCallCandidateSchema>;

const UserCommandBaseSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    requestId: IdSchema,
    companyId: CompanyIdSchema,
    actorUserId: z.string().min(1).max(256),
});

export const CallNotesCommandSchema = z.discriminatedUnion("kind", [
    UserCommandBaseSchema.extend({
        kind: z.literal("start_capture"),
        provider: CallNotesProviderSchema,
        occurrenceKey: ProviderKeySchema,
        authorizationRef: IdSchema,
        title: z.string().min(1).max(512).optional(),
    }),
    UserCommandBaseSchema.extend({
        kind: z.literal("dismiss_detected_occurrence"),
        provider: CallNotesProviderSchema,
        occurrenceKey: ProviderKeySchema,
    }),
    UserCommandBaseSchema.extend({ kind: z.literal("pause_capture"), callId: IdSchema }),
    UserCommandBaseSchema.extend({ kind: z.literal("resume_capture"), callId: IdSchema }),
    UserCommandBaseSchema.extend({
        kind: z.literal("update_note"),
        callId: IdSchema,
        baseRevision: z.number().int().nonnegative(),
        title: z.string().max(512),
        contentMarkdown: MarkdownSchema,
        contentRich: RichTextSchema,
    }),
    UserCommandBaseSchema.extend({
        kind: z.literal("add_bookmark"),
        callId: IdSchema,
        segmentId: IdSchema,
        comment: z.string().max(2000).nullable(),
    }),
    UserCommandBaseSchema.extend({
        kind: z.literal("set_note_visibility"),
        callId: IdSchema,
        visibility: NoteVisibilitySchema,
    }),
    UserCommandBaseSchema.extend({ kind: z.literal("request_enrichment"), callId: IdSchema }),
    UserCommandBaseSchema.extend({
        kind: z.literal("reject_enrichment"),
        callId: IdSchema,
        enrichmentRunId: IdSchema,
    }),
    UserCommandBaseSchema.extend({
        kind: z.literal("accept_enrichment"),
        callId: IdSchema,
        enrichmentRunId: IdSchema,
        contentMarkdown: MarkdownSchema,
        contentRich: RichTextSchema,
    }),
    UserCommandBaseSchema.extend({
        kind: z.literal("set_knowledge_inclusion"),
        callId: IdSchema,
        included: z.boolean(),
    }),
    UserCommandBaseSchema.extend({ kind: z.literal("delete_call"), callId: IdSchema }),
]);
export type CallNotesCommand = z.infer<typeof CallNotesCommandSchema>;

export const CallQuerySchema = z.object({
    companyId: CompanyIdSchema,
    actorUserId: z.string().min(1).max(256),
    callId: IdSchema,
});
export type CallQuery = z.infer<typeof CallQuerySchema>;

export const CallListQuerySchema = z.object({
    companyId: CompanyIdSchema,
    actorUserId: z.string().min(1).max(256),
    limit: z.number().int().min(1).max(100).default(50),
});
export type CallListQuery = z.infer<typeof CallListQuerySchema>;

export const TranscriptSearchQuerySchema = CallQuerySchema.extend({
    query: z.string().min(1).max(512),
});
export type TranscriptSearchQuery = z.infer<typeof TranscriptSearchQuerySchema>;

export const EnrichmentInputSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION),
    callId: IdSchema,
    transcriptFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    transcript: z.array(TranscriptSegmentSchema).min(1),
    gaps: z.array(GapSchema),
    bookmarks: z.array(BookmarkSchema),
    note: CallNoteSchema,
});
export type EnrichmentInput = z.infer<typeof EnrichmentInputSchema>;

export const EnrichmentResultSchema = z.object({
    proposal: EnrichedNoteProposalSchema,
    modelMetadata: ModelMetadataSchema,
});
export type EnrichmentResult = z.infer<typeof EnrichmentResultSchema>;

export const KnowledgeNoteSchema = z.object({
    companyId: CompanyIdSchema,
    callId: IdSchema,
    documentNoteId: z.number().int().positive(),
    ownerUserId: z.string().min(1).max(256),
    revision: z.number().int().positive(),
    title: z.string().max(512),
    contentMarkdown: MarkdownSchema,
    deepLink: z.string().min(1).max(2048),
});
export type KnowledgeNote = z.infer<typeof KnowledgeNoteSchema>;

export const CompleteEnrichmentInputSchema = z.object({
    companyId: CompanyIdSchema,
    callId: IdSchema,
    enrichmentRunId: IdSchema,
    result: EnrichmentResultSchema,
});
export type CompleteEnrichmentInput = z.infer<typeof CompleteEnrichmentInputSchema>;
