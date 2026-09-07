import assert from "node:assert/strict";
import { test } from "node:test";

import type { PcmFrame } from "./audio";
import { VoiceActivityDetector } from "./vad";

const FRAME_AT = new Date("2026-08-20T10:00:00.000Z");

function pcm16(value: number): Uint8Array {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setInt16(0, value, true);
    return bytes;
}

function frame(value: number, durationMs = 20): PcmFrame {
    return { pcm: pcm16(value), capturedAt: new Date(FRAME_AT), durationMs };
}

test("VoiceActivityDetector activates only after the configured threshold count", () => {
    const vad = new VoiceActivityDetector({
        threshold: 0.25,
        activationFrames: 2,
        releaseFrames: 2,
    });

    const below = vad.process(frame(8_191));
    assert.equal(below.active, false);
    assert.equal(below.started, false);
    assert.equal(below.ended, false);
    assert.ok(below.rms < 0.25);

    const firstAtThreshold = vad.process(frame(8_192));
    assert.equal(firstAtThreshold.active, false);
    assert.equal(firstAtThreshold.started, false);

    const activated = vad.process(frame(8_192));
    assert.equal(activated.active, true);
    assert.equal(activated.started, true);
    assert.equal(activated.ended, false);
    assert.equal(vad.active, true);

    const continuing = vad.process(frame(8_192));
    assert.deepEqual(
        { active: continuing.active, started: continuing.started, ended: continuing.ended },
        { active: true, started: false, ended: false }
    );
});

test("VoiceActivityDetector releases on the exact quiet-frame boundary", () => {
    const vad = new VoiceActivityDetector({
        threshold: 0.1,
        activationFrames: 1,
        releaseFrames: 2,
    });

    assert.equal(vad.process(frame(10_000)).started, true);
    const firstQuiet = vad.process(frame(0));
    assert.equal(firstQuiet.active, true);
    assert.equal(firstQuiet.ended, false);

    const secondQuiet = vad.process(frame(0));
    assert.equal(secondQuiet.active, false);
    assert.equal(secondQuiet.started, false);
    assert.equal(secondQuiet.ended, true);

    const quietAfterRelease = vad.process(frame(0));
    assert.equal(quietAfterRelease.active, false);
    assert.equal(quietAfterRelease.ended, false);
});

test("VoiceActivityDetector releases on accumulated duration at the time boundary", () => {
    const vad = new VoiceActivityDetector({
        threshold: 0.1,
        activationFrames: 1,
        releaseSilenceMs: 50,
        frameDurationMs: 20,
    });

    assert.equal(vad.process(frame(10_000)).active, true);
    assert.equal(vad.process(frame(0, 20)).ended, false);
    assert.equal(vad.process(frame(0, 29)).ended, false);

    const boundary = vad.process(frame(0, 1));
    assert.equal(boundary.active, false);
    assert.equal(boundary.ended, true);
});
