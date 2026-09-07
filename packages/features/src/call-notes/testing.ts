import {
    CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    CALL_NOTES_SCHEMA_VERSION,
    CallNotesCommandSchema,
    CallSnapshotSchema,
    CaptureControlInputSchema,
    CaptureEventSchema,
    CompleteEnrichmentInputSchema,
    DetectedCallCandidateSchema,
    EnrichedNoteProposalSchema,
    StartCaptureInputSchema,
    type CallNotesCommand,
    type CallSnapshot,
    type CaptureEvent,
    type KnowledgeNote,
} from "./contracts";
import { renderEnrichedNoteProposal } from "./enrichment";
import type {
    CallNotesApplication,
    CaptureAttemptHandle,
    CaptureEventSink,
    CaptureSource,
} from "./ports";

function invariant(value: unknown, message: string): asserts value {
    if (!value) throw new Error(`Call Notes contract violation: ${message}`);
}
async function invariantRejects(promise: Promise<unknown>, message: string): Promise<void> {
    try {
        await promise;
    } catch {
        return;
    }
    throw new Error(`Call Notes contract violation: ${message}`);
}

const fixtureParticipant = {
    sourceParticipantKey: "user_owner",
    sourceSessionKey: "local-session-owner",
    displayName: "Alex Founder",
};

const fixtureGuest = {
    sourceParticipantKey: "local-participant-guest",
    sourceSessionKey: "local-session-guest",
    displayName: "Maya Customer",
};

export const CALL_NOTES_FIXTURE_IDS = {
    companyId: "1",
    ownerUserId: "user_owner",
    otherUserId: "user_teammate",
    sourceOccurrenceKey: "local-occurrence-2026-08-15",
    firstSourceAttemptKey: "local-attempt-1",
    secondSourceAttemptKey: "local-attempt-2",
} as const;
export const CALL_NOTES_DETECTED_CANDIDATE = DetectedCallCandidateSchema.parse({
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    source: "local_audio",
    sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
    title: "Customer onboarding review",
    detectedAt: "2026-08-15T13:59:00.000Z",
    endsAt: null,
});

export const CALL_NOTES_CAPTURE_EVENTS = CaptureEventSchema.array().parse([
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-connected-1",
        kind: "attempt_connected",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        sourceStreamKey: "local-stream-1",
        occurredAt: "2026-08-15T14:00:00.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-owner-joined",
        kind: "participant_joined",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        participant: fixtureParticipant,
        occurredAt: "2026-08-15T14:00:01.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-guest-joined",
        kind: "participant_joined",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        participant: fixtureGuest,
        occurredAt: "2026-08-15T14:00:02.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-segment-1",
        kind: "transcript_segment",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        sourcePacketHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceKind: "derived_asr",
        audioChannel: "microphone",
        participant: null,
        sourceStartMs: 1_000,
        sourceEndMs: 4_000,
        receivedAt: "2026-08-15T14:00:04.100Z",
        receiveOrder: 1,
        text: "We need to reduce onboarding time before the September launch.",
        language: "en",
        occurredAt: "2026-08-15T14:00:04.100Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-paused-1",
        kind: "attempt_paused",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        occurredAt: "2026-08-15T14:05:00.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-resumed-1",
        kind: "attempt_resumed",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        occurredAt: "2026-08-15T14:07:00.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-segment-2",
        kind: "transcript_segment",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        sourcePacketHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        sourceKind: "derived_asr",
        audioChannel: "system",
        participant: null,
        sourceStartMs: 421_000,
        sourceEndMs: 425_000,
        receivedAt: "2026-08-15T14:07:05.050Z",
        receiveOrder: 2,
        text: "I will send the revised onboarding checklist by Friday.",
        language: "en",
        occurredAt: "2026-08-15T14:07:05.050Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-transport-interrupted-1",
        kind: "transport_interrupted",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        reason: "audio device unavailable",
        occurredAt: "2026-08-15T14:09:00.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-attempt-1-ended",
        kind: "attempt_ended",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        reason: "silence_timeout",
        occurredAt: "2026-08-15T14:10:00.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-connected-2",
        kind: "attempt_connected",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.secondSourceAttemptKey,
        sourceStreamKey: "local-stream-2",
        occurredAt: "2026-08-15T14:11:00.000Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-owner-returned",
        kind: "participant_returned",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.secondSourceAttemptKey,
        participant: fixtureParticipant,
        occurredAt: "2026-08-15T14:11:00.100Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-segment-3",
        kind: "transcript_segment",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.secondSourceAttemptKey,
        sourcePacketHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        sourceKind: "derived_asr",
        audioChannel: "microphone",
        participant: null,
        sourceStartMs: 665_000,
        sourceEndMs: 669_000,
        receivedAt: "2026-08-15T14:11:09.040Z",
        receiveOrder: 3,
        text: "That checklist and a short walkthrough should unblock our team.",
        language: "en",
        occurredAt: "2026-08-15T14:11:09.040Z",
    },
    {
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        eventId: "event-occurrence-ended",
        kind: "occurrence_ended",
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        occurredAt: "2026-08-15T14:30:00.000Z",
        reason: "silence_timeout",
    },
]);

