import type { ZoomRtmsStartedPayload, ZoomStartedStreamSource } from "./capture-source";

interface StreamWaiter {
    resolve(payload: ZoomRtmsStartedPayload): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
}

export class ZoomStartedStreamRegistry implements ZoomStartedStreamSource {
    private readonly available = new Map<string, ZoomRtmsStartedPayload>();
    private readonly waiters = new Map<string, StreamWaiter>();

    constructor(private readonly timeoutMs = 30_000) {}

    publish(payload: ZoomRtmsStartedPayload): void {
        const occurrenceKey = payload.meeting_uuid;
        const waiter = this.waiters.get(occurrenceKey);
        if (waiter) {
            clearTimeout(waiter.timer);
            this.waiters.delete(occurrenceKey);
            waiter.resolve(payload);
            return;
        }
        this.available.set(occurrenceKey, payload);
    }

    take(occurrenceKey: string): Promise<ZoomRtmsStartedPayload> {
        const payload = this.available.get(occurrenceKey);
        if (payload) {
            this.available.delete(occurrenceKey);
            return Promise.resolve(payload);
        }
        if (this.waiters.has(occurrenceKey)) {
            return Promise.reject(
                new Error(`A waiter already exists for Zoom occurrence ${occurrenceKey}`)
            );
        }

        const { promise, resolve, reject } = Promise.withResolvers<ZoomRtmsStartedPayload>();
        const timer = setTimeout(() => {
            this.waiters.delete(occurrenceKey);
            reject(new Error(`Timed out waiting for Zoom RTMS stream ${occurrenceKey}`));
        }, this.timeoutMs);
        this.waiters.set(occurrenceKey, { resolve, reject, timer });
        return promise;
    }

    close(): void {
        for (const [occurrenceKey, waiter] of this.waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(
                new Error(`Zoom stream registry closed while waiting for ${occurrenceKey}`)
            );
        }
        this.waiters.clear();
        this.available.clear();
    }
}
