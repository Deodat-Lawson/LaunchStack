import { createHash } from "node:crypto";

import {
    CALL_NOTES_SCHEMA_VERSION,
    CaptureEventSchema,
    LocalCaptureSessionSchema,
    type AudioChannel,
    type CaptureEvent,
    type LocalCaptureSession,
} from "@launchstack/features/call-notes";

import type { CallWorkerConfig } from "../config";
import {
    FfmpegPcmSource,
    encodePcm16Wav,
    SystemAudioPcmSource,
    type AudioSource,
    type PcmFrame,
} from "./audio";
import { VoiceActivityDetector, type VoiceActivityResult } from "./vad";
import {
    AzureSpeechFastTranscriptionModel,
    OpenAiCompatibleTranscriptionModel,
    type TranscriptionModel,
} from "./transcription";
import {
    LocalBackendClient,
    type LocalBackendEventInput,
    type LocalBackendFinishInput,
} from "./backend-client";

const LOCAL_SOURCE = "local_audio" as const;
const LOCAL_STREAM_KEY = "local-audio";
const DEFAULT_FRAME_DURATION_MS = 20;
const DEFAULT_CLOSE_TIMEOUT_MS = 1_000;
const DEFAULT_AUDIO_READY_TIMEOUT_MS = 10_000;
const DEFAULT_AUDIO_PRE_ROLL_MS = 200;
const DEFAULT_STOP_DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 20_000;
const BEST_EFFORT_FAILURE_TIMEOUT_MS = 250;
const ITERATOR_CLOSE_TIMEOUT_MS = 250;
const MAX_PENDING_TRANSCRIPTIONS = 8;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type CaptureEventWithoutId = DistributiveOmit<CaptureEvent, "eventId">;
type CaptureEventInput = DistributiveOmit<CaptureEvent, "eventId" | "schemaVersion" | "source">;

export interface LocalCaptureBackend {
    event(input: LocalBackendEventInput, signal?: AbortSignal): Promise<void>;
    finish(input: LocalBackendFinishInput, signal?: AbortSignal): Promise<void>;
}

export interface LocalCaptureSources {
    microphone: AudioSource;
    system?: AudioSource;
}

export interface LocalCaptureVads {
    microphone: Pick<VoiceActivityDetector, "process">;
    system?: Pick<VoiceActivityDetector, "process">;
}

export interface LocalCapturePipelineOptions {
    session: LocalCaptureSession;
    sources: LocalCaptureSources;
    vads: LocalCaptureVads;
    transcription: TranscriptionModel;
    backend: LocalCaptureBackend;
    companyId: string;
    userId: string;
    autoEnrich: boolean;
    sampleRate: number;
    utteranceMaxMs: number;
    audioPreRollMs?: number;
    audioReadyTimeoutMs?: number;
    stopDrainTimeoutMs?: number;
    transcriptionTimeoutMs?: number;
    language?: string;
    frameDurationMs?: number;
    closeTimeoutMs?: number;
}

export interface LocalCapturePipelineDependencies {
    sources?: Partial<LocalCaptureSources>;
    vads?: Partial<LocalCaptureVads>;
    transcription?: TranscriptionModel;
    backend?: LocalCaptureBackend;
}

interface BufferedFrame {
    pcm: Uint8Array;
    startAt: Date;
    endAt: Date;
}

interface ActiveCapture {
    readonly occurrenceKey: string;
    readonly attemptKey: string;
    readonly callId: string;
    readonly startedAt: Date;
    failed: boolean;
    finished: boolean;
    failureReported: boolean;
}

interface StreamState {
    readonly channel: AudioChannel;
    readonly source: AudioSource;
    readonly vad: Pick<VoiceActivityDetector, "process">;
    iterator?: AsyncIterator<PcmFrame>;
    done: boolean;
    utterance: BufferedFrame[];
    preRoll: BufferedFrame[];
    utteranceStartedAt?: Date;
    utteranceEndedAt?: Date;
}

interface PendingFrame {
    state: StreamState;
    result: IteratorResult<PcmFrame>;
}

interface StopSignal {
    stopped: true;
}

interface TranscriptWorkResult {
    text: string;
    sourceAttemptKey: string;
    sourceOccurrenceKey: string;
    sourcePacketHash: string;
    sourceStartMs: number;
    sourceEndMs: number;
    receivedAt: string;
    occurredAt: string;
    audioChannel: AudioChannel;
    pcm: Uint8Array;
    audioWav: Uint8Array;
}

function sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

function deterministicEventId(event: CaptureEventWithoutId): string {
    return sha256(JSON.stringify(event));
}

