import { randomUUID } from "node:crypto";

import type {
    LocalCapturePollResult,
    LocalCaptureSession,
} from "@launchstack/pipelines/call-notes";

import type { CallWorkerConfig } from "./config";
import { deferred } from "./deferred";
import {
    emitWorkerMessage,
    logWorkerEvent,
    type WorkerControl,
    type WorkerMessage,
    type WorkerState,
} from "./ipc";
import {
    createLocalCapturePipeline,
    type LocalCapturePipeline,
    type LocalCaptureBackend,
    type LocalCapturePipelineDependencies,
} from "./local/pipeline";
import {
    LocalBackendClient,
    LocalBackendError,
    type LocalBackendPollInput,
    type LocalBackendPollResult,
} from "./local/backend-client";

const MIN_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 750;

export interface LocalCaptureControlBackend extends LocalCaptureBackend {
    poll(input: LocalBackendPollInput, signal?: AbortSignal): Promise<LocalBackendPollResult>;
}

export interface CallWorkerRuntimeDependencies extends LocalCapturePipelineDependencies {
    backend?: LocalCaptureControlBackend;
    createPipeline?: (
        config: CallWorkerConfig,
        session: LocalCaptureSession,
        dependencies: LocalCapturePipelineDependencies
    ) => LocalCapturePipeline;
    pipelineDependenciesFactory?: () => LocalCapturePipelineDependencies;
    pollIntervalMs?: number;
    workerId?: string;
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    log?: (event: string, fields: Record<string, unknown>) => void;
    emit?: (message: WorkerMessage) => void;
}

interface ActivePipeline {
    session: LocalCaptureSession;
    pipeline: LocalCapturePipeline;
    done: Promise<void>;
    stopping: boolean;
    pausing: boolean;
}

function abortError(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    return reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" ? reason : "call worker stopped", { cause: reason });
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = (): void => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            reject(abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

function boundedPollInterval(value: number | undefined): number {
    if (value === undefined) return DEFAULT_POLL_INTERVAL_MS;
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError("pollIntervalMs must be a positive finite number");
    }
    return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, value));
}

function sameSession(first: LocalCaptureSession, second: LocalCaptureSession): boolean {
    return (
        first.callId === second.callId &&
        first.captureId === second.captureId &&
        first.occurrenceKey === second.occurrenceKey &&
        first.attemptKey === second.attemptKey
    );
}

export class CallWorkerRuntime {
    readonly workerId: string;
    private readonly backend: LocalCaptureControlBackend;
    private readonly createPipeline: (
        config: CallWorkerConfig,
        session: LocalCaptureSession,
        dependencies: LocalCapturePipelineDependencies
    ) => LocalCapturePipeline;
    private readonly pipelineDependenciesFactory: () => LocalCapturePipelineDependencies;
    private readonly pollIntervalMs: number;
    private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    private readonly log: (event: string, fields: Record<string, unknown>) => void;
    private readonly controlAbortController = new AbortController();
    private runPromise?: Promise<void>;
    private closePromise?: Promise<void>;
    private active?: ActivePipeline;
    private pollAbortController?: AbortController;
    private externalAbortCleanup?: () => void;
    private readonly emit: (message: WorkerMessage) => void;
    private state: WorkerState = "idle";
    private progressTimer?: NodeJS.Timeout;
    private fatalPipelineError?: LocalBackendError;

    constructor(
        private readonly config: CallWorkerConfig,
        dependencies: CallWorkerRuntimeDependencies = {}
    ) {
        this.workerId = dependencies.workerId ?? randomUUID();
        this.pollIntervalMs = boundedPollInterval(dependencies.pollIntervalMs);
        this.sleep = dependencies.sleep ?? abortableDelay;
        this.createPipeline = dependencies.createPipeline ?? createLocalCapturePipeline;
        this.log = dependencies.log ?? logWorkerEvent;
        this.emit = dependencies.emit ?? emitWorkerMessage;

        const backend =
            dependencies.backend ??
            new LocalBackendClient({
                origin: config.origin,
                deviceToken: config.deviceToken,
                appVersion: config.appVersion,
            });
        if (typeof backend.poll !== "function") {
            throw new Error("call worker backend must implement poll");
        }
        this.backend = backend;
        this.pipelineDependenciesFactory =
            dependencies.pipelineDependenciesFactory ??
            (() => ({
                sources: dependencies.sources,
                vads: dependencies.vads,
                transcription: dependencies.transcription,
                backend: this.backend,
            }));
    }

    run(signal?: AbortSignal): Promise<void> {
        if (signal) {
            const abort = (): void => {
                void this.close().catch(() => undefined);
            };
            if (signal.aborted) abort();
            else {
                signal.addEventListener("abort", abort, { once: true });
                this.externalAbortCleanup = () => signal.removeEventListener("abort", abort);
            }
        }
        if (!this.runPromise) {
            this.publishState("idle");
            this.progressTimer = setInterval(() => {
                if (this.state === "capturing") this.publishState("capturing");
            }, 2_000);
            this.progressTimer.unref();
            this.runPromise = this.pollLoop();
        }
        return this.runPromise;
    }

    async handleControl(control: WorkerControl): Promise<void> {
        if (control.type === "keep_recording") this.active?.pipeline.keepRecording();
        else if (control.type === "call_ended_signal") this.active?.pipeline.callEnded();
        else await this.close();
    }

