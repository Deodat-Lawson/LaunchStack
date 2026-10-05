import { CallSnapshotSchema, type CallSnapshot } from "@launchstack/pipelines/call-notes/contracts";

const ownerCapabilities = {
    canEditNote: true,
    canControlCapture: true,
    canRequestEnrichment: true,
    canResolveEnrichment: true,
    canChangeVisibility: true,
    canDelete: false,
} as const;

const readOnlyCapabilities = {
    canEditNote: false,
    canControlCapture: false,
    canRequestEnrichment: false,
    canResolveEnrichment: false,
    canChangeVisibility: false,
    canDelete: false,
} as const;

// base input that the variants below extend.
const baseCallInput = {
    schemaVersion: "call-notes/v2",
    id: "call-northstar-pricing",
    companyId: "42",
    source: "local_audio",
    sourceOccurrenceKey: "local-northstar-2026-08-21",
    title: "Northstar pricing review",
    status: "completed",
    capture: {
        id: "capture-northstar-1",
        desiredMode: "running",
        pausedReason: null,
        lifecycle: "completed",
        outcome: "complete",
        activeAttemptId: null,
        attemptCount: 1,
    },
    viewerCapabilities: ownerCapabilities,
    transcript: [
        {
            id: "segment-1",
            attemptId: "attempt-1",
            participantId: null,
            speakerName: null,
            audioChannel: "microphone",
            sourceStartMs: 0,
            sourceEndMs: 4200,
            receivedAt: "2026-08-21T14:00:04.000Z",
            receiveOrder: 0,
            text: "Let's aim to finalize the pricing tiers before Friday.",
            language: "en",
        },
        {
            id: "segment-2",
            attemptId: "attempt-1",
            participantId: null,
            speakerName: null,
            audioChannel: "system",
            sourceStartMs: 4200,
            sourceEndMs: 9000,
            receivedAt: "2026-08-21T14:00:09.000Z",
            receiveOrder: 1,
            text: "Agreed. I'll draft the enterprise tier and share it tomorrow.",
            language: "en",
        },
    ],
    gaps: [],
    note: {
        documentNoteId: 101,
        ownerUserId: "user-hank",
        visibility: "company",
        revision: 1,
        title: "Northstar pricing review",
        contentMarkdown: "- Finalize pricing tiers by Friday\n- Enterprise tier draft in progress",
        contentRich: {},
        saveState: "saved",
    },
    enrichment: null,
    createdAt: "2026-08-21T14:00:00.000Z",
    updatedAt: "2026-08-21T14:10:00.000Z",
} as const;

// completed call with a note and transcript
export const northstarPricingReviewCall: CallSnapshot = CallSnapshotSchema.parse(baseCallInput);

// live call the user has paused
export const pausedCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-paused",
    sourceOccurrenceKey: "local-paused-1",
    title: "Live roadmap sync",
    status: "active",
    capture: {
        id: "capture-paused-1",
        desiredMode: "paused",
        pausedReason: "user",
        lifecycle: "live",
        outcome: null,
        activeAttemptId: "attempt-paused-1",
        attemptCount: 1,
    },
    note: { ...baseCallInput.note, saveState: "saving" },
    enrichment: null,
});

// a Call paused after the Local Capture Worker stopped, retaining its Transcript
export const workerErrorPausedCall: CallSnapshot = CallSnapshotSchema.parse({
    ...pausedCall,
    id: "call-worker-error",
    sourceOccurrenceKey: "local-worker-error-1",
    capture: {
        ...pausedCall.capture,
        id: "capture-worker-error-1",
        pausedReason: "worker_error",
        lifecycle: "interrupted",
        activeAttemptId: null,
    },
    note: { ...pausedCall.note, saveState: "saved" },
});

// a capture that failed to connect
export const failedCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-failed",
    sourceOccurrenceKey: "local-failed-1",
    title: "Dropped investor call",
    status: "failed",
    capture: {
        id: "capture-failed-1",
        desiredMode: "running",
        pausedReason: null,
        lifecycle: "failed",
        outcome: "failed",
        activeAttemptId: null,
        attemptCount: 2,
    },
    viewerCapabilities: { ...ownerCapabilities, canDelete: true },
    transcript: [],
    gaps: [],
    note: { ...baseCallInput.note, title: "Dropped investor call", contentMarkdown: "" },
    enrichment: null,
});

// a completed but partial call with a capture gap between the two segments
export const partialCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-partial",
    sourceOccurrenceKey: "local-partial-1",
    title: "Partial support review",
    capture: {
        id: "capture-partial-1",
        desiredMode: "running",
        pausedReason: null,
        lifecycle: "completed",
        outcome: "partial",
        activeAttemptId: null,
        attemptCount: 1,
    },
    transcript: [
        {
            id: "segment-1",
            attemptId: "attempt-1",
            participantId: null,
            speakerName: null,
            audioChannel: "microphone",
            sourceStartMs: 0,
            sourceEndMs: 4200,
            receivedAt: "2026-08-21T14:00:04.000Z",
            receiveOrder: 0,
            text: "Let's aim to finalize the pricing tiers before Friday.",
            language: "en",
        },
        {
            id: "segment-2",
            attemptId: "attempt-1",
            participantId: null,
            speakerName: null,
            audioChannel: "system",
            sourceStartMs: 51000,
            sourceEndMs: 55000,
            receivedAt: "2026-08-21T14:00:52.000Z",
            receiveOrder: 1,
            text: "Sorry, I'm back — I'll draft the enterprise tier and share it tomorrow.",
            language: "en",
        },
    ],
    gaps: [
        {
            id: "gap-1",
            attemptId: "attempt-1",
            kind: "user_paused",
            startedAt: "2026-08-21T14:00:06.000Z",
            endedAt: "2026-08-21T14:00:51.000Z",
        },
    ],
});

// a private note viewed by a non-owner
export const redactedCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-redacted",
    sourceOccurrenceKey: "local-redacted-1",
    title: "Private 1:1",
    note: null,
    viewerCapabilities: readOnlyCapabilities,
});

// a call whose AI-enhanced proposal is ready to review
export const enrichmentReadyCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-enriched",
    sourceOccurrenceKey: "local-enriched-1",
    title: "Enriched strategy call",
    enrichment: {
        id: "enrichment-1",
        status: "ready",
        baseNoteRevision: 1,
        transcriptFingerprint: "a".repeat(64),
        proposal: {
            schemaVersion: "call-notes-enrichment/v1",
            chronologicalSections: [
                {
                    heading: "Pricing",
                    markdown:
                        "- **Finalize the pricing tiers by Friday**, then draft the enterprise tier by August 28.",
                    ownerContextLabels: [],
                },
            ],
            summary:
                "The team agreed to finalize the pricing tiers by Friday; the enterprise tier draft follows.",
            decisions: [],
            actionItems: [
                { text: "Draft the enterprise tier", ownerName: null, dueDate: "2026-08-28" },
            ],
            conflicts: [],
        },
        modelMetadata: {
            provider: "fixture",
            model: "claude-sonnet",
            promptVersion: "calls-v1",
        },
        createdAt: "2026-08-21T14:15:00.000Z",
        resolvedAt: null,
    },
});
