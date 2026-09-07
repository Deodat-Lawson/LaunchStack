/// <reference lib="es2024.promise" />
import type * as NextServerModule from "next/server";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { EventEmitter, once } from "node:events";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { CallNotesTestDatabase } from "./testDb";
import type { StructuredOutputOptions } from "@launchstack/llm";
import { sql } from "drizzle-orm";

import {
    CALL_NOTES_ENRICHMENT_PROPOSAL,
    CALL_NOTES_SCHEMA_VERSION,
    CallSnapshotSchema,
    createPostgresCallNotesApplication,
    renderEnrichedNoteProposal,
    type CallSnapshot,
} from "@launchstack/pipelines/call-notes";

const mockWorkspacePermission = jest.fn();
const mockInvokeStructured = jest.fn<Promise<unknown>, unknown[]>();
const mockAfterTasks: Promise<void>[] = [];
jest.mock("next/server", () => ({
    ...jest.requireActual<typeof NextServerModule>("next/server"),
    after: (task: () => Promise<void>) => {
        mockAfterTasks.push(Promise.resolve().then(task));
    },
}));
let mockTestDb: CallNotesTestDatabase | undefined;
const mockServerEnv = {
    CALL_NOTES_CAPTURE_ENABLED: true,
    CALL_NOTES_INTERNAL_TOKEN: "explicit-capture-e2e-token",
    CALL_NOTES_LOCAL_COMPANY_ID: "1",
    CALL_NOTES_LOCAL_USER_ID: "explicit-capture-owner",
};

jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockTestDb!.db }) }));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: (...args: unknown[]): unknown => mockWorkspacePermission(...args),
}));
jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: () => ({ name: "fixture", modelId: "deterministic-enrichment" }),
}));
jest.mock("@launchstack/llm", () => ({
    invokeStructured: (...args: unknown[]) => mockInvokeStructured(...args),
}));

import {
    configureWebCallNotesApplication,
    createWebCallNotesDocumentNoteStore,
    createWebCallNotesMembershipStore,
} from "~/server/call-notes/application";
import { LocalDetectedCallSource } from "~/server/call-notes/detected-calls";
import { POST as productCommand, GET as listCalls } from "~/app/api/call-notes/route";
import { GET as getCall } from "~/app/api/call-notes/[callId]/route";
import { GET as getEnrichmentStream } from "~/app/api/call-notes/[callId]/enrichment/stream/route";
import { EnrichmentStreamEventSchema } from "~/lib/call-notes-enrichment-stream";
import { POST as workerIngress } from "~/app/api/internal/call-notes/local/route";
import { GET as listCallFiles } from "~/app/api/call-notes/files/route";
import { GET as getWorkerStatus } from "~/app/api/call-notes/worker/route";
import { CallWorkerRuntime } from "../../../call-worker/src/worker";
import type { CallWorkerConfig } from "../../../call-worker/src/config";
import type { AudioSource, PcmFrame } from "../../../call-worker/src/local/audio";
import { OpenAiCompatibleTranscriptionModel } from "../../../call-worker/src/local/transcription";
import { createCallNotesTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;
const OWNER = mockServerEnv.CALL_NOTES_LOCAL_USER_ID;
const MICROPHONE_TEXT = "I will send the revised onboarding checklist by Friday.";
const SYSTEM_TEXT = "We need to reduce onboarding time before the September launch.";
const proposal = {
    ...CALL_NOTES_ENRICHMENT_PROPOSAL,
};

/** The only audio substitution: controlled PCM instead of accessing the test machine's devices. */
class ControlledAudioSource implements AudioSource {
    opened = 0;
    closed = 0;
    readonly consumed = Promise.withResolvers<void>();
    private delivered = 0;
    private readonly queue: PcmFrame[] = [];
    private notify: (() => void) | undefined;

    speech(sample: number): void {
        const origin = Date.now();
        for (let index = 0; index < 3; index += 1) {
            const pcm = new Uint8Array(640);
            const view = new DataView(pcm.buffer);
            for (let offset = 0; offset < pcm.length; offset += 2)
                view.setInt16(offset, sample, true);
            this.queue.push({ pcm, capturedAt: new Date(origin + index * 20), durationMs: 20 });
        }
        this.notify?.();
    }

    async *frames(signal: AbortSignal): AsyncIterable<PcmFrame> {
        this.opened += 1;
        const wake = () => this.notify?.();
        signal.addEventListener("abort", wake);
        try {
            yield { pcm: new Uint8Array(640), capturedAt: new Date(), durationMs: 20 };
            while (!signal.aborted) {
                const frame = this.queue.shift();
                if (frame) {
                    yield frame;
                    this.delivered += 1;
                    if (this.delivered === 3) this.consumed.resolve();
                } else {
                    const waiting = Promise.withResolvers<void>();
                    this.notify = waiting.resolve;
                    await waiting.promise;
                }
            }
        } finally {
            signal.removeEventListener("abort", wake);
            for (const frame of this.queue.splice(0)) frame.pcm.fill(0);
            this.closed += 1;
        }
    }
}

async function eventually<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 15_000;
    let value = await read();
    while (!ready(value)) {
        if (Date.now() >= deadline)
            throw new Error(`Capture condition timed out: ${JSON.stringify(value)}`);
        await yieldEventLoop();
        value = await read();
    }
    return value;
}

