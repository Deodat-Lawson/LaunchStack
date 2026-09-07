import assert from "node:assert/strict";
import { test } from "node:test";

import type {
    CaptureEvent,
    LocalCapturePollResult,
    LocalCaptureSession,
} from "@launchstack/features/call-notes";

import type { AudioSource, PcmFrame } from "./local/audio";
import type {
    LocalBackendEventInput,
    LocalBackendFinishInput,
    LocalBackendPollInput,
} from "./local/backend-client";
import { VoiceActivityDetector } from "./local/vad";
import { CallWorkerRuntime, type LocalCaptureControlBackend } from "./worker";
import type { TranscriptionInput, TranscriptionModel } from "./local/transcription";
import type { CallWorkerConfig } from "./config";

const CONFIG: CallWorkerConfig = {
    captureEnabled: true,
    webOrigin: "http://localhost:3000",
    internalToken: "worker-token",
    companyId: "42",
    userId: "user-7",
    ffmpegPath: "ffmpeg",
    audioInputFormat: "avfoundation",
    audioInputDevice: ":0",
    systemAudioEnabled: false,
    systemAudioHelperPath: "",
    audioSampleRate: 1_000,
    audioFrameMs: 20,
    vadThreshold: 0.1,
    vadActivationFrames: 1,
    vadReleaseFrames: 15,
    utteranceMaxMs: 3_000,
    audioPreRollMs: 200,
    audioReadyTimeoutMs: 10_000,
    stopDrainTimeoutMs: 30_000,
    transcriptionTimeoutMs: 20_000,
    transcriptionProvider: "openai",
    transcriptionBaseUrl: "http://localhost:8000/v1",
    transcriptionModel: "whisper-1",
    transcriptionApiKey: "test-key",
    autoEnrich: false,
};

class QuietSource implements AudioSource {
    starts = 0;

    async *frames(signal: AbortSignal): AsyncIterable<PcmFrame> {
        this.starts += 1;
        if (signal.aborted) return;
        yield {
            pcm: new Uint8Array([0, 0]),
            capturedAt: new Date("2026-08-20T10:00:00.000Z"),
            durationMs: 20,
        };
        if (!signal.aborted) {
            await new Promise<void>(resolve =>
                signal.addEventListener("abort", () => resolve(), { once: true })
            );
        }
    }
}

class NoopTranscription implements TranscriptionModel {
    async transcribe(_input: TranscriptionInput): Promise<string> {
        return "";
    }
}

function session(index: number): LocalCaptureSession {
    return {
        callId: `call-${index}`,
        captureId: `capture-${index}`,
        occurrenceKey: `occurrence-${index}`,
        attemptKey: `attempt-${index}`,
        startedAt: "2026-08-20T10:00:00.000Z",
        title: `Call ${index}`,
        desiredMode: "running",
    };
}

class PollBackend implements LocalCaptureControlBackend {
    readonly polls: LocalBackendPollInput[] = [];
    readonly events: CaptureEvent[] = [];
    readonly finishes: LocalBackendFinishInput[] = [];
    private readonly responses: LocalCapturePollResult[];

    constructor(responses: LocalCapturePollResult[]) {
        this.responses = responses;
    }

    async poll(input: LocalBackendPollInput): Promise<LocalCapturePollResult> {
        this.polls.push(input);
        return this.responses.shift() ?? { capture: null };
    }

    async event(input: LocalBackendEventInput): Promise<void> {
        this.events.push(input.event);
    }

    async finish(input: LocalBackendFinishInput): Promise<void> {
        this.finishes.push(input);
    }
}

