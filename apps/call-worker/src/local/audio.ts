import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { PassThrough } from "node:stream";

/** One short, timestamped slice of little-endian signed 16-bit PCM audio. */
export interface PcmFrame {
    pcm: Uint8Array;
    capturedAt: Date;
    durationMs: number;
}

/** A source that exposes captured audio without retaining a recording. */
export interface AudioSource {
    frames(signal: AbortSignal): AsyncIterable<PcmFrame>;
    /**
     * Stop an active native producer without waiting for an async iterator
     * return call. Sources backed by child processes implement this so a
     * blocked `next()` cannot retain the process during worker shutdown.
     */
    stop?(reason?: unknown): void;
}

export interface FfmpegPcmSourceOptions {
    /** ffmpeg input device (for example `:0` or `hw:1,0`). */
    input?: string;
    /** Alias for input, useful when the value is called a device in config. */
    device?: string;
    /** Alias for input. */
    inputDevice?: string;
    /** ffmpeg input demuxer (normally `avfoundation` on macOS or `alsa` on Linux). */
    inputFormat?: string;
    /** Alias for inputFormat. */
    format?: string;
    ffmpegPath?: string;
    sampleRate?: number;
    /** Target frame duration. The nearest whole number of samples is used. */
    frameDurationMs?: number;
    /** Explicit frame size in samples, useful when the source rate is unusual. */
    frameSamples?: number;
    /** Explicit frame size in bytes. Must be an even number. */
    frameBytes?: number;
    /** Complete ffmpeg argv override, excluding the executable. */
    args?: readonly string[];
    /** Additional ffmpeg arguments inserted before the PCM output arguments. */
    extraArgs?: readonly string[];
    /** Clock used for the first frame timestamp. */
    clock?: () => Date;
    /** Spawn implementation override for embedders and deterministic integration tests. */
    spawn?: typeof nodeSpawn;
}

export interface SystemAudioPcmSourceOptions {
    /** Absolute or PATH-resolvable launchstack-system-audio executable. */
    helperPath: string;
    sampleRate?: number;
    /** Target frame duration. The nearest whole number of samples is used. */
    frameDurationMs?: number;
    /** Explicit frame size in samples, useful when the source rate is unusual. */
    frameSamples?: number;
    /** Explicit frame size in bytes. Must be an even number. */
    frameBytes?: number;
    /** Bounded wait for the helper's --status response. */
    statusTimeoutMs?: number;
    /** Clock used for the first frame timestamp. */
    clock?: () => Date;
    /** Spawn implementation override for embedders and deterministic integration tests. */
    spawn?: typeof nodeSpawn;
}

type ProcessExit = {
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
};

interface FrameLayout {
    sampleRate: number;
    frameSamples: number;
    frameBytes: number;
    frameDurationMs: number;
}

interface ProcessPcmReaderOptions extends FrameLayout {
    executable: string;
    args: readonly string[];
    label: string;
    clock: () => Date;
    spawn: typeof nodeSpawn;
    createError: (message: string, options?: ErrorOptions) => Error;
    registerStop?: (stop: () => void) => void;
    unregisterStop?: (stop: () => void) => void;
}

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_FRAME_DURATION_MS = 20;
const DEFAULT_STDERR_LIMIT = 4_096;
const DEFAULT_STATUS_TIMEOUT_MS = 2_000;
const MAX_STATUS_TIMEOUT_MS = 30_000;
const STATUS_STDOUT_LIMIT = 16_384;
const STATUS_SHUTDOWN_GRACE_MS = 250;

function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

function positiveInteger(name: string, value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
    }
    return value;
}

function nonEmpty(value: string | undefined, name: string): string {
    const result = value?.trim();
    if (!result) throw new Error(`${name} is required`);
    return result;
}

