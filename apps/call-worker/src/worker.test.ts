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
    LocalBackendError,
    type LocalBackendEventInput,
    type LocalBackendFinishInput,
    type LocalBackendPollInput,
} from "./local/backend-client";
import { VoiceActivityDetector } from "./local/vad";
import { CallWorkerRuntime, type LocalCaptureControlBackend } from "./worker";
import type { TranscriptionInput, TranscriptionModel } from "./local/transcription";
import { loadCallWorkerConfig } from "./config";
import type { WorkerMessage } from "./ipc";

const CONFIG = loadCallWorkerConfig(
    JSON.stringify({
        origin: "http://localhost:3000",
        deviceToken: `lsc_${"a".repeat(43)}`,
        appVersion: "1.2.3",
        systemAudioHelperPath: "/bundled/launchstack-system-audio",
        vadThreshold: 0.1,
        vadActivationFrames: 1,
    })
);

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
                sources: { microphone: source, system: new QuietSource() },
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
            sources: { microphone: source, system: new QuietSource() },
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
            sources: { microphone: source, system: new QuietSource() },
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
            sources: { microphone: source, system: new QuietSource() },
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
        sources: { microphone: new QuietSource(), system: new QuietSource() },
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
        sources: { microphone: new FailingSource(), system: new QuietSource() },
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

