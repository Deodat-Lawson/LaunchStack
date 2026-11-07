import { EventEmitter } from "node:events";

import type { LocalCapturePollResult } from "@launchstack/pipelines/call-notes";

export const CAPTURE_LONG_POLL_MS = 25_000;
export const CAPTURE_POLL_RECHECK_MS = 5_000;

// Route handlers are compiled separately by Next. Keep one process-wide emitter
// so a command received in one bundle wakes a poll held by another bundle.
const state = globalThis as typeof globalThis & {
    __launchstackCaptureWake?: EventEmitter;
};
const emitter = (state.__launchstackCaptureWake ??= new EventEmitter());
emitter.setMaxListeners(0);

export function wakeCaptureDevice(deviceId: string): void {
    emitter.emit(deviceId);
}

export async function pollCaptureDevice(input: {
    deviceId: string;
    wait: boolean;
    signal: AbortSignal;
    poll: () => Promise<LocalCapturePollResult>;
}): Promise<LocalCapturePollResult> {
    const deadline = Date.now() + CAPTURE_LONG_POLL_MS;
    let pendingWake = false;
    let release: (() => void) | undefined;
    const onWake = () => {
        pendingWake = true;
        release?.();
    };
    const onAbort = () => release?.();
    // Subscribe before reading the database, so a command committed between
    // an empty read and waiting cannot be lost.
    emitter.on(input.deviceId, onWake);
    input.signal.addEventListener("abort", onAbort);
    try {
        for (;;) {
            pendingWake = false;
            const result = await input.poll();
            if (result.capture || !input.wait || input.signal.aborted || Date.now() >= deadline) {
                return result;
            }
            if (pendingWake) continue;
            await new Promise<void>(resolve => {
                const timer = setTimeout(
                    finish,
                    Math.min(CAPTURE_POLL_RECHECK_MS, Math.max(0, deadline - Date.now()))
                );
                function finish() {
                    clearTimeout(timer);
                    release = undefined;
                    resolve();
                }
                release = finish;
                if (pendingWake || input.signal.aborted) finish();
            });
        }
    } finally {
        emitter.off(input.deviceId, onWake);
        input.signal.removeEventListener("abort", onAbort);
    }
}
