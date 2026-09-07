import { randomUUID } from "node:crypto";

import type {
    LocalCapturePollInput,
    LocalCapturePollResult,
    LocalCaptureSession,
} from "@launchstack/pipelines/call-notes";

import type { CallWorkerConfig } from "./config";
import {
    createLocalCapturePipeline,
    type LocalCapturePipeline,
    type LocalCaptureBackend,
    type LocalCapturePipelineDependencies,
} from "./local/pipeline";
import {
    LocalBackendClient,
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
}

interface ActivePipeline {
    session: LocalCaptureSession;
    pipeline: LocalCapturePipeline;
    done: Promise<PipelineOutcome>;
    stopping: boolean;
}

interface PipelineOutcome {
    ok: boolean;
    error?: unknown;
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
        timer.unref?.();
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
    private readonly controlAbortController = new AbortController();
    private runPromise?: Promise<void>;
    private closePromise?: Promise<void>;
    private active?: ActivePipeline;
    private externalAbortCleanup?: () => void;

    constructor(
        private readonly config: CallWorkerConfig,
        dependencies: CallWorkerRuntimeDependencies = {}
    ) {
        this.workerId = dependencies.workerId ?? randomUUID();
        this.pollIntervalMs = boundedPollInterval(dependencies.pollIntervalMs);
        this.sleep = dependencies.sleep ?? abortableDelay;
        this.createPipeline = dependencies.createPipeline ?? createLocalCapturePipeline;

        const backend =
            dependencies.backend ??
            new LocalBackendClient({
                webOrigin: config.webOrigin,
                token: config.internalToken,
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
                this.controlAbortController.abort(abortError(signal));
                void this.active?.pipeline.close();
            };
            if (signal.aborted) abort();
            else {
                signal.addEventListener("abort", abort, { once: true });
                this.externalAbortCleanup = () => signal.removeEventListener("abort", abort);
            }
        }
        this.runPromise ??= this.pollLoop();
        return this.runPromise;
    }

    async close(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        this.controlAbortController.abort(new Error("call worker closed"));
        this.externalAbortCleanup?.();
        this.externalAbortCleanup = undefined;
        this.closePromise = (async () => {
            await this.active?.pipeline.close();
            await this.runPromise?.catch(() => undefined);
        })();
        return this.closePromise;
    }

    private async pollLoop(): Promise<void> {
        const signal = this.controlAbortController.signal;
        try {
            while (!signal.aborted) {
                const result = await this.poll(signal);
                this.reconcile(result, signal);
                await this.waitForPipelineOrPoll(signal);
            }
        } catch (error) {
            if (!signal.aborted) throw error;
        } finally {
            this.externalAbortCleanup?.();
            this.externalAbortCleanup = undefined;
            await this.active?.pipeline.close();
        }
    }

    private async poll(signal: AbortSignal): Promise<LocalCapturePollResult> {
        const input: LocalCapturePollInput = {
            companyId: this.config.companyId,
            userId: this.config.userId,
            workerId: this.workerId,
        };
        return this.backend.poll(input, signal);
    }
    private reconcile(result: LocalCapturePollResult, _signal: AbortSignal): void {
        const session = result.capture;
        const active = this.active;
        if (!session) {
            if (active) {
                // A missing assignment revokes ownership. Preserve an explicit
                // stopped assignment's graceful drain, but never finalize an
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
            });
            const run = pipeline.run();
            const done = run.then<PipelineOutcome, PipelineOutcome>(
                () => ({ ok: true }),
                error => ({ ok: false, error })
            );
            this.active = { session, pipeline, done, stopping: false };
        }

        const current = this.active;
        if (!current) return;
        if (session.desiredMode === "stopped") {
            current.stopping = true;
            void current.pipeline.stop().catch(() => {
                current.stopping = false;
            });
        } else if (session.desiredMode === "paused") {
            // Pause has no safe native implementation; fail closed instead of
            // leaving an open microphone recording while the UI says paused.
            void current.pipeline.close().catch(() => undefined);
        }
    }

    private async waitForPipelineOrPoll(signal: AbortSignal): Promise<void> {
        const active = this.active;
        if (!active) {
            await this.sleep(this.pollIntervalMs, signal);
            return;
        }
        const winner = await Promise.race([active.done, this.sleep(this.pollIntervalMs, signal)]);
        if (winner === undefined) return;
        this.active = undefined;
        if (!winner.ok) throw winner.error;
    }
}
