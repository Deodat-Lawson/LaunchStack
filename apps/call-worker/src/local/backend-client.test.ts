import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { test } from "node:test";

import type { CaptureEvent, LocalCapturePollResult } from "@launchstack/pipelines/call-notes";

import {
    LocalBackendClient,
    type LocalBackendEventInput,
    type LocalBackendPollInput,
} from "./backend-client";

type RequestRecord = { body: unknown; authorization: string | undefined };
type RequestHandler = (
    request: IncomingMessage,
    response: ServerResponse,
    body: unknown
) => void | Promise<void>;

async function readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function abortReason(signal: AbortSignal | null | undefined): Error {
    const reason: unknown = signal?.reason;
    return reason instanceof Error ? reason : new Error("request aborted");
}

async function startServer(handler: RequestHandler): Promise<{ server: Server; origin: string }> {
    const server = createServer((request, response) => {
        void readJson(request)
            .then(body => handler(request, response, body))
            .catch((error: unknown) => {
                response.statusCode = 500;
                response.end(error instanceof Error ? error.message : String(error));
            });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
    );
}

const EVENT: CaptureEvent = {
    schemaVersion: "call-notes/v2",
    eventId: "event-fixed",
    kind: "attempt_connected",
    source: "local_audio",
    sourceOccurrenceKey: "occurrence-fixed",
    sourceAttemptKey: "attempt-fixed",
    sourceStreamKey: "local-audio",
    occurredAt: "2026-08-20T10:00:00.000Z",
};

const COMPANY_ID = "42";
const USER_ID = "user-7";
const CALL_ID = "call-fixed";

function pollInput(workerId = "worker-fixed"): LocalBackendPollInput {
    return { companyId: COMPANY_ID, userId: USER_ID, workerId };
}

function pollResult(callId = CALL_ID): LocalCapturePollResult {
    return {
        capture: {
            callId,
            captureId: "capture-fixed",
            occurrenceKey: "occurrence-fixed",
            attemptKey: "attempt-fixed",
            startedAt: "2026-08-20T10:00:00.000Z",
            title: "Local call",
            desiredMode: "running",
        },
    };
}

function eventInput(callId: string = CALL_ID): LocalBackendEventInput {
    return { companyId: COMPANY_ID, userId: USER_ID, callId, event: EVENT };
}

await test("LocalBackendClient sends authenticated poll, event, and finish tenant bodies", async () => {
    const requests: RequestRecord[] = [];
    const { server, origin } = await startServer(async (request, response, body) => {
        requests.push({ body, authorization: request.headers.authorization });
        const kind =
            body !== null &&
            typeof body === "object" &&
            "kind" in body &&
            typeof body.kind === "string"
                ? body.kind
                : "unknown";
        if (kind === "poll") response.end(JSON.stringify(pollResult()));
        else response.end(JSON.stringify({ ok: true }));
    });
    try {
        const client = new LocalBackendClient({ webOrigin: origin, token: "worker-secret" });
        const polled = await client.poll(pollInput());
        await client.event(eventInput());
        await client.finish({
            companyId: COMPANY_ID,
            userId: USER_ID,
            callId: CALL_ID,
            autoEnrich: true,
        });

        assert.deepEqual(polled, pollResult());
        assert.deepEqual(
            requests.map(request => request.body),
            [
                { kind: "poll", ...pollInput() },
                { kind: "event", ...eventInput() },
                {
                    kind: "finish",
                    companyId: COMPANY_ID,
                    userId: USER_ID,
                    callId: CALL_ID,
                    autoEnrich: true,
                },
            ]
        );
        assert.deepEqual(
            requests.map(request => request.authorization),
            ["Bearer worker-secret", "Bearer worker-secret", "Bearer worker-secret"]
        );
    } finally {
        await stopServer(server);
    }
});

await test("LocalBackendClient surfaces non-2xx responses and response detail", async () => {
    const { server, origin } = await startServer(async (_request, response) => {
        response.statusCode = 409;
        response.end("capture conflict");
    });
    try {
        const client = new LocalBackendClient({ webOrigin: origin, token: "worker-secret" });
        await assert.rejects(client.poll(pollInput()), /HTTP 409: capture conflict/);
    } finally {
        await stopServer(server);
    }
});

await test("LocalBackendClient validates shared poll responses", async () => {
    let malformed = false;
    const { server, origin } = await startServer(async (_request, response) => {
        if (malformed) response.end("not json");
        else response.end(JSON.stringify({ capture: { callId: "missing" } }));
    });
    try {
        const client = new LocalBackendClient({ webOrigin: origin, token: "worker-secret" });
        await assert.rejects(client.poll(pollInput()), /capture|expected/i);
        malformed = true;
        await assert.rejects(client.poll(pollInput()), /invalid JSON/);
    } finally {
        await stopServer(server);
    }
});

await test("LocalBackendClient retries transport refusal and HTTP 503 before recovering", async () => {
    const attempts: string[] = [];
    const delays: number[] = [];
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        random: () => 0.5,
        sleep: async milliseconds => {
            delays.push(milliseconds);
        },
        fetch: async (_url, init) => {
            attempts.push(typeof init?.body === "string" ? init.body : "");
            if (attempts.length === 1) {
                throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
            }
            if (attempts.length === 2)
                return new Response("temporarily unavailable", { status: 503 });
            return Response.json(pollResult());
        },
    });

    assert.deepEqual(await client.poll(pollInput()), pollResult());
    assert.equal(attempts.length, 3);
    assert.equal(new Set(attempts).size, 1);
    assert.deepEqual(delays, [125, 250]);
});

