import type * as NextServerModule from "next/server";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import type { CallNotesTestDatabase } from "./testDb";
import type { StructuredOutputOptions } from "@launchstack/llm";
import type * as LlmModule from "@launchstack/llm";
import { sql } from "drizzle-orm";
import { z } from "zod";

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
const mockCallNoteSync = jest.fn<Promise<void>, [{ companyId: string; callId: string }]>();
const mockTranscribe = jest.fn<
    Promise<{ text: string; language?: string }>,
    [{ audioWav: Uint8Array; language?: string }]
>();
const mockAfterTasks: Promise<void>[] = [];
jest.mock("next/server", () => ({
    ...jest.requireActual<typeof NextServerModule>("next/server"),
    after: (task: () => Promise<void>) => {
        mockAfterTasks.push(Promise.resolve().then(task));
    },
}));
let mockTestDb: CallNotesTestDatabase | undefined;
const mockServerEnv = { CALL_NOTES_CAPTURE_ENABLED: true };

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
    resolveConfiguredChatRoute: () => ({ definition: { behavior: {} } }),
    resolveConfiguredChatModel: () => ({
        name: "fixture",
        modelId: "deterministic-enrichment",
        behavior: {},
    }),
}));
jest.mock("@launchstack/llm", () => ({
    ...jest.requireActual<typeof LlmModule>("@launchstack/llm"),
    invokeStructured: (...args: unknown[]) => mockInvokeStructured(...args),
}));
jest.mock("~/server/call-notes/transcription", () => ({
    transcribeCallNotesAudio: (input: { audioWav: Uint8Array; language?: string }) =>
        mockTranscribe(input),
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
import { POST as createConnectCode } from "~/app/api/call-notes/capture-app/connect-codes/route";
import { POST as pairDevice } from "~/app/api/call-notes/devices/pair/route";
import { POST as transcribeAudio } from "~/app/api/call-notes/devices/transcribe/route";
import { DELETE as revokeDevice } from "~/app/api/call-notes/devices/[deviceId]/route";
import { CallWorkerRuntime } from "../../../call-worker/src/worker";
import { loadCallWorkerConfig, type CallWorkerConfig } from "../../../call-worker/src/config";
import type { AudioSource, PcmFrame } from "../../../call-worker/src/local/audio";
import { LocalBackendClient } from "../../../call-worker/src/local/backend-client";
import { createCallNotesTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;
const OWNER = "explicit-capture-owner";
const MICROPHONE_TEXT = "I will send the revised onboarding checklist by Friday.";
const SYSTEM_TEXT = "We need to reduce onboarding time before the September launch.";
const proposal = {
    ...CALL_NOTES_ENRICHMENT_PROPOSAL,
};

// Keep this test host compatible with the web image's Node 20 runtime.
function deferred() {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

/** The only audio substitution: controlled PCM instead of accessing the test machine's devices. */
class ControlledAudioSource implements AudioSource {
    opened = 0;
    closed = 0;
    private readonly queue: PcmFrame[] = [];
    private notify: (() => void) | undefined;

    speech(sample: number, silenceFrames = 0): void {
        const origin = Date.now();
        for (let index = 0; index < 3; index += 1) {
            const pcm = new Uint8Array(640);
            const view = new DataView(pcm.buffer);
            for (let offset = 0; offset < pcm.length; offset += 2)
                view.setInt16(offset, sample, true);
            this.queue.push({ pcm, capturedAt: new Date(origin + index * 20), durationMs: 20 });
        }
        for (let index = 0; index < silenceFrames; index += 1) {
            this.queue.push({
                pcm: new Uint8Array(640),
                capturedAt: new Date(origin + (3 + index) * 20),
                durationMs: 20,
            });
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
                } else {
                    const waiting = deferred();
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
    pendingLongPolls: number;
    ingressAvailable: boolean;
    transcriptionChannels: string[];
}

/** Real production handlers over HTTP; session identity and external models are the only server substitutions. */
async function startHttpHost(): Promise<HttpTestHost> {
    const server = createServer((incoming, outgoing) => {
        void (async () => {
            let longPoll = false;
            const controller = new AbortController();
            outgoing.once("close", () => controller.abort());
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of incoming as AsyncIterable<Buffer>) chunks.push(chunk);
                const url = new URL(incoming.url!, `http://${incoming.headers.host!}`);
                const request = new Request(url, {
                    method: incoming.method,
                    headers: incoming.headers as Record<string, string>,
                    signal: controller.signal,
                    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
                });
                const body: unknown =
                    chunks.length && incoming.headers["content-type"]?.startsWith("application/json")
                        ? JSON.parse(Buffer.concat(chunks).toString())
                        : null;
                const poll =
                    url.pathname === "/api/internal/call-notes/local" &&
                    body !== null &&
                    typeof body === "object" &&
                    "kind" in body &&
                    body.kind === "poll";
                longPoll = poll && "wait" in body && body.wait === true;
                if (longPoll) host.pendingLongPolls += 1;
                let response: Response;
                if (url.pathname === "/api/internal/call-notes/local") {
                    response = host.ingressAvailable
                        ? await workerIngress(request)
                        : Response.json({ error: "fixture_ingress_outage" }, { status: 503 });
                } else if (url.pathname === "/api/call-notes/capture-app/connect-codes") {
                    response = await createConnectCode(request);
                } else if (url.pathname === "/api/call-notes/devices/pair") {
                    response = await pairDevice(request);
                } else if (url.pathname === "/api/call-notes/devices/transcribe") {
                    const form = await request.clone().formData();
                    host.transcriptionChannels.push(String(form.get("channel")));
                    response = await transcribeAudio(request);
                } else if (url.pathname.startsWith("/api/call-notes/devices/")) {
                    response = await revokeDevice(request, {
                        params: Promise.resolve({ deviceId: url.pathname.split("/").at(-1)! }),
                    });
                } else if (url.pathname === "/api/call-notes") {
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
                if (poll) host.polls += 1;
            } catch (error) {
                if (!outgoing.destroyed) {
                    outgoing.writeHead(500);
                    outgoing.end(error instanceof Error ? error.message : String(error));
                }
            } finally {
                if (longPoll) host.pendingLongPolls -= 1;
            }
        })();
    });
    const listening = deferred();
    server.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing E2E HTTP address");
    const host: HttpTestHost = {
        server,
        origin: `http://127.0.0.1:${address.port}`,
        polls: 0,
        pendingLongPolls: 0,
        ingressAvailable: true,
        transcriptionChannels: [],
    };
    return host;
}

const PairedDeviceSchema = z.object({
    deviceId: z.string(),
    token: z.string().regex(/^lsc_[A-Za-z0-9_-]{43}$/),
    origin: z.string().url(),
    user: z.object({ id: z.string() }),
    company: z.object({ id: z.string() }),
});
type PairedDevice = z.infer<typeof PairedDeviceSchema>;

async function pairCaptureDevice(origin: string): Promise<PairedDevice> {
    const mint = await fetch(`${origin}/api/call-notes/capture-app/connect-codes`, {
        method: "POST",
    });
    expect(mint.status).toBe(201);
    const { code, deepLink } = z
        .object({ code: z.string(), deepLink: z.string() })
        .parse(await mint.json());
    expect(new URL(deepLink).searchParams.get("origin")).toBe(origin);
    expect(new URL(deepLink).searchParams.get("code")).toBe(code);
    const paired = await fetch(`${origin}/api/call-notes/devices/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            code,
            name: "Capture E2E Mac",
            appVersion: "1.0.0",
            os: "macos",
            arch: "arm64",
        }),
    });
    expect(paired.status).toBe(201);
    const device = PairedDeviceSchema.parse(await paired.json());
    expect(device).toMatchObject({ origin, user: { id: OWNER }, company: { id: "1" } });
    return device;
}

function workerConfig(device: PairedDevice): CallWorkerConfig {
    return loadCallWorkerConfig(
        JSON.stringify({
            origin: device.origin,
            deviceToken: device.token,
            appVersion: "1.0.0",
            systemAudioHelperPath: "unused-fixture-source",
            vadActivationFrames: 1,
            vadReleaseFrames: 2,
            autoEnrich: true,
        })
    );
}

async function command(origin: string, body: Record<string, unknown>): Promise<CallSnapshot> {
    const response = await fetch(`${origin}/api/call-notes`, {
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
}

async function readCall(origin: string, callId: string): Promise<CallSnapshot> {
    const response = await fetch(`${origin}/api/call-notes/${callId}`);
    if (!response.ok) throw new Error(`Read Call HTTP ${response.status}`);
    return CallSnapshotSchema.parse(await response.json());
}

function peakSample(wav: Uint8Array): number {
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    const samples = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    let sample = 0;
    for (let offset = 44; offset < wav.byteLength; offset += 2)
        sample = Math.max(sample, samples.getInt16(offset, true));
    return sample;
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
    let applicationNow: Date | undefined;
    let device: PairedDevice;
    const originalAuthUrl = process.env.BETTER_AUTH_URL;

    beforeEach(async () => {
        runtime = undefined;
        runtimeRun = undefined;
        releaseModel = undefined;
        releaseEnrichment = undefined;
        enrichmentStreamAbort = undefined;
        applicationNow = undefined;
        mockAfterTasks.length = 0;
        mockTestDb = await createCallNotesTestDatabase();
        await seedOwner();
        mockWorkspacePermission.mockResolvedValue({
            success: true,
            data: { authUserId: OWNER, companyId: 1n, role: "owner" },
        });
        mockInvokeStructured.mockReset().mockResolvedValue(proposal);
        mockCallNoteSync.mockReset().mockResolvedValue(undefined);
        mockTranscribe.mockReset().mockResolvedValue({ text: MICROPHONE_TEXT });
        configureWebCallNotesApplication(
            createPostgresCallNotesApplication({
                db: mockTestDb.db,
                memberships: createWebCallNotesMembershipStore(mockTestDb.db),
                documentNotes: createWebCallNotesDocumentNoteStore(mockTestDb.db),
                detectedCalls: new LocalDetectedCallSource(),
                callNoteIndex: { sync: mockCallNoteSync },
                clock: { now: () => applicationNow ?? new Date() },
            })
        );
        host = await startHttpHost();
        process.env.BETTER_AUTH_URL = host.origin;
        device = await pairCaptureDevice(host.origin);
    }, 60_000);

    afterEach(async () => {
        releaseModel?.();
        releaseEnrichment?.();
        enrichmentStreamAbort?.abort();
        await runtime?.close();
        await runtimeRun?.catch(() => undefined);
        await Promise.allSettled(mockAfterTasks);
        if (host?.server.listening) {
            host.server.closeAllConnections();
            const closed = deferred();
            host.server.close(error => (error ? closed.reject(error) : closed.resolve()));
            await closed.promise;
        }
        await mockTestDb?.close();
        if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
        else process.env.BETTER_AUTH_URL = originalAuthUrl;
    });

    it("stays idle until Start, drains final words on Stop, finalizes and creates a reviewable AI proposal", async () => {
        mockCallNoteSync.mockRejectedValueOnce(new Error("fixture Call Note indexing failure"));
        const microphone = new ControlledAudioSource();
        const system = new ControlledAudioSource();
        const modelGate = deferred();
        releaseModel = modelGate.resolve;
        const enrichmentGate = deferred();
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
        const transcriptionStarted = deferred();
        let transcriptionRequests = 0;
        mockTranscribe.mockImplementation(async ({ audioWav }) => {
            const sample = peakSample(audioWav);
            transcriptionRequests += 1;
            if (transcriptionRequests === 2) transcriptionStarted.resolve();
            await modelGate.promise;
            return { text: sample === 16_000 ? MICROPHONE_TEXT : SYSTEM_TEXT };
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
        runtime = new CallWorkerRuntime(workerConfig(device), {
            sources: { microphone, system },
            emit: () => undefined,
            log: () => undefined,
        });
        runtimeRun = runtime.run();
        void runtimeRun.catch(() => undefined);

        // The real idle request is held, not a stream of short polls or a guessed sleep.
        await eventually(
            async () => host!.pendingLongPolls,
            pending => pending === 1
        );
        expect(host!.polls).toBe(0);
        expect(microphone.opened).toBe(0);
        expect(system.opened).toBe(0);
        const idleList = await fetch(`${host!.origin}/api/call-notes`);
        expect(await idleList.json()).toEqual([]);
        const available = await eventually(
            async () => (await fetch(`${host!.origin}/api/call-notes/worker`)).json() as Promise<{
                available: boolean;
            }>,
            status => status.available
        );
        expect(available).toMatchObject({ available: true });

        const started = await command(host!.origin, {
            kind: "start_capture",
            sourceOccurrenceKey: randomUUID(),
            title: "Explicit capture proof",
            targetDeviceId: device.deviceId,
        });
        const live = await eventually(
            () => readCall(host!.origin, started.id),
            call => call.capture.lifecycle === "live"
        );
        expect(live.capture.attemptCount).toBe(1);
        microphone.speech(16_000, 2);
        system.speech(8_000, 2);
        await transcriptionStarted.promise;
        expect(mockTranscribe).toHaveBeenCalledTimes(2);
        expect(host!.transcriptionChannels.sort()).toEqual(["microphone", "system"]);

        const stopping = await command(host!.origin, { kind: "stop_capture", callId: live.id });
        expect(stopping.capture.desiredMode).toBe("stopped");
        const draining = await readCall(host!.origin, live.id);
        expect(draining.status).toBe("finalizing");
        expect(draining.enrichment).toBeNull();
        expect(mockInvokeStructured).not.toHaveBeenCalled();
        await eventually(
            async () => microphone.closed + system.closed,
            closed => closed === 2
        );

        releaseModel();
        const completed = await eventually(
            () => readCall(host!.origin, live.id),
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
        const duringGeneration = await readCall(host!.origin, live.id);
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
        expect(mockCallNoteSync).toHaveBeenCalledTimes(1);
        expect(mockCallNoteSync).toHaveBeenCalledWith({
            companyId: "1",
            callId: ready.id,
        });
        expect(mockInvokeStructured).toHaveBeenCalledTimes(1);

        const rendered = renderEnrichedNoteProposal(proposal);
        const accepted = await command(host!.origin, {
            kind: "accept_enrichment",
            callId: ready.id,
            enrichmentRunId: ready.enrichment!.id,
            ...rendered,
        });
        expect(accepted.note?.contentMarkdown).toBe(rendered.contentMarkdown);
        expect(accepted.note?.revision).toBe(1);
        expect(mockCallNoteSync).toHaveBeenCalledTimes(2);
        expect(mockCallNoteSync).toHaveBeenLastCalledWith({
            companyId: "1",
            callId: accepted.id,
        });
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
        const repeatedStop = await command(host!.origin, { kind: "stop_capture", callId: ready.id });
        expect(repeatedStop.status).toBe("completed");
        await eventually(
            async () => host!.pendingLongPolls,
            pending => pending === 1
        );
        expect(microphone.opened).toBe(1);
        expect(system.opened).toBe(1);
    }, 30_000);

    it("keeps evidence before, during and after an HTTP ingress outage longer than the capture lease on one Call", async () => {
        const microphone = new ControlledAudioSource();
        const system = new ControlledAudioSource();
        const retryObserved = deferred();
        const duringAudioTranscribed = deferred();
        const beforeText = "We began the conversation before the backend outage.";
        const duringText = "These words were spoken while the backend was offline.";
        const afterText = "The conversation continued after the backend returned.";
        mockTranscribe.mockImplementation(async ({ audioWav }) => {
            const sample = peakSample(audioWav);
            if (sample === 12_000) duringAudioTranscribed.resolve();
            return {
                text: sample === 8_000 ? beforeText : sample === 12_000 ? duringText : afterText,
            };
        });
        const backend = new LocalBackendClient({
            origin: device.origin,
            deviceToken: device.token,
            appVersion: "1.0.0",
            timeoutMs: 1_000,
            retryBudgetMs: 10_000,
            retryBaseDelayMs: 10,
            retryMaxDelayMs: 20,
            random: () => 0.5,
            onRetry: () => {
                if (!host!.ingressAvailable) retryObserved.resolve();
            },
        });
        runtime = new CallWorkerRuntime(
            { ...workerConfig(device), autoEnrich: false },
            {
                sources: { microphone, system },
                backend,
                emit: () => undefined,
                log: () => undefined,
            }
        );
        let runtimeFailure: unknown;
        runtimeRun = runtime.run();
        void runtimeRun.catch(error => {
            runtimeFailure = error;
        });
        await eventually(
            async () => (await fetch(`${host!.origin}/api/call-notes/worker`)).json() as Promise<{
                available: boolean;
            }>,
            status => status.available
        );
        const started = await command(host!.origin, {
            kind: "start_capture",
            sourceOccurrenceKey: randomUUID(),
            title: "Capture continues through an ingress outage",
            targetDeviceId: device.deviceId,
        });
        const readSnapshot = () => readCall(host!.origin, started.id);
        await eventually(readSnapshot, call => call.capture.lifecycle === "live");
        microphone.speech(8_000, 2);
        const before = await eventually(readSnapshot, call => call.transcript.length === 1);
        expect(before.transcript[0]?.text).toBe(beforeText);

        // Only the control/evidence endpoint is unavailable. Server-side
        // transcription still runs through the real device route over HTTP.
        host!.ingressAvailable = false;
        microphone.speech(12_000, 2);
        await Promise.all([duringAudioTranscribed.promise, retryObserved.promise]);
        // Only the server clock jumps: the real client remains retrying while
        // its audio pipeline continues consuming and transcribing PCM.
        applicationNow = new Date(Date.now() + 16_000);
        const reaped = await readSnapshot();
        expect(reaped).toMatchObject({
            id: started.id,
            status: "active",
            capture: {
                desiredMode: "paused",
                pausedReason: "worker_error",
                lifecycle: "interrupted",
                activeAttemptId: null,
            },
        });
        expect(reaped.transcript.map(segment => segment.text)).toEqual([beforeText]);
        expect(reaped.gaps).toEqual([
            expect.objectContaining({ kind: "worker_unavailable", endedAt: null }),
        ]);
        host!.ingressAvailable = true;
        const recovered = await eventually(
            readSnapshot,
            call => call.transcript.length === 2 && call.capture.lifecycle === "live"
        );
        expect(recovered.gaps).toEqual([]);
        microphone.speech(16_000, 2);
        const live = await eventually(
            readSnapshot,
            call => call.transcript.length === 3 && call.capture.lifecycle === "live"
        );
        expect(runtimeFailure).toBeUndefined();
        expect(live).toMatchObject({
            id: started.id,
            status: "active",
            capture: {
                desiredMode: "running",
                pausedReason: null,
                lifecycle: "live",
                attemptCount: 1,
            },
            gaps: [],
        });
        expect(live.transcript.map(segment => segment.text)).toEqual([
            beforeText,
            duringText,
            afterText,
        ]);
        expect(
            live.transcript.every(segment => segment.attemptId === before.transcript[0]!.attemptId)
        ).toBe(true);
        expect(microphone.opened).toBe(1);
        expect(microphone.closed).toBe(0);
        const callsResponse = await fetch(`${host!.origin}/api/call-notes`);
        const calls = (await callsResponse.json()) as unknown[];
        expect(calls).toHaveLength(1);
    }, 30_000);

    it("automatically stops after both channels become quiet with stopReason silence", async () => {
        const microphone = new ControlledAudioSource();
        const system = new ControlledAudioSource();
        const autoStopPending = deferred();
        const autoStopped = deferred();
        let pending = false;
        runtime = new CallWorkerRuntime(
            { ...workerConfig(device), autoEnrich: false, silenceTimeoutMs: 25 },
            {
                sources: { microphone, system },
                emit: message => {
                    if (message.type === "auto_stop_pending") {
                        expect(message.reason).toBe("silence");
                        pending = true;
                        autoStopPending.resolve();
                    } else if (message.type === "state" && message.state === "idle" && pending) {
                        autoStopped.resolve();
                    }
                },
                log: () => undefined,
            }
        );
        runtimeRun = runtime.run();
        void runtimeRun.catch(() => undefined);
        await eventually(
            async () => (await fetch(`${host!.origin}/api/call-notes/worker`)).json() as Promise<{
                available: boolean;
            }>,
            status => status.available
        );
        const started = await command(host!.origin, {
            kind: "start_capture",
            sourceOccurrenceKey: randomUUID(),
            targetDeviceId: device.deviceId,
            title: "Quiet capture",
        });
        microphone.speech(16_000, 2);
        await autoStopPending.promise;
        expect((await readCall(host!.origin, started.id)).capture.desiredMode).toBe("running");
        // Exercise the production sixty-second cancellation window, not an injected pipeline.
        await autoStopped.promise;
        const stopped = await readCall(host!.origin, started.id);
        expect(stopped.status).toBe("completed");
        expect(stopped.capture).toMatchObject({
            desiredMode: "stopped",
            stopReason: "silence",
        });
        expect(microphone.closed).toBe(1);
        expect(system.closed).toBe(1);
        expect(mockTranscribe).toHaveBeenCalledTimes(1);
        expect(stopped.transcript).toEqual([
            expect.objectContaining({ audioChannel: "microphone", text: MICROPHONE_TEXT }),
        ]);
        expect(mockInvokeStructured).not.toHaveBeenCalled();
    }, 85_000);

    it("terminates a running worker with exit code 77 semantics after its device is revoked", async () => {
        const microphone = new ControlledAudioSource();
        const system = new ControlledAudioSource();
        runtime = new CallWorkerRuntime(
            { ...workerConfig(device), autoEnrich: false },
            {
                sources: { microphone, system },
                emit: () => undefined,
                log: () => undefined,
            }
        );
        runtimeRun = runtime.run();
        void runtimeRun.catch(() => undefined);
        await eventually(
            async () => (await fetch(`${host!.origin}/api/call-notes/worker`)).json() as Promise<{
                available: boolean;
            }>,
            status => status.available
        );
        const started = await command(host!.origin, {
            kind: "start_capture",
            sourceOccurrenceKey: randomUUID(),
            targetDeviceId: device.deviceId,
            title: "Revoked capture",
        });
        await eventually(
            () => readCall(host!.origin, started.id),
            call => call.capture.lifecycle === "live"
        );
        const revoked = await fetch(`${host!.origin}/api/call-notes/devices/${device.deviceId}`, {
            method: "DELETE",
        });
        expect(revoked.status).toBe(204);
        await expect(runtimeRun).rejects.toMatchObject({
            name: "LocalBackendError",
            status: 401,
            retryable: false,
            exitCode: 77,
        });
        expect(microphone.closed).toBe(1);
        expect(system.closed).toBe(1);
        expect(await (await fetch(`${host!.origin}/api/call-notes/worker`)).json()).toMatchObject({
            available: false,
            devices: [],
        });
    }, 30_000);
});