export const CALL_NOTES_ENRICHMENT_PROPOSAL = EnrichedNoteProposalSchema.parse({
    schemaVersion: CALL_NOTES_ENRICHMENT_SCHEMA_VERSION,
    chronologicalSections: [
        {
            heading: "Onboarding launch risk",
            markdown: "**Onboarding needs to be faster** before the September launch.",
            ownerContextLabels: ["Pricing concerns and launch sequencing"],
        },
        {
            heading: "Next step",
            markdown: "Alex will send a revised onboarding checklist by Friday.",
            ownerContextLabels: [],
        },
    ],
    summary: "The onboarding checklist and a short walkthrough should unblock the launch.",
    decisions: [],
    actionItems: [
        {
            text: "Send the revised onboarding checklist.",
            ownerName: "Alex Founder",
            dueDate: "2026-08-21",
        },
    ],
    conflicts: [],
});

export const CALL_NOTES_START_COMMAND: Extract<CallNotesCommand, { kind: "start_capture" }> =
    CallNotesCommandSchema.parse({
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        requestId: "request-start-1",
        kind: "start_capture",
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        title: "Customer onboarding review",
    }) as Extract<CallNotesCommand, { kind: "start_capture" }>;
export const CALL_NOTES_DISMISS_COMMAND: Extract<
    CallNotesCommand,
    { kind: "dismiss_detected_occurrence" }
> = CallNotesCommandSchema.parse({
    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
    requestId: "request-dismiss-1",
    kind: "dismiss_detected_occurrence",
    companyId: CALL_NOTES_FIXTURE_IDS.companyId,
    actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
    source: "local_audio",
    sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
}) as Extract<CallNotesCommand, { kind: "dismiss_detected_occurrence" }>;

export interface KnowledgeNoteProbe {
    get(companyId: string, callId: string): Promise<KnowledgeNote | null>;
}

export async function assertCaptureSourceContract(source: CaptureSource): Promise<void> {
    const events: CaptureEvent[] = [];
    const sink: CaptureEventSink = {
        async append(event) {
            events.push(CaptureEventSchema.parse(event));
        },
    };
    const startInput = StartCaptureInputSchema.parse({
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        source: "local_audio",
        sourceOccurrenceKey: CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey,
        sourceAttemptKey: CALL_NOTES_FIXTURE_IDS.firstSourceAttemptKey,
        captureUser: fixtureParticipant,
    });
    const controlInput = CaptureControlInputSchema.parse(startInput);
    const handle = await source.startAttempt(startInput, sink);
    await handle.pause(controlInput);
    await handle.resume(controlInput);
    await handle.dispose();

    invariant(!source.capabilities.attributedTranscript, "local source must not claim attribution");
    invariant(
        events.some(event => event.kind === "attempt_connected"),
        "missing connected event"
    );
    invariant(
        events.some(event => event.kind === "attempt_paused"),
        "missing paused event"
    );
    invariant(
        events.some(event => event.kind === "attempt_resumed"),
        "missing resumed event"
    );
    invariant(
        events.every(
            event =>
                event.sourceOccurrenceKey === startInput.sourceOccurrenceKey &&
                event.sourceAttemptKey === startInput.sourceAttemptKey
        ),
        "source changed occurrence or attempt identity"
    );
}

