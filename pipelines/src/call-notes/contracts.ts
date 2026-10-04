import { z } from "zod";

export const CALL_NOTES_SCHEMA_VERSION = "call-notes/v2" as const;
export const CALL_NOTES_ENRICHMENT_SCHEMA_VERSION = "call-notes-enrichment/v1" as const;

const IdSchema = z.string().min(1).max(64);
const SourceKeySchema = z.string().min(1).max(256);
const TimestampSchema = z.string().datetime({ offset: true });
const CompanyIdSchema = z.string().regex(/^\d+$/);
const MarkdownSchema = z.string().max(120_000);
const RichTextSchema = z.record(z.unknown());

export const CallNotesSourceSchema = z.literal("local_audio");

export const AudioChannelSchema = z.enum(["microphone", "system"]);
export type AudioChannel = z.infer<typeof AudioChannelSchema>;

export const CallStatusSchema = z.enum(["active", "finalizing", "completed", "failed"]);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const CaptureDesiredModeSchema = z.enum(["running", "paused", "stopped"]);

export const CaptureLifecycleSchema = z.enum([
    "connecting",
    "live",
    "interrupted",
    "finalizing",
    "completed",
    "failed",
]);

export const CaptureOutcomeSchema = z.enum(["complete", "partial", "failed"]);

export const GapKindSchema = z.enum([
    "user_paused",
    "capture_user_absent",
    "transport_interruption",
    "worker_unavailable",
    "capture_unknown",
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
    sourceParticipantKey: SourceKeySchema,
    sourceSessionKey: SourceKeySchema.optional(),
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
    source: CallNotesSourceSchema,
    sourceOccurrenceKey: SourceKeySchema,
    sourceAttemptKey: SourceKeySchema.optional(),
    occurredAt: TimestampSchema,
});

export const CaptureEventSchema = z.discriminatedUnion("kind", [
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_connected"),
        sourceAttemptKey: SourceKeySchema,
        sourceStreamKey: SourceKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_paused"),
        sourceAttemptKey: SourceKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_resumed"),
        sourceAttemptKey: SourceKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("transport_interrupted"),
        sourceAttemptKey: SourceKeySchema,
        reason: z.string().max(512).optional(),
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("transport_reconnected"),
        sourceAttemptKey: SourceKeySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_ended"),
        sourceAttemptKey: SourceKeySchema,
        reason: z.enum(["silence_timeout", "user_stopped", "source_stopped"]),
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("attempt_failed"),
        sourceAttemptKey: SourceKeySchema,
        code: z.string().min(1).max(128),
        message: z.string().max(1024).optional(),
    }),
    CaptureEventBaseSchema.extend({
        kind: z.enum(["participant_joined", "participant_left", "participant_returned"]),
        sourceAttemptKey: SourceKeySchema,
        participant: ParticipantIdentitySchema,
    }),
    CaptureEventBaseSchema.extend({
        kind: z.literal("transcript_segment"),
        sourceAttemptKey: SourceKeySchema,
        sourcePacketHash: z.string().regex(/^[a-f0-9]{64}$/),
        sourceKind: z.literal("derived_asr"),
        audioChannel: AudioChannelSchema,
        participant: z.null(),
        sourceStartMs: z.number().int().nonnegative().optional(),
        sourceEndMs: z.number().int().nonnegative().optional(),
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
    source: CallNotesSourceSchema,
    sourceOccurrenceKey: SourceKeySchema,
    sourceAttemptKey: SourceKeySchema,
    captureUser: ParticipantIdentitySchema,
});
export type StartCaptureInput = z.infer<typeof StartCaptureInputSchema>;

export const CaptureControlInputSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    source: CallNotesSourceSchema,
    sourceOccurrenceKey: SourceKeySchema,
    sourceAttemptKey: SourceKeySchema,
});
export type CaptureControlInput = z.infer<typeof CaptureControlInputSchema>;

