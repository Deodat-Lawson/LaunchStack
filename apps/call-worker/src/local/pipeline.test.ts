import assert from "node:assert/strict";
import { test } from "node:test";

import type { CaptureEvent, LocalCaptureSession } from "@launchstack/pipelines/call-notes";

import type { AudioSource, PcmFrame } from "./audio";
import { LocalCapturePipeline, type LocalCaptureBackend } from "./pipeline";
import {
    LocalBackendClient,
    type LocalBackendEventInput,
    type LocalBackendFinishInput,
} from "./backend-client";
import type { TranscriptionInput, TranscriptionModel } from "./transcription";
import { VoiceActivityDetector } from "./vad";

const CAPTURE_START = new Date("2026-08-20T10:00:00.000Z");
const SAMPLE_RATE = 1_000;
const FRAME_DURATION_MS = 20;

const SESSION: LocalCaptureSession = {
    callId: "call-fixed",
    captureId: "capture-fixed",
    occurrenceKey: "occurrence-fixed",
    attemptKey: "attempt-fixed",
    startedAt: CAPTURE_START.toISOString(),
    title: "Synthetic local call",
    desiredMode: "running",
};

function pcmFrame(sample: number, index: number, durationMs = FRAME_DURATION_MS): PcmFrame {
    const sampleCount = Math.round((SAMPLE_RATE * durationMs) / 1_000);
    const pcm = new Uint8Array(sampleCount * 2);
    const view = new DataView(pcm.buffer);
    for (let offset = 0; offset < sampleCount; offset += 1) {
        view.setInt16(offset * 2, sample, true);
    }
    return {
        pcm,
        capturedAt: new Date(CAPTURE_START.getTime() + index * FRAME_DURATION_MS),
        durationMs,
    };
}

class ScriptedAudioSource implements AudioSource {
    framesStarted = 0;
    framesRead = 0;

    constructor(
        private readonly scriptedFrames: readonly PcmFrame[],
        private readonly failure?: Error,
        private readonly holdOpen = false
    ) {}

    async *frames(signal: AbortSignal): AsyncIterable<PcmFrame> {
        this.framesStarted += 1;
        for (const frame of this.scriptedFrames) {
            if (signal.aborted) return;
            this.framesRead += 1;
            yield frame;
            await Promise.resolve();
        }
        if (!signal.aborted && this.failure) throw this.failure;
        if (!signal.aborted && this.holdOpen) {
            await new Promise<void>(resolve =>
                signal.addEventListener("abort", () => resolve(), { once: true })
            );
        }
    }
}

class RecordingBackend implements LocalCaptureBackend {
    readonly eventInputs: LocalBackendEventInput[] = [];
    readonly events: CaptureEvent[] = [];
    readonly finishes: LocalBackendFinishInput[] = [];

    async event(input: LocalBackendEventInput, _signal?: AbortSignal): Promise<void> {
        this.eventInputs.push({ ...input });
        this.events.push(input.event);
    }

    async finish(input: LocalBackendFinishInput, _signal?: AbortSignal): Promise<void> {
        this.finishes.push({ ...input });
    }
}

class RecordingTranscription implements TranscriptionModel {
    readonly inputs: TranscriptionInput[] = [];
    private callCount = 0;

    constructor(private readonly outputs: readonly string[]) {}

    async transcribe(input: TranscriptionInput): Promise<string> {
        this.inputs.push({ ...input, audioWav: new Uint8Array(input.audioWav) });
        const output = this.outputs[this.callCount];
        this.callCount += 1;
        if (output === undefined) throw new Error("transcription fixture ran out of outputs");
        return output;
    }
}

class GatedTranscription implements TranscriptionModel {
    calls = 0;
    readonly started = Promise.withResolvers<void>();
    readonly release = Promise.withResolvers<string>();

    async transcribe(_input: TranscriptionInput): Promise<string> {
        this.calls += 1;
        this.started.resolve();
        return this.release.promise;
    }
}

