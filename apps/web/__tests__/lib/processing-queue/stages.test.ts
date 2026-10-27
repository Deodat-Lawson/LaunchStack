/**
 * The Processing queue's stage logic: DB rows in, the six-stage item out.
 * Recorded (worker stage rows), inferred (job + outbox only), retrying,
 * failed at each half, and rows left over from an earlier run.
 */

import {
    buildQueueItem,
    providerLabel,
    queueEventIds,
    stepTypesFrom,
    summarize,
    type BuildQueueItemInput,
    type QueueEventRow,
    type QueueJobRow,
    type QueueStepRow,
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
        userId: "auth_ada",
        status: "processing",
        documentName: "upload.pdf",
        pageCount: null,
        actualProvider: null,
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

function step(
    stepType: QueueStepRow["stepType"],
    status: QueueStepRow["status"],
    at: number,
    extra: Partial<QueueStepRow> = {}
): QueueStepRow {
    return {
        stepType,
        status,
        output: null,
        errorMessage: null,
        durationMs: status === "completed" || status === "failed" ? 2000 : null,
        createdAt: t(at),
        ...extra,
    };
}

function build(input: Partial<BuildQueueItemInput> = {}): ProcessingQueueItem {
    return buildQueueItem({
        job: job(),
        document: { id: 42, title: "Board deck", category: "Unfiled", mimeType: "application/pdf" },
        steps: [],
        events: [],
        viewerUserId: "auth_ada",
        canRetry: false,
        maxAttempts: 8,
        now: NOW,
        ...input,
    });
}

/** `{ added: "done", waiting: "done", reading: "active", … }` */
function statuses(item: ProcessingQueueItem): Record<QueueStageId, string> {
    return Object.fromEntries(item.stages.map(s => [s.id, s.status])) as Record<
        QueueStageId,
        string
    >;
}

function stage(item: ProcessingQueueItem, id: QueueStageId) {
    return item.stages.find(s => s.id === id)!;
}

describe("buildQueueItem — shape", () => {
    it("always carries all six stages, in order", () => {
        const item = build();
        expect(item.stages.map(s => s.id)).toEqual([
            "added",
            "waiting",
            "reading",
            "splitting",
            "indexing",
            "ready",
        ]);
        expect(stage(item, "added")).toMatchObject({
            status: "done",
            startedAt: t(0).toISOString(),
            endedAt: t(0).toISOString(),
        });
    });

    it("names the file from the library, folder '' for Unfiled, and says whose it is", () => {
        const mine = build();
        expect(mine).toMatchObject({
            jobId: JOB,
            documentId: 42,
            name: "Board deck",
            folder: "",
            mimeType: "application/pdf",
            addedById: "auth_ada",
            mine: true,
            maxAttempts: 8,
            createdAt: t(0).toISOString(),
        });
        const theirs = build({
            viewerUserId: "auth_bea",
            document: { id: 42, title: "Notes", category: "Google Drive/Coding", mimeType: null },
        });
        expect(theirs).toMatchObject({ mine: false, folder: "Google Drive/Coding" });
    });

    it("falls back to the job's name without a document", () => {
        expect(build({ document: null }).name).toBe("upload.pdf");
    });
});

describe("buildQueueItem — inferred from the job and its outbox events", () => {
    it("queued with no events yet: waiting", () => {
        const item = build({ job: job({ status: "queued" }) });
        expect(item).toMatchObject({ state: "waiting", stage: "waiting", attempt: 0 });
        expect(item.stageSource).toBe("inferred");
        expect(statuses(item)).toMatchObject({
            added: "done",
            waiting: "active",
            reading: "pending",
        });
    });

    it("processing with no events (a pre-outbox job): reading", () => {
        const item = build({ job: job({ status: "processing", startedAt: t(3) }) });
        expect(item).toMatchObject({ state: "running", stage: "reading" });
        expect(stage(item, "reading").startedAt).toBe(t(3).toISOString());
    });

    it("extraction event pending and unclaimed: waiting", () => {
        const item = build({ job: job({ status: "queued" }), events: [event("extraction")] });
        expect(item).toMatchObject({ state: "waiting", stage: "waiting", attempt: 0 });
        expect(item.nextAttemptAt).toBeNull();
    });

    it("extraction event processing: reading, started when it was claimed", () => {
        const item = build({
            events: [event("extraction", { status: "processing", claimedAt: t(4) })],
        });
        expect(item).toMatchObject({ state: "running", stage: "reading", attempt: 1 });
        expect(statuses(item)).toMatchObject({
            waiting: "done",
            reading: "active",
            splitting: "pending",
        });
        expect(stage(item, "waiting").endedAt).toBe(t(4).toISOString());
        expect(stage(item, "reading").startedAt).toBe(t(4).toISOString());
    });

    it("between the halves: extraction processed, indexing pending → waiting at splitting", () => {
        const item = build({ events: [extracted(30), event("indexing")] });
        expect(item).toMatchObject({ state: "waiting", stage: "splitting", attempt: 0 });
        expect(statuses(item)).toEqual({
            added: "done",
            waiting: "done",
            reading: "done",
            splitting: "pending",
            indexing: "pending",
            ready: "pending",
        });
        expect(stage(item, "reading").endedAt).toBe(t(30).toISOString());
    });

    it("extraction processed with no indexing row yet: still waiting at splitting", () => {
        const item = build({ events: [extracted()] });
        expect(item).toMatchObject({ state: "waiting", stage: "splitting" });
    });

    it("indexing event processing: indexing (chunking and embedding can't be told apart)", () => {
        const item = build({
            events: [extracted(), event("indexing", { status: "processing", claimedAt: t(40) })],
        });
        expect(item).toMatchObject({ state: "running", stage: "indexing", attempt: 1 });
        expect(statuses(item)).toMatchObject({
            splitting: "done",
            indexing: "active",
            ready: "pending",
        });
        expect(stage(item, "indexing").startedAt).toBe(t(40).toISOString());
        expect(stage(item, "indexing").total).toBeUndefined();
    });

    it("completed: every stage done", () => {
        const item = build({
            job: job({
                status: "completed",
                startedAt: t(5),
                completedAt: t(90),
                pageCount: 12,
                actualProvider: "NATIVE_PDF",
            }),
            events: [
                extracted(),
                event("indexing", { status: "processed", claimedAt: t(40), processedAt: t(90) }),
            ],
        });
        expect(item).toMatchObject({
            state: "done",
            stage: "ready",
            attempt: 1,
            pageCount: 12,
            provider: "Native PDF",
            completedAt: t(90).toISOString(),
            error: null,
            canRetry: false,
        });
        expect(item.stages.every(s => s.status === "done")).toBe(true);
        expect(stage(item, "ready").endedAt).toBe(t(90).toISOString());
    });

    it("failed in extraction: reading failed, later stages pending", () => {
        const item = build({
            job: job({
                status: "failed",
                completedAt: t(300),
                errorMessage:
                    "pipeline dead after max attempts: [s3] fetch failed ← caused by: fetch failed ← caused by: ",
            }),
            events: [event("extraction", { status: "dead", attemptCount: 8, claimedAt: t(290) })],
            canRetry: true,
        });
        expect(item).toMatchObject({
            state: "failed",
            stage: "reading",
            attempt: 8,
            canRetry: true,
        });
        expect(statuses(item)).toMatchObject({
            waiting: "done",
            reading: "failed",
            splitting: "pending",
        });
        expect(item.error).toEqual({
            message: "Couldn't fetch the file from storage.",
            detail: "pipeline dead after max attempts: [s3] fetch failed ← caused by: fetch failed ← caused by:",
        });
        expect(stage(item, "reading").endedAt).toBe(t(300).toISOString());
        expect(item.completedAt).toBe(t(300).toISOString());
    });

    it("failed in indexing: reading done, indexing failed", () => {
        const item = build({
            job: job({
                status: "failed",
                errorMessage: "pipeline event dead: 402 Insufficient credits",
            }),
            events: [extracted(), event("indexing", { status: "dead", attemptCount: 8 })],
        });
        expect(item).toMatchObject({ state: "failed", stage: "indexing" });
        expect(statuses(item)).toMatchObject({
            reading: "done",
            splitting: "done",
            indexing: "failed",
            ready: "pending",
        });
        expect(item.error?.message).toBe(
            "The AI provider is out of credit or rate-limited — try again later."
        );
    });

    it("failed without any outbox or stage rows: reading, generic message when there's no error", () => {
        const item = build({ job: job({ status: "failed" }), canRetry: true });
        expect(item).toMatchObject({
            state: "failed",
            stage: "reading",
            attempt: 1,
            canRetry: true,
        });
        expect(item.error).toEqual({ message: "Processing stopped with an error.", detail: null });
    });

    it("never offers Retry for a job that hasn't failed", () => {
        expect(build({ canRetry: true }).canRetry).toBe(false);
    });

    it("an event that died before the job row caught up reads as failed", () => {
        const item = build({
            events: [event("extraction", { status: "dead", attemptCount: 8, lastError: "boom" })],
        });
        expect(item).toMatchObject({ state: "failed", stage: "reading" });
        expect(item.error).toEqual({
            message: "Processing stopped with an error.",
            detail: "boom",
        });
    });
});

describe("buildQueueItem — retrying", () => {
    it("extraction retrying: the error is only on the event, the job row says processing", () => {
        const item = build({
            job: job({ status: "processing" }),
            events: [
                event("extraction", {
                    status: "pending",
                    attemptCount: 2,
                    availableAt: t(700),
                    lastError: "[s3] fetch failed ← caused by: fetch failed",
                }),
            ],
        });
        expect(item).toMatchObject({
            state: "retrying",
            stage: "reading",
            attempt: 2,
            nextAttemptAt: t(700).toISOString(),
        });
        expect(stage(item, "reading")).toMatchObject({
            status: "active",
            detail: "attempt 3 of 8",
        });
        expect(item.error?.message).toBe("Couldn't fetch the file from storage.");
    });

    it("retrying whose next attempt is already due still reads as retrying", () => {
        const item = build({
            events: [
                event("extraction", {
                    attemptCount: 1,
                    availableAt: t(100),
                    lastError: "Document converter /convert failed: 503 Service Unavailable",
                }),
            ],
        });
        expect(item).toMatchObject({ state: "retrying", nextAttemptAt: t(100).toISOString() });
        expect(item.error?.message).toBe("The document converter had a problem — try again later.");
    });

    it("indexing retrying at the recorded stage that failed", () => {
        const item = build({
            events: [
                extracted(),
                event("indexing", {
                    attemptCount: 1,
                    availableAt: t(200),
                    lastError: "429 Too Many Requests",
                }),
            ],
            steps: [
                step("read", "completed", 6),
                step("chunk", "completed", 41, { output: { chunks: 40 } }),
                step("embed", "failed", 45, {
                    output: { done: 10, total: 40 },
                    errorMessage: "429 Too Many Requests",
                }),
            ],
        });
        expect(item).toMatchObject({ state: "retrying", stage: "indexing", attempt: 1 });
        expect(statuses(item)).toMatchObject({ splitting: "done", indexing: "active" });
        expect(stage(item, "indexing")).toMatchObject({
            done: 10,
            total: 40,
            detail: "attempt 2 of 8",
        });
    });

    it("an operator replay (pending, out of attempts) is a fresh wait, not a retry", () => {
        const item = build({
            events: [extracted(), event("indexing", { attemptCount: 8, lastError: "old" })],
        });
        expect(item).toMatchObject({ state: "waiting", stage: "splitting", error: null });
    });

    it("a running attempt after failures says which attempt it is", () => {
        const item = build({
            events: [
                event("extraction", { status: "processing", attemptCount: 2, claimedAt: t(50) }),
            ],
        });
        expect(item).toMatchObject({ state: "running", attempt: 3 });
        expect(stage(item, "reading").detail).toBe("attempt 3 of 8");
    });
});

describe("buildQueueItem — recorded stage rows", () => {
    const reading = [
        event("extraction", { status: "processing", claimedAt: t(5) }),
    ] satisfies QueueEventRow[];

    it("route then read: reading active, the wait ended when routing began", () => {
        const item = build({
            events: reading,
            steps: [step("route", "completed", 6), step("read", "in_progress", 7)],
        });
        expect(item).toMatchObject({ state: "running", stage: "reading", stageSource: "recorded" });
        expect(stage(item, "waiting").endedAt).toBe(t(6).toISOString());
        expect(stage(item, "reading").startedAt).toBe(t(6).toISOString());
    });

    it("route done, read not started yet: still reading", () => {
        const item = build({ events: reading, steps: [step("route", "completed", 6)] });
        expect(item).toMatchObject({ stage: "reading", state: "running" });
    });

    it("no route row for a non-PDF: read alone drives reading", () => {
        const item = build({
            events: [extracted(30), event("indexing")],
            steps: [step("read", "completed", 6, { output: { provider: "DOCLING", pages: 12 } })],
        });
        expect(statuses(item)).toMatchObject({ reading: "done", splitting: "pending" });
        expect(stage(item, "reading")).toMatchObject({
            detail: "Docling · 12 pages",
            startedAt: t(6).toISOString(),
            endedAt: t(8).toISOString(),
        });
        expect(item).toMatchObject({ provider: "Docling", pageCount: 12 });
    });

    const indexingRun = [
        extracted(30),
        event("indexing", { status: "processing", claimedAt: t(40) }),
    ];

    it("chunking: splitting active", () => {
        const item = build({
            events: indexingRun,
            steps: [step("read", "completed", 6), step("chunk", "in_progress", 41)],
        });
        expect(item).toMatchObject({ stage: "splitting", state: "running" });
        expect(statuses(item)).toMatchObject({
            reading: "done",
            splitting: "active",
            indexing: "pending",
        });
    });

    it("the indexing handler just started, before its first row: splitting", () => {
        const item = build({ events: indexingRun, steps: [step("read", "completed", 6)] });
        expect(item).toMatchObject({ stage: "splitting", state: "running" });
    });

    it("embedding: indexing active with done / total, splitting shows its chunk count", () => {
        const item = build({
            events: indexingRun,
            steps: [
                step("read", "completed", 6),
                step("chunk", "completed", 41, { output: { chunks: 40 } }),
                step("embed", "in_progress", 44, { output: { done: 10, total: 40 } }),
            ],
        });
        expect(item).toMatchObject({ stage: "indexing", state: "running" });
        expect(stage(item, "splitting")).toMatchObject({
            status: "done",
            detail: "40 chunks",
            endedAt: t(43).toISOString(),
        });
        expect(stage(item, "indexing")).toMatchObject({ status: "active", done: 10, total: 40 });
    });

    it("chunked, embed row not written yet: indexing, no done / total", () => {
        const item = build({
            events: indexingRun,
            steps: [step("read", "completed", 6), step("chunk", "completed", 41)],
        });
        expect(item.stage).toBe("indexing");
        expect(stage(item, "indexing").total).toBeUndefined();
    });

    it("finalising: ready active", () => {
        const item = build({
            events: indexingRun,
            steps: [
                step("read", "completed", 6),
                step("chunk", "completed", 41),
                step("embed", "completed", 44, { output: { done: 40, total: 40 } }),
                step("finalize", "in_progress", 80),
            ],
        });
        expect(item).toMatchObject({ stage: "ready", state: "running" });
        expect(stage(item, "indexing")).toMatchObject({ status: "done", done: 40, total: 40 });
    });

    it("completed: embed done equals total even when its last write lagged", () => {
        const item = build({
            job: job({ status: "completed", completedAt: t(90) }),
            events: [extracted(), event("indexing", { status: "processed", processedAt: t(90) })],
            steps: [
                step("read", "completed", 6),
                step("chunk", "completed", 41),
                step("embed", "completed", 44, { output: { done: 38, total: 40 } }),
                step("finalize", "completed", 80),
            ],
        });
        expect(item.state).toBe("done");
        expect(stage(item, "indexing")).toMatchObject({ done: 40, total: 40 });
    });

    it("failed at reading: the failed row names the stage", () => {
        const item = build({
            job: job({
                status: "failed",
                errorMessage: "pipeline event dead: Unsupported file type",
            }),
            events: [event("extraction", { status: "dead", attemptCount: 8 })],
            steps: [step("route", "completed", 6), step("read", "failed", 7)],
        });
        expect(item).toMatchObject({ state: "failed", stage: "reading" });
        expect(item.error?.message).toBe("This file type isn't supported.");
        expect(stage(item, "reading").endedAt).toBe(t(9).toISOString());
    });

    it("failed at splitting vs at indexing", () => {
        const dead = [extracted(), event("indexing", { status: "dead", attemptCount: 8 })];
        const atChunk = build({
            job: job({ status: "failed" }),
            events: dead,
            steps: [step("read", "completed", 6), step("chunk", "failed", 41)],
        });
        expect(atChunk.stage).toBe("splitting");
        expect(statuses(atChunk)).toMatchObject({
            reading: "done",
            splitting: "failed",
            indexing: "pending",
        });

        const atEmbed = build({
            job: job({ status: "failed" }),
            events: dead,
            steps: [
                step("read", "completed", 6),
                step("chunk", "completed", 41),
                step("embed", "failed", 44, {
                    output: { done: 12, total: 40 },
                    errorMessage: "Failed to generate embeddings for indices: 3",
                }),
            ],
        });
        expect(atEmbed.stage).toBe("indexing");
        expect(stage(atEmbed, "indexing")).toMatchObject({ status: "failed", done: 12, total: 40 });
        // No job or event error: the stage row's own error is used.
        expect(atEmbed.error?.message).toBe("Couldn't build the search index for this file.");
    });
});

describe("buildQueueItem — rows left over from an earlier run", () => {
    const oldRun = [
        step("route", "completed", 6),
        step("read", "completed", 7, { output: { provider: "AZURE", pages: 3 } }),
        step("chunk", "completed", 41, { output: { chunks: 9 } }),
        step("embed", "failed", 44, { output: { done: 2, total: 9 } }),
    ];

    it("a re-upload revived extraction: the old rows are ignored, the file is waiting", () => {
        const item = build({
            job: job({ status: "queued" }),
            events: [
                event("extraction", { status: "pending", attemptCount: 0, availableAt: t(500) }),
                event("indexing", { status: "dead", attemptCount: 8, lastError: "old" }),
            ],
            steps: oldRun,
        });
        expect(item).toMatchObject({
            state: "waiting",
            stage: "waiting",
            error: null,
            provider: null,
        });
        expect(statuses(item)).toMatchObject({ reading: "pending", indexing: "pending" });
        expect(stage(item, "indexing").total).toBeUndefined();
    });

    it("extraction re-running: rows older than its claim don't count", () => {
        const item = build({
            events: [
                event("extraction", { status: "processing", claimedAt: t(500) }),
                event("indexing", { status: "dead", attemptCount: 8 }),
            ],
            steps: oldRun,
        });
        expect(item).toMatchObject({ state: "running", stage: "reading", error: null });
        expect(stage(item, "reading").startedAt).toBe(t(500).toISOString());
        expect(stage(item, "reading").detail).toBeUndefined();
    });

    it("indexing re-running: a later stage's row older than an earlier one's is stale", () => {
        const item = build({
            events: [
                extracted(30),
                event("indexing", { status: "processing", claimedAt: t(40), attemptCount: 1 }),
            ],
            steps: [
                step("read", "completed", 6),
                step("chunk", "in_progress", 100),
                step("embed", "failed", 60, { output: { done: 2, total: 9 } }),
            ],
        });
        expect(item).toMatchObject({ state: "running", stage: "splitting", attempt: 2 });
        expect(stage(item, "indexing").total).toBeUndefined();
    });

    it("keeps a retried stage's own row: only the latest row per stage counts", () => {
        const item = build({
            events: [extracted(30), event("indexing", { status: "processing", claimedAt: t(40) })],
            steps: [
                step("read", "completed", 6),
                step("chunk", "completed", 41),
                step("embed", "failed", 42),
                step("embed", "in_progress", 50, { output: { done: 5, total: 9 } }),
            ],
        });
        expect(item.stage).toBe("indexing");
        expect(stage(item, "indexing")).toMatchObject({ status: "active", done: 5, total: 9 });
    });
});

describe("summarize", () => {
    it("counts items by state", () => {
        const items = [
            build({ job: job({ status: "queued" }) }),
            build({ events: [event("extraction", { status: "processing", claimedAt: t(1) })] }),
            build({ events: [event("extraction", { attemptCount: 1, lastError: "x" })] }),
            build({ job: job({ status: "failed" }) }),
            build({ job: job({ status: "completed" }) }),
            build({ job: job({ status: "completed" }) }),
        ];
        expect(summarize(items)).toEqual({
            running: 1,
            waiting: 1,
            retrying: 1,
            failed: 1,
            done: 2,
        });
        expect(summarize([])).toEqual({ running: 0, waiting: 0, retrying: 0, failed: 0, done: 0 });
    });
});

describe("helpers", () => {
    it("stepTypesFrom lists the stage rows from a stage onward", () => {
        expect(stepTypesFrom("reading")).toEqual(["route", "read", "chunk", "embed", "finalize"]);
        expect(stepTypesFrom("splitting")).toEqual(["chunk", "embed", "finalize"]);
        expect(stepTypesFrom("ready")).toEqual(["finalize"]);
    });

    it("providerLabel names known providers and title-cases the rest", () => {
        expect(providerLabel("NATIVE_PDF")).toBe("Native PDF");
        expect(providerLabel("docling")).toBe("Docling");
        expect(providerLabel("SOME_NEW_THING")).toBe("Some New Thing");
        expect(providerLabel(null)).toBeNull();
    });
});

describe("a file put back in line", () => {
    it("waits from the retry, not from when it was first added", () => {
        const item = build({
            job: job({ status: "queued" }),
            events: [event("extraction", { availableAt: t(540) })],
        });
        expect(item.state).toBe("waiting");
        const waiting = item.stages.find(stage => stage.id === "waiting")!;
        expect(waiting.startedAt).toBe(t(540).toISOString());
    });

    it("waits from when it was added on its first trip", () => {
        const item = build({ job: job({ status: "queued" }), events: [event("extraction")] });
        expect(item.stages.find(stage => stage.id === "waiting")!.startedAt).toBe(
            t(0).toISOString()
        );
    });
});
