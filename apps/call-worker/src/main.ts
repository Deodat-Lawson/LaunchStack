import { createInterface } from "node:readline";

import { CallWorkerConfigError, loadCallWorkerConfig } from "./config";
import { logWorkerEvent, WorkerControlSchema } from "./ipc";
import { LocalBackendError } from "./local/backend-client";
import { CallWorkerRuntime } from "./worker";

async function main(): Promise<void> {
    const input = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
    const lines = input[Symbol.asyncIterator]();
    let runtime: CallWorkerRuntime | undefined;
    const shutdownController = new AbortController();
    const shutdown = (): void => shutdownController.abort();
    let controlFailure: Error | undefined;
    try {
        const first = await lines.next();
        if (first.done)
            throw new CallWorkerConfigError("Startup configuration is required on stdin line 1");
        const config = loadCallWorkerConfig(first.value);
        runtime = new CallWorkerRuntime(config);
        const worker = runtime;
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
        const running = worker.run(shutdownController.signal);
        const controls = (async () => {
            while (true) {
                const line = await lines.next();
                // A config file may reach EOF in development. Keep polling until shutdown.
                if (line.done) return;
                let message: unknown;
                try {
                    message = JSON.parse(line.value) as unknown;
                } catch {
                    logWorkerEvent("call_worker_invalid_control");
                    continue;
                }
                const parsed = WorkerControlSchema.safeParse(message);
                if (!parsed.success) {
                    logWorkerEvent("call_worker_invalid_control");
                    continue;
                }
                await worker.handleControl(parsed.data);
                if (parsed.data.type === "shutdown") return;
            }
        })().catch((error: unknown) => {
            controlFailure =
                error instanceof Error
                    ? error
                    : new Error("Stdin control failed", { cause: error });
            shutdownController.abort();
        });
        logWorkerEvent("call_worker_ready");
        try {
            await running;
            if (controlFailure) throw controlFailure;
        } finally {
            await worker.close();
            input.close();
            await controls;
        }
        logWorkerEvent("call_worker_stopped");
    } finally {
        process.removeListener("SIGINT", shutdown);
        process.removeListener("SIGTERM", shutdown);
        input.close();
        process.stdin.pause();
        await runtime?.close();
    }
}

main().catch((error: unknown) => {
    logWorkerEvent("call_worker_failed", {
        message: error instanceof Error ? error.message : "Unknown call worker failure",
    });
    process.exitCode =
        error instanceof CallWorkerConfigError
            ? 64
            : error instanceof LocalBackendError
              ? (error.exitCode ?? 1)
              : 1;
});