function frameLayout(options: {
    sampleRate?: number;
    frameDurationMs?: number;
    frameSamples?: number;
    frameBytes?: number;
}): FrameLayout {
    const sampleRate = positiveInteger("sampleRate", options.sampleRate ?? DEFAULT_SAMPLE_RATE);
    const configuredFrameBytes = options.frameBytes;
    if (configuredFrameBytes !== undefined) {
        positiveInteger("frameBytes", configuredFrameBytes);
        if (configuredFrameBytes % 2 !== 0) {
            throw new RangeError("frameBytes must contain complete 16-bit samples");
        }
    }

    const configuredFrameSamples = options.frameSamples;
    if (configuredFrameSamples !== undefined) {
        positiveInteger("frameSamples", configuredFrameSamples);
    }

    if (
        configuredFrameBytes !== undefined &&
        configuredFrameSamples !== undefined &&
        configuredFrameBytes !== configuredFrameSamples * 2
    ) {
        throw new RangeError("frameBytes and frameSamples must describe the same frame");
    }

    const frameDurationMs = options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
    if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
        throw new RangeError("frameDurationMs must be a positive finite number");
    }

    const frameSamples =
        configuredFrameSamples ??
        (configuredFrameBytes !== undefined
            ? configuredFrameBytes / 2
            : Math.max(1, Math.round((sampleRate * frameDurationMs) / 1_000)));
    const frameBytes = configuredFrameBytes ?? frameSamples * 2;
    return {
        sampleRate,
        frameSamples,
        frameBytes,
        frameDurationMs: (frameSamples * 1_000) / sampleRate,
    };
}

function processExit(child: ChildProcess): {
    promise: Promise<ProcessExit>;
    hasExited: () => boolean;
} {
    let exited = false;
    let settled = false;
    let resolveExit: (exit: ProcessExit) => void = () => undefined;
    const promise = new Promise<ProcessExit>(resolve => {
        resolveExit = resolve;
    });

    child.once("error", error => {
        if (settled) return;
        settled = true;
        resolveExit({ code: null, signal: null, error: asError(error) });
    });
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
        exited = true;
        if (settled) return;
        settled = true;
        resolveExit({ code, signal });
    });

    return { promise, hasExited: () => exited };
}

function stopProcess(child: ChildProcess, hasExited: () => boolean): void {
    if (hasExited()) return;
    try {
        child.kill("SIGTERM");
    } catch {
        // The process may have exited between hasExited and kill.
    }
    const forceKillTimer = setTimeout(() => {
        if (hasExited()) return;
        try {
            child.kill("SIGKILL");
        } catch {
            // The process may have exited before the escalation timer.
        }
    }, 2_000);
    forceKillTimer.unref?.();
}

function addAbortHandler(
    child: ChildProcess,
    signal: AbortSignal,
    hasExited: () => boolean
): { wasAborted: () => boolean; dispose: () => void } {
    let aborted = signal.aborted;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = (): void => {
        aborted = true;
        if (hasExited()) return;
        try {
            child.kill("SIGTERM");
        } catch {
            // The process may have exited between hasExited and kill.
        }
        forceKillTimer = setTimeout(() => {
            if (hasExited()) return;
            try {
                child.kill("SIGKILL");
            } catch {
                // The process may have exited before the escalation timer.
            }
        }, 2_000);
        forceKillTimer.unref?.();
    };

    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();

    return {
        wasAborted: () => aborted || signal.aborted,
        dispose: () => {
            signal.removeEventListener("abort", stop);
            if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
        },
    };
}

async function waitForProcessAfterStop(
    completion: Promise<ProcessExit>,
    child: ChildProcess,
    hasExited: () => boolean
): Promise<void> {
    if (hasExited()) return;
    await Promise.race([
        completion.then(() => undefined),
        new Promise<void>(resolve => {
            const timer = setTimeout(resolve, STATUS_SHUTDOWN_GRACE_MS);
            timer.unref?.();
        }),
    ]);
    if (!hasExited()) {
        try {
            child.kill("SIGKILL");
        } catch {
            // The process may have exited before the escalation.
        }
    }
}

export class FfmpegPcmSourceError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "FfmpegPcmSourceError";
    }
}

export type SystemAudioStatusReason = "ready" | "unsupported" | "permission_denied";

export type SystemAudioReadinessCode =
    | SystemAudioStatusReason
    | "helper_unavailable"
    | "status_timeout"
    | "invalid_status"
    | "status_failed"
    | "cancelled";

export interface SystemAudioStatus {
    supported: boolean;
    authorized: boolean;
    reason: SystemAudioStatusReason;
    message: string;
}

export interface SystemAudioReadiness {
    ready: boolean;
    code: SystemAudioReadinessCode;
    supported: boolean;
    authorized: boolean;
    message: string;
}