function frameEndAt(value: Date, durationMs: number, fallbackDurationMs: number): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw new TypeError("audio frame capturedAt must be a valid Date");
    }
    const duration =
        Number.isFinite(durationMs) && durationMs > 0 ? durationMs : fallbackDurationMs;
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError("audio frame durationMs must be positive");
    }
    return new Date(value.getTime() + duration);
}

function copyFrame(frame: PcmFrame, fallbackDurationMs: number): BufferedFrame {
    if (!(frame.pcm instanceof Uint8Array) || frame.pcm.byteLength % 2 !== 0) {
        throw new TypeError("audio frame pcm must be an even-length Uint8Array");
    }
    const startAt = new Date(frame.capturedAt.getTime());
    if (!Number.isFinite(startAt.getTime())) {
        throw new TypeError("audio frame capturedAt must be a valid Date");
    }
    return {
        pcm: new Uint8Array(frame.pcm),
        startAt,
        endAt: frameEndAt(startAt, frame.durationMs, fallbackDurationMs),
    };
}

function validatePcmFrame(frame: PcmFrame): void {
    if (!frame || typeof frame !== "object") throw new TypeError("audio frame is required");
    if (!(frame.pcm instanceof Uint8Array) || frame.pcm.byteLength === 0) {
        throw new TypeError("audio frame pcm must be a non-empty Uint8Array");
    }
    if (frame.pcm.byteLength % 2 !== 0) {
        throw new TypeError("audio frame pcm must contain complete 16-bit samples");
    }
    if (!(frame.capturedAt instanceof Date) || !Number.isFinite(frame.capturedAt.getTime())) {
        throw new TypeError("audio frame capturedAt must be a valid Date");
    }
    if (
        frame.durationMs !== undefined &&
        (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0)
    ) {
        throw new TypeError("audio frame durationMs must be positive");
    }
}

function concatenatePcm(frames: readonly BufferedFrame[]): Uint8Array {
    let length = 0;
    for (const frame of frames) length += frame.pcm.byteLength;
    const pcm = new Uint8Array(length);
    let offset = 0;
    for (const frame of frames) {
        pcm.set(frame.pcm, offset);
        offset += frame.pcm.byteLength;
    }
    return pcm;
}

function sourceOffsetMs(origin: Date, value: Date): number {
    return Math.max(0, Math.round(value.getTime() - origin.getTime()));
}

function newerDate(first: Date | undefined, second: Date): Date {
    return !first || second.getTime() > first.getTime() ? second : first;
}

function abortError(signal: AbortSignal, fallback: string): Error {
    const reason: unknown = signal.reason;
    return reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" ? reason : fallback, { cause: reason });
}

function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

export class LocalCapturePipeline {
    private readonly sourceStopController = new AbortController();
    private readonly operationAbortController = new AbortController();
    private readonly closeTimeoutMs: number;
    private readonly audioReadyTimeoutMs: number;
    private readonly audioPreRollMs: number;
    private readonly stopDrainTimeoutMs: number;
    private readonly transcriptionTimeoutMs: number;
    private readonly streams: StreamState[];
    private readonly activeCapture: ActiveCapture;
    private runPromise?: Promise<void>;
    private stopPromise?: Promise<void>;
    private closePromise?: Promise<void>;
    private lastFrameEnd?: Date;
    private receiveOrder = 0;
    private transcriptAppendTail: Promise<void> = Promise.resolve();
    private readonly pendingFlushes = new Set<Promise<void>>();
    private stopRequested = false;
    private closeRequested = false;
    private captureLost = false;
    private fatalError?: unknown;
    private closeFailureCode = "capture_closed";
    private finishPromise?: Promise<void>;
    private stopTimeoutError?: Error;
    private connected = false;
    private readonly removeRunSignalListeners: Array<() => void> = [];

