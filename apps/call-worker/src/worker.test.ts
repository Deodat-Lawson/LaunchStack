import assert from "node:assert/strict";
import { test } from "node:test";

import type {
    CaptureEvent,
    LocalCapturePollResult,
    LocalCaptureSession,
} from "@launchstack/pipelines/call-notes";

import type { AudioSource, PcmFrame } from "./local/audio";
import {
    LocalBackendClient,
    type LocalBackendEventInput,
    type LocalBackendFinishInput,
    type LocalBackendPollInput,
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

await test("CallWorkerRuntime reports the opaque active Attempt key while its pipeline runs", async () => {
    const runningSession = { ...session(6), attemptKey: "worker-fixed:attempt-uuid" };
    const backend = new PollBackend([{ capture: runningSession }, { capture: runningSession }]);
    const observedActivePoll = Promise.withResolvers<LocalBackendPollInput>();
    const originalPoll = backend.poll.bind(backend);
    backend.poll = async input => {
        const result = await originalPoll(input);
        if (backend.polls.length === 2) observedActivePoll.resolve(input);
        return result;
    };
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        workerId: "worker-fixed",
        sleep: async () => nextTurn(),
        sources: { microphone: new QuietSource() },
        transcription: new NoopTranscription(),
    });
    const running = runtime.run();
    void running.catch(() => undefined);
    try {
        const input = await Promise.race([observedActivePoll.promise, running]);
        assert.ok(input);
        assert.equal(input.activeAttemptKey, runningSession.attemptKey);
        assert.notEqual(input.activeAttemptKey, input.workerId);
        assert.equal(backend.polls[0]?.activeAttemptKey, undefined);
    } finally {
        await runtime.close();
        await running;
    }
});

await test("CallWorkerRuntime survives a pipeline rejection and omits its dead Attempt from the next poll", async () => {
    class FailingSource extends QuietSource {
        async *frames(_signal: AbortSignal): AsyncIterable<PcmFrame> {
            throw new Error("microphone disconnected");
        }
    }
    const runningSession = session(7);
    const backend = new PollBackend([{ capture: runningSession }, { capture: null }]);
    const nextPoll = Promise.withResolvers<LocalBackendPollInput>();
    const originalPoll = backend.poll.bind(backend);
    backend.poll = async input => {
        const result = await originalPoll(input);
        if (backend.polls.length === 2) nextPoll.resolve(input);
        return result;
    };
    const failures: Record<string, unknown>[] = [];
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        sleep: async () => nextTurn(),
        sources: { microphone: new FailingSource() },
        transcription: new NoopTranscription(),
        log: (event, fields) => {
            if (event === "call_worker_pipeline_failed") failures.push(fields);
        },
    });
    const running = runtime.run();
    void running.catch(() => undefined);
    try {
        const input = await Promise.race([nextPoll.promise, running]);
        assert.ok(input, "the worker must continue polling after the audio pipeline rejects");
        assert.equal(input.activeAttemptKey, undefined);
        assert.equal(failures.length, 1);
        assert.match(String(failures[0]?.message), /microphone disconnected/);
        assert.equal(backend.finishes.length, 0);
        await runtime.close();
        await running;
    } finally {
        await runtime.close();
        await running.catch(() => undefined);
    }
});

await test("CallWorkerRuntime stops retrying a stale active Attempt poll when its pipeline settles", async () => {
    const sourceFailure = Promise.withResolvers<void>();
    class GatedFailureSource extends QuietSource {
        async *frames(signal: AbortSignal): AsyncIterable<PcmFrame> {
            yield {
                pcm: new Uint8Array([0, 0]),
                capturedAt: new Date("2026-08-20T10:00:00.000Z"),
                durationMs: 20,
            };
            const stopped = Promise.withResolvers<void>();
            const onAbort = (): void => stopped.resolve();
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
            try {
                await Promise.race([sourceFailure.promise, stopped.promise]);
            } finally {
                signal.removeEventListener("abort", onAbort);
            }
            if (!signal.aborted) throw new Error("microphone disconnected during outage");
        }
    }
    const runningSession = session(8);
    const polls: LocalBackendPollInput[] = [];
    const retryStarted = Promise.withResolvers<void>();
    const failureLogged = Promise.withResolvers<void>();
    const backend = new LocalBackendClient({
        webOrigin: CONFIG.webOrigin,
        token: CONFIG.internalToken,
        onRetry: () => undefined,
        sleep: async (_milliseconds, signal) => {
            retryStarted.resolve();
            await new Promise<void>((_resolve, reject) => {
                const abort = (): void =>
                    reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
            });
        },
        fetch: async (_url, init) => {
            const body = JSON.parse(
                typeof init?.body === "string" ? init.body : "{}"
            ) as LocalBackendPollInput & { kind: string };
            if (body.kind !== "poll") return Response.json({ ok: true });
            polls.push(body);
            if (polls.length === 2) return new Response("web server restarting", { status: 503 });
            return Response.json({ capture: polls.length === 1 ? runningSession : null });
        },
    });
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        sources: { microphone: new GatedFailureSource() },
        transcription: new NoopTranscription(),
        sleep: async () => nextTurn(),
        log: event => {
            if (event === "call_worker_pipeline_failed") failureLogged.resolve();
        },
    });
    const running = runtime.run();
    void running.catch(() => undefined);
    try {
        await Promise.race([retryStarted.promise, running]);
        assert.equal(polls[1]?.activeAttemptKey, runningSession.attemptKey);
        sourceFailure.resolve();
        await Promise.race([failureLogged.promise, running]);
        await nextTurn();
        await nextTurn();
        assert.ok(polls.length >= 3, "a settled pipeline must interrupt stale poll retries");
        assert.equal(polls[2]?.activeAttemptKey, undefined);
    } finally {
        sourceFailure.resolve();
        await runtime.close();
        await running.catch(() => undefined);
    }
});