async function nextTurn(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

await test("CallWorkerRuntime polls while idle and starts only explicit sessions", async () => {
    const sourceInstances: QuietSource[] = [];
    const first = session(1);
    const second = session(2);
    const backend = new PollBackend([
        { capture: null },
        { capture: null },
        { capture: first },
        { capture: { ...first, desiredMode: "stopped" } },
        { capture: null },
        { capture: second },
        { capture: { ...second, desiredMode: "stopped" } },
        { capture: null },
    ]);
    const firstFinished = Promise.withResolvers<void>();
    const secondFinished = Promise.withResolvers<void>();
    const originalFinish = backend.finish.bind(backend);
    backend.finish = async input => {
        await originalFinish(input);
        if (backend.finishes.length === 1) firstFinished.resolve();
        if (backend.finishes.length === 2) secondFinished.resolve();
    };

    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        pollIntervalMs: 500,
        sleep: async () => nextTurn(),
        pipelineDependenciesFactory: () => {
            const source = new QuietSource();
            sourceInstances.push(source);
            return {
                sources: { microphone: source },
                vads: {
                    microphone: new VoiceActivityDetector({
                        threshold: 0.1,
                        activationFrames: 1,
                        releaseFrames: 1,
                    }),
                },
                transcription: new NoopTranscription(),
            };
        },
    });

    const running = runtime.run();
    await nextTurn();
    assert.equal(sourceInstances.length, 0);
    await firstFinished.promise;
    await secondFinished.promise;
    assert.equal(sourceInstances.length, 2);
    assert.equal(
        sourceInstances.every(source => source.starts === 1),
        true
    );
    assert.equal(new Set(backend.polls.map(input => input.workerId)).size, 1);
    await runtime.close();
    await running;
});

await test("CallWorkerRuntime keeps a claimed pipeline responsive to a stop poll", async () => {
    const runningSession = session(3);
    const stoppedSession = { ...runningSession, desiredMode: "stopped" as const };
    const backend = new PollBackend([
        { capture: runningSession },
        { capture: stoppedSession },
        { capture: null },
    ]);
    const source = new QuietSource();
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        sleep: async () => nextTurn(),
        pipelineDependenciesFactory: () => ({
            sources: { microphone: source },
            vads: {
                microphone: new VoiceActivityDetector({
                    threshold: 0.1,
                    activationFrames: 1,
                    releaseFrames: 1,
                }),
            },
            transcription: new NoopTranscription(),
        }),
    });

    const running = runtime.run();
    while (backend.finishes.length === 0) await nextTurn();
    assert.equal(
        backend.events.some(event => event.kind === "attempt_ended"),
        true
    );
    await runtime.close();
    await running;
});

await test("CallWorkerRuntime force-closes capture when backend unassigns it", async () => {
    const runningSession = session(4);
    const backend = new PollBackend([{ capture: runningSession }, { capture: null }]);
    const source = new QuietSource();
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        sleep: async () => nextTurn(),
        pipelineDependenciesFactory: () => ({
            sources: { microphone: source },
            vads: {
                microphone: new VoiceActivityDetector({
                    threshold: 0.1,
                    activationFrames: 1,
                    releaseFrames: 15,
                }),
            },
            transcription: new NoopTranscription(),
        }),
    });

    const running = runtime.run();
    while (!backend.events.some(event => event.kind === "attempt_failed")) {
        await nextTurn();
    }
    assert.equal(backend.finishes.length, 0);
    assert.equal(
        backend.events.some(event => event.kind === "attempt_ended"),
        false
    );
    await runtime.close();
    await running;
});

await test("CallWorkerRuntime keeps graceful stop draining after a null poll", async () => {
    const runningSession = session(5);
    const stoppedSession = { ...runningSession, desiredMode: "stopped" as const };
    const backend = new PollBackend([
        { capture: runningSession },
        { capture: stoppedSession },
        { capture: null },
    ]);
    const finishStarted = Promise.withResolvers<void>();
    const releaseFinish = Promise.withResolvers<void>();
    backend.finish = async input => {
        backend.finishes.push({ ...input });
        finishStarted.resolve();
        await releaseFinish.promise;
    };
    const source = new QuietSource();
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        sleep: async () => nextTurn(),
        pipelineDependenciesFactory: () => ({
            sources: { microphone: source },
            vads: {
                microphone: new VoiceActivityDetector({
                    threshold: 0.1,
                    activationFrames: 1,
                    releaseFrames: 15,
                }),
            },
            transcription: new NoopTranscription(),
        }),
    });

    const running = runtime.run();
    await finishStarted.promise;
    for (let index = 0; index < 3; index += 1) await nextTurn();
    assert.equal(
        backend.events.some(event => event.kind === "attempt_failed"),
        false
    );
    releaseFinish.resolve();
    while (!backend.events.some(event => event.kind === "occurrence_ended")) {
        await nextTurn();
    }
    await runtime.close();
    await running;
});
