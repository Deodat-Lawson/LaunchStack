import { CallSnapshotSchema, type CallSnapshot } from "@launchstack/features/call-notes";

// base input that the variants below extend.
const baseCallInput = {
    schemaVersion: "call-notes/v1",
    id: "call-northstar-pricing",
    companyId: "42",
    provider: "zoom",
    occurrenceKey: "zoom-northstar-2026-08-21",
    title: "Northstar pricing review",
    status: "completed",
    capture: {
        id: "capture-northstar-1",
        desiredMode: "running",
        lifecycle: "completed",
        outcome: "complete",
        activeAttemptId: null,
        attemptCount: 1,
    },
    transcript: [
        {
            id: "segment-1",
            attemptId: "attempt-1",
            participantId: "participant-deodat",
            speakerName: "Deodat",
            providerStartMs: 0,
            providerEndMs: 4200,
            receivedAt: "2026-08-21T14:00:04.000Z",
            receiveOrder: 0,
            text: "Let's aim to finalize the pricing tiers before Friday.",
            language: "en",
        },
        {
            id: "segment-2",
            attemptId: "attempt-1",
            participantId: "participant-hank",
            speakerName: "Hank",
            providerStartMs: 4200,
            providerEndMs: 9000,
            receivedAt: "2026-08-21T14:00:09.000Z",
            receiveOrder: 1,
            text: "Agreed. I'll draft the enterprise tier and share it tomorrow.",
            language: "en",
        },
    ],
    gaps: [],
    bookmarks: [
        {
            id: "bookmark-1",
            segmentId: "segment-1",
            comment: "Pricing deadline",
            createdAt: "2026-08-21T14:05:00.000Z",
        },
    ],
    note: {
        documentNoteId: 101,
        ownerUserId: "user-hank",
        visibility: "company",
        knowledgeIncluded: false,
        revision: 1,
        title: "Northstar pricing review",
        contentMarkdown: "- Finalize pricing tiers by Friday\n- Hank drafting the enterprise tier",
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
    occurrenceKey: "zoom-paused-1",
    title: "Live roadmap sync",
    status: "active",
    capture: {
        id: "capture-paused-1",
        desiredMode: "paused",
        lifecycle: "live",
        outcome: null,
        activeAttemptId: "attempt-paused-1",
        attemptCount: 1,
    },
    note: { ...baseCallInput.note, saveState: "saving" },
    enrichment: null,
});

// a capture that failed to connect
export const failedCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-failed",
    occurrenceKey: "zoom-failed-1",
    title: "Dropped investor call",
    status: "failed",
    capture: {
        id: "capture-failed-1",
        desiredMode: "running",
        lifecycle: "failed",
        outcome: "failed",
        activeAttemptId: null,
        attemptCount: 2,
    },
    transcript: [],
    gaps: [],
    bookmarks: [],
    note: { ...baseCallInput.note, title: "Dropped investor call", contentMarkdown: "" },
    enrichment: null,
});

// a completed but partial call with a capture gap between the two segments
export const partialCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-partial",
    occurrenceKey: "zoom-partial-1",
    title: "Partial support review",
    capture: {
        id: "capture-partial-1",
        desiredMode: "running",
        lifecycle: "completed",
        outcome: "partial",
        activeAttemptId: null,
        attemptCount: 1,
    },
    transcript: [
        {
            id: "segment-1",
            attemptId: "attempt-1",
            participantId: "participant-deodat",
            speakerName: "Deodat",
            providerStartMs: 0,
            providerEndMs: 4200,
            receivedAt: "2026-08-21T14:00:04.000Z",
            receiveOrder: 0,
            text: "Let's aim to finalize the pricing tiers before Friday.",
            language: "en",
        },
        {
            id: "segment-2",
            attemptId: "attempt-1",
            participantId: "participant-hank",
            speakerName: "Hank",
            providerStartMs: 51000,
            providerEndMs: 55000,
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
    occurrenceKey: "zoom-redacted-1",
    title: "Private 1:1",
    note: null,
});

// a call whose AI-enhanced proposal is ready to review
export const enrichmentReadyCall: CallSnapshot = CallSnapshotSchema.parse({
    ...baseCallInput,
    id: "call-enriched",
    occurrenceKey: "zoom-enriched-1",
    title: "Enriched strategy call",
    enrichment: {
        id: "enrichment-1",
        status: "ready",
        baseNoteRevision: 1,
        transcriptFingerprint: "a".repeat(64),
        proposal: {
            schemaVersion: "call-notes-enrichment/v1",
            chronologicalSections: [
                { heading: "Pricing", markdown: "Discussed the tier structure.", ownerContextLabels: [] },
            ],
            summary: "The team agreed to finalize the pricing tiers by Friday; Hank will draft the enterprise tier.",
            actionItems: [{ text: "Draft the enterprise tier", ownerName: "Hank", dueDate: "2026-08-28" }],
            bookmarkPassages: [
                {
                    markdown: "Pricing deadline is Friday.",
                    citations: [
                        {
                            bookmarkId: "bookmark-1",
                            segmentId: "segment-1",
                            speakerName: "Deodat",
                            providerStartMs: 0,
                        },
                    ],
                },
            ],
            conflicts: [],
            contentMarkdown: "The team agreed to finalize the pricing tiers by Friday.",
            contentRich: {},
        },
        modelMetadata: { model: "claude-sonnet", promptVersion: "calls-v1" },
        createdAt: "2026-08-21T14:15:00.000Z",
        resolvedAt: null,
    },
});

export const sampleCalls: CallSnapshot[] = [
    pausedCall,
    northstarPricingReviewCall,
    partialCall,
    enrichmentReadyCall,
    failedCall,
    redactedCall,
];