function createPipeline(input: {
    source: ScriptedAudioSource;
    transcription: TranscriptionModel;
    backend: LocalCaptureBackend;
    utteranceMaxMs?: number;
    audioPreRollMs?: number;
    audioReadyTimeoutMs?: number;
    stopDrainTimeoutMs?: number;
    transcriptionTimeoutMs?: number;
    vadActivationFrames?: number;
    vadReleaseFrames?: number;
    session?: LocalCaptureSession;
}): LocalCapturePipeline {
    const microphoneVad = new VoiceActivityDetector({
        threshold: 0.1,
        activationFrames: input.vadActivationFrames ?? 1,
        releaseFrames: input.vadReleaseFrames ?? 1,
        frameDurationMs: FRAME_DURATION_MS,
    });
    return new LocalCapturePipeline({
        session: input.session ?? SESSION,
        sources: { microphone: input.source },
        vads: { microphone: microphoneVad },
        transcription: input.transcription,
        backend: input.backend,
        companyId: "42",
        userId: "user-7",
        autoEnrich: false,
        sampleRate: SAMPLE_RATE,
        utteranceMaxMs: input.utteranceMaxMs ?? 3_000,
        audioPreRollMs: input.audioPreRollMs ?? 200,
        audioReadyTimeoutMs: input.audioReadyTimeoutMs ?? 10_000,
        stopDrainTimeoutMs: input.stopDrainTimeoutMs ?? 30_000,
        transcriptionTimeoutMs: input.transcriptionTimeoutMs ?? 20_000,
        frameDurationMs: FRAME_DURATION_MS,
    });
}

function eventKinds(backend: RecordingBackend): string[] {
    return backend.events.map(event => event.kind);
}