await test("LocalBackendClient never retries validation and authorization responses", async () => {
    for (const status of [400, 401, 403]) {
        let calls = 0;
        const client = new LocalBackendClient({
            webOrigin: "http://localhost:3000",
            token: "worker-secret",
            sleep: async () => assert.fail("non-retryable responses must not back off"),
            fetch: async () => {
                calls += 1;
                return new Response("invalid request", { status });
            },
        });

        await assert.rejects(
            client.event(eventInput()),
            error =>
                error instanceof Error &&
                error.name === "LocalBackendError" &&
                "retryable" in error &&
                error.retryable === false &&
                "status" in error &&
                error.status === status
        );
        assert.equal(calls, 1);
    }
});

await test("LocalBackendClient event and finish exhaust their finite retry budgets", async () => {
    for (const kind of ["event", "finish"] as const) {
        let elapsed = 0;
        let calls = 0;
        const delays: number[] = [];
        const client = new LocalBackendClient({
            webOrigin: "http://localhost:3000",
            token: "worker-secret",
            retryBudgetMs: 1_000,
            random: () => 0.5,
            now: () => elapsed,
            sleep: async milliseconds => {
                elapsed += milliseconds;
                delays.push(milliseconds);
            },
            onRetry: () => undefined,
            fetch: async () => {
                calls += 1;
                return new Response("overloaded", { status: 503 });
            },
        });
        const request =
            kind === "event"
                ? client.event(eventInput())
                : client.finish({
                      companyId: COMPANY_ID,
                      userId: USER_ID,
                      callId: CALL_ID,
                      autoEnrich: false,
                  });

        await assert.rejects(
            request,
            error =>
                error instanceof Error &&
                error.name === "LocalBackendError" &&
                "retryable" in error &&
                error.retryable === true &&
                "exhausted" in error &&
                error.exhausted === true &&
                "status" in error &&
                error.status === 503
        );
        assert.equal(calls, 4);
        assert.equal(elapsed, 1_000);
        assert.deepEqual(delays, [125, 250, 500, 125]);
    }
});

await test("LocalBackendClient poll keeps retrying beyond the delivery budget with capped jitter", async () => {
    let elapsed = 0;
    let calls = 0;
    const delays: number[] = [];
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        retryBudgetMs: 1_000,
        random: () => 0.5,
        now: () => elapsed,
        sleep: async milliseconds => {
            elapsed += 40_000;
            delays.push(milliseconds);
        },
        onRetry: () => undefined,
        fetch: async () => {
            calls += 1;
            if (calls <= 8) return new Response("busy", { status: 429 });
            return Response.json({ capture: null });
        },
    });

    assert.deepEqual(await client.poll(pollInput()), { capture: null });
    assert.equal(calls, 9);
    assert.ok(elapsed > 120_000);
    assert.deepEqual(delays, [125, 250, 500, 1_000, 2_000, 2_500, 2_500, 2_500]);
});

