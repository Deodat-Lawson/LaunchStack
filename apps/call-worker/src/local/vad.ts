import type { PcmFrame } from "./audio";

export interface VoiceActivityDetectorOptions {
    /** Normalized PCM RMS threshold in the range 0..1. */
    threshold?: number;
    /** Alias for threshold used by capture configuration. */
    speechThreshold?: number;
    /** Consecutive active frames required to enter the active state. */
    activationFrames?: number;
    /** Consecutive quiet frames required to leave the active state. */
    releaseFrames?: number;
    /** Alternative release setting measured in frame durations. */
    releaseSilenceMs?: number;
    /** Used only when a frame does not carry a usable duration. */
    frameDurationMs?: number;
}

export interface VoiceActivityResult {
    active: boolean;
    started: boolean;
    ended: boolean;
    /** Root-mean-square amplitude normalized to full-scale PCM (0..1). */
    rms: number;
}

const DEFAULT_THRESHOLD = 0.015;
const DEFAULT_ACTIVATION_FRAMES = 3;
const DEFAULT_RELEASE_FRAMES = 25;

function positiveInteger(name: string, value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
    }
    return value;
}

function nonnegativeFinite(name: string, value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a nonnegative finite number`);
    }
    return value;
}

function calculateRms(pcm: Uint8Array): number {
    if (!(pcm instanceof Uint8Array)) {
        throw new TypeError("frame.pcm must be a Uint8Array");
    }
    if (pcm.byteLength % 2 !== 0) {
        throw new RangeError("frame.pcm must contain complete 16-bit samples");
    }
    if (pcm.byteLength === 0) return 0;

    let sumSquares = 0;
    for (let offset = 0; offset < pcm.byteLength; offset += 2) {
        const unsigned = pcm[offset]! | (pcm[offset + 1]! << 8);
        const signed = unsigned >= 0x8000 ? unsigned - 0x1_0000 : unsigned;
        const normalized = signed / 32_768;
        sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / (pcm.byteLength / 2));
}

/** Hysteresis RMS VAD suitable for short PCM frames. */
export class VoiceActivityDetector {
    readonly threshold: number;
    readonly activationFrames: number;
    readonly releaseFrames?: number;
    readonly releaseSilenceMs?: number;
    readonly frameDurationMs?: number;

    private activeState = false;
    private consecutiveSpeechFrames = 0;
    private consecutiveSilenceFrames = 0;
    private consecutiveSilenceMs = 0;

    constructor(options: VoiceActivityDetectorOptions = {}) {
        const threshold = options.threshold ?? options.speechThreshold ?? DEFAULT_THRESHOLD;
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
            throw new RangeError("threshold must be a finite number between 0 and 1");
        }
        this.threshold = threshold;
        this.activationFrames = positiveInteger(
            "activationFrames",
            options.activationFrames ?? DEFAULT_ACTIVATION_FRAMES
        );

        if (options.releaseFrames !== undefined) {
            this.releaseFrames = positiveInteger("releaseFrames", options.releaseFrames);
        } else if (options.releaseSilenceMs === undefined) {
            this.releaseFrames = DEFAULT_RELEASE_FRAMES;
        }

        if (options.releaseSilenceMs !== undefined) {
            this.releaseSilenceMs = nonnegativeFinite("releaseSilenceMs", options.releaseSilenceMs);
            if (this.releaseSilenceMs <= 0) {
                throw new RangeError("releaseSilenceMs must be greater than zero");
            }
        }

        if (options.frameDurationMs !== undefined) {
            this.frameDurationMs = nonnegativeFinite("frameDurationMs", options.frameDurationMs);
            if (this.frameDurationMs <= 0) {
                throw new RangeError("frameDurationMs must be greater than zero");
            }
        }
    }

    get active(): boolean {
        return this.activeState;
    }

    process(frame: PcmFrame): VoiceActivityResult {
        if (!frame || typeof frame !== "object") {
            throw new TypeError("frame is required");
        }
        const rms = calculateRms(frame.pcm);
        const speaking = rms >= this.threshold;
        let started = false;
        let ended = false;

        if (!this.activeState) {
            this.consecutiveSilenceFrames = 0;
            this.consecutiveSilenceMs = 0;
            if (speaking) {
                this.consecutiveSpeechFrames += 1;
                if (this.consecutiveSpeechFrames >= this.activationFrames) {
                    this.activeState = true;
                    this.consecutiveSpeechFrames = 0;
                    started = true;
                }
            } else {
                this.consecutiveSpeechFrames = 0;
            }
        } else if (speaking) {
            this.consecutiveSilenceFrames = 0;
            this.consecutiveSilenceMs = 0;
        } else {
            this.consecutiveSpeechFrames = 0;
            this.consecutiveSilenceFrames += 1;
            this.consecutiveSilenceMs += this.durationFor(frame);
            const reachedFrameRelease =
                this.releaseFrames !== undefined &&
                this.consecutiveSilenceFrames >= this.releaseFrames;
            const reachedTimeRelease =
                this.releaseSilenceMs !== undefined &&
                this.consecutiveSilenceMs >= this.releaseSilenceMs;
            if (reachedFrameRelease || reachedTimeRelease) {
                this.activeState = false;
                this.consecutiveSilenceFrames = 0;
                this.consecutiveSilenceMs = 0;
                ended = true;
            }
        }

        return {
            active: this.activeState,
            started,
            ended,
            rms,
        };
    }

    reset(): void {
        this.activeState = false;
        this.consecutiveSpeechFrames = 0;
        this.consecutiveSilenceFrames = 0;
        this.consecutiveSilenceMs = 0;
    }

    private durationFor(frame: PcmFrame): number {
        return typeof frame.durationMs === "number" &&
            Number.isFinite(frame.durationMs) &&
            frame.durationMs > 0
            ? frame.durationMs
            : (this.frameDurationMs ?? 0);
    }
}

export { calculateRms as pcm16Rms };