export const TranscriptSegmentSchema = z.object({
    id: IdSchema,
    attemptId: IdSchema,
    audioChannel: AudioChannelSchema,
    participantId: IdSchema.nullable(),
    speakerName: z.string().min(1).max(512).nullable(),
    sourceStartMs: z.number().int().nonnegative().nullable(),
    sourceEndMs: z.number().int().nonnegative().nullable(),
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

export const CallNoteSchema = z.object({
    documentNoteId: z.number().int().positive().nullable(),
    ownerUserId: z.string().min(1).max(256).nullable(),
    visibility: NoteVisibilitySchema,
    revision: z.number().int().nonnegative(),
    title: z.string().max(512),
    contentMarkdown: MarkdownSchema,
    contentRich: RichTextSchema,
    saveState: z.enum(["saved", "saving", "failed"]),
});
export type CallNote = z.infer<typeof CallNoteSchema>;

export const EnrichedNoteProposalSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION),
    chronologicalSections: z
        .array(
            z.object({
                heading: z
                    .string()
                    .min(1)
                    .max(256)
                    .describe("A natural topic heading from this call, not a template heading."),
                markdown: z
                    .string()
                    .min(1)
                    .max(20_000)
                    .describe(
                        "Concise key notes using Markdown '- ' bullets only, not paragraphs. One key point per short bullet; nest only essential detail. " +
                            "Rewrite user shorthand clearly, never quote it or discuss how it matches the transcript. " +
                            "Use **bold** ONLY for ideas present in currentOwnerCallNote's body; " +
                            "if that body is empty, no bold is permitted. Transcript-only details stay unbolded. " +
                            "Integrate decisions, follow-ups, and any note/transcript discrepancy here, not in appendices."
                    ),
                ownerContextLabels: z
                    .array(z.string().min(1).max(512))
                    .max(20)
                    .default([])
                    .describe(
                        "Metadata for integrated user ideas, never a substitute for inline paraphrases."
                    ),
            })
        )
        .min(1)
        .max(100)
        .describe("The entire visible note: topic sections ordered as the conversation unfolded."),
    summary: z
        .string()
        .min(1)
        .max(20_000)
        .describe("Metadata synopsis of the chronological note; not a separate visible section."),
    decisions: z
        .array(
            z.object({
                text: z.string().min(1).max(2000),
            })
        )
        .max(100),
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
    conflicts: z
        .array(
            z.object({
                ownerText: z.string().min(1).max(4000),
                explanation: z.string().min(1).max(4000),
            })
        )
        .max(100),
});
export type EnrichedNoteProposal = z.infer<typeof EnrichedNoteProposalSchema>;

export const ModelMetadataSchema = z.object({
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    promptVersion: z.string().min(1).max(128),
    completionId: z.string().min(1).max(256).optional(),
});
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

export const EnrichmentRunSchema = z
    .object({
        id: IdSchema,
        status: EnrichmentStatusSchema,
        baseNoteRevision: z.number().int().nonnegative(),
        transcriptFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        proposal: EnrichedNoteProposalSchema.nullable(),
        modelMetadata: ModelMetadataSchema.nullable(),
        createdAt: TimestampSchema,
        resolvedAt: TimestampSchema.nullable(),
    })
    .superRefine((run, context) => {
        const requiresArtifacts =
            run.status === "ready" || run.status === "accepted" || run.status === "rejected";
        if (requiresArtifacts && run.proposal === null) {
            context.addIssue({
                code: "custom",
                path: ["proposal"],
                message: `${run.status} enrichment requires a proposal`,
            });
        }
        if (requiresArtifacts && run.modelMetadata === null) {
            context.addIssue({
                code: "custom",
                path: ["modelMetadata"],
                message: `${run.status} enrichment requires model metadata`,
            });
        }
        if ((run.status === "accepted" || run.status === "rejected") && run.resolvedAt === null) {
            context.addIssue({
                code: "custom",
                path: ["resolvedAt"],
                message: `${run.status} enrichment requires a resolution timestamp`,
            });
        }
    });

export const ViewerCapabilitiesSchema = z.object({
    canEditNote: z.boolean(),
    canControlCapture: z.boolean(),
    canRequestEnrichment: z.boolean(),
    canResolveEnrichment: z.boolean(),
    canChangeVisibility: z.boolean(),
    canDelete: z.boolean(),
});

export const CaptureSnapshotSchema = z.object({
    id: IdSchema,
    desiredMode: CaptureDesiredModeSchema,
    lifecycle: CaptureLifecycleSchema,
    outcome: CaptureOutcomeSchema.nullable(),
    activeAttemptId: IdSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
});