async function nextTurn(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

await test("LocalCapturePipeline does not open sources until an explicit session runs", async () => {
    const source = new ScriptedAudioSource([], undefined, true);
    const backend = new RecordingBackend();
    const pipeline = createPipeline({
        source,
        transcription: new RecordingTranscription([]),
        backend,
    });

    assert.equal(source.framesStarted, 0);
    const running = pipeline.run();
    await nextTurn();
    assert.equal(source.framesStarted, 1);
    assert.equal(backend.finishes.length, 0);
    await pipeline.stop();
    await running;
});

await test("LocalCapturePipeline keeps a silent session active until explicit stop", async () => {
    const source = new ScriptedAudioSource([pcmFrame(0, 0), pcmFrame(0, 1)], undefined, true);
    const backend = new RecordingBackend();
    const pipeline = createPipeline({
        source,
        transcription: new RecordingTranscription([]),
        backend,
    });

    const running = pipeline.run();
    await nextTurn();
    await nextTurn();
    assert.equal(backend.finishes.length, 0);
    await pipeline.stop();
    await running;

    assert.equal(backend.finishes.length, 1);
    const ended = backend.events.find(event => event.kind === "attempt_ended");
    assert.equal(ended?.kind, "attempt_ended");
    if (ended?.kind === "attempt_ended") assert.equal(ended.reason, "user_stopped");
});

await test("LocalCapturePipeline reports a resumed attempt as connected when its audio is ready, not at the Capture start", async () => {
    // Session startedAt is the Capture's start; this attempt's audio begins 10 minutes later.
    const resumedAt = 30_000;
    const source = new ScriptedAudioSource(
        [pcmFrame(0, resumedAt), pcmFrame(0, resumedAt + 1)],
        undefined,
        true
    );
    const backend = new RecordingBackend();
    const pipeline = createPipeline({
        source,
        transcription: new RecordingTranscription([]),
        backend,
    });

    const running = pipeline.run();
    await nextTurn();
    await nextTurn();
    await pipeline.stop();
    await running;

    const connected = backend.events.find(event => event.kind === "attempt_connected");
    assert.equal(
        connected?.occurredAt,
        new Date(CAPTURE_START.getTime() + resumedAt * FRAME_DURATION_MS).toISOString()
    );
});

await test("LocalCapturePipeline stop drains a pending transcript before durable finish", async () => {
    const source = new ScriptedAudioSource([pcmFrame(12_000, 0), pcmFrame(0, 1)], undefined, true);
    const backend = new RecordingBackend();
    const transcription = new GatedTranscription();
    const pipeline = createPipeline({ source, transcription, backend });

    const running = pipeline.run();
    await transcription.started.promise;
    let stopped = false;
    const stop = pipeline.stop().then(() => {
        stopped = true;
    });
    await nextTurn();
    assert.equal(stopped, false);
    transcription.release.resolve("final words");
    await stop;
    await running;

    assert.deepEqual(eventKinds(backend), [
        "attempt_connected",
        "transcript_segment",
        "attempt_ended",
        "occurrence_ended",
    ]);
    assert.equal(backend.events[1]?.kind, "transcript_segment");
    if (backend.events[1]?.kind === "transcript_segment") {
        assert.equal(backend.events[1].text, "final words");
    }
    assert.equal(backend.finishes.length, 1);
});

await test("LocalCapturePipeline treats unexpected source EOF as capture loss", async () => {
    const sourceFrame = pcmFrame(0, 0);
    const source = new ScriptedAudioSource([sourceFrame]);
    const backend = new RecordingBackend();
    const pipeline = createPipeline({
        source,
        transcription: new RecordingTranscription([]),
        backend,
    });

    await assert.rejects(pipeline.run(), /audio stream ended before explicit stop/);
    assert.equal(
        backend.events.some(event => event.kind === "attempt_failed"),
        true
    );
    assert.equal(
        backend.events.some(event => event.kind === "attempt_ended"),
        false
    );
    assert.equal(
        backend.events.some(event => event.kind === "occurrence_ended"),
        false
    );
    assert.equal(backend.finishes.length, 0);
});

await test("LocalCapturePipeline reports source failures without finishing the call", async () => {
    const source = new ScriptedAudioSource([], new Error("source failed"));
    const backend = new RecordingBackend();
    const pipeline = createPipeline({
        source,
        transcription: new RecordingTranscription([]),
        backend,
    });

    await assert.rejects(pipeline.run(), /source failed/);
    assert.equal(backend.finishes.length, 0);
    const failed = backend.events.find(event => event.kind === "attempt_failed");
    assert.equal(failed?.kind, "attempt_failed");
    assert.equal(
        backend.events.some(event => event.kind === "attempt_connected"),
        false
    );
    if (failed?.kind === "attempt_failed") assert.equal(failed.code, "capture_not_ready");
});

await test("LocalCapturePipeline preserves VAD activation pre-roll without duplicating chunks", async () => {
    const source = new ScriptedAudioSource(
        [pcmFrame(0, 0), pcmFrame(12_000, 1), pcmFrame(12_000, 2), pcmFrame(0, 3), pcmFrame(0, 4)],
        undefined,
        true
    );
    const backend = new RecordingBackend();
    const transcription = new RecordingTranscription(["pre-roll words"]);
    const pipeline = createPipeline({
        source,
        transcription,
        backend,
        audioPreRollMs: 40,
        vadActivationFrames: 2,
        vadReleaseFrames: 2,
    });

    const running = pipeline.run();
    for (let index = 0; index < 5 && transcription.inputs.length === 0; index += 1) {
        await nextTurn();
    }
    assert.equal(transcription.inputs.length, 1);
    const wav = transcription.inputs[0]!.audioWav;
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(view.getUint32(40, true), 5 * 40);
    assert.equal(view.getInt16(44, true), 0);
    assert.equal(view.getInt16(44 + 40, true), 12_000);
    assert.equal(view.getInt16(44 + 80, true), 12_000);
    assert.equal(view.getInt16(44 + 120, true), 0);
    assert.equal(view.getInt16(44 + 160, true), 0);

    await pipeline.stop();
    await running;
});

await test("LocalCapturePipeline allows a successful ASR drain longer than one second", async () => {
    const source = new ScriptedAudioSource([pcmFrame(12_000, 0)], undefined, true);
    const backend = new RecordingBackend();
    const transcription = new GatedTranscription();
    const pipeline = createPipeline({ source, transcription, backend });
    const running = pipeline.run();
    await nextTurn();

    const startedAt = Date.now();
    const stop = pipeline.stop();
    await transcription.started.promise;
    setTimeout(() => transcription.release.resolve("delayed words"), 1_050);
    await stop;
    assert.ok(Date.now() - startedAt >= 1_000);
    await running;
    assert.equal(backend.finishes.length, 1);
});

await test("LocalCapturePipeline rejects a stop drain timeout and records explicit failure", async () => {
    const source = new ScriptedAudioSource([pcmFrame(12_000, 0)], undefined, true);
    const backend = new RecordingBackend();
    const transcription = new GatedTranscription();
    const pipeline = createPipeline({
        source,
        transcription,
        backend,
        stopDrainTimeoutMs: 20,
    });
    const running = pipeline.run();
    await nextTurn();

    await assert.rejects(pipeline.stop(), /stop drain timed out after 20ms/);
    const failed = backend.events.find(event => event.kind === "attempt_failed");
    assert.equal(failed?.kind, "attempt_failed");
    if (failed?.kind === "attempt_failed") assert.equal(failed.code, "capture_stop_timeout");
    transcription.release.resolve("late words");
    await assert.rejects(running, /stop drain timed out after 20ms/);
    assert.equal(backend.finishes.length, 0);
});

await test("LocalCapturePipeline close is cancellation and never finalizes successfully", async () => {
    const source = new ScriptedAudioSource([pcmFrame(12_000, 0)], undefined, true);
    const backend = new RecordingBackend();
    const pipeline = createPipeline({
        source,
        transcription: new RecordingTranscription(["words"]),
        backend,
    });

    const running = pipeline.run();
    await nextTurn();
    await pipeline.close();
    await running;
    assert.equal(backend.finishes.length, 0);
    assert.equal(
        backend.events.some(event => event.kind === "attempt_failed"),
        true
    );
});

await test("LocalCapturePipeline buffers more than eight utterances through a 40-second backend outage", async () => {
    const utterances = 12;
    const source = new ScriptedAudioSource(
        Array.from({ length: utterances * 2 }, (_, index) =>
            pcmFrame(index % 2 === 0 ? 12_000 : 0, index)
        ),
        undefined,
        true
    );
    const audioInputs: TranscriptionInput[] = [];
    const transcription: TranscriptionModel = {
        async transcribe(input) {
            audioInputs.push(input);
            return `utterance ${audioInputs.length}`;
        },
    };
    const outageStarted = Promise.withResolvers<void>();
    const releaseOutage = Promise.withResolvers<void>();
    const delivered: CaptureEvent[] = [];
    let elapsed = 0;
    let finishes = 0;
    const backend = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        random: () => 0.5,
        now: () => elapsed,
        onRetry: () => undefined,
        sleep: async milliseconds => {
            outageStarted.resolve();
            await releaseOutage.promise;
            elapsed += milliseconds;
        },
        fetch: async (_url, init) => {
            const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
                kind: string;
                event?: CaptureEvent;
            };
            if (body.event?.kind === "transcript_segment" && elapsed < 40_000) {
                return new Response("web server restarting", { status: 503 });
            }
            if (body.event) delivered.push(body.event);
            if (body.kind === "finish") finishes += 1;
            return Response.json({ ok: true });
        },
    });
    const pipeline = createPipeline({ source, transcription, backend });
    const running = pipeline.run();
    void running.catch(() => undefined);
    try {
        await Promise.race([outageStarted.promise, running]);
        await nextTurn();
        assert.equal(audioInputs.length, utterances);
        assert.equal(delivered.filter(event => event.kind === "transcript_segment").length, 0);
        assert.ok(audioInputs.every(input => input.audioWav.every(byte => byte === 0)));
        releaseOutage.resolve();
        await pipeline.stop();
        await running;

        const segments = delivered.filter(event => event.kind === "transcript_segment");
        assert.deepEqual(
            segments.map(segment => segment.text),
            Array.from({ length: utterances }, (_, index) => `utterance ${index + 1}`)
        );
        assert.deepEqual(
            segments.map(segment => segment.receiveOrder),
            Array.from({ length: utterances }, (_, index) => index)
        );
        assert.ok(elapsed >= 40_000);
        assert.equal(
            delivered.some(event => event.kind === "attempt_failed"),
            false
        );
        assert.equal(finishes, 1);
    } finally {
        releaseOutage.resolve();
        await pipeline.close();
        await running.catch(() => undefined);
    }
});

