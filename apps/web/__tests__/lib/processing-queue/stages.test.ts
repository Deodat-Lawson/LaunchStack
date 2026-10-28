/**
 * The Processing queue's stage logic: DB rows in, the six-stage item out.
 * The job's status first, then its outbox events (which half is live, and
 * whether it is waiting out a retry), then the progress the stages record
 * (`ocr_jobs.progress`) — trusted only when it belongs to the live attempt.
 */

import type { OcrJobProgress } from "@launchstack/store/schema";
import {
    buildQueueItem,
    queueEventIds,
    summarize,
    type BuildQueueItemInput,
    type QueueEventRow,
    type QueueJobRow,
} from "~/lib/processing-queue/stages";
import type { ProcessingQueueItem, QueueStageId } from "~/lib/processing-queue/types";

const JOB = "job-1";
const ids = queueEventIds(JOB);
const T0 = Date.parse("2026-10-17T10:00:00.000Z");
/** `t(5)` is five seconds after the job was created. */
const t = (seconds: number) => new Date(T0 + seconds * 1000);
const NOW = t(600);

function job(overrides: Partial<QueueJobRow> = {}): QueueJobRow {
    return {
        id: JOB,
        documentId: 42n,
        versionId: 7n,
        userId: "auth_ada",
        status: "processing",
        documentName: "upload.pdf",
        pageCount: null,
        actualProvider: null,
        progress: null,
        retryCount: 0,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        createdAt: t(0),
        updatedAt: t(0),
        ...overrides,
    };
}

function event(
    kind: "extraction" | "indexing",
    overrides: Partial<QueueEventRow> = {}
): QueueEventRow {
    return {
        eventId: ids[kind],
        status: "pending",
        attemptCount: 0,
        availableAt: t(0),
        claimedAt: null,
        processedAt: null,
        lastError: null,
        ...overrides,
    };
}

const extracted = (at = 30) =>
    event("extraction", { status: "processed", claimedAt: t(5), processedAt: t(at) });

function progress(stage: OcrJobProgress["stage"], at: number, extra: Partial<OcrJobProgress> = {}) {
    return { stage, updatedAt: t(at).toISOString(), ...extra } satisfies OcrJobProgress;
}

function build(input: Partial<BuildQueueItemInput> = {}): ProcessingQueueItem {
    return buildQueueItem({
        job: job(),
        document: {
            id: 42,
            title: "Board deck",
            category: "Unfiled",
            mimeType: "application/pdf",
            currentVersionId: 7n,
        },
        events: [],
        viewerUserId: "auth_ada",
        canEdit: false,
        maxAttempts: 8,
        now: NOW,
        ...input,
    });
}

const statuses = (item: ProcessingQueueItem) =>
    Object.fromEntries(item.stages.map(stage => [stage.id, stage.status])) as Record<
        QueueStageId,
        string
    >;

describe("waiting", () => {
    it("is in line until the worker claims the extraction", () => {
        const item = build({ job: job({ status: "queued" }), events: [event("extraction")] });
        expect(item.state).toBe("waiting");
        expect(item.stage).toBe("waiting");
        expect(statuses(item)).toMatchObject({
            added: "done",
            waiting: "active",
            reading: "pending",
        });
        expect(item.attempt).toBe(0);
    });

    it("waits between the halves once the text is read", () => {
        const item = build({ events: [extracted(), event("indexing")] });
        expect(item.state).toBe("waiting");
        expect(item.stage).toBe("splitting");
        expect(statuses(item)).toMatchObject({ reading: "done", splitting: "pending" });
    });

    it("waits from the retry, not from when it was first added", () => {
        const item = build({
            job: job({ status: "queued" }),
            events: [event("extraction", { availableAt: t(540) })],
        });
        expect(item.stages.find(stage => stage.id === "waiting")!.startedAt).toBe(
            t(540).toISOString()
        );
    });
});

describe("running", () => {
    it("reads the text while the extraction is claimed", () => {
        const item = build({
            job: job({ startedAt: t(4) }),
            events: [event("extraction", { status: "processing", claimedAt: t(4) })],
        });
        expect(item.state).toBe("running");
        expect(item.stage).toBe("reading");
        expect(item.attempt).toBe(1);
        expect(item.startedAt).toBe(t(4).toISOString());
        expect(item.stages.find(stage => stage.id === "waiting")!.endedAt).toBe(t(4).toISOString());
    });

    it("indexes with a real done/total from the progress the stage recorded", () => {
        const item = build({
            job: job({ progress: progress("embedding", 50, { done: 120, total: 300 }) }),
            events: [extracted(), event("indexing", { status: "processing", claimedAt: t(40) })],
        });
        expect(item.stage).toBe("indexing");
        expect(statuses(item)).toMatchObject({ splitting: "done", indexing: "active" });
        expect(item.stages.find(stage => stage.id === "indexing")).toMatchObject({
            done: 120,
            total: 300,
        });
    });

    it("ignores progress left over from an earlier attempt", () => {
        const item = build({
            job: job({ progress: progress("embedding", 20, { done: 50, total: 300 }) }),
            events: [extracted(), event("indexing", { status: "processing", claimedAt: t(100) })],
        });
        expect(item.stage).toBe("splitting");
        expect(item.stages.find(stage => stage.id === "indexing")!.status).toBe("pending");
    });

    it("finishes up after the last batch", () => {
        const item = build({
            job: job({ progress: progress("finishing", 90) }),
            events: [extracted(), event("indexing", { status: "processing", claimedAt: t(40) })],
        });
        expect(item.stage).toBe("ready");
        expect(statuses(item)).toMatchObject({ indexing: "done", ready: "active" });
    });

    it("trusts the job when there is no outbox row to go on", () => {
        const item = build({ job: job({ progress: progress("chunking", 30) }) });
        expect(item.state).toBe("running");
        expect(item.stage).toBe("splitting");
    });
});