/** Private worker control plane; never returned as a user-facing device credential. */
export const LocalCapturePollInputSchema = z
    .object({
        companyId: CompanyIdSchema,
        userId: z.string().min(1).max(256),
        workerId: IdSchema,
    })
    .strict();
export type LocalCapturePollInput = z.infer<typeof LocalCapturePollInputSchema>;
export const LocalCaptureWorkerStatusSchema = z
    .object({
        available: z.boolean(),
        lastSeenAt: TimestampSchema.nullable(),
    })
    .strict();
export type LocalCaptureWorkerStatus = z.infer<typeof LocalCaptureWorkerStatusSchema>;

export const LocalCaptureSessionSchema = z
    .object({
        callId: IdSchema,
        captureId: IdSchema,
        occurrenceKey: SourceKeySchema,
        attemptKey: SourceKeySchema,
        startedAt: TimestampSchema,
        title: z.string().min(1).max(512),
        desiredMode: CaptureDesiredModeSchema,
    })
    .strict();
export type LocalCaptureSession = z.infer<typeof LocalCaptureSessionSchema>;

export const LocalCapturePollResultSchema = z
    .object({
        capture: LocalCaptureSessionSchema.nullable(),
    })
    .strict();
export type LocalCapturePollResult = z.infer<typeof LocalCapturePollResultSchema>;

export const CallSnapshotSchema = z
    .object({
        schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
        id: IdSchema,
        companyId: CompanyIdSchema,
        source: CallNotesSourceSchema,
        sourceOccurrenceKey: SourceKeySchema,
        title: z.string().min(1).max(512),
        status: CallStatusSchema,
        capture: CaptureSnapshotSchema,
        viewerCapabilities: ViewerCapabilitiesSchema,
        transcript: z.array(TranscriptSegmentSchema),
        gaps: z.array(GapSchema),
        note: CallNoteSchema.nullable(),
        enrichment: EnrichmentRunSchema.nullable(),
        createdAt: TimestampSchema,
        updatedAt: TimestampSchema,
    })
    .superRefine((snapshot, context) => {
        if (snapshot.note === null && snapshot.enrichment !== null) {
            context.addIssue({
                code: "custom",
                path: ["enrichment"],
                message: "Private-note projections must redact enrichment",
            });
        }
    });
export type CallSnapshot = z.infer<typeof CallSnapshotSchema>;
export const DetectedCallCandidateSchema = z.object({
    schemaVersion: z.literal(CALL_NOTES_SCHEMA_VERSION),
    source: CallNotesSourceSchema,
    sourceOccurrenceKey: SourceKeySchema,
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
        source: CallNotesSourceSchema,
        sourceOccurrenceKey: SourceKeySchema,
        title: z.string().min(1).max(512).optional(),
    }),
    UserCommandBaseSchema.extend({
        kind: z.literal("dismiss_detected_occurrence"),
        source: CallNotesSourceSchema,
        sourceOccurrenceKey: SourceKeySchema,
    }),
    UserCommandBaseSchema.extend({ kind: z.literal("pause_capture"), callId: IdSchema }),
    UserCommandBaseSchema.extend({ kind: z.literal("resume_capture"), callId: IdSchema }),
    UserCommandBaseSchema.extend({ kind: z.literal("stop_capture"), callId: IdSchema }),
    UserCommandBaseSchema.extend({
        kind: z.literal("update_note"),
        callId: IdSchema,
        baseRevision: z.number().int().nonnegative(),
        title: z.string().max(512),
        contentMarkdown: MarkdownSchema,
        contentRich: RichTextSchema,
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
    note: CallNoteSchema,
});
export type EnrichmentInput = z.infer<typeof EnrichmentInputSchema>;

export const EnrichmentResultSchema = z.object({
    proposal: EnrichedNoteProposalSchema,
    modelMetadata: ModelMetadataSchema,
});
export type EnrichmentResult = z.infer<typeof EnrichmentResultSchema>;

export const CompleteEnrichmentInputSchema = z.object({
    companyId: CompanyIdSchema,
    callId: IdSchema,
    enrichmentRunId: IdSchema,
    result: EnrichmentResultSchema,
});
export type CompleteEnrichmentInput = z.infer<typeof CompleteEnrichmentInputSchema>;
