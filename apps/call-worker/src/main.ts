import { loadCallWorkerConfig } from "./config";
import { CallWorkerRuntime } from "./worker";
import { ZoomAutoStartCaptureSource } from "./zoom/capture-source";
import { ZoomStartedStreamRegistry } from "./zoom/started-stream-registry";

function log(event: string, fields: Record<string, unknown> = {}): void {
    process.stdout.write(
        `${JSON.stringify({ event, ...fields, observedAt: new Date().toISOString() })}\n`
    );
}

async function main(): Promise<void> {
    const config = loadCallWorkerConfig();
    const streams = new ZoomStartedStreamRegistry();
    const source = new ZoomAutoStartCaptureSource(streams);
    const { promise: stopped, resolve: stop } = Promise.withResolvers<void>();
    let runtime: CallWorkerRuntime | undefined;
    let closing: Promise<void> | undefined;

    const shutdown = (signal: NodeJS.Signals): void => {
        if (closing) return;
        log("call_worker_stopping", { signal });
        streams.close();
        closing = (runtime ? runtime.close() : Promise.resolve()).finally(stop);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    if (config.captureEnabled && config.maxConcurrentStreams < 1) {
        throw new Error(
            "CALL_NOTES_CAPTURE_ENABLED requires a positive ZOOM_RTMS_MAX_CONCURRENT_STREAMS"
        );
    }

    log("call_worker_ready", {
        workerId: config.workerId,
        captureEnabled: config.captureEnabled,
        maxConcurrentStreams: config.maxConcurrentStreams,
        attributedTranscript: source.capabilities.attributedTranscript,
        nativePauseResume: source.capabilities.nativePauseResume,
    });

    const keepAlive = setInterval(() => {
        log("call_worker_heartbeat", { workerId: config.workerId });
    }, 30_000);
    try {
        if (config.captureEnabled) {
            runtime = new CallWorkerRuntime(config);
            await Promise.race([stopped, runtime.run()]);
        } else {
            await stopped;
        }
    } finally {
        clearInterval(keepAlive);
        streams.close();
        if (closing) await closing;
        else if (runtime) await runtime.close();
    }
    log("call_worker_stopped", { workerId: config.workerId });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown call worker failure";
    log("call_worker_failed", { message });
    process.exitCode = 1;
});