export function createScriptedCaptureSource(): CaptureSource {
    return {
        capabilities: {
            attributedTranscript: false,
            nativePauseResume: true,
            transportReconnect: false,
            observesCaptureUserReturn: false,
        },
        async startAttempt(input, sink): Promise<CaptureAttemptHandle> {
            await sink.append(CALL_NOTES_CAPTURE_EVENTS[0]!);
            return {
                async pause(control) {
                    CaptureControlInputSchema.parse(control);
                    await sink.append(CALL_NOTES_CAPTURE_EVENTS[4]!);
                },
                async resume(control) {
                    CaptureControlInputSchema.parse(control);
                    await sink.append(CALL_NOTES_CAPTURE_EVENTS[5]!);
                },
                async dispose() {
                    return undefined;
                },
            };
        },
    };
}

function userCommand(
    actorUserId: string,
    callId: string,
    command: { kind: CallNotesCommand["kind"] } & Record<string, unknown>
): CallNotesCommand {
    return CallNotesCommandSchema.parse({
        schemaVersion: CALL_NOTES_SCHEMA_VERSION,
        requestId: `request-${actorUserId}-${command.kind}`,
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        actorUserId,
        callId,
        ...command,
    });
}

function ownerCommand(
    callId: string,
    command: { kind: CallNotesCommand["kind"] } & Record<string, unknown>
): CallNotesCommand {
    return userCommand(CALL_NOTES_FIXTURE_IDS.ownerUserId, callId, command);
}

/**
 * Shared end-to-end contract. The subject must use its real state machine,
 * persistence, authorization, API-facing application boundary, and knowledge sink.
 * Only local audio capture and model output may be deterministic fakes.
 */