async function seedOwner(): Promise<void> {
    await mockTestDb!.db.execute(sql`
        INSERT INTO "pdr_ai_v2_company" ("name", "numberOfEmployees")
        VALUES ('Explicit Capture E2E', '5')
    `);
    const users = await mockTestDb!.db.execute(sql`
        INSERT INTO "pdr_ai_v2_users" ("name", "email", "userId", "company_id", "role", "status")
        VALUES (${OWNER}, 'explicit-capture@example.test', ${OWNER}, 1, 'owner', 'active')
        RETURNING "id"
    `);
    await mockTestDb!.db.execute(sql`
        INSERT INTO "pdr_ai_v2_user_company_memberships" ("user_id", "company_id", "role")
        VALUES (${BigInt(String(users[0]!.id))}, 1, 'owner')
    `);
}

interface HttpTestHost {
    server: Server;
    origin: string;
    polls: number;
    events: EventEmitter;
}

/** Real HTTP transport terminating at production handlers, with only auth and external models substituted. */
async function startHttpHost(): Promise<HttpTestHost> {
    const server = createServer((incoming, outgoing) => {
        void (async () => {
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of incoming as AsyncIterable<Buffer>) chunks.push(chunk);
                const url = new URL(incoming.url!, "http://127.0.0.1");
                const request = new Request(url, {
                    method: incoming.method,
                    headers: incoming.headers as Record<string, string>,
                    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
                });
                let response: Response;
                if (url.pathname === "/api/internal/call-notes/local")
                    response = await workerIngress(request);
                else if (url.pathname === "/api/call-notes") {
                    response =
                        incoming.method === "POST"
                            ? await productCommand(request)
                            : await listCalls(request);
                } else if (url.pathname === "/api/call-notes/worker") {
                    response = await getWorkerStatus();
                } else if (url.pathname === "/api/call-notes/files") {
                    response = await listCallFiles();
                } else if (url.pathname.startsWith("/api/call-notes/")) {
                    response = await getCall(request, {
                        params: Promise.resolve({ callId: url.pathname.split("/").at(-1)! }),
                    });
                } else response = new Response("Not found", { status: 404 });
                outgoing.writeHead(response.status, Object.fromEntries(response.headers));
                outgoing.end(Buffer.from(await response.arrayBuffer()));
                const body: unknown = chunks.length
                    ? JSON.parse(Buffer.concat(chunks).toString())
                    : null;
                if (
                    url.pathname === "/api/internal/call-notes/local" &&
                    body !== null &&
                    typeof body === "object" &&
                    "kind" in body &&
                    body.kind === "poll"
                ) {
                    host.polls += 1;
                    host.events.emit("poll");
                }
            } catch (error) {
                outgoing.writeHead(500);
                outgoing.end(error instanceof Error ? error.message : String(error));
            }
        })();
    });
    const listening = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing E2E HTTP address");
    const host: HttpTestHost = {
        server,
        origin: `http://127.0.0.1:${address.port}`,
        polls: 0,
        events: new EventEmitter(),
    };
    return host;
}

