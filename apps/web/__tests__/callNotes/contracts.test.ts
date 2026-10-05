import {
    CALL_NOTES_CAPTURE_EVENTS,
    CALL_NOTES_DETECTED_CANDIDATE,
    CALL_NOTES_DISMISS_COMMAND,
    CALL_NOTES_ENRICHMENT_PROPOSAL,
    CALL_NOTES_FIXTURE_IDS,
    CALL_NOTES_START_COMMAND,
    CALL_NOTES_SCHEMA_VERSION,
    CallNotesCommandSchema,
    CallNotesSourceSchema,
    CallStatusSchema,
    CaptureEventSchema,
    CallSnapshotSchema,
    DetectedCallCandidateSchema,
    assertCaptureSourceContract,
    createScriptedCaptureSource,
} from "@launchstack/pipelines/call-notes";

import type { CaptureAttemptHandle, CaptureSource } from "@launchstack/pipelines/call-notes";

describe("Call Notes contract baseline", () => {
    it("keeps one occurrence across pause and same-user return attempts", () => {
        const events = CALL_NOTES_CAPTURE_EVENTS.map(event => CaptureEventSchema.parse(event));

        expect(new Set(events.map(event => event.sourceOccurrenceKey))).toEqual(
            new Set([CALL_NOTES_FIXTURE_IDS.sourceOccurrenceKey])
        );
        expect(
            new Set(
                events.flatMap(event => (event.sourceAttemptKey ? [event.sourceAttemptKey] : []))
            ).size
        ).toBe(2);
        expect(events.filter(event => event.kind === "transcript_segment")).toHaveLength(3);
        expect(
            events
                .filter(event => event.kind === "transcript_segment")
                .map(event => event.sourceKind)
        ).toEqual(["derived_asr", "derived_asr", "derived_asr"]);
        expect(events.filter(event => event.source === "local_audio")).toHaveLength(events.length);
        expect(events.some(event => event.kind === "attempt_paused")).toBe(true);
        expect(events.some(event => event.kind === "participant_returned")).toBe(true);
    });

    it("requires replay-safe evidence identity on every transcript segment", () => {
        const segment = CALL_NOTES_CAPTURE_EVENTS.find(
            event => event.kind === "transcript_segment"
        );
        if (!segment) throw new Error("fixture transcript segment missing");
        const withoutHash: Partial<typeof segment> = { ...segment };
        delete withoutHash.sourcePacketHash;

        expect(() => CaptureEventSchema.parse(withoutHash)).toThrow();
    });

    it("accepts only local audio capture at the command boundary", () => {
        expect(CallNotesSourceSchema.parse("local_audio")).toBe("local_audio");
        expect(() => CallNotesSourceSchema.parse("remote_conference")).toThrow();
        expect(() =>
            CallNotesCommandSchema.parse({
                ...CALL_NOTES_START_COMMAND,
                source: "remote_conference",
            })
        ).toThrow();
    });

    it("rejects retired bookmark command kinds", () => {
        for (const kind of ["add_bookmark", "update_bookmark", "remove_bookmark"]) {
            expect(() =>
                CallNotesCommandSchema.parse({
                    ...CALL_NOTES_START_COMMAND,
                    kind,
                })
            ).toThrow();
        }
    });

    it("keeps detected suggestions separate from Calls until Start", () => {
        const candidate = DetectedCallCandidateSchema.parse(CALL_NOTES_DETECTED_CANDIDATE);

        expect(candidate.sourceOccurrenceKey).toBe(CALL_NOTES_DISMISS_COMMAND.sourceOccurrenceKey);
        expect(CALL_NOTES_DISMISS_COMMAND.kind).toBe("dismiss_detected_occurrence");
        expect(CALL_NOTES_DISMISS_COMMAND).not.toHaveProperty("callId");
        expect(CallStatusSchema.options).not.toContain("detected");
    });

    it("fails closed when a private-note projection carries enrichment", () => {
        const viewerCapabilities = {
            canEditNote: false,
            canControlCapture: false,
            canRequestEnrichment: false,
            canResolveEnrichment: false,
            canChangeVisibility: false,
            canDelete: false,
        };
        const snapshot = {
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            id: "call-private",
            companyId: "1",
            source: "local_audio",
            sourceOccurrenceKey: "local-occurrence-private",
            title: "Private call",
            status: "completed",
            capture: {
                id: "capture-private",
                desiredMode: "running",
                pausedReason: null,
                lifecycle: "completed",
                outcome: "complete",
                activeAttemptId: null,
                attemptCount: 1,
            },
            viewerCapabilities,
            transcript: [],
            gaps: [],
            note: null,
            enrichment: {
                id: "enrichment-private",
                status: "ready",
                baseNoteRevision: 1,
                transcriptFingerprint: "a".repeat(64),
                proposal: CALL_NOTES_ENRICHMENT_PROPOSAL,
                modelMetadata: {
                    provider: "fixture",
                    model: "fixture-model",
                    promptVersion: "call-notes/v1",
                },
                createdAt: "2026-08-15T14:30:00.000Z",
                resolvedAt: null,
            },
            createdAt: "2026-08-15T14:00:00.000Z",
            updatedAt: "2026-08-15T14:30:00.000Z",
        };

        expect(() => CallSnapshotSchema.parse(snapshot)).toThrow(
            "Private-note projections must redact enrichment"
        );
        expect(() => CallSnapshotSchema.parse({ ...snapshot, enrichment: null })).not.toThrow();
    });

    it("exercises start, Pause, and Resume through the capture-source conformance suite", async () => {
        await expect(
            assertCaptureSourceContract(createScriptedCaptureSource())
        ).resolves.toBeUndefined();

        const missingResume: CaptureSource = {
            capabilities: {
                attributedTranscript: false,
                nativePauseResume: true,
                transportReconnect: false,
                observesCaptureUserReturn: false,
            },
            async startAttempt(input, sink): Promise<CaptureAttemptHandle> {
                await sink.append(CALL_NOTES_CAPTURE_EVENTS[0]!);
                return {
                    async pause() {
                        await sink.append(CALL_NOTES_CAPTURE_EVENTS[4]!);
                    },
                    async resume() {
                        return undefined;
                    },
                    async dispose() {
                        return undefined;
                    },
                };
            },
        };

        await expect(assertCaptureSourceContract(missingResume)).rejects.toThrow(
            "missing resumed event"
        );
    });
});
