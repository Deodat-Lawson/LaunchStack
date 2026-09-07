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
