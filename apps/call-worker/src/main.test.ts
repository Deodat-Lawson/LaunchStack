import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { WorkerMessage } from "./ipc";

const CONFIG = {
    origin: "http://localhost:3000",
    deviceToken: `lsc_${"a".repeat(43)}`,
    appVersion: "1.2.3",
    systemAudioHelperPath: "/bundled/launchstack-system-audio",
};

function startWorker(line?: string) {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
    });
    const done = Promise.withResolvers<{ code: number | null; stdout: string; stderr: string }>();
    child.once("error", error => done.reject(error));
    child.once("close", code => done.resolve({ code, stdout, stderr }));
    if (line === undefined) child.stdin.end();
    else child.stdin.write(`${line}\n`);
    return { child, completed: done.promise };
}

async function startBackend(
    handler: (response: ServerResponse) => void
): Promise<{ server: Server; origin: string }> {
    const server = createServer((request, response) => {
        assert.equal(request.url, "/api/internal/call-notes/local");
        assert.equal(request.headers.authorization, `Bearer ${CONFIG.deviceToken}`);
        assert.equal(request.headers["x-launchstack-capture-version"], CONFIG.appVersion);
        request.resume();
        request.once("end", () => handler(response));
    });
    const ready = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", ready.resolve);
    await ready.promise;
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function stopBackend(server: Server): Promise<void> {
    const stopped = Promise.withResolvers<void>();
    server.close(error => (error ? stopped.reject(error) : stopped.resolve()));
    server.closeAllConnections();
    await stopped.promise;
}

await test(
    "startup rejects missing, malformed or incomplete stdin configuration with exit 64",
    { timeout: 10_000 },
    async () => {
        for (const line of [
            undefined,
            "not json",
            "{}",
            JSON.stringify({ ...CONFIG, silenceTimeoutMs: 0 }),
        ]) {
            const worker = startWorker(line);
            try {
                const result = await worker.completed;
                assert.equal(result.code, 64);
                assert.equal(result.stdout, "");
                assert.match(result.stderr, /call_worker_failed/);
                assert.equal(result.stderr.includes(CONFIG.deviceToken), false);
            } finally {
                worker.child.kill();
            }
        }
    }
);

await test(
    "process exits 77 on 401 and 75 on 426 without retrying",
    { timeout: 10_000 },
    async () => {
        for (const [status, expected] of [
            [401, 77],
            [426, 75],
        ] as const) {
            let calls = 0;
            const { server, origin } = await startBackend(response => {
                calls += 1;
                response.writeHead(status).end(JSON.stringify({ error: "device rejected" }));
            });
            const worker = startWorker(JSON.stringify({ ...CONFIG, origin }));
            try {
                const result = await worker.completed;
                assert.equal(result.code, expected);
                assert.equal(calls, 1);
                const messages = result.stdout
                    .trim()
                    .split("\n")
                    .map(line => JSON.parse(line) as WorkerMessage);
                assert.deepEqual(
                    messages.map(message => message.type),
                    ["state"]
                );
                assert.equal(result.stderr.includes(CONFIG.deviceToken), false);
            } finally {
                worker.child.kill();
                await stopBackend(server);
            }
        }
    }
);

await test(
    "stdout contains only contract IPC while startup, retry and control logs use stderr",
    { timeout: 10_000 },
    async () => {
        const recovered = Promise.withResolvers<void>();
        let polls = 0;
        const { server, origin } = await startBackend(response => {
            polls += 1;
            if (polls === 1) response.writeHead(503).end("temporarily unavailable");
            else {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify({ capture: null }));
                recovered.resolve();
            }
        });
        const worker = startWorker(JSON.stringify({ ...CONFIG, origin }));
        try {
            await recovered.promise;
            worker.child.stdin.write(
                'not-json\n{"type":"keep_recording"}\n{"type":"call_ended_signal"}\n{"type":"shutdown"}\n'
            );
            const result = await worker.completed;
            assert.equal(result.code, 0);
            const lines = result.stdout.trim().split("\n");
            assert.ok(lines.length > 0);
            for (const line of lines) {
                const message = JSON.parse(line) as WorkerMessage;
                assert.ok(
                    ["state", "auto_stop_pending", "auto_stop_cancelled"].includes(message.type)
                );
                assert.equal("event" in message, false);
            }
            assert.match(result.stderr, /call_worker_ready/);
            assert.match(result.stderr, /call_worker_backend_retry/);
            assert.match(result.stderr, /call_worker_invalid_control/);
            assert.match(result.stderr, /call_worker_stopped/);
            assert.equal(result.stdout.includes(CONFIG.deviceToken), false);
            assert.equal(result.stderr.includes(CONFIG.deviceToken), false);
        } finally {
            worker.child.kill();
            await stopBackend(server);
        }
    }
);

await test(
    "config-file EOF keeps the worker alive and SIGTERM exits through graceful shutdown",
    { timeout: 10_000 },
    async () => {
        const polled = Promise.withResolvers<void>();
        const { server, origin } = await startBackend(response => {
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ capture: null }));
            polled.resolve();
        });
        const worker = startWorker(JSON.stringify({ ...CONFIG, origin }));
        worker.child.stdin.end();
        try {
            await polled.promise;
            assert.equal(worker.child.exitCode, null);
            worker.child.kill("SIGTERM");
            const result = await worker.completed;
            assert.equal(result.code, 0);
            assert.match(result.stderr, /call_worker_stopped/);
        } finally {
            worker.child.kill();
            await stopBackend(server);
        }
    }
);