export class SystemAudioPcmSourceError extends Error {
    readonly code: SystemAudioReadinessCode | "capture_failed";
    readonly readiness?: SystemAudioReadiness;

    constructor(
        message: string,
        options: ErrorOptions & {
            code?: SystemAudioReadinessCode | "capture_failed";
            readiness?: SystemAudioReadiness;
        } = {}
    ) {
        super(message, options);
        this.name = "SystemAudioPcmSourceError";
        this.code = options.code ?? "capture_failed";
        this.readiness = options.readiness;
    }
}

const PROCESS_PCM_BUFFER_BYTES = 4 * 1024 * 1024;

async function* readProcessPcmFrames(
    options: ProcessPcmReaderOptions,
    signal: AbortSignal
): AsyncGenerator<PcmFrame> {
    if (signal.aborted) return;

    let child: ChildProcess;
    try {
        const spawnOptions: SpawnOptions = {
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        };
        child = options.spawn(options.executable, [...options.args], spawnOptions);
    } catch (error) {
        throw options.createError(`Unable to spawn ${options.label}: ${asError(error).message}`, {
            cause: error,
        });
    }

    if (!child.stdout || !child.stderr) {
        stopProcess(child, () => false);
        throw options.createError(`${options.label} must provide stdout and stderr pipes`);
    }

    // Capture processes produce real-time PCM and cannot pause while the consumer
    // performs network I/O. This bounded buffer keeps their stdout drained for
    // roughly two minutes at 16 kHz mono without retaining a durable recording.
    const pcmOutput = new PassThrough({ highWaterMark: PROCESS_PCM_BUFFER_BYTES });
    child.stdout.pipe(pcmOutput);
    const forwardStdoutError = (error: Error): void => {
        pcmOutput.destroy(error);
    };
    child.stdout.on("error", forwardStdoutError);

    let stderrTail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-DEFAULT_STDERR_LIMIT);
    });

    const completion = processExit(child);
    let stopped = false;
    const stop = (): void => {
        stopped = true;
        stopProcess(child, completion.hasExited);
    };
    options.registerStop?.(stop);
    const abort = addAbortHandler(child, signal, completion.hasExited);
    let streamError: unknown;
    let frameBuffer = new Uint8Array(options.frameBytes);
    let frameOffset = 0;
    let emittedSamples = 0;
    const startedAt = options.clock();
    const startedAtMs = startedAt.getTime();
    if (!Number.isFinite(startedAtMs)) {
        abort.dispose();
        options.unregisterStop?.(stop);
        stopProcess(child, completion.hasExited);
        throw options.createError("capture clock returned an invalid date");
    }

    try {
        for await (const chunk of pcmOutput) {
            if (stopped || abort.wasAborted()) return;
            if (!(chunk instanceof Uint8Array)) {
                throw options.createError(`${options.label} stdout yielded a non-byte chunk`);
            }

            let offset = 0;
            while (offset < chunk.byteLength) {
                const copyLength = Math.min(
                    options.frameBytes - frameOffset,
                    chunk.byteLength - offset
                );
                frameBuffer.set(chunk.subarray(offset, offset + copyLength), frameOffset);
                frameOffset += copyLength;
                offset += copyLength;

                if (frameOffset !== options.frameBytes) continue;
                if (stopped || abort.wasAborted()) return;

                const pcm = frameBuffer;
                frameBuffer = new Uint8Array(options.frameBytes);
                frameOffset = 0;
                const capturedAt = new Date(
                    startedAtMs + (emittedSamples * 1_000) / options.sampleRate
                );
                emittedSamples += options.frameSamples;
                yield {
                    pcm,
                    capturedAt,
                    durationMs: options.frameDurationMs,
                };
            }
        }
    } catch (error) {
        streamError = error;
    } finally {
        child.stdout.unpipe(pcmOutput);
        child.stdout.off("error", forwardStdoutError);
        pcmOutput.destroy();
        abort.dispose();
        options.unregisterStop?.(stop);
        if (!completion.hasExited()) stopProcess(child, completion.hasExited);
    }

    const exit = await completion.promise;
    if (stopped || abort.wasAborted()) return;

    if (streamError !== undefined) {
        throw options.createError(
            `Unable to read ${options.label} PCM output: ${asError(streamError).message}`,
            { cause: streamError }
        );
    }
    if (exit.error) {
        throw options.createError(`Unable to spawn ${options.label}: ${exit.error.message}`, {
            cause: exit.error,
        });
    }
    if (exit.code !== 0) {
        const details = stderrTail.trim();
        throw options.createError(
            `${options.label} exited with code ${String(exit.code)}${details ? `: ${details}` : ""}`
        );
    }
    if (exit.signal !== null) {
        const details = stderrTail.trim();
        throw options.createError(
            `${options.label} exited due to signal ${exit.signal}${details ? `: ${details}` : ""}`
        );
    }
    if (frameOffset !== 0) {
        if (frameOffset % 2 !== 0) {
            throw options.createError(`${options.label} produced an incomplete 16-bit PCM sample`);
        }
        const sampleCount = frameOffset / 2;
        const pcm = frameBuffer.slice(0, frameOffset);
        frameBuffer.fill(0);
        frameBuffer = new Uint8Array(0);
        yield {
            pcm,
            capturedAt: new Date(startedAtMs + (emittedSamples * 1_000) / options.sampleRate),
            durationMs: (sampleCount * 1_000) / options.sampleRate,
        };
    }
}