    constructor(private readonly options: LocalCapturePipelineOptions) {
        const session = LocalCaptureSessionSchema.parse(options.session);
        if (!options.sources?.microphone) throw new Error("microphone audio source is required");
        if (!options.vads?.microphone) throw new Error("microphone VAD is required");
        if (options.sources.system && !options.vads.system) {
            throw new Error("system VAD is required when system audio is enabled");
        }
        if (options.companyId.trim().length === 0) throw new Error("companyId must not be empty");
        if (options.userId.trim().length === 0) throw new Error("userId must not be empty");
        if (!Number.isSafeInteger(options.sampleRate) || options.sampleRate <= 0) {
            throw new Error("sampleRate must be a positive integer");
        }
        if (!Number.isFinite(options.utteranceMaxMs) || options.utteranceMaxMs <= 0) {
            throw new Error("utteranceMaxMs must be positive");
        }
        this.audioPreRollMs = options.audioPreRollMs ?? DEFAULT_AUDIO_PRE_ROLL_MS;
        if (!Number.isFinite(this.audioPreRollMs) || this.audioPreRollMs < 0) {
            throw new Error("audioPreRollMs must be nonnegative");
        }
        this.audioReadyTimeoutMs = options.audioReadyTimeoutMs ?? DEFAULT_AUDIO_READY_TIMEOUT_MS;
        if (!Number.isFinite(this.audioReadyTimeoutMs) || this.audioReadyTimeoutMs <= 0) {
            throw new Error("audioReadyTimeoutMs must be positive");
        }
        this.stopDrainTimeoutMs = options.stopDrainTimeoutMs ?? DEFAULT_STOP_DRAIN_TIMEOUT_MS;
        if (!Number.isFinite(this.stopDrainTimeoutMs) || this.stopDrainTimeoutMs <= 0) {
            throw new Error("stopDrainTimeoutMs must be positive");
        }
        this.transcriptionTimeoutMs =
            options.transcriptionTimeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
        if (!Number.isFinite(this.transcriptionTimeoutMs) || this.transcriptionTimeoutMs <= 0) {
            throw new Error("transcriptionTimeoutMs must be positive");
        }
        this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
        if (!Number.isFinite(this.closeTimeoutMs) || this.closeTimeoutMs <= 0) {
            throw new Error("closeTimeoutMs must be positive");
        }

        const startedAt = new Date(session.startedAt);
        if (!Number.isFinite(startedAt.getTime()))
            throw new Error("session.startedAt must be valid");
        this.activeCapture = {
            occurrenceKey: session.occurrenceKey,
            attemptKey: session.attemptKey,
            callId: session.callId,
            startedAt,
            failed: false,
            finished: false,
            failureReported: false,
        };
        this.streams = [
            {
                channel: "microphone",
                source: options.sources.microphone,
                vad: options.vads.microphone,
                done: false,
                utterance: [],
                preRoll: [],
            },
            ...(options.sources.system
                ? [
                      {
                          channel: "system" as const,
                          source: options.sources.system,
                          vad: options.vads.system!,
                          done: false,
                          utterance: [],
                          preRoll: [],
                      },
                  ]
                : []),
        ];
    }

    run(signal?: AbortSignal): Promise<void> {
        if (signal) {
            const abort = (): void => {
                this.captureLost = true;
                const reason = abortError(signal, "local capture operation aborted");
                this.stopSources(reason);
                this.operationAbortController.abort(reason);
            };
            if (signal.aborted) abort();
            else {
                signal.addEventListener("abort", abort, { once: true });
                this.removeRunSignalListeners.push(() =>
                    signal.removeEventListener("abort", abort)
                );
            }
        }
        this.runPromise ??= this.consume();
        return this.runPromise;
    }

    stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        if (this.closePromise) return this.closePromise;
        this.stopRequested = true;
        this.stopSources(new Error("local capture stopped by user"));
        this.stopPromise = this.finishStop(this.run());
        return this.stopPromise;
    }

    close(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        this.closeRequested = true;
        this.captureLost = true;
        const reason = new Error("local capture closed");
        this.closeFailureCode =
            this.options.session.desiredMode === "paused" ? "capture_paused" : "capture_closed";
        this.stopSources(reason);
        this.operationAbortController.abort(reason);
        const runPromise = this.run();
        this.closePromise = this.finishClose(runPromise);
        return this.closePromise;
    }

    private stopSources(reason: unknown): void {
        for (const state of this.streams) {
            try {
                state.source.stop?.(reason);
            } catch {
                // Source shutdown must not mask the operation failure.
            }
        }
        if (!this.sourceStopController.signal.aborted) {
            this.sourceStopController.abort(reason);
        }
    }

    private async finishStop(runPromise: Promise<void>): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<boolean>(resolve => {
            timer = setTimeout(() => resolve(false), this.stopDrainTimeoutMs);
            // Keep the awaited drain alive after the native source handles close.
        });
        const completedPromise = runPromise.then(
            () => true,
            () => true
        );
        const completed = await Promise.race([completedPromise, timeoutPromise]);
        clearTimeout(timer);
        if (completed) {
            await runPromise;
            return;
        }

        const reason = new Error(
            `local capture stop drain timed out after ${this.stopDrainTimeoutMs}ms`
        );
        this.stopTimeoutError = reason;
        this.captureLost = true;
        this.closeFailureCode = "capture_stop_timeout";
        this.stopSources(reason);
        this.operationAbortController.abort(reason);
        await this.failActiveCall(reason, "capture_stop_timeout");
        void runPromise.catch(() => undefined);
        throw reason;
    }

    private async finishClose(runPromise: Promise<void>): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<boolean>(resolve => {
            timer = setTimeout(() => resolve(false), this.closeTimeoutMs);
            timer.unref?.();
        });
        const completedPromise = runPromise.then(
            () => true,
            () => true
        );
        const completed = await Promise.race([completedPromise, timeoutPromise]);
        clearTimeout(timer);
        if (completed) {
            await runPromise.catch(() => undefined);
            return;
        }

        const reason = new Error("local capture shutdown timed out");
        this.captureLost = true;
        this.stopSources(reason);
        this.operationAbortController.abort(reason);
        await this.failActiveCall(reason, this.closeFailureCode);
        void runPromise.catch(() => undefined);
    }

    private async consume(): Promise<void> {
        let failure: unknown;
        try {
            if (this.options.session.desiredMode === "stopped" && !this.closeRequested) {
                this.stopRequested = true;
                this.stopSources(new Error("capture session is already stopped"));
            }
            if (this.options.session.desiredMode === "paused" && !this.closeRequested) {
                this.closeRequested = true;
                this.captureLost = true;
                this.closeFailureCode = "capture_paused";
                const reason = new Error("capture pause is not supported");
                this.stopSources(reason);
                this.operationAbortController.abort(reason);
            }

            if (!this.closeRequested && !this.stopRequested) {
                try {
                    await this.consumeStreams();
                } catch (error) {
                    failure = this.fatalError ?? error;
                    this.captureLost = true;
                    this.stopSources(error);
                    this.operationAbortController.abort(error);
                }
            }

            if (!failure && this.fatalError !== undefined) {
                failure = this.fatalError;
                this.captureLost = true;
            }
            if (!failure && this.stopTimeoutError) failure = this.stopTimeoutError;

            try {
                await this.waitForPendingFlushes();
            } catch (error) {
                failure ??= this.fatalError ?? error;
                this.captureLost = true;
                this.stopSources(error);
                this.operationAbortController.abort(error);
            }

            if (
                !failure &&
                !this.captureLost &&
                !this.closeRequested &&
                !this.activeCapture.failed &&
                this.connected
            ) {
                try {
                    await this.finishCall();
                } catch (error) {
                    failure = error;
                    this.captureLost = true;
                    this.stopSources(error);
                    this.operationAbortController.abort(error);
                }
            }

            if (
                this.activeCapture.failed === false &&
                (failure !== undefined ||
                    this.captureLost ||
                    this.closeRequested ||
                    this.operationAbortController.signal.aborted)
            ) {
                await this.failActiveCall(
                    failure ??
                        this.operationAbortController.signal.reason ??
                        new Error("local capture operation aborted"),
                    this.closeRequested
                        ? this.closeFailureCode
                        : this.stopTimeoutError
                          ? "capture_stop_timeout"
                          : this.connected
                            ? "capture_stream_lost"
                            : "capture_not_ready"
                );
            }
        } finally {
            this.zeroBufferedFrames();
            await this.closeIterators();
            for (const remove of this.removeRunSignalListeners.splice(0)) remove();
        }
        if (failure && !this.closeRequested) throw asError(failure);
    }

    private async consumeStreams(): Promise<void> {
        if (this.sourceStopController.signal.aborted) return;
        const pending = new Map<AudioChannel, Promise<PendingFrame>>();
        try {
            for (const state of this.streams) {
                if (this.sourceStopController.signal.aborted) break;
                let iterator: AsyncIterator<PcmFrame>;
                try {
                    iterator = state.source
                        .frames(this.sourceStopController.signal)
                        [Symbol.asyncIterator]();
                } catch (error) {
                    throw new Error(
                        `${state.channel} audio source failed: ${asError(error).message}`,
                        { cause: error }
                    );
                }
                state.iterator = iterator;
                pending.set(state.channel, this.nextFrame(state));
            }
        } catch (error) {
            this.stopSources(error);
            await this.settlePendingFrames(pending);
            throw error;
        }

        let removeStopListener: (() => void) | undefined;
        const stopPromise = new Promise<StopSignal>(resolve => {
            const onAbort = (): void => resolve({ stopped: true });
            if (this.sourceStopController.signal.aborted) onAbort();
            else {
                this.sourceStopController.signal.addEventListener("abort", onAbort, { once: true });
                removeStopListener = () =>
                    this.sourceStopController.signal.removeEventListener("abort", onAbort);
            }
        });

        try {
            const initial = await this.waitForInitialFrames(pending, stopPromise);
            if (!initial || this.sourceStopController.signal.aborted) return;
            for (const pendingFrame of initial) {
                if (pendingFrame.result.done) {
                    throw new Error(
                        `${pendingFrame.state.channel} audio stream ended before readiness`
                    );
                }
                validatePcmFrame(pendingFrame.result.value);
            }
            if (this.sourceStopController.signal.aborted) return;

            await this.appendEvent({
                kind: "attempt_connected",
                sourceAttemptKey: this.activeCapture.attemptKey,
                sourceStreamKey: LOCAL_STREAM_KEY,
                sourceOccurrenceKey: this.activeCapture.occurrenceKey,
                occurredAt: this.activeCapture.startedAt.toISOString(),
            });
            this.connected = true;
            pending.clear();

            for (const pendingFrame of initial) {
                if (!pendingFrame.result.done) {
                    await this.processFrame(pendingFrame.state, pendingFrame.result.value);
                }
            }
            for (const state of this.streams) {
                if (!this.sourceStopController.signal.aborted) {
                    pending.set(state.channel, this.nextFrame(state));
                }
            }

            while (pending.size > 0) {
                const winner = await Promise.race([...pending.values(), stopPromise]);
                if ("stopped" in winner) break;
                pending.delete(winner.state.channel);
                if (winner.result.done) {
                    if (this.sourceStopController.signal.aborted) break;
                    throw new Error(
                        `${winner.state.channel} audio stream ended before explicit stop`
                    );
                }
                await this.processFrame(winner.state, winner.result.value);
                if (this.sourceStopController.signal.aborted || winner.state.done) break;
                pending.set(
                    winner.state.channel,
                    this.nextFrame(stateForChannel(this.streams, winner.state.channel))
                );
            }
        } catch (error) {
            this.stopSources(error);
            throw error;
        } finally {
            removeStopListener?.();
            await this.settlePendingFrames(pending);
        }
    }

    private async waitForInitialFrames(
        pending: Map<AudioChannel, Promise<PendingFrame>>,
        stopPromise: Promise<StopSignal>
    ): Promise<PendingFrame[] | undefined> {
        const initial = Promise.all([...pending.values()]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () =>
                    reject(
                        new Error(`audio readiness timed out after ${this.audioReadyTimeoutMs}ms`)
                    ),
                this.audioReadyTimeoutMs
            );
            timer.unref?.();
        });
        try {
            return await Promise.race([initial, timeout, stopPromise.then(() => undefined)]);
        } finally {
            clearTimeout(timer);
        }
    }

    private async settlePendingFrames(
        pending: Map<AudioChannel, Promise<PendingFrame>>
    ): Promise<void> {
        if (pending.size === 0) return;
        const settled = Promise.allSettled([...pending.values()]);
        const timeout = new Promise<void>(resolve => {
            const timer = setTimeout(resolve, ITERATOR_CLOSE_TIMEOUT_MS);
            timer.unref?.();
        });
        await Promise.race([settled.then(() => undefined), timeout]);
        void settled.then(results => {
            for (const result of results) {
                if (result.status === "fulfilled" && !result.value.result.done) {
                    result.value.result.value.pcm.fill(0);
                }
            }
        });
    }

    private async nextFrame(state: StreamState): Promise<PendingFrame> {
        if (!state.iterator) throw new Error(`${state.channel} audio source was not initialized`);
        try {
            const result = await state.iterator.next();
            return { state, result };
        } catch (error) {
            throw new Error(`${state.channel} audio source failed: ${asError(error).message}`, {
                cause: error,
            });
        }
    }

    private async processFrame(state: StreamState, frame: PcmFrame): Promise<void> {
        this.assertOperationAvailable();
        let buffered: BufferedFrame | undefined;
        try {
            validatePcmFrame(frame);
            buffered = copyFrame(frame, this.options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS);
            this.lastFrameEnd = newerDate(this.lastFrameEnd, buffered.endAt);
            const activity: VoiceActivityResult = state.vad.process(frame);

            if (activity.active && state.utterance.length === 0) {
                for (const prior of state.preRoll) state.utterance.push(prior);
                state.preRoll = [];
                if (state.utterance.length === 0) {
                    state.utteranceStartedAt = buffered.startAt;
                } else {
                    state.utteranceStartedAt = state.utterance[0]!.startAt;
                }
                state.utterance.push(buffered);
                state.utteranceEndedAt = buffered.endAt;
                buffered = undefined;
            } else if (state.utterance.length > 0) {
                state.utterance.push(buffered);
                state.utteranceEndedAt = buffered.endAt;
                buffered = undefined;
            } else {
                this.appendPreRoll(state, buffered);
                buffered = undefined;
            }

            const utteranceStartedAt = state.utteranceStartedAt;
            const utteranceEndedAt = state.utteranceEndedAt;
            if (
                state.utterance.length > 0 &&
                utteranceStartedAt &&
                utteranceEndedAt &&
                (activity.ended ||
                    utteranceEndedAt.getTime() - utteranceStartedAt.getTime() >=
                        this.options.utteranceMaxMs)
            ) {
                this.scheduleUtteranceFlush(state);
            }
        } catch (error) {
            if (buffered && !state.utterance.includes(buffered)) buffered.pcm.fill(0);
            throw error;
        } finally {
            if (frame.pcm instanceof Uint8Array) frame.pcm.fill(0);
        }
    }

    private appendPreRoll(state: StreamState, frame: BufferedFrame): void {
        state.preRoll.push(frame);
        if (this.audioPreRollMs === 0) {
            while (state.preRoll.length > 1) state.preRoll.shift()!.pcm.fill(0);
            return;
        }
        const cutoff = frame.endAt.getTime() - this.audioPreRollMs;
        while (state.preRoll.length > 1 && state.preRoll[0]!.endAt.getTime() <= cutoff) {
            state.preRoll.shift()!.pcm.fill(0);
        }
    }

    private scheduleUtteranceFlush(state: StreamState): void {
        if (state.utterance.length === 0) return;
        const frames = state.utterance;
        const startedAt = state.utteranceStartedAt ?? frames[0]!.startAt;
        const endedAt = state.utteranceEndedAt ?? frames[frames.length - 1]!.endAt;
        state.utterance = [];
        state.utteranceStartedAt = undefined;
        state.utteranceEndedAt = undefined;

        if (this.activeCapture.failed) {
            for (const frame of frames) frame.pcm.fill(0);
            return;
        }
        if (this.pendingFlushes.size >= MAX_PENDING_TRANSCRIPTIONS) {
            for (const frame of frames) frame.pcm.fill(0);
            throw new Error(
                `transcription fell behind live audio (${MAX_PENDING_TRANSCRIPTIONS} utterances pending)`
            );
        }

        const transcriptPromise = this.transcribeUtterance(
            state.channel,
            frames,
            startedAt,
            endedAt
        );
        const orderedPromise = this.transcriptAppendTail
            .then(async () => {
                const result = await transcriptPromise;
                try {
                    if (!result.text) return;
                    this.assertOperationAvailable();
                    await this.appendEvent({
                        kind: "transcript_segment",
                        sourceAttemptKey: result.sourceAttemptKey,
                        sourceOccurrenceKey: result.sourceOccurrenceKey,
                        sourcePacketHash: result.sourcePacketHash,
                        sourceKind: "derived_asr",
                        audioChannel: result.audioChannel,
                        participant: null,
                        sourceStartMs: result.sourceStartMs,
                        sourceEndMs: result.sourceEndMs,
                        receivedAt: result.receivedAt,
                        receiveOrder: this.receiveOrder++,
                        text: result.text,
                        ...(this.options.language ? { language: this.options.language } : {}),
                        occurredAt: result.occurredAt,
                    });
                } finally {
                    result.pcm.fill(0);
                    result.audioWav.fill(0);
                }
            })
            .finally(() => {
                for (const frame of frames) frame.pcm.fill(0);
            });
        this.transcriptAppendTail = orderedPromise.catch(() => undefined);
        const trackedPromise: Promise<void> = orderedPromise.then(
            () => {
                this.pendingFlushes.delete(trackedPromise);
            },
            error => {
                this.pendingFlushes.delete(trackedPromise);
                this.recordFatalFailure(error);
                throw error;
            }
        );
        this.pendingFlushes.add(trackedPromise);
        void trackedPromise.catch(() => undefined);
    }

    private async transcribeUtterance(
        audioChannel: AudioChannel,
        frames: BufferedFrame[],
        startedAt: Date,
        endedAt: Date
    ): Promise<TranscriptWorkResult> {
        const pcm = concatenatePcm(frames);
        const startMs = sourceOffsetMs(this.activeCapture.startedAt, startedAt);
        const endMs = Math.max(startMs, sourceOffsetMs(this.activeCapture.startedAt, endedAt));
        const sourcePacketHash = sha256(
            `${this.activeCapture.attemptKey}:${audioChannel}:${startMs}:${endMs}:${sha256(pcm)}`
        );
        let audioWav: Uint8Array | undefined;
        try {
            audioWav = encodePcm16Wav(pcm, this.options.sampleRate);
            const text = await this.options.transcription.transcribe(
                {
                    audioWav,
                    ...(this.options.language ? { language: this.options.language } : {}),
                    timeoutMs: this.transcriptionTimeoutMs,
                },
                {
                    signal: this.operationAbortController.signal,
                    timeoutMs: this.transcriptionTimeoutMs,
                }
            );
            return {
                text,
                sourceAttemptKey: this.activeCapture.attemptKey,
                sourceOccurrenceKey: this.activeCapture.occurrenceKey,
                sourcePacketHash,
                sourceStartMs: startMs,
                sourceEndMs: endMs,
                receivedAt: endedAt.toISOString(),
                occurredAt: endedAt.toISOString(),
                audioChannel,
                pcm,
                audioWav,
            };
        } catch (error) {
            pcm.fill(0);
            audioWav?.fill(0);
            throw error;
        }
    }

    private recordFatalFailure(error: unknown): void {
        if (!this.closeRequested && this.fatalError === undefined) this.fatalError = error;
        if (this.closeRequested) return;
        this.captureLost = true;
        this.stopSources(error);
        this.operationAbortController.abort(error);
    }

    private async waitForPendingFlushes(): Promise<void> {
        while (this.pendingFlushes.size > 0) {
            const pending = [...this.pendingFlushes];
            const results = await Promise.allSettled(pending);
            const failed = results.find(
                (result): result is PromiseRejectedResult => result.status === "rejected"
            );
            if (failed) throw failed.reason;
        }
        await this.transcriptAppendTail;
    }

    private async finishCall(): Promise<void> {
        if (this.finishPromise) return this.finishPromise;
        if (this.activeCapture.finished || this.activeCapture.failed) return;

        const finishing = (async () => {
            for (const state of this.streams) this.scheduleUtteranceFlush(state);
            await this.waitForPendingFlushes();
            this.assertOperationAvailable();
            await this.appendEvent({
                kind: "attempt_ended",
                sourceAttemptKey: this.activeCapture.attemptKey,
                sourceOccurrenceKey: this.activeCapture.occurrenceKey,
                reason: "user_stopped",
                occurredAt: (this.lastFrameEnd ?? this.activeCapture.startedAt).toISOString(),
            });
            await this.appendEvent({
                kind: "occurrence_ended",
                sourceOccurrenceKey: this.activeCapture.occurrenceKey,
                occurredAt: (this.lastFrameEnd ?? this.activeCapture.startedAt).toISOString(),
                reason: "user_stopped",
            });
            this.assertOperationAvailable();
            await this.options.backend.finish(
                {
                    companyId: this.options.companyId,
                    userId: this.options.userId,
                    callId: this.activeCapture.callId,
                    autoEnrich: this.options.autoEnrich,
                },
                this.operationAbortController.signal
            );
            this.assertOperationAvailable();
            if (this.closeRequested || this.operationAbortController.signal.aborted) {
                throw new Error("local capture closed while finishing");
            }
            this.activeCapture.finished = true;
        })();
        this.finishPromise = finishing;
        try {
            await finishing;
        } finally {
            if (this.finishPromise === finishing) this.finishPromise = undefined;
        }
    }

    private async failActiveCall(error: unknown, code: string): Promise<void> {
        if (this.activeCapture.finished || this.activeCapture.failureReported) {
            this.zeroBufferedFrames();
            return;
        }
        this.activeCapture.failed = true;
        this.activeCapture.failureReported = true;
        this.zeroBufferedFrames();

        const failureController = new AbortController();
        const timer = setTimeout(
            () => failureController.abort(new Error("attempt_failed report timed out")),
            BEST_EFFORT_FAILURE_TIMEOUT_MS
        );
        timer.unref?.();
        const occurredAt = (this.lastFrameEnd ?? this.activeCapture.startedAt).toISOString();
        const message = asError(error).message.slice(0, 1024);
        try {
            await Promise.race([
                this.appendEvent(
                    {
                        kind: "attempt_failed",
                        sourceAttemptKey: this.activeCapture.attemptKey,
                        sourceOccurrenceKey: this.activeCapture.occurrenceKey,
                        code,
                        ...(message ? { message } : {}),
                        occurredAt,
                    },
                    failureController.signal
                ),
                new Promise<void>(resolve => {
                    const timeout = setTimeout(resolve, BEST_EFFORT_FAILURE_TIMEOUT_MS);
                    timeout.unref?.();
                }),
            ]);
        } catch {
            // Failure reporting is best effort and must never mask the root failure.
        } finally {
            clearTimeout(timer);
            failureController.abort();
        }
    }

    private zeroBufferedFrames(): void {
        for (const state of this.streams) {
            for (const frame of state.utterance) frame.pcm.fill(0);
            for (const frame of state.preRoll) frame.pcm.fill(0);
            state.utterance = [];
            state.preRoll = [];
            state.utteranceStartedAt = undefined;
            state.utteranceEndedAt = undefined;
        }
    }

    private async closeIterators(): Promise<void> {
        // Native sources are stopped explicitly through AudioSource.stop().
        // Calling return() on an async generator while next() is blocked can
        // itself remain pending and retain the generator forever.
        for (const state of this.streams) state.iterator = undefined;
    }

    private async appendEvent(
        event: CaptureEventInput,
        signal: AbortSignal = this.operationAbortController.signal
    ): Promise<void> {
        this.assertOperationAvailable(signal);
        const completeEvent: CaptureEventWithoutId = {
            ...event,
            schemaVersion: CALL_NOTES_SCHEMA_VERSION,
            source: LOCAL_SOURCE,
        };
        const parsed = CaptureEventSchema.parse({
            ...completeEvent,
            eventId: deterministicEventId(completeEvent),
        });
        await this.options.backend.event(
            {
                companyId: this.options.companyId,
                userId: this.options.userId,
                callId: this.activeCapture.callId,
                event: parsed,
            },
            signal
        );
        this.assertOperationAvailable(signal);
    }

    private assertOperationAvailable(signal = this.operationAbortController.signal): void {
        if (signal.aborted) throw abortError(signal, "local capture operation aborted");
        if (signal === this.operationAbortController.signal && this.captureLost) {
            throw new Error("local capture operation aborted");
        }
    }
}