describe("retrying", () => {
    it("says which attempt failed, why, and when it tries again", () => {
        const item = build({
            events: [
                event("extraction", {
                    attemptCount: 2,
                    availableAt: t(660),
                    lastError: "Document converter /convert failed: 503",
                }),
            ],
        });
        expect(item.state).toBe("retrying");
        expect(item.stage).toBe("reading");
        expect(item.attempt).toBe(2);
        expect(item.nextAttemptAt).toBe(t(660).toISOString());
        expect(item.error).toBe("Document converter /convert failed: 503");
        expect(statuses(item).reading).toBe("active");
    });

    it("stays on the stage that failed inside the indexing half", () => {
        const item = build({
            job: job({ progress: progress("embedding", 50, { done: 50, total: 300 }) }),
            events: [
                extracted(),
                event("indexing", {
                    attemptCount: 1,
                    availableAt: t(700),
                    lastError: "429 RESOURCE_EXHAUSTED",
                }),
            ],
        });
        expect(item.state).toBe("retrying");
        expect(item.stage).toBe("indexing");
    });
});

describe("failed", () => {
    it("stopped while reading, with the job's error", () => {
        const item = build({
            job: job({
                status: "failed",
                completedAt: t(500),
                errorMessage: "pipeline dead after max attempts: [s3] fetch failed",
            }),
            events: [event("extraction", { status: "dead", attemptCount: 8 })],
        });
        expect(item.state).toBe("failed");
        expect(item.stage).toBe("reading");
        expect(item.attempt).toBe(8);
        expect(item.error).toBe("pipeline dead after max attempts: [s3] fetch failed");
        expect(item.completedAt).toBe(t(500).toISOString());
        expect(statuses(item)).toMatchObject({
            waiting: "done",
            reading: "failed",
            splitting: "pending",
        });
    });

    it("stopped while indexing when only the second half died", () => {
        const item = build({
            job: job({
                status: "failed",
                progress: progress("embedding", 80, { done: 100, total: 300 }),
                errorMessage: "pipeline dead after max attempts: 429",
            }),
            events: [extracted(), event("indexing", { status: "dead", attemptCount: 8 })],
        });
        expect(item.stage).toBe("indexing");
        expect(statuses(item)).toMatchObject({
            reading: "done",
            splitting: "done",
            indexing: "failed",
        });
    });

    it("may be retried by someone who can edit it — its current version only", () => {
        const failed = job({ status: "failed" });
        const events = [event("extraction", { status: "dead", attemptCount: 8 })];
        expect(build({ job: failed, events, canEdit: true }).canRetry).toBe(true);
        expect(build({ job: failed, events, canEdit: false }).canRetry).toBe(false);
        expect(
            build({ job: job({ status: "failed", versionId: 6n }), events, canEdit: true }).canRetry
        ).toBe(false);
        expect(build({ events: [extracted()], canEdit: true }).canRetry).toBe(false);
    });
});

describe("done", () => {
    it("is ready, with every stage done and how long it took", () => {
        const item = build({
            job: job({
                status: "completed",
                startedAt: t(5),
                completedAt: t(65),
                pageCount: 12,
                actualProvider: "DOCLING",
                retryCount: 1,
            }),
            events: [extracted(), event("indexing", { status: "processed", claimedAt: t(31) })],
        });
        expect(item.state).toBe("done");
        expect(item.stages.every(stage => stage.status === "done")).toBe(true);
        expect(item).toMatchObject({
            pageCount: 12,
            provider: "DOCLING",
            retryCount: 1,
            completedAt: t(65).toISOString(),
            error: null,
        });
    });
});

describe("the item", () => {
    it("names the file as the library does, and says whose it is", () => {
        const item = build({
            document: {
                id: 42,
                title: "Renamed deck",
                category: "Board/2026",
                mimeType: null,
                currentVersionId: 7n,
            },
            viewerUserId: "auth_bea",
        });
        expect(item).toMatchObject({
            name: "Renamed deck",
            folder: "Board/2026",
            documentId: 42,
            addedById: "auth_ada",
            mine: false,
        });
        expect(build().folder).toBe("");
    });

    it("always carries all six stages, in order", () => {
        expect(build().stages.map(stage => stage.id)).toEqual([
            "added",
            "waiting",
            "reading",
            "splitting",
            "indexing",
            "ready",
        ]);
    });

    it("is summarised by state", () => {
        const items = [
            build({ job: job({ status: "queued" }), events: [event("extraction")] }),
            build({ events: [event("extraction", { status: "processing", claimedAt: t(4) })] }),
            build({ job: job({ status: "completed" }) }),
            build({ job: job({ status: "completed" }) }),
        ];
        expect(summarize(items)).toEqual({
            running: 1,
            waiting: 1,
            retrying: 0,
            failed: 0,
            done: 2,
        });
    });
});