/**
 * Captures mono signed 16-bit PCM from an ffmpeg input device.
 *
 * ffmpeg is intentionally invoked with an argv array and `shell: false`; the
 * input format and device are therefore safe to configure independently on
 * macOS (`avfoundation`, e.g. `:0`) and Linux (`alsa`, e.g. `default`).
 */
export class FfmpegPcmSource implements AudioSource {
    readonly ffmpegPath: string;
    readonly input: string;
    readonly inputFormat: string;
    readonly sampleRate: number;
    readonly frameSamples: number;
    readonly frameBytes: number;
    readonly frameDurationMs: number;
    private readonly args?: readonly string[];
    private readonly extraArgs: readonly string[];
    private readonly clock: () => Date;
    private readonly spawnProcess: typeof nodeSpawn;
    private readonly activeStops = new Set<() => void>();
    constructor(options?: FfmpegPcmSourceOptions);
    constructor(input: string, options?: Omit<FfmpegPcmSourceOptions, "input">);
    constructor(
        inputOrOptions: string | FfmpegPcmSourceOptions = {},
        positionalOptions: Omit<FfmpegPcmSourceOptions, "input"> = {}
    ) {
        const options: FfmpegPcmSourceOptions =
            typeof inputOrOptions === "string"
                ? { ...positionalOptions, input: inputOrOptions }
                : inputOrOptions;

        this.ffmpegPath = nonEmpty(options.ffmpegPath ?? "ffmpeg", "ffmpegPath");
        this.input = nonEmpty(
            options.input ??
                options.device ??
                options.inputDevice ??
                (process.platform === "darwin" ? ":0" : "default"),
            "input"
        );
        this.inputFormat = nonEmpty(
            options.inputFormat ??
                options.format ??
                (process.platform === "darwin" ? "avfoundation" : "alsa"),
            "inputFormat"
        );
        const layout = frameLayout(options);
        this.sampleRate = layout.sampleRate;
        this.frameSamples = layout.frameSamples;
        this.frameBytes = layout.frameBytes;
        this.frameDurationMs = layout.frameDurationMs;

        this.args = options.args === undefined ? undefined : [...options.args];
        this.extraArgs = options.extraArgs === undefined ? [] : [...options.extraArgs];
        this.clock = options.clock ?? (() => new Date());
        this.spawnProcess = options.spawn ?? nodeSpawn;
    }

    frames(signal: AbortSignal): AsyncIterable<PcmFrame> {
        return readProcessPcmFrames(
            {
                executable: this.ffmpegPath,
                args: this.buildArgs(),
                label: "ffmpeg",
                sampleRate: this.sampleRate,
                frameSamples: this.frameSamples,
                frameBytes: this.frameBytes,
                frameDurationMs: this.frameDurationMs,
                clock: this.clock,
                spawn: this.spawnProcess,
                createError: (message, options) => new FfmpegPcmSourceError(message, options),
                registerStop: stop => this.activeStops.add(stop),
                unregisterStop: stop => this.activeStops.delete(stop),
            },
            signal
        );
    }