function workerConfig(origin: string): CallWorkerConfig {
    return {
        captureEnabled: true,
        webOrigin: origin,
        internalToken: mockServerEnv.CALL_NOTES_INTERNAL_TOKEN,
        companyId: "1",
        userId: OWNER,
        ffmpegPath: "unused-fixture-source",
        audioInputFormat: "unused-fixture-source",
        audioInputDevice: "unused-fixture-source",
        systemAudioEnabled: true,
        systemAudioHelperPath: "unused-fixture-source",
        audioSampleRate: 16_000,
        audioFrameMs: 20,
        audioPreRollMs: 200,
        audioReadyTimeoutMs: 10_000,
        stopDrainTimeoutMs: 30_000,
        transcriptionTimeoutMs: 20_000,
        vadThreshold: 0.015,
        vadActivationFrames: 1,
        vadReleaseFrames: 2,
        utteranceMaxMs: 3_000,
        transcriptionProvider: "openai",
        transcriptionBaseUrl: "https://transcription.example.test/v1",
        transcriptionModel: "fixture-asr",
        transcriptionApiKey: "fixture-asr-token",
        autoEnrich: true,
    };
}

async function readEnrichmentEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const { done, value } = await reader.read();
    if (done) throw new Error("Enrichment stream ended before its expected event");
    const body: unknown = JSON.parse(new TextDecoder().decode(value).slice(6).trim());
    return EnrichmentStreamEventSchema.parse(body);
}