await test("LocalBackendClient retries a timed-out request", async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        timeoutMs: 5,
        sleep: async () => undefined,
        onRetry: () => undefined,
        fetch: async (_url, init) => {
            calls += 1;
            if (calls > 1) return Response.json({ capture: null });
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(abortReason(init.signal)), {
                    once: true,
                });
            });
        },
    });

    const pending = client.poll(pollInput());
    context.mock.timers.tick(5);
    assert.deepEqual(await pending, { capture: null });
    assert.equal(calls, 2);
});

await test("LocalBackendClient never retries invalid JSON", async () => {
    let calls = 0;
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        fetch: async () => {
            calls += 1;
            return new Response("not json");
        },
    });

    await assert.rejects(
        client.poll(pollInput()),
        error =>
            error instanceof Error &&
            error.message.includes("invalid JSON") &&
            "retryable" in error &&
            error.retryable === false
    );
    assert.equal(calls, 1);
});

await test("LocalBackendClient caller abort cancels retry backoff without another request", async () => {
    let calls = 0;
    const controller = new AbortController();
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        onRetry: () => undefined,
        sleep: async () => {
            const reason = new Error("caller stopped polling");
            controller.abort(reason);
            throw reason;
        },
        fetch: async () => {
            calls += 1;
            return new Response("busy", { status: 503 });
        },
    });

    await assert.rejects(
        client.poll(pollInput(), controller.signal),
        error =>
            error instanceof Error &&
            error.message.includes("caller stopped polling") &&
            "retryable" in error &&
            error.retryable === false
    );
    assert.equal(calls, 1);
});

await test("LocalBackendClient event and finish retry the identical idempotent request after recovery", async () => {
    const requests: string[] = [];
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        sleep: async () => undefined,
        onRetry: () => undefined,
        fetch: async (_url, init) => {
            requests.push(typeof init?.body === "string" ? init.body : "");
            if (requests.length === 1) return new Response("busy", { status: 429 });
            if (requests.length === 3) return new Response("restarting", { status: 503 });
            return Response.json({ ok: true });
        },
    });

    await client.event(eventInput());
    await client.finish({
        companyId: COMPANY_ID,
        userId: USER_ID,
        callId: CALL_ID,
        autoEnrich: true,
    });
    assert.equal(requests.length, 4);
    assert.equal(requests[0], requests[1]);
    assert.equal(requests[2], requests[3]);
});

await test("LocalBackendClient a broken unauthorized response body is still not retryable", async () => {
    let calls = 0;
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        sleep: async () => assert.fail("authorization must not be retried"),
        fetch: async () => {
            calls += 1;
            const response = new Response("Unauthorized", { status: 401 });
            Object.defineProperty(response, "text", {
                value: async () => {
                    throw new Error("ECONNRESET");
                },
            });
            return response;
        },
    });

    await assert.rejects(
        client.poll(pollInput()),
        error =>
            error instanceof Error &&
            "retryable" in error &&
            error.retryable === false &&
            "status" in error &&
            error.status === 401
    );
    assert.equal(calls, 1);
});

await test("LocalBackendClient a caller abort during fetch never retries the request", async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    const controller = new AbortController();
    const client = new LocalBackendClient({
        webOrigin: "http://localhost:3000",
        token: "worker-secret",
        fetch: async (_url, init) => {
            calls += 1;
            controller.abort(new Error("capture revoked"));
            return new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                const abort = (): void => reject(abortReason(signal));
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
            });
        },
    });
    const pending = client.event(eventInput(), controller.signal);
    context.mock.timers.tick(30_000);

    await assert.rejects(
        pending,
        error =>
            error instanceof Error &&
            error.message.includes("capture revoked") &&
            "retryable" in error &&
            error.retryable === false
    );
    assert.equal(calls, 1);
});