    stop(): void {
        for (const stop of this.activeStops) stop();
    }

    private buildArgs(): string[] {
        if (this.args !== undefined) return [...this.args];
        return [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-f",
            this.inputFormat,
            "-i",
            this.input,
            "-ac",
            "1",
            "-ar",
            String(this.sampleRate),
            ...this.extraArgs,
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "pipe:1",
        ];
    }
}

function statusDiagnostic(
    code: SystemAudioReadinessCode,
    message: string,
    supported = false,
    authorized = false
): SystemAudioReadiness {
    return { ready: code === "ready", code, supported, authorized, message };
}

function parseSystemAudioStatus(stdout: string): SystemAudioReadiness {
    let value: unknown;
    try {
        value = JSON.parse(stdout.trim());
    } catch {
        return statusDiagnostic("invalid_status", "system audio helper returned invalid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return statusDiagnostic(
            "invalid_status",
            "system audio helper status must be a JSON object"
        );
    }

    const record = value as Record<string, unknown>;
    if (typeof record.supported !== "boolean" || typeof record.authorized !== "boolean") {
        return statusDiagnostic(
            "invalid_status",
            "system audio helper status must contain boolean supported and authorized fields"
        );
    }
    if (
        record.reason !== "ready" &&
        record.reason !== "unsupported" &&
        record.reason !== "permission_denied"
    ) {
        return statusDiagnostic(
            "invalid_status",
            "system audio helper status must contain a stable reason"
        );
    }
    if (typeof record.message !== "string" || record.message.length > 4_096) {
        return statusDiagnostic(
            "invalid_status",
            "system audio helper status must contain a bounded message"
        );
    }

    const supported = record.supported;
    const authorized = record.authorized;
    if (record.reason === "ready" && (!supported || !authorized)) {
        return statusDiagnostic(
            "invalid_status",
            "system audio helper reported ready without support and authorization",
            supported,
            authorized
        );
    }
    if (record.reason === "unsupported" && supported) {
        return statusDiagnostic(
            "invalid_status",
            "system audio helper reported unsupported while supported",
            supported,
            authorized
        );
    }
    if (record.reason === "permission_denied" && (!supported || authorized)) {
        return statusDiagnostic(
            "invalid_status",
            "system audio helper reported denied permission inconsistently",
            supported,
            authorized
        );
    }
    return {
        ready: supported && authorized && record.reason === "ready",
        code: record.reason,
        supported,
        authorized,
        message: record.message,
    };
}

