import { loadCallWorkerConfig } from "./config";
import { CallWorkerRuntime } from "./worker";

function log(event: string, fields: Record<string, unknown> = {}): void {
    process.stdout.write(
        `${JSON.stringify({ event, ...fields, observedAt: new Date().toISOString() })}\n`
    );
}

async function main(): Promise<void> {
    const config = loadCallWorkerConfig();
    const runtime = config.captureEnabled ? new CallWorkerRuntime(config) : undefined;
    const { promise: stopped, resolve: stop } = Promise.withResolvers<void>();
    let closing: Promise<void> | undefined;

    const shutdown = (signal: NodeJS.Signals): void => {
        if (closing) return;
        log("call_worker_stopping", { signal });
        closing = (runtime ? runtime.close() : Promise.resolve()).finally(stop);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    log("call_worker_ready", {
        captureEnabled: config.captureEnabled,
        state: config.captureEnabled ? "idle" : "disabled",
        controlPlane: config.captureEnabled ? "polling" : "disabled",
        systemAudioEnabled: config.systemAudioEnabled,
    });

    const heartbeat = setInterval(() => {
        log("call_worker_heartbeat", { captureEnabled: config.captureEnabled });
    }, 30_000);

    try {
        if (runtime) {
            await Promise.race([stopped, runtime.run()]);
        } else {
            await stopped;
        }
    } finally {
        clearInterval(heartbeat);
        if (closing) await closing;
        else if (runtime) await runtime.close();
    }
    log("call_worker_stopped", { captureEnabled: config.captureEnabled });
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown call worker failure";
    log("call_worker_failed", { message });
    process.exitCode = 1;
});