await test("LocalCapturePipeline user pause drains transcripts and ends only its Capture Attempt", async () => {
    const source = new ScriptedAudioSource(
        [
            pcmFrame(12_000, 0),
            pcmFrame(0, 1),
            pcmFrame(12_000, 2),
            pcmFrame(0, 3),
            pcmFrame(12_000, 4),
        ],
        undefined,
        true
    );
    const backend = new RecordingBackend();
    const deliveryStarted = Promise.withResolvers<void>();
    const releaseDelivery = Promise.withResolvers<void>();
    const releaseTranscription = Promise.withResolvers<string>();
    let transcriptions = 0;
    const transcription: TranscriptionModel = {
        async transcribe() {
            transcriptions += 1;
            if (transcriptions === 1) return "already transcribed";
            if (transcriptions === 2) return releaseTranscription.promise;
            return "last partial utterance";
        },
    };
    const originalEvent = backend.event.bind(backend);
    backend.event = async input => {
        if (input.event.kind === "transcript_segment") {
            deliveryStarted.resolve();
            await releaseDelivery.promise;
        }
        await originalEvent(input);
    };
    const pipeline = createPipeline({ source, transcription, backend });
    const running = pipeline.run();
    void running.catch(() => undefined);
    try {
        await deliveryStarted.promise;
        await nextTurn();
        let paused = false;
        const pausing = pipeline.pause().then(() => {
            paused = true;
        });
        await nextTurn();
        assert.equal(paused, false);
        assert.equal(backend.finishes.length, 0);
        releaseTranscription.resolve("pending transcription");
        await nextTurn();
        assert.equal(paused, false);
        releaseDelivery.resolve();
        await pausing;
        await running;

        assert.deepEqual(eventKinds(backend), [
            "attempt_connected",
            "transcript_segment",
            "transcript_segment",
            "transcript_segment",
            "attempt_ended",
        ]);
        assert.deepEqual(
            backend.events
                .filter(event => event.kind === "transcript_segment")
                .map(event => event.text),
            ["already transcribed", "pending transcription", "last partial utterance"]
        );
        const ended = backend.events.find(event => event.kind === "attempt_ended");
        assert.equal(ended?.reason, "user_paused");
        assert.equal(backend.finishes.length, 0);
    } finally {
        releaseTranscription.resolve("pending transcription");
        releaseDelivery.resolve();
        await pipeline.close();
        await running.catch(() => undefined);
    }
});