await test("CallWorkerRuntime never reopens a failed Attempt when its failure report is lost and waits for explicit Resume", async () => {
    class FailingSource extends QuietSource {
        async *frames(_signal: AbortSignal): AsyncIterable<PcmFrame> {
            this.starts += 1;
            throw new Error("system audio status probe timed out");
        }
    }
    const first = session(13);
    const resumed = { ...first, attemptKey: "worker-fixed:resumed-after-source-failure" };
    const backend = new PollBackend([]);
    const failures: Record<string, unknown>[] = [];
    const sources: QuietSource[] = [];
    const staleOffersObserved = Promise.withResolvers<void>();
    const resumedConnected = Promise.withResolvers<void>();
    let staleOffers = 0;
    let resumeRequested = false;
    backend.poll = async input => {
        backend.polls.push(input);
        if (resumeRequested) return { capture: resumed };
        if (failures.length === 0) return { capture: first };
        staleOffers += 1;
        if (staleOffers === 3) staleOffersObserved.resolve();
        return { capture: staleOffers <= 3 ? first : null };
    };
    backend.event = async input => {
        backend.events.push(input.event);
        if (input.event.kind === "attempt_failed") {
            throw new LocalBackendError("failure report unavailable", { retryable: true });
        }
        if (
            input.event.kind === "attempt_connected" &&
            input.event.sourceAttemptKey === resumed.attemptKey
        ) {
            resumedConnected.resolve();
        }
    };
    const runtime = new CallWorkerRuntime(CONFIG, {
        backend,
        sleep: async () => nextTurn(),
        emit: () => undefined,
        log: (event, fields) => {
            if (event === "call_worker_pipeline_failed") failures.push(fields);
        },
        pipelineDependenciesFactory: () => {
            const microphone = sources.length === 0 ? new FailingSource() : new QuietSource();
            sources.push(microphone);
            return {
                sources: { microphone, system: new QuietSource() },
                transcription: new NoopTranscription(),
            };
        },
    });
    const running = runtime.run();
    void running.catch(() => undefined);
    try {
        await Promise.race([staleOffersObserved.promise, running]);
        await nextTurn();
        assert.equal(staleOffers >= 3, true);
        assert.equal(sources.length, 1, "stale offers must not open another audio pipeline");
        assert.equal(sources[0]?.starts, 1);
        assert.equal(failures.length, 1);
        assert.equal(backend.events.filter(event => event.kind === "attempt_failed").length, 1);
        assert.equal(backend.finishes.length, 0);
        assert.equal(backend.polls.at(-1)?.activeAttemptKey, undefined);

        resumeRequested = true;
        await Promise.race([resumedConnected.promise, running]);
        assert.equal(sources.length, 2, "an explicit Resume's fresh Attempt may open audio");
        assert.equal(sources[1]?.starts, 1);
        assert.equal(failures.length, 1);
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
        origin: CONFIG.origin,
        deviceToken: CONFIG.deviceToken,
        appVersion: CONFIG.appVersion,
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
        sources: { microphone: new GatedFailureSource(), system: new QuietSource() },
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
            return {
                sources: { microphone: source, system: new QuietSource() },
                transcription: new NoopTranscription(),
            };
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
        origin: CONFIG.origin,
        deviceToken: CONFIG.deviceToken,
        appVersion: CONFIG.appVersion,
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

await test("shutdown IPC and SIGTERM-style abort both drain the active capture gracefully", async () => {
    for (const mode of ["shutdown", "signal"]) {
        const capture = session(10);
        const backend = new PollBackend([]);
        backend.poll = async input => {
            backend.polls.push(input);
            return { capture };
        };
        const messages: WorkerMessage[] = [];
        const runtime = new CallWorkerRuntime(CONFIG, {
            backend,
            emit: message => messages.push(message),
            sources: { microphone: new QuietSource(), system: new QuietSource() },
            transcription: new NoopTranscription(),
            sleep: async () => nextTurn(),
        });
        const controller = new AbortController();
        const running = runtime.run(controller.signal);
        try {
            while (!backend.events.some(event => event.kind === "attempt_connected"))
                await nextTurn();
            if (mode === "shutdown") await runtime.handleControl({ type: "shutdown" });
            else controller.abort();
            await running;
            await runtime.close();
            assert.equal(backend.finishes.length, 1);
            assert.equal(
                backend.events.find(event => event.kind === "attempt_ended")?.reason,
                "source_stopped"
            );
            assert.equal(
                backend.events.find(event => event.kind === "occurrence_ended")?.reason,
                "source_stopped"
            );
            assert.equal(
                backend.events.some(event => event.kind === "attempt_failed"),
                false
            );
            assert.deepEqual(
                messages.filter(message => message.type === "state").map(message => message.state),
                ["idle", "starting", "capturing", "stopping", "idle"]
            );
            assert.equal(backend.polls[0]?.wait, true);
            assert.ok(backend.polls.slice(1).every(input => input.wait === false));
        } finally {
            await runtime.close();
        }
    }
});

await test("capturing IPC reports VAD activity and delivered segment progress at most every two seconds", async context => {
    context.mock.timers.enable({
        apis: ["setTimeout", "setInterval", "Date"],
        now: Date.parse("2026-08-20T10:00:00.000Z"),
    });
    const quiet = Promise.withResolvers<void>();
    const microphone: AudioSource = {
        async *frames(signal) {
            yield { pcm: new Uint8Array([0, 64]), capturedAt: new Date(), durationMs: 20 };
            await quiet.promise;
            if (signal.aborted) return;
            yield { pcm: new Uint8Array([0, 0]), capturedAt: new Date(), durationMs: 20 };
            if (!signal.aborted) {
                const stopped = Promise.withResolvers<void>();
                signal.addEventListener("abort", () => stopped.resolve(), { once: true });
                await stopped.promise;
            }
        },
    };
    const capture = session(11);
    const backend = new PollBackend([]);
    backend.poll = async () => ({ capture });
    const messages: WorkerMessage[] = [];
    const runtime = new CallWorkerRuntime(
        { ...CONFIG, vadReleaseFrames: 1 },
        {
            backend,
            emit: message => messages.push(message),
            sources: { microphone, system: new QuietSource() },
            transcription: { transcribe: async () => "Delivered segment" },
        }
    );
    const running = runtime.run();
    try {
        await nextTurn();
        const states = () =>
            messages.filter(message => message.type === "state" && message.state === "capturing");
        assert.equal(states().length, 1);
        context.mock.timers.tick(1_999);
        await nextTurn();
        assert.equal(states().length, 1);
        context.mock.timers.tick(1);
        await nextTurn();
        const speaking = states().at(-1);
        assert.equal(speaking?.type === "state" && speaking.channels.microphone, true);
        assert.equal(speaking?.type === "state" && speaking.channels.system, false);
        assert.equal(states().length, 2);
        quiet.resolve();
        await nextTurn();
        context.mock.timers.tick(2_000);
        await nextTurn();
        const delivered = states().at(-1);
        assert.equal(delivered?.type === "state" && delivered.segments, 1);
        assert.equal(delivered?.type === "state" && delivered.channels.microphone, false);
        assert.ok(delivered?.type === "state" && delivered.lastSegmentAt);
        assert.equal(states().length, 3);
    } finally {
        quiet.resolve();
        await runtime.close();
        await running;
    }
});

await test("authorization and upgrade failures from transcription terminate the runtime instead of restarting capture", async () => {
    for (const status of [401, 426]) {
        const capture = session(12);
        const backend = new PollBackend([]);
        backend.poll = async () => ({ capture });
        const source: AudioSource = {
            async *frames(signal) {
                yield { pcm: new Uint8Array([0, 64]), capturedAt: new Date(), durationMs: 20 };
                yield { pcm: new Uint8Array([0, 0]), capturedAt: new Date(), durationMs: 20 };
                if (!signal.aborted) {
                    const stopped = Promise.withResolvers<void>();
                    signal.addEventListener("abort", () => stopped.resolve(), { once: true });
                    await stopped.promise;
                }
            },
        };
        const runtime = new CallWorkerRuntime(
            { ...CONFIG, vadReleaseFrames: 1 },
            {
                backend,
                emit: () => undefined,
                log: () => undefined,
                sources: { microphone: source, system: new QuietSource() },
                transcription: {
                    transcribe: async () => {
                        throw new LocalBackendError("device rejected", {
                            retryable: false,
                            status,
                        });
                    },
                },
                sleep: async () => nextTurn(),
            }
        );
        try {
            await assert.rejects(
                runtime.run(),
                error =>
                    error instanceof LocalBackendError &&
                    error.exitCode === (status === 401 ? 77 : 75)
            );
            assert.equal(backend.finishes.length, 0);
        } finally {
            await runtime.close();
        }
    }
});