export async function runCallNotesVerticalTracer(
    application: CallNotesApplication,
    knowledgeProbe?: KnowledgeNoteProbe
): Promise<CallSnapshot> {
    const worker = await application.getLocalCaptureWorkerStatus({
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        userId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
    });
    invariant(worker.available, "a Local Capture Worker heartbeat is required before the tracer");
    const started = await application.execute(CALL_NOTES_START_COMMAND);
    invariant(started, "start_capture returned no Call");
    CallSnapshotSchema.parse(started);

    for (const event of CALL_NOTES_CAPTURE_EVENTS.slice(0, 4)) {
        await application.ingestCaptureEvent(CALL_NOTES_FIXTURE_IDS.companyId, event);
    }

    const paused = await application.execute(ownerCommand(started.id, { kind: "pause_capture" }));
    invariant(paused?.capture.desiredMode === "paused", "Pause did not persist desired mode");
    await application.ingestCaptureEvent(
        CALL_NOTES_FIXTURE_IDS.companyId,
        CALL_NOTES_CAPTURE_EVENTS[4]!
    );

    const resumed = await application.execute(ownerCommand(started.id, { kind: "resume_capture" }));
    invariant(resumed?.capture.desiredMode === "running", "Resume did not persist desired mode");
    await application.ingestCaptureEvent(
        CALL_NOTES_FIXTURE_IDS.companyId,
        CALL_NOTES_CAPTURE_EVENTS[5]!
    );

    for (const index of [7, 8, 9, 10, 11, 6, 6, 12]) {
        await application.ingestCaptureEvent(
            CALL_NOTES_FIXTURE_IDS.companyId,
            CALL_NOTES_CAPTURE_EVENTS[index]!
        );
    }

    let current = await application.getCall({
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        callId: started.id,
    });
    invariant(current.status === "completed", "occurrence did not finalize the Call");
    invariant(current.capture.outcome === "partial", "known gaps must produce a partial outcome");
    invariant(current.capture.attemptCount === 2, "same-user return must create a second attempt");
    invariant(current.transcript.length === 3, "transcript replay lost or duplicated segments");
    invariant(
        current.transcript.every(segment => segment.participantId === null),
        "channel provenance must not create named participants"
    );
    invariant(
        current.transcript
            .map(segment => `${segment.audioChannel}:${segment.speakerName}`)
            .join("|") === "microphone:Me|system:Meeting|microphone:Me",
        "transcript presentation did not apply deterministic channel labels"
    );
    invariant(
        current.transcript.map(segment => segment.text).join("|") ===
            [
                "We need to reduce onboarding time before the September launch.",
                "I will send the revised onboarding checklist by Friday.",
                "That checklist and a short walkthrough should unblock our team.",
            ].join("|"),
        "late Transcript packets were not restored to deterministic source-time order"
    );
    invariant(current.gaps.length >= 2, "pause and transport gaps must remain visible");
    invariant(current.note, "owner cannot see the Call Note");
    await invariantRejects(
        application.getCall({
            companyId: "2",
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        }),
        "wrong-company Call lookup did not resolve as not found"
    );

    await application.execute(
        ownerCommand(started.id, {
            kind: "update_note",
            baseRevision: current.note.revision,
            title: current.note.title,
            contentMarkdown: "Pricing concerns and launch sequencing.",
            contentRich: { type: "doc", content: [] },
        })
    );
    await application.execute(
        ownerCommand(started.id, {
            kind: "set_note_visibility",
            visibility: "private",
        })
    );

    const teammateView = await application.getCall({
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        actorUserId: CALL_NOTES_FIXTURE_IDS.otherUserId,
        callId: started.id,
    });
    invariant(teammateView.transcript.length === 3, "company transcript must remain visible");
    invariant(teammateView.note === null, "private Call Note leaked to another company user");
    await invariantRejects(
        application.execute(
            ownerCommand(started.id, {
                kind: "set_knowledge_inclusion",
                included: true,
            })
        ),
        "private Call Note entered company knowledge"
    );

    await application.execute(
        ownerCommand(started.id, {
            kind: "set_note_visibility",
            requestId: "request-owner-visibility-company",
            visibility: "company",
        })
    );
    current = (await application.execute(
        ownerCommand(started.id, {
            kind: "request_enrichment",
        })
    ))!;
    invariant(current.enrichment, "request_enrichment did not create a run");

    await application.completeEnrichment(
        CompleteEnrichmentInputSchema.parse({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            callId: started.id,
            enrichmentRunId: current.enrichment.id,
            result: {
                proposal: CALL_NOTES_ENRICHMENT_PROPOSAL,
                modelMetadata: {
                    provider: "fixture",
                    model: "deterministic-enrichment",
                    promptVersion: "call-notes/v1",
                    completionId: "fixture-completion-1",
                },
            },
        })
    );
    current = await application.getCall({
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        callId: started.id,
    });
    invariant(current.enrichment?.status === "ready", "enrichment proposal was not reviewable");
    const renderedProposal = renderEnrichedNoteProposal(CALL_NOTES_ENRICHMENT_PROPOSAL);

    await application.execute(
        ownerCommand(started.id, {
            kind: "accept_enrichment",
            enrichmentRunId: current.enrichment.id,
            contentMarkdown: renderedProposal.contentMarkdown,
            contentRich: renderedProposal.contentRich,
        })
    );
    await application.execute(
        ownerCommand(started.id, {
            kind: "set_knowledge_inclusion",
            included: true,
        })
    );

    const searchResults = await application.searchTranscript({
        companyId: CALL_NOTES_FIXTURE_IDS.companyId,
        actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
        callId: started.id,
        query: "checklist",
    });
    invariant(searchResults.length === 2, "transcript search did not filter matching segments");

    const finalSnapshot = CallSnapshotSchema.parse(
        await application.getCall({
            companyId: CALL_NOTES_FIXTURE_IDS.companyId,
            actorUserId: CALL_NOTES_FIXTURE_IDS.ownerUserId,
            callId: started.id,
        })
    );
    invariant(
        finalSnapshot.note?.knowledgeIncluded,
        "accepted Call Note was not included in knowledge"
    );
    invariant(
        finalSnapshot.enrichment?.status === "accepted",
        "accepted proposal was not immutable history"
    );

    if (knowledgeProbe) {
        const indexed = await knowledgeProbe.get(CALL_NOTES_FIXTURE_IDS.companyId, started.id);
        invariant(indexed, "knowledge sink did not receive the canonical Call Note");
        invariant(
            indexed.revision === finalSnapshot.note.revision,
            "knowledge sink indexed a stale Call Note revision"
        );
    }

    return finalSnapshot;
}