await test("LocalCapturePipeline rejects a full text-only delivery buffer with an explicit loss boundary", async () => {
    const utterances = 601;
    const source = new ScriptedAudioSource(
        Array.from({ length: utterances * 2 }, (_, index) =>
            pcmFrame(index % 2 === 0 ? 12_000 : 0, index)
        ),
        undefined,
        true
    );
    const backend = new RecordingBackend();
    const originalEvent = backend.event.bind(backend);
    backend.event = async (input, signal) => {
        if (input.event.kind === "transcript_segment") {
            await new Promise<void>((_resolve, reject) => {
                const abort = (): void =>
                    reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
            });
        }
        await originalEvent(input, signal);
    };
    const transcription = new RecordingTranscription(
        Array.from({ length: utterances }, (_, index) => `utterance ${index + 1}`)
    );
    const pipeline = createPipeline({ source, transcription, backend });

    await assert.rejects(
        pipeline.run(),
        /transcript delivery buffer exceeded \(600 undelivered segments pending\)/
    );
    assert.equal(transcription.inputs.length, utterances);
    assert.equal(backend.events.filter(event => event.kind === "transcript_segment").length, 0);
    const failure = backend.events.find(event => event.kind === "attempt_failed");
    assert.match(failure?.message ?? "", /600 undelivered segments pending/);
    assert.equal(backend.finishes.length, 0);
});

await test("LocalCapturePipeline an already-paused session ends its Attempt without opening sources", async () => {
    const source = new ScriptedAudioSource([], undefined, true);
    const backend = new RecordingBackend();
    const pipeline = createPipeline({
        source,
        transcription: new RecordingTranscription([]),
        backend,
        session: { ...SESSION, desiredMode: "paused" },
    });

    await pipeline.run();
    assert.equal(source.framesStarted, 0);
    assert.deepEqual(eventKinds(backend), ["attempt_ended"]);
    const ended = backend.events[0];
    assert.equal(ended?.kind, "attempt_ended");
    if (ended?.kind === "attempt_ended") assert.equal(ended.reason, "user_paused");
    assert.equal(backend.finishes.length, 0);
});