async function probeSystemAudioStatusProcess(options: {
    helperPath: string;
    timeoutMs: number;
    spawn: typeof nodeSpawn;
    signal: AbortSignal;
    registerStop?: (stop: () => void) => void;
    unregisterStop?: (stop: () => void) => void;
}): Promise<SystemAudioReadiness> {
    if (options.signal.aborted) {
        return statusDiagnostic("cancelled", "system audio status probe was cancelled");
    }

    let child: ChildProcess;
    try {
        child = options.spawn(options.helperPath, ["--status"], {
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (error) {
        return statusDiagnostic(
            "helper_unavailable",
            `unable to spawn system audio helper: ${asError(error).message}`
        );
    }
    if (!child.stdout || !child.stderr) {
        stopProcess(child, () => false);
        return statusDiagnostic(
            "helper_unavailable",
            "system audio helper must provide stdout and stderr pipes"
        );
    }

    let stdout = "";
    let stderr = "";
    let outputTooLarge = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
        if (outputTooLarge) return;
        stdout += chunk;
        if (Buffer.byteLength(stdout, "utf8") > STATUS_STDOUT_LIMIT) {
            outputTooLarge = true;
            stdout = stdout.slice(0, STATUS_STDOUT_LIMIT);
            try {
                child.kill("SIGTERM");
            } catch {
                // The helper may have exited while output was being handled.
            }
        }
    });
    child.stderr.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-DEFAULT_STDERR_LIMIT);
    });

    const completion = processExit(child);
    let timedOut = false;
    let cancelled: boolean = options.signal.aborted;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const stopForProbe = (): void => {
        if (!completion.hasExited()) {
            try {
                child.kill("SIGTERM");
            } catch {
                // The helper may have exited between the check and kill.
            }
        }
    };
    options.registerStop?.(stopForProbe);

    const abortPromise = new Promise<"cancelled">(resolve => {
        const onAbort = (): void => {
            cancelled = true;
            stopForProbe();
            resolve("cancelled");
        };
        if (options.signal.aborted) onAbort();
        else {
            options.signal.addEventListener("abort", onAbort, { once: true });
            removeAbort = () => options.signal.removeEventListener("abort", onAbort);
        }
    });
    const timeoutPromise = new Promise<"timeout">(resolve => {
        timeout = setTimeout(() => {
            timedOut = true;
            stopForProbe();
            resolve("timeout");
        }, options.timeoutMs);
        timeout.unref?.();
    });

    try {
        const result = await Promise.race([
            completion.promise.then(exit => ({ kind: "exit" as const, exit })),
            abortPromise.then(kind => ({ kind })),
            timeoutPromise.then(kind => ({ kind })),
        ]);
        if (result.kind !== "exit") {
            await waitForProcessAfterStop(completion.promise, child, completion.hasExited);
            if (result.kind === "cancelled" || cancelled) {
                return statusDiagnostic("cancelled", "system audio status probe was cancelled");
            }
            return statusDiagnostic(
                "status_timeout",
                `system audio status probe timed out after ${options.timeoutMs}ms`
            );
        }

        const exit = result.exit;
        if (outputTooLarge) {
            return statusDiagnostic(
                "invalid_status",
                "system audio helper status exceeded the output limit"
            );
        }
        if (exit.error) {
            return statusDiagnostic(
                "helper_unavailable",
                `unable to run system audio helper: ${exit.error.message}`
            );
        }
        if (exit.signal !== null) {
            return statusDiagnostic(
                "status_failed",
                `system audio status exited due to signal ${exit.signal}`
            );
        }
        const readiness = parseSystemAudioStatus(stdout);
        const expectedExitCode =
            readiness.code === "ready"
                ? 0
                : readiness.code === "permission_denied"
                  ? 2
                  : readiness.code === "unsupported"
                    ? 3
                    : undefined;
        if (expectedExitCode === undefined) return readiness;
        if (exit.code !== expectedExitCode) {
            const detail = stderr.trim();
            return statusDiagnostic(
                "status_failed",
                `system audio status reported ${readiness.code} but exited with code ${String(exit.code)}${detail ? `: ${detail}` : ""}`,
                readiness.supported,
                readiness.authorized
            );
        }
        return readiness;
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        removeAbort?.();
        options.unregisterStop?.(stopForProbe);
        if (timedOut || cancelled)
            await waitForProcessAfterStop(completion.promise, child, completion.hasExited);
    }
}

/**
 * Process-backed ScreenCaptureKit system-output capture. The helper is probed
 * before capture and is never invoked through a shell.
 */
export class SystemAudioPcmSource implements AudioSource {
    readonly helperPath: string;
    readonly sampleRate: number;
    readonly frameSamples: number;
    readonly frameBytes: number;
    readonly frameDurationMs: number;
    readonly statusTimeoutMs: number;

    private readonly clock: () => Date;
    private readonly spawnProcess: typeof nodeSpawn;
    private readonly activeStops = new Set<() => void>();
    private readinessPromise?: Promise<SystemAudioReadiness>;

    constructor(options: SystemAudioPcmSourceOptions) {
        this.helperPath = nonEmpty(options.helperPath, "helperPath");
        const layout = frameLayout({
            sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
            frameDurationMs: options.frameDurationMs,
            frameSamples: options.frameSamples,
            frameBytes: options.frameBytes,
        });
        this.sampleRate = layout.sampleRate;
        this.frameSamples = layout.frameSamples;
        this.frameBytes = layout.frameBytes;
        this.frameDurationMs = layout.frameDurationMs;
        this.statusTimeoutMs = options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
        if (
            !Number.isSafeInteger(this.statusTimeoutMs) ||
            this.statusTimeoutMs <= 0 ||
            this.statusTimeoutMs > MAX_STATUS_TIMEOUT_MS
        ) {
            throw new RangeError(
                `statusTimeoutMs must be a positive integer no greater than ${MAX_STATUS_TIMEOUT_MS}`
            );
        }
        this.clock = options.clock ?? (() => new Date());
        this.spawnProcess = options.spawn ?? nodeSpawn;
    }

