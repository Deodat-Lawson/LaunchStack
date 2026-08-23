import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";

import { createDb, type Db } from "@launchstack/core/db";
import {
    CallNotesWorkItems,
    callNotesCalls,
    callNotesCaptures,
    createPostgresCallNotesApplication,
    type CallNotesApplication,
    type CallNotesDocumentNoteStore,
    type CallNotesMembershipStore,
    type CaptureAttemptHandle,
    type KnowledgeNoteSink,
    type StartCaptureInput,
} from "@launchstack/features/call-notes";

import type { CallWorkerConfig } from "./config";
import { ZoomAutoStartCaptureSource, type ZoomRtmsStartedPayload } from "./zoom/capture-source";
import { ZoomStartedStreamRegistry } from "./zoom/started-stream-registry";

interface ZoomProviderWorkPayload {
    source: "zoom_webhook";
    event: string;
    payload: Record<string, unknown>;
}

interface CaptureTarget {
    companyId: string;
    occurrenceKey: string;
    captureUserConnectionId: string;
    captureUserProviderKey: string;
}

const unavailableDocumentNotes: CallNotesDocumentNoteStore = {
    async create() {
        throw new Error("Document Note writes are unavailable in call-worker");
    },
    async get() {
        throw new Error("Document Note reads are unavailable in call-worker");
    },
    async update() {
        throw new Error("Document Note writes are unavailable in call-worker");
    },
    async delete() {
        throw new Error("Document Note writes are unavailable in call-worker");
    },
};

const unavailableMemberships: CallNotesMembershipStore = {
    async getRole() {
        return null;
    },
};

const unavailableKnowledgeSink: KnowledgeNoteSink = {
    async upsert() {
        throw new Error("Knowledge writes are unavailable in call-worker");
    },
    async remove() {
        throw new Error("Knowledge writes are unavailable in call-worker");
    },
};

function parseProviderWork(value: Record<string, unknown>): ZoomProviderWorkPayload | null {
    if (value.source !== "zoom_webhook" || typeof value.event !== "string") return null;
    if (!value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) {
        return null;
    }
    return {
        source: "zoom_webhook",
        event: value.event,
        payload: value.payload as Record<string, unknown>,
    };
}

export class CallWorkerRuntime {
    private readonly database: Db;
    private readonly workItems: CallNotesWorkItems;
    private readonly application: CallNotesApplication;
    private readonly streams = new ZoomStartedStreamRegistry();
    private readonly source = new ZoomAutoStartCaptureSource(this.streams);
    private readonly activeHandles = new Map<string, CaptureAttemptHandle>();
    private readonly abort = new AbortController();

    constructor(private readonly config: CallWorkerConfig) {
        this.database = createDb({ url: config.databaseUrl, maxConnections: 4 });
        this.workItems = new CallNotesWorkItems(this.database.db);
        this.application = createPostgresCallNotesApplication({
            db: this.database.db,
            memberships: unavailableMemberships,
            documentNotes: unavailableDocumentNotes,
            knowledgeSink: unavailableKnowledgeSink,
            detectedCalls: {
                async list() {
                    return [];
                },
            },
        });
    }

    async run(): Promise<void> {
        while (!this.abort.signal.aborted) {
            const work = await this.workItems.claimNext(this.config.workerId, {
                kind: "provider_event",
                leaseMs: 30_000,
            });
            if (!work) {
                await delay(this.config.pollIntervalMs, undefined, {
                    signal: this.abort.signal,
                }).catch(() => undefined);
                continue;
            }

            try {
                const handled = await this.process(work.companyId.toString(), work.payload);
                if (!handled) {
                    await this.workItems.release(
                        work.id,
                        work.leaseToken,
                        new Date(Date.now() + this.config.pollIntervalMs)
                    );
                } else {
                    await this.workItems.complete(work.id, work.leaseToken);
                }
            } catch (error) {
                await this.workItems.fail(work.id, work.leaseToken, {
                    code: "zoom_provider_event_failed",
                    message:
                        error instanceof Error
                            ? error.message.slice(0, 1_024)
                            : "Unknown Zoom failure",
                });
            }
        }
    }

    async close(): Promise<void> {
        this.abort.abort();
        this.streams.close();
        await Promise.allSettled([...this.activeHandles.values()].map(handle => handle.dispose()));
        this.activeHandles.clear();
        await this.database.close();
    }

    private async process(
        companyId: string,
        rawPayload: Record<string, unknown>
    ): Promise<boolean> {
        const work = parseProviderWork(rawPayload);
        if (!work) return true;

        if (work.event === "meeting.rtms_started") {
            const payload = this.startedPayload(work.payload);
            const target = await this.captureTarget(companyId, payload.meeting_uuid);
            if (!target) return false;
            if (this.activeHandles.size >= this.config.maxConcurrentStreams) {
                throw new Error("Configured RTMS concurrency boundary is exhausted");
            }

            this.streams.publish(payload);
            const input: StartCaptureInput = {
                schemaVersion: "call-notes/v1",
                provider: "zoom",
                occurrenceKey: target.occurrenceKey,
                attemptKey: payload.rtms_stream_id,
                authorizationRef: target.captureUserConnectionId,
                captureUser: {
                    providerParticipantKey: target.captureUserProviderKey,
                    displayName: "Zoom Capture User",
                },
            };
            const handle = await this.source.startAttempt(input, {
                append: event => this.application.ingestCaptureEvent(target.companyId, event),
            });
            this.activeHandles.set(payload.rtms_stream_id, handle);
            return true;
        }

        if (work.event === "meeting.rtms_stopped") {
            const streamId =
                typeof work.payload.rtms_stream_id === "string"
                    ? work.payload.rtms_stream_id
                    : null;
            if (!streamId) return true;
            const handle = this.activeHandles.get(streamId);
            if (!handle) return true;
            await handle.dispose();
            this.activeHandles.delete(streamId);
        }

        return true;
    }

    private startedPayload(payload: Record<string, unknown>): ZoomRtmsStartedPayload {
        if (
            typeof payload.meeting_uuid !== "string" ||
            typeof payload.rtms_stream_id !== "string" ||
            typeof payload.server_urls !== "string"
        ) {
            throw new Error("Invalid meeting.rtms_started payload");
        }
        return payload as ZoomRtmsStartedPayload;
    }

    private async captureTarget(
        companyId: string,
        occurrenceKey: string
    ): Promise<CaptureTarget | null> {
        const [target] = await this.database.db
            .select({
                companyId: callNotesCalls.companyId,
                occurrenceKey: callNotesCalls.providerOccurrenceKey,
                captureUserConnectionId: callNotesCaptures.captureUserConnectionId,
                captureUserProviderKey: callNotesCaptures.captureUserProviderKey,
            })
            .from(callNotesCalls)
            .innerJoin(callNotesCaptures, eq(callNotesCaptures.callId, callNotesCalls.id))
            .where(
                and(
                    eq(callNotesCalls.companyId, BigInt(companyId)),
                    eq(callNotesCalls.provider, "zoom"),
                    eq(callNotesCalls.providerOccurrenceKey, occurrenceKey)
                )
            )
            .limit(1);
        if (!target) return null;
        return {
            companyId: target.companyId.toString(),
            occurrenceKey: target.occurrenceKey,
            captureUserConnectionId: target.captureUserConnectionId,
            captureUserProviderKey: target.captureUserProviderKey,
        };
    }
}
