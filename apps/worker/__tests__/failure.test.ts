/**
 * Behavioral pins for the dead-event failure hook (ADR-003 failure
 * visibility), successor to the retired web `processDocumentFailure` suite:
 * when a pipeline event exhausts its retries, the underlying OCR job is
 * marked failed (never clobbering a terminal success), and the document is
 * stamped with failure metadata — but only when the dead version is still
 * the document's current version.
 */
import { Column, Param, is } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaimedEvent } from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";
import { document, ocrJobs } from "@launchstack/store/schema";

type Predicate = { columns: string[]; params: unknown[] };

type UpdateRecord = {
    table: unknown;
    patch: Record<string, unknown>;
    predicate: Predicate;
    applied: boolean;
};

/**
 * Walk a drizzle condition tree collecting column names and bound parameter
 * values, so tests can assert the WHERE composition without a database.
 */
function inspectPredicate(value: unknown, acc: Predicate = { columns: [], params: [] }): Predicate {
    if (Array.isArray(value)) {
        for (const item of value) inspectPredicate(item, acc);
        return acc;
    }
    if (!value || typeof value !== "object") return acc;
    if (is(value, Column)) {
        acc.columns.push(value.name);
        return acc;
    }
    if (is(value, Param)) {
        acc.params.push(value.value);
        return acc;
    }
    const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) {
        for (const chunk of chunks) inspectPredicate(chunk, acc);
    }
    return acc;
}

const updates: UpdateRecord[] = [];
const getDbCalls = { count: 0 };

/**
 * Stateful fake: an update "applies" only when the captured WHERE params
 * match the row state, mirroring the real guards (job-status filter,
 * document current-version pointer).
 */
const state = {
    document: {
        id: 42,
        currentVersionId: 2n,
        ocrProcessed: true,
        ocrMetadata: { version: 2 } as unknown,
    },
    job: {
        id: "job-1",
        status: "processing",
        errorMessage: null as string | null,
        completedAt: null as Date | null,
    },
    documentUpdateError: null as Error | null,
};

const fakeDb = {
    update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
            where: async (condition: unknown) => {
                const predicate = inspectPredicate(condition);
                if (table === document && state.documentUpdateError) {
                    throw state.documentUpdateError;
                }
                let applied = false;
                if (table === document) {
                    applied =
                        predicate.params.includes(state.document.id) &&
                        predicate.params.includes(state.document.currentVersionId);
                    if (applied) Object.assign(state.document, patch);
                } else if (table === ocrJobs) {
                    applied =
                        predicate.params.includes(state.job.id) &&
                        predicate.params.includes(state.job.status);
                    if (applied) Object.assign(state.job, patch);
                }
                updates.push({ table, patch, predicate, applied });
                return undefined;
            },
        }),
    }),
};

vi.mock("@launchstack/store/client", () => ({
    getDb: () => {
        getDbCalls.count += 1;
        return fakeDb;
    },
}));

import { createDeadEventHandler } from "../src/ports/failure";

const JOB_BEARING_EVENTS = [
    "source.version.created",
    "evidence.version.extracted",
    "evidence.version.indexed",
] as const;

function makeClaimed(eventType: string, payload: Record<string, unknown>): ClaimedEvent {
    return {
        outboxId: 1,
        attemptCount: 8,
        event: {
            eventId: `${eventType}:test`,
            eventType,
            schemaVersion: "1",
            occurredAt: new Date().toISOString(),
            traceId: "trace-dead",
            companyId: 7,
            payload,
        } as unknown as ClaimedEvent["event"],
    };
}

function makeLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies LoggerPort;
}

function jobUpdates(): UpdateRecord[] {
    return updates.filter(u => u.table === ocrJobs);
}

function documentUpdates(): UpdateRecord[] {
    return updates.filter(u => u.table === document);
}

beforeEach(() => {
    updates.length = 0;
    getDbCalls.count = 0;
    state.document = {
        id: 42,
        currentVersionId: 2n,
        ocrProcessed: true,
        ocrMetadata: { version: 2 },
    };
    state.job = {
        id: "job-1",
        status: "processing",
        errorMessage: null,
        completedAt: null,
    };
    state.documentUpdateError = null;
    vi.clearAllMocks();
});

