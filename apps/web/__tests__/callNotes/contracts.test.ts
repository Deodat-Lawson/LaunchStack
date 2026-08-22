import {
    CALL_NOTES_CAPTURE_EVENTS,
    CALL_NOTES_DETECTED_CANDIDATE,
    CALL_NOTES_DISMISS_COMMAND,
    CALL_NOTES_ENRICHMENT_PROPOSAL,
    CALL_NOTES_FIXTURE_IDS,
    CALL_NOTES_START_COMMAND,
    CallNotesCommandSchema,
    CallStatusSchema,
    CaptureEventSchema,
    DetectedCallCandidateSchema,
    EnrichedNoteProposalSchema,
    assertCaptureSourceContract,
    createScriptedCaptureSource,
} from "@launchstack/features/call-notes";

import type { CaptureAttemptHandle, CaptureSource } from "@launchstack/features/call-notes";

describe("Call Notes contract baseline", () => {
    it("keeps one occurrence across pause and same-user return attempts", () => {
        const events = CALL_NOTES_CAPTURE_EVENTS.map(event => CaptureEventSchema.parse(event));

        expect(new Set(events.map(event => event.occurrenceKey))).toEqual(
            new Set([CALL_NOTES_FIXTURE_IDS.occurrenceKey])
        );
        expect(
            new Set(events.flatMap(event => (event.attemptKey ? [event.attemptKey] : []))).size
        ).toBe(2);
        expect(events.filter(event => event.kind === "transcript_segment")).toHaveLength(3);
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

    it("rejects unsupported capture providers at the command boundary", () => {
        expect(() =>
            CallNotesCommandSchema.parse({ ...CALL_NOTES_START_COMMAND, provider: "google_meet" })
        ).toThrow();
    });
    it("keeps detected suggestions separate from Calls until Start", () => {
        const candidate = DetectedCallCandidateSchema.parse(CALL_NOTES_DETECTED_CANDIDATE);

        expect(candidate.occurrenceKey).toBe(CALL_NOTES_DISMISS_COMMAND.occurrenceKey);
        expect(CALL_NOTES_DISMISS_COMMAND.kind).toBe("dismiss_detected_occurrence");
        expect(CALL_NOTES_DISMISS_COMMAND).not.toHaveProperty("callId");
        expect(CallStatusSchema.options).not.toContain("detected");
    });

    it("keeps enrichment as a structured reviewable proposal", () => {
        const proposal = EnrichedNoteProposalSchema.parse(CALL_NOTES_ENRICHMENT_PROPOSAL);

        expect(proposal.chronologicalSections.map(section => section.heading)).toEqual([
            "Onboarding launch risk",
            "Next step",
        ]);
        expect(proposal.actionItems).toEqual([
            expect.objectContaining({ ownerName: "Alex Founder" }),
        ]);
        expect(proposal.contentMarkdown).toContain("## Summary");
    });

    it("exercises start, Pause, and Resume through the capture-source conformance suite", async () => {
        await expect(
            assertCaptureSourceContract(createScriptedCaptureSource())
        ).resolves.toBeUndefined();

        const missingResume: CaptureSource = {
            capabilities: {
                attributedTranscript: true,
                nativePauseResume: true,
                transportReconnect: true,
                observesCaptureUserReturn: true,
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