    async probeStatus(
        signal: AbortSignal = new AbortController().signal
    ): Promise<SystemAudioReadiness> {
        if (signal.aborted) {
            return statusDiagnostic("cancelled", "system audio status probe was cancelled");
        }
        this.readinessPromise ??= probeSystemAudioStatusProcess({
            helperPath: this.helperPath,
            timeoutMs: this.statusTimeoutMs,
            spawn: this.spawnProcess,
            signal,
            registerStop: stop => this.activeStops.add(stop),
            unregisterStop: stop => this.activeStops.delete(stop),
        });
        return this.readinessPromise;
    }

    frames(signal: AbortSignal): AsyncIterable<PcmFrame> {
        return this.captureFrames(signal);
    }

    private async *captureFrames(signal: AbortSignal): AsyncGenerator<PcmFrame> {
        if (signal.aborted) return;
        const readiness = await this.probeStatus(signal);
        if (signal.aborted || readiness.code === "cancelled") return;
        if (!readiness.ready) {
            throw new SystemAudioPcmSourceError(
                `System audio is not ready (${readiness.code}): ${readiness.message}`,
                { code: readiness.code, readiness }
            );
        }

        yield* readProcessPcmFrames(
            {
                executable: this.helperPath,
                args: ["--sample-rate", String(this.sampleRate)],
                label: "system audio helper",
                sampleRate: this.sampleRate,
                frameSamples: this.frameSamples,
                frameBytes: this.frameBytes,
                frameDurationMs: this.frameDurationMs,
                clock: this.clock,
                spawn: this.spawnProcess,
                createError: (message, options) =>
                    new SystemAudioPcmSourceError(message, { ...options, code: "capture_failed" }),
                registerStop: stop => this.activeStops.add(stop),
                unregisterStop: stop => this.activeStops.delete(stop),
            },
            signal
        );
        if (!signal.aborted) {
            throw new SystemAudioPcmSourceError("system audio helper stopped unexpectedly", {
                code: "capture_failed",
            });
        }
    }

    stop(): void {
        for (const stop of this.activeStops) stop();
    }
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
        target[offset + index] = value.charCodeAt(index);
    }
}

function assertWavRate(name: string, value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
    }
    return value;
}

export interface Pcm16WavOptions {
    sampleRate: number;
    channels?: number;
}

/** Encode interleaved signed 16-bit little-endian PCM in a RIFF/WAVE container. */
export function encodePcm16Wav(pcm: Uint8Array, sampleRate: number, channels?: number): Uint8Array;
export function encodePcm16Wav(input: Uint8Array, options: Pcm16WavOptions): Uint8Array;
export function encodePcm16Wav(
    pcm: Uint8Array,
    sampleRateOrOptions: number | Pcm16WavOptions,
    channels = 1
): Uint8Array {
    if (!(pcm instanceof Uint8Array)) {
        throw new TypeError("pcm must be a Uint8Array");
    }

    const sampleRate =
        typeof sampleRateOrOptions === "number"
            ? sampleRateOrOptions
            : sampleRateOrOptions.sampleRate;
    if (typeof sampleRateOrOptions !== "number") {
        channels = sampleRateOrOptions.channels ?? 1;
    }
    assertWavRate("sampleRate", sampleRate);
    if (!Number.isSafeInteger(channels) || channels <= 0 || channels > 0xffff) {
        throw new RangeError("channels must be a positive 16-bit integer");
    }

    const blockAlign = channels * 2;
    if (pcm.byteLength % blockAlign !== 0) {
        throw new RangeError("PCM byte length must contain complete samples for every channel");
    }
    const maxPayloadBytes = 0xffff_ffff - 36;
    if (pcm.byteLength > maxPayloadBytes) {
        throw new RangeError("PCM payload is too large for a RIFF/WAVE file");
    }

    const wav = new Uint8Array(44 + pcm.byteLength);
    const view = new DataView(wav.buffer);
    writeAscii(wav, 0, "RIFF");
    view.setUint32(4, 36 + pcm.byteLength, true);
    writeAscii(wav, 8, "WAVE");
    writeAscii(wav, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeAscii(wav, 36, "data");
    view.setUint32(40, pcm.byteLength, true);
    wav.set(pcm, 44);
    return wav;
}