describe("createDeadEventHandler", () => {
    it("marks the OCR job failed for every job-bearing event type, truncating the error", async () => {
        const longError = "x".repeat(3000);

        for (const eventType of JOB_BEARING_EVENTS) {
            updates.length = 0;
            state.job = {
                id: `job-${eventType}`,
                status: "processing",
                errorMessage: null,
                completedAt: null,
            };
            const logger = makeLogger();

            await createDeadEventHandler(logger)(
                makeClaimed(eventType, { ocrJobId: `job-${eventType}` }),
                longError
            );

            const [jobUpdate] = jobUpdates();
            expect(jobUpdate, `no ocr_jobs update for ${eventType}`).toBeDefined();
            expect(jobUpdate!.applied).toBe(true);
            expect(state.job.status).toBe("failed");
            expect(state.job.completedAt).toBeInstanceOf(Date);
            expect(state.job.errorMessage).toMatch(/^pipeline dead after max attempts: x/);
            // The message is truncated so a giant stack can never blow the column.
            expect(state.job.errorMessage).toHaveLength(2000);
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    ocrJobId: `job-${eventType}`,
                    eventType,
                    traceId: "trace-dead",
                }),
                "marked OCR job failed after pipeline exhausted retries"
            );
        }
    });

    it("ignores non-job events entirely", async () => {
        const logger = makeLogger();
        const handler = createDeadEventHandler(logger);

        await handler(
            makeClaimed("note.embedding.requested", { noteId: 1, reason: "created" }),
            "dead"
        );
        await handler(
            makeClaimed("company.state.projected", {
                projection: "company-metadata",
            }),
            "dead"
        );

        expect(getDbCalls.count).toBe(0);
        expect(updates).toHaveLength(0);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("never clobbers a terminal success — the status filter only touches queued/processing/failed", async () => {
        state.job.status = "completed";
        const logger = makeLogger();

        await createDeadEventHandler(logger)(
            makeClaimed("source.version.created", { ocrJobId: "job-1" }),
            "late death"
        );

        const [jobUpdate] = jobUpdates();
        expect(jobUpdate).toBeDefined();
        // Structural pin on the WHERE: id + a status filter that admits only
        // the non-terminal-success states.
        expect(jobUpdate!.predicate.columns).toContain("status");
        expect(jobUpdate!.predicate.params).toEqual(
            expect.arrayContaining(["queued", "processing", "failed"])
        );
        expect(jobUpdate!.predicate.params).not.toContain("completed");
        // Behavioral pin: the completed row was not rewritten.
        expect(jobUpdate!.applied).toBe(false);
        expect(state.job.status).toBe("completed");
        expect(state.job.errorMessage).toBeNull();
    });

    it("handles a missing ocrJobId payload gracefully", async () => {
        const logger = makeLogger();

        await expect(
            createDeadEventHandler(logger)(makeClaimed("source.version.created", {}), "dead")
        ).resolves.toBeUndefined();

        expect(getDbCalls.count).toBe(0);
        expect(updates).toHaveLength(0);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("does not stamp the live document when the dead event is for a superseded version", async () => {
        const logger = makeLogger();

        // Version 1 died, but the document has moved on to version 2.
        await createDeadEventHandler(logger)(
            makeClaimed("source.version.created", {
                ocrJobId: "job-1",
                sourceId: 42,
                sourceVersionId: 1,
            }),
            "v1 died"
        );

        const [docUpdate] = documentUpdates();
        expect(docUpdate).toBeDefined();
        // The write is guarded on the current-version pointer…
        expect(docUpdate!.predicate.columns).toContain("current_version_id");
        expect(docUpdate!.predicate.params).toContain(1n);
        // …so the live document state stays untouched.
        expect(docUpdate!.applied).toBe(false);
        expect(state.document.ocrProcessed).toBe(true);
        expect(state.document.ocrMetadata).toEqual({ version: 2 });
        // The job itself is still marked failed.
        expect(state.job.status).toBe("failed");
    });

    it("stamps failure metadata on the document when the dead version is current", async () => {
        const logger = makeLogger();

        await createDeadEventHandler(logger)(
            makeClaimed("evidence.version.extracted", {
                ocrJobId: "job-1",
                sourceId: 42,
                sourceVersionId: 2,
            }),
            "v2 died"
        );

        const [docUpdate] = documentUpdates();
        expect(docUpdate).toBeDefined();
        expect(docUpdate!.applied).toBe(true);
        expect(state.document.ocrProcessed).toBe(false);
        expect(state.document.ocrMetadata).toEqual(
            expect.objectContaining({
                error: "processing_failed",
                errorMessage: expect.stringContaining("v2 died"),
                failedAt: expect.any(String),
            })
        );
        expect(state.job.status).toBe("failed");
    });

    it("leaves the document alone when the payload carries no source identifiers", async () => {
        const logger = makeLogger();

        await createDeadEventHandler(logger)(
            makeClaimed("source.version.created", { ocrJobId: "job-1" }),
            "dead"
        );

        expect(documentUpdates()).toHaveLength(0);
        expect(jobUpdates()).toHaveLength(1);
        expect(state.document.ocrProcessed).toBe(true);
    });

    it("logs and does not throw when the document write itself fails", async () => {
        state.documentUpdateError = new Error("connection lost");
        const logger = makeLogger();

        await expect(
            createDeadEventHandler(logger)(
                makeClaimed("source.version.created", {
                    ocrJobId: "job-1",
                    sourceId: 42,
                    sourceVersionId: 2,
                }),
                "v2 died"
            )
        ).resolves.toBeUndefined();

        // The job was still marked failed before the document write blew up…
        expect(state.job.status).toBe("failed");
        // …the failure was logged…
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ sourceId: 42, traceId: "trace-dead" }),
            "could not stamp document failure metadata"
        );
        // …and the terminal log still fired.
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ ocrJobId: "job-1" }),
            "marked OCR job failed after pipeline exhausted retries"
        );
    });
});