    private publishState(state: WorkerState, active = this.active): void {
        this.state = state;
        this.emit({
            type: "state",
            state,
            ...(active
                ? {
                      callId: active.session.callId,
                      title: active.session.title,
                      startedAt: active.session.startedAt,
                  }
                : {}),
            ...(active?.pipeline.progress ?? {
                channels: { microphone: false, system: false },
                segments: 0,
            }),
        });
    }

    async close(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        this.controlAbortController.abort(new Error("call worker closed"));
        this.externalAbortCleanup?.();
        this.externalAbortCleanup = undefined;
        this.closePromise = (async () => {
            await this.active?.pipeline.stop("source_stopped");
            await this.runPromise?.catch(() => undefined);
        })();
        return this.closePromise;
    }

    private async pollLoop(): Promise<void> {
        const signal = this.controlAbortController.signal;
        try {
            while (!signal.aborted) {
                try {
                    const result = await this.poll(signal);
                    this.reconcile(result, signal);
                    await this.waitForPipelineOrPoll(signal);
                } catch (error) {
                    if (signal.aborted) break;
                    if (!(error instanceof LocalBackendError) || !error.retryable) throw error;
                    this.log("call_worker_backend_retry", { message: error.message });
                    await this.sleep(this.pollIntervalMs, signal);
                }
            }
        } catch (error) {
            if (!signal.aborted) throw error;
        } finally {
            clearInterval(this.progressTimer);
            this.externalAbortCleanup?.();
            this.externalAbortCleanup = undefined;
            if (signal.aborted) await this.active?.pipeline.stop("source_stopped");
            else await this.active?.pipeline.close();
        }
    }

    private async poll(signal: AbortSignal): Promise<LocalCapturePollResult> {
        while (!signal.aborted) {
            if (this.fatalPipelineError) throw this.fatalPipelineError;
            const input: LocalBackendPollInput = {
                workerId: this.workerId,
                wait: !this.active,
                ...(this.active ? { activeAttemptKey: this.active.session.attemptKey } : {}),
            };
            const controller = new AbortController();
            this.pollAbortController = controller;
            try {
                const result = await this.backend.poll(
                    input,
                    AbortSignal.any([signal, controller.signal])
                );
                if (signal.aborted) throw abortError(signal);
                if (controller.signal.aborted) continue;
                return result;
            } catch (error) {
                if (!signal.aborted && controller.signal.aborted) continue;
                throw error;
            } finally {
                if (this.pollAbortController === controller) this.pollAbortController = undefined;
            }
        }
        throw abortError(signal);
    }
    private reconcile(result: LocalCapturePollResult, _signal: AbortSignal): void {
        const session = result.capture;
        const active = this.active;
        if (!session) {
            if (active) {
                // A missing assignment revokes ownership. Preserve an explicit
                // stop/pause assignment's graceful drain, but never finalize an
                // otherwise-running capture successfully after revocation.
                const shutdown = active.stopping ? active.pipeline.stop() : active.pipeline.close();
                void shutdown.catch(() => undefined);
            }
            return;
        }
        if (active && !sameSession(active.session, session)) return;

        // A stopped/paused assignment is not work. In particular, do not
        // create a fresh native capture process for a stale terminal poll.
        if (!active && session.desiredMode !== "running") return;

        if (!active) {
            const dependencies = this.pipelineDependenciesFactory();
            const pipeline = this.createPipeline(this.config, session, {
                ...dependencies,
                backend: dependencies.backend ?? this.backend,
                onStateChange: state => {
                    dependencies.onStateChange?.(state);
                    if (!this.active || !sameSession(this.active.session, session)) return;
                    if (state === "stopping") this.active.stopping = true;
                    this.publishState(state);
                },
                onAutoStop: message => {
                    dependencies.onAutoStop?.(message);
                    this.emit(message);
                },
            });
            const completion = deferred();
            const active: ActivePipeline = {
                session,
                pipeline,
                stopping: false,
                pausing: false,
                done: completion.promise,
            };
            this.active = active;
            this.publishState("starting");
            void pipeline.run().then(
                () => {
                    this.settlePipeline(active);
                    completion.resolve();
                },
                error => {
                    this.settlePipeline(active, error);
                    completion.resolve();
                }
            );
        }

        const current = this.active;
        if (!current) return;
        if (session.desiredMode === "stopped") {
            current.stopping = true;
            void current.pipeline.stop().catch(() => {
                current.stopping = false;
            });
        } else if (session.desiredMode === "paused") {
            current.stopping = true;
            current.pausing = true;
            void current.pipeline.pause().catch(() => {
                current.stopping = false;
            });
        }
    }

    private settlePipeline(active: ActivePipeline, error?: unknown): void {
        if (this.active === active) {
            this.active = undefined;
            this.publishState(
                active.pausing && !error ? "paused" : "idle",
                active.pausing ? active : undefined
            );
            if (error instanceof LocalBackendError && error.exitCode)
                this.fatalPipelineError = error;
            this.pollAbortController?.abort(new Error("capture pipeline settled"));
        }
        if (error) {
            this.log("call_worker_pipeline_failed", {
                callId: active.session.callId,
                captureId: active.session.captureId,
                attemptKey: active.session.attemptKey,
                message:
                    error instanceof Error ? error.message : "Unknown capture pipeline failure",
            });
        }
    }

    private async waitForPipelineOrPoll(signal: AbortSignal): Promise<void> {
        const active = this.active;
        if (!active) {
            await this.sleep(this.pollIntervalMs, signal);
            return;
        }
        await Promise.race([active.done, this.sleep(this.pollIntervalMs, signal)]);
    }
}