function stateForChannel(streams: readonly StreamState[], channel: AudioChannel): StreamState {
    const state = streams.find(candidate => candidate.channel === channel);
    if (!state) throw new Error(`${channel} audio stream was not initialized`);
    return state;
}

export function createLocalCapturePipeline(
    config: CallWorkerConfig,
    session: LocalCaptureSession,
    dependencies: LocalCapturePipelineDependencies = {}
): LocalCapturePipeline {
    const microphoneSource =
        dependencies.sources?.microphone ??
        new FfmpegPcmSource({
            ffmpegPath: config.ffmpegPath,
            inputFormat: config.audioInputFormat,
            input: config.audioInputDevice,
            sampleRate: config.audioSampleRate,
            frameDurationMs: config.audioFrameMs,
        });
    const systemSource = config.systemAudioEnabled
        ? (dependencies.sources?.system ??
          new SystemAudioPcmSource({
              helperPath: config.systemAudioHelperPath,
              sampleRate: config.audioSampleRate,
              frameDurationMs: config.audioFrameMs,
          }))
        : dependencies.sources?.system;
    const sources: LocalCaptureSources = {
        microphone: microphoneSource,
        ...(systemSource ? { system: systemSource } : {}),
    };
    const microphoneVad =
        dependencies.vads?.microphone ??
        new VoiceActivityDetector({
            threshold: config.vadThreshold,
            activationFrames: config.vadActivationFrames,
            releaseFrames: config.vadReleaseFrames,
            frameDurationMs: config.audioFrameMs,
        });
    const systemVad = sources.system
        ? (dependencies.vads?.system ??
          new VoiceActivityDetector({
              threshold: config.vadThreshold,
              activationFrames: config.vadActivationFrames,
              releaseFrames: config.vadReleaseFrames,
              frameDurationMs: config.audioFrameMs,
          }))
        : undefined;
    const vads: LocalCaptureVads = {
        microphone: microphoneVad,
        ...(systemVad ? { system: systemVad } : {}),
    };
    const transcription =
        dependencies.transcription ??
        (config.transcriptionProvider === "azure_speech"
            ? new AzureSpeechFastTranscriptionModel({
                  endpoint: config.transcriptionBaseUrl,
                  apiKey: config.transcriptionApiKey,
                  timeoutMs: config.transcriptionTimeoutMs,
              })
            : new OpenAiCompatibleTranscriptionModel({
                  baseUrl: config.transcriptionBaseUrl,
                  model: config.transcriptionModel,
                  apiKey: config.transcriptionApiKey,
                  timeoutMs: config.transcriptionTimeoutMs,
              }));
    const backend =
        dependencies.backend ??
        new LocalBackendClient({
            webOrigin: config.webOrigin,
            token: config.internalToken,
        });
    return new LocalCapturePipeline({
        session,
        sources,
        vads,
        transcription,
        backend,
        companyId: config.companyId,
        userId: config.userId,
        autoEnrich: config.autoEnrich,
        sampleRate: config.audioSampleRate,
        utteranceMaxMs: config.utteranceMaxMs,
        audioPreRollMs: config.audioPreRollMs,
        audioReadyTimeoutMs: config.audioReadyTimeoutMs,
        stopDrainTimeoutMs: config.stopDrainTimeoutMs,
        transcriptionTimeoutMs: config.transcriptionTimeoutMs,
        language: config.transcriptionLanguage,
        frameDurationMs: config.audioFrameMs,
    });
}