await test("CallWorkerRuntime user pause idles and Resume opens a new Attempt on the same Call", async () => {
    const first = session(9);
    const resumed = { ...first, attemptKey: "worker-fixed:resumed-attempt" };
    const backend = new PollBackend([]);
    const firstEnded = Promise.withResolvers<CaptureEvent>();
    const secondFinished = Promise.withResolvers<void>();
    const sources: QuietSource[] = [];
    backend.poll = async input => {
        backend.polls.push(input);
        if (backend.finishes.length > 0) return { capture: null };
        if (
            backend.events.some(
                event =>
                    event.kind === "attempt_connected" &&
                    event.sourceAttemptKey === resumed.attemptKey
            )
        ) {
            return { capture: { ...resumed, desiredMode: "stopped" } };
        }
        if (
            backend.events.some(
                event =>
                    event.kind === "attempt_ended" &&
                    event.sourceAttemptKey === first.attemptKey &&
                    event.reason === "user_paused"
            )
        ) {
            return { capture: resumed };
        }
        if (backend.events.some(event => event.kind === "attempt_connected")) {
            return { capture: { ...first, desiredMode: "paused" } };
        }
        return { capture: first };
    };
    const originalEvent = backend.event.bind(backend);
    backend.event = async input => {
        await originalEvent(input);
        if (
            (input.event.kind === "attempt_ended" || input.event.kind === "attempt_failed") &&
            input.event.sourceAttemptKey === first.attemptKey
        ) {
            firstEnded.resolve(input.event);
        }
    };
    const originalFinish = backend.finish.bind(backend);
    backend.finish = async input => {
        await originalFinish(input);
        secondFinished.resolve();
    };
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        sleep: async () => nextTurn(),
        pipelineDependenciesFactory: () => {
            const source = new QuietSource();
            sources.push(source);
            return { sources: { microphone: source }, transcription: new NoopTranscription() };
        },
    });
    const running = runtime.run();
    void running.catch(() => undefined);
    try {
        const ended = await Promise.race([firstEnded.promise, running]);
        assert.equal(ended?.kind, "attempt_ended");
        if (ended?.kind === "attempt_ended") assert.equal(ended.reason, "user_paused");
        assert.equal(backend.finishes.length, 0);
        await Promise.race([secondFinished.promise, running]);
        assert.equal(sources.length, 2);
        assert.ok(sources.every(source => source.starts === 1));
        assert.equal(
            backend.events.some(event => event.kind === "attempt_failed"),
            false
        );
        assert.deepEqual(
            backend.events
                .filter(event => event.kind === "attempt_ended")
                .map(event => event.sourceAttemptKey),
            [first.attemptKey, resumed.attemptKey]
        );
        assert.ok(backend.finishes.every(input => input.callId === first.callId));
    } finally {
        await runtime.close();
        await running.catch(() => undefined);
    }
});

await test("CallWorkerRuntime rejects a bad-token response rather than polling it again", async () => {
    let calls = 0;
    const backend = new LocalBackendClient({
        webOrigin: CONFIG.webOrigin,
        token: CONFIG.internalToken,
        fetch: async () => {
            calls += 1;
            return new Response("Unauthorized", { status: 401 });
        },
    });
    const runtime = new CallWorkerRuntime(CONFIG, { backend });

    try {
        await assert.rejects(
            runtime.run(),
            error =>
                error instanceof Error &&
                "retryable" in error &&
                error.retryable === false &&
                "status" in error &&
                error.status === 401
        );
        assert.equal(calls, 1);
    } finally {
        await runtime.close();
    }
});
