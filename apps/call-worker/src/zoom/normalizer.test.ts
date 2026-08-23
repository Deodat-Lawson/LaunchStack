import assert from "node:assert/strict";
import test from "node:test";

import { ZoomCaptureEventNormalizer } from "./normalizer";

const context = {
    occurrenceKey: "zoom-occurrence-1",
    attemptKey: "zoom-attempt-1",
};

void test("normalizes attributed transcript evidence deterministically", () => {
    const first = new ZoomCaptureEventNormalizer(context).transcript(
        "  Disclosed demo phrase.  ",
        42,
        {
            userId: 7,
            userName: "Pilot User",
            startTs: 1_000,
            endTs: 2_000,
            language: "en",
        },
        new Date("2026-08-23T12:00:00.000Z")
    );
    const replay = new ZoomCaptureEventNormalizer(context).transcript(
        "Disclosed demo phrase.",
        42,
        {
            userId: 7,
            userName: "Pilot User",
            startTs: 1_000,
            endTs: 2_000,
            language: "en",
        },
        new Date("2026-08-23T12:00:00.000Z")
    );

    assert.equal(first.kind, "transcript_segment");
    if (first.kind !== "transcript_segment" || replay.kind !== "transcript_segment") return;
    assert.equal(first.text, "Disclosed demo phrase.");
    assert.equal(first.participant?.displayName, "Pilot User");
    assert.equal(first.sourcePacketHash, replay.sourcePacketHash);
    assert.equal(first.eventId, replay.eventId);
});

void test("uses monotonic receive order without changing packet identity", () => {
    const normalizer = new ZoomCaptureEventNormalizer(context);
    const input = [
        "Repeated provider packet",
        100,
        { userId: "user-1", userName: "Pilot User" },
        new Date("2026-08-23T12:00:00.000Z"),
    ] as const;
    const first = normalizer.transcript(...input);
    const duplicate = normalizer.transcript(...input);

    if (first.kind !== "transcript_segment" || duplicate.kind !== "transcript_segment") {
        assert.fail("expected transcript events");
    }
    assert.equal(first.sourcePacketHash, duplicate.sourcePacketHash);
    assert.equal(first.receiveOrder, 0);
    assert.equal(duplicate.receiveOrder, 1);
});

void test("maps native Pause and Resume operation codes", () => {
    const normalizer = new ZoomCaptureEventNormalizer(context);
    const paused = normalizer.sessionState({
        operation: 3,
        occurredAt: new Date("2026-08-23T12:01:00.000Z"),
    });
    const resumed = normalizer.sessionState({
        operation: 4,
        occurredAt: new Date("2026-08-23T12:02:00.000Z"),
    });

    assert.equal(paused?.kind, "attempt_paused");
    assert.equal(resumed?.kind, "attempt_resumed");
    assert.equal(normalizer.sessionState({ operation: 1, occurredAt: new Date() }), null);
});

void test("maps observed Zoom stop reasons without inventing detail", () => {
    const normalizer = new ZoomCaptureEventNormalizer(context);
    const occurredAt = new Date("2026-08-23T12:03:00.000Z");

    const userLeft = normalizer.ended(3, occurredAt);
    const meetingEnded = normalizer.ended(6, occurredAt);
    const providerStopped = normalizer.ended(99, occurredAt);

    assert.equal(userLeft.kind === "attempt_ended" && userLeft.reason, "capture_user_left");
    assert.equal(meetingEnded.kind === "attempt_ended" && meetingEnded.reason, "meeting_ended");
    assert.equal(
        providerStopped.kind === "attempt_ended" && providerStopped.reason,
        "provider_stopped"
    );
});