describeIfDatabase("Explicit local capture HTTP/PostgreSQL end-to-end", () => {
    let host: HttpTestHost | undefined;
    let runtime: CallWorkerRuntime | undefined;
    let runtimeRun: Promise<void> | undefined;
    let releaseModel: (() => void) | undefined;
    let releaseEnrichment: (() => void) | undefined;
    let enrichmentStreamAbort: AbortController | undefined;

    beforeEach(async () => {
        mockAfterTasks.length = 0;
        mockTestDb = await createCallNotesTestDatabase();
        await seedOwner();
        mockWorkspacePermission.mockResolvedValue({
            success: true,
            data: { authUserId: OWNER, companyId: 1n },
        });
        mockInvokeStructured.mockReset().mockResolvedValue(proposal);
        configureWebCallNotesApplication(
            createPostgresCallNotesApplication({
                db: mockTestDb.db,
                memberships: createWebCallNotesMembershipStore(mockTestDb.db),
                documentNotes: createWebCallNotesDocumentNoteStore(mockTestDb.db),
                detectedCalls: new LocalDetectedCallSource(),
                knowledgeSink: {
                    async upsert() {
                        throw new Error("Capture must not implicitly index a note");
                    },
                    async remove() {
                        throw new Error("Capture must not implicitly remove indexed notes");
                    },
                },
            })
        );
        host = await startHttpHost();
    }, 60_000);

    afterEach(async () => {
        releaseModel?.();
        releaseEnrichment?.();
        enrichmentStreamAbort?.abort();
        await runtime?.close();
        await runtimeRun?.catch(() => undefined);
        await Promise.allSettled(mockAfterTasks);
        if (host) {
            host.server.closeAllConnections();
            const closed = Promise.withResolvers<void>();
            host.server.close(error => (error ? closed.reject(error) : closed.resolve()));
            await closed.promise;
        }
        await mockTestDb?.close();
    });

    it("stays idle until Start, drains final words on Stop, finalizes and creates a reviewable AI proposal", async () => {
        const microphone = new ControlledAudioSource();
        const system = new ControlledAudioSource();
        const modelGate = Promise.withResolvers<void>();
        releaseModel = modelGate.resolve;
        const enrichmentGate = Promise.withResolvers<void>();
        releaseEnrichment = enrichmentGate.resolve;
        const section = proposal.chronologicalSections[0]!;
        const partialSection = {
            heading: section.heading,
            markdown: section.markdown.slice(0, 12),
        };
        mockInvokeStructured.mockImplementation(async (...args: unknown[]) => {
            await (args[3] as StructuredOutputOptions).onPartial?.({
                chronologicalSections: [partialSection],
            });
            await enrichmentGate.promise;
            return proposal;
        });
        const transcriptionStarted = Promise.withResolvers<void>();
        let transcriptionRequests = 0;
        const transcription = new OpenAiCompatibleTranscriptionModel({
            baseUrl: "https://transcription.example.test/v1",
            model: "fixture-asr",
            apiKey: "fixture-asr-token",
            fetch: async (_input, init) => {
                const form = init?.body as FormData;
                const audio = form.get("file") as Blob;
                const wav = new Uint8Array(await audio.arrayBuffer());
                expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
                const samples = new DataView(wav.buffer);
                let sample = 0;
                for (let offset = 44; offset < wav.byteLength; offset += 2) {
                    sample = Math.max(sample, samples.getInt16(offset, true));
                }
                transcriptionRequests += 1;
                if (transcriptionRequests === 2) transcriptionStarted.resolve();
                await modelGate.promise;
                await delay(1_250);
                return Response.json({ text: sample === 16_000 ? MICROPHONE_TEXT : SYSTEM_TEXT });
            },
        });
        const offline = await fetch(`${host!.origin}/api/call-notes/worker`);
        expect(await offline.json()).toMatchObject({ available: false });
        const unavailableStart = await fetch(`${host!.origin}/api/call-notes`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                requestId: randomUUID(),
                kind: "start_capture",
                sourceOccurrenceKey: randomUUID(),
            }),
        });
        expect(unavailableStart.status).toBe(503);
        runtime = new CallWorkerRuntime(workerConfig(host!.origin), {
            sources: { microphone, system },
            transcription,
        });
        runtimeRun = runtime.run();
        void runtimeRun.catch(() => undefined);

        const command = async (body: Record<string, unknown>): Promise<CallSnapshot> => {
            const response = await fetch(`${host!.origin}/api/call-notes`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    requestId: randomUUID(),
                    ...body,
                }),
            });
            const payload: unknown = await response.json();
            if (!response.ok)
                throw new Error(`Command HTTP ${response.status}: ${JSON.stringify(payload)}`);
            return CallSnapshotSchema.parse(payload);
        };
        const readCall = async (callId: string) => {
            const response = await fetch(`${host!.origin}/api/call-notes/${callId}`);
            if (!response.ok) throw new Error(`Read Call HTTP ${response.status}`);
            return CallSnapshotSchema.parse(await response.json());
        };

        // Observe completed control polls, not a guessed startup sleep.
        while (host!.polls < 2) await once(host!.events, "poll");
        expect(microphone.opened).toBe(0);
        expect(system.opened).toBe(0);
        const idleList = await fetch(`${host!.origin}/api/call-notes`);
        expect(await idleList.json()).toEqual([]);
        const available = await fetch(`${host!.origin}/api/call-notes/worker`);
        expect(await available.json()).toMatchObject({ available: true });

        const started = await command({
            kind: "start_capture",
            sourceOccurrenceKey: randomUUID(),
            title: "Explicit capture proof",
        });
        const live = await eventually(
            () => readCall(started.id),
            call => call.capture.lifecycle === "live"
        );
        expect(live.capture.attemptCount).toBe(1);
        microphone.speech(16_000);
        system.speech(8_000);
        await Promise.all([microphone.consumed.promise, system.consumed.promise]);

        const stopping = await command({ kind: "stop_capture", callId: live.id });
        expect(stopping.capture.desiredMode).toBe("stopped");
        await transcriptionStarted.promise;
        const draining = await readCall(live.id);
        expect(draining.status).toBe("finalizing");
        expect(draining.enrichment).toBeNull();
        expect(mockInvokeStructured).not.toHaveBeenCalled();
        await eventually(
            async () => microphone.closed + system.closed,
            closed => closed === 2
        );

        releaseModel();
        const completed = await eventually(
            () => readCall(live.id),
            call => call.status === "completed" && call.enrichment?.status === "generating"
        );
        expect(completed.transcript).toHaveLength(2);
        expect(completed.capture.outcome).toBe("complete");
        enrichmentStreamAbort = new AbortController();
        const stream = await getEnrichmentStream(
            new Request(
                `${host!.origin}/api/call-notes/${live.id}/enrichment/stream?run=${completed.enrichment!.id}`,
                { signal: enrichmentStreamAbort.signal }
            ),
            { params: Promise.resolve({ callId: live.id }) }
        );
        expect(stream.status).toBe(200);
        const reader = stream.body!.getReader();
        // Await real SSE frames from the PostgreSQL-backed runner, not a guessed sleep.
        let preview = await readEnrichmentEvent(reader);
        while (preview.type === "progress" && !preview.markdown) {
            preview = await readEnrichmentEvent(reader);
        }
        expect(preview).toMatchObject({
            type: "progress",
            status: "generating",
            markdown: `## ${partialSection.heading}\n\n${partialSection.markdown.trim()}`,
        });
        const duringGeneration = await readCall(live.id);
        expect(duringGeneration.enrichment?.proposal).toBeNull();
        expect(duringGeneration.note?.contentMarkdown).toBe("");
        releaseEnrichment();
        let final = await readEnrichmentEvent(reader);
        while (final.type === "progress") final = await readEnrichmentEvent(reader);
        if (final.type !== "complete") throw new Error(final.message);
        const ready = final.snapshot;
        expect((await reader.read()).done).toBe(true);
        expect(ready.status).toBe("completed");
        expect(ready.capture.outcome).toBe("complete");
        expect(
            ready.transcript.map(segment => [segment.audioChannel, segment.text]).sort()
        ).toEqual([
            ["microphone", MICROPHONE_TEXT],
            ["system", SYSTEM_TEXT],
        ]);
        expect(ready.transcript.every(segment => segment.participantId === null)).toBe(true);
        expect(ready.note?.contentMarkdown).toBe("");
        expect(ready.note?.knowledgeIncluded).toBe(false);
        expect(mockInvokeStructured).toHaveBeenCalledTimes(1);

        const rendered = renderEnrichedNoteProposal(proposal);
        const accepted = await command({
            kind: "accept_enrichment",
            callId: ready.id,
            enrichmentRunId: ready.enrichment!.id,
            ...rendered,
        });
        expect(accepted.note?.contentMarkdown).toBe(rendered.contentMarkdown);
        expect(accepted.note?.revision).toBe(1);
        expect(accepted.note?.knowledgeIncluded).toBe(false);
        const filesResponse = await fetch(`${host!.origin}/api/call-notes/files`);
        expect(filesResponse.status).toBe(200);
        expect(await filesResponse.json()).toEqual([
            expect.objectContaining({
                type: "call-note",
                callId: accepted.id,
                noteId: accepted.note!.documentNoteId,
                revision: accepted.note!.revision,
                title: accepted.note!.title,
            }),
        ]);
        const repeatedStop = await command({ kind: "stop_capture", callId: ready.id });
        expect(repeatedStop.status).toBe("completed");
        const idlePollTarget = host!.polls + 2;
        while (host!.polls < idlePollTarget) await once(host!.events, "poll");
        expect(microphone.opened).toBe(1);
        expect(system.opened).toBe(1);
    }, 30_000);
});
