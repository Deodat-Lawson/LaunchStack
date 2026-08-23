export interface CallWorkerConfig {
    databaseUrl: string;
    workerId: string;
    captureEnabled: boolean;
    maxConcurrentStreams: number;
    pollIntervalMs: number;
}

function nonnegativeInteger(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a nonnegative integer`);
    }
    return value;
}

export function loadCallWorkerConfig(): CallWorkerConfig {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const configuredWorkerId = process.env.CALL_WORKER_ID?.trim();
    return {
        databaseUrl,
        workerId:
            configuredWorkerId && configuredWorkerId.length > 0
                ? configuredWorkerId
                : `call-worker-${process.pid}`,
        captureEnabled: process.env.CALL_NOTES_CAPTURE_ENABLED === "true",
        maxConcurrentStreams: nonnegativeInteger("ZOOM_RTMS_MAX_CONCURRENT_STREAMS", 0),
        pollIntervalMs: nonnegativeInteger("CALL_WORKER_POLL_INTERVAL_MS", 1_000),
    };
}
