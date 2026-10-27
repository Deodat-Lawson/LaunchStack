import {
    QUEUE_STAGE_IDS,
    type ProcessingQueueItem,
    type QueueStage,
} from "~/lib/processing-queue/types";

import type { LocalTask } from "../processing/uploadTasks";
import {
    NOTE_TTL_MS,
    buildRows,
    folderLabel,
    formatDuration,
    formatIn,
    groupRows,
    overallProgress,
    rowFromLocal,
    rowFromServer,
    stageProgress,
    summarySentence,
    tabBadge,
} from "../processing/viewModel";

/**
 * The Processing tab's words and order: what each row says it is doing, which
 * section it sits in, and how a browser upload hands over to the server's job
 * without showing twice.
 */

const NOW = Date.parse("2026-10-17T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function stages(
    overrides: Partial<Record<QueueStage["id"], Partial<QueueStage>>> = {}
): QueueStage[] {
    return QUEUE_STAGE_IDS.map(id => ({
        id,
        status: "pending" as const,
        startedAt: null,
        endedAt: null,
        ...overrides[id],
    }));
}

function item(overrides: Partial<ProcessingQueueItem> = {}): ProcessingQueueItem {
    return {
        jobId: "job-1",
        documentId: 1,
        name: "deck.pdf",
        folder: "Board",
        mimeType: "application/pdf",
        addedById: "me",
        mine: true,
        state: "running",
        stage: "reading",
        stages: stages({
            added: { status: "done" },
            waiting: { status: "done" },
            reading: { status: "active", startedAt: iso(-5_000) },
        }),
        attempt: 1,
        maxAttempts: 8,
        nextAttemptAt: null,
        error: null,
        pageCount: null,
        provider: null,
        createdAt: iso(-60_000),
        startedAt: iso(-5_000),
        completedAt: null,
        canRetry: false,
        stageSource: "recorded",
        ...overrides,
    };
}

function task(overrides: Partial<LocalTask> = {}): LocalTask {
    return {
        id: "local-1",
        name: "deck.pdf",
        category: "Board",
        kind: "file",
        mimeType: "application/pdf",
        phase: "uploading",
        loaded: 512 * 1024,
        total: 2 * 1024 * 1024,
        workLabel: null,
        error: null,
        jobIds: [],
        note: null,
        createdAt: NOW - 4_000,
        finishedAt: null,
        ...overrides,
    };
}

describe("server rows", () => {
    it("says what the running stage is doing", () => {
        expect(rowFromServer(item(), NOW).headline).toBe("Reading the text");
        const indexing = item({
            stage: "indexing",
            stages: stages({
                added: { status: "done" },
                waiting: { status: "done" },
                reading: { status: "done" },
                splitting: { status: "done" },
                indexing: { status: "active", done: 50, total: 200 },
            }),
            provider: "Docling",
            pageCount: 12,
        });
        const row = rowFromServer(indexing, NOW);
        expect(row.headline).toBe("Indexing for search · 25%");
        expect(row.detail).toBe("50 of 200 sections · Docling · 12 pages");
        expect(row.progress).toBeCloseTo(4.25);
    });

    it("puts a retrying file under Needs attention with when it tries again", () => {
        const row = rowFromServer(
            item({ state: "retrying", attempt: 3, nextAttemptAt: iso(3 * 60_000) }),
            NOW
        );
        expect(row.section).toBe("attention");
        expect(row.headline).toBe("Trying again in 3 min");
        expect(row.detail).toContain("Attempt 3 of 8");
    });

    it("names the stage a failed file stopped at", () => {
        const row = rowFromServer(item({ state: "failed", stage: "indexing" }), NOW);
        expect(row.headline).toBe("Stopped while indexing");
        expect(row.section).toBe("attention");
    });

    it("says how long a finished file took", () => {
        const row = rowFromServer(
            item({
                state: "done",
                stage: "ready",
                startedAt: iso(-40_000),
                completedAt: iso(-6_000),
                pageCount: 1,
            }),
            NOW
        );
        expect(row.headline).toBe("Ready to search");
        expect(row.detail).toBe("1 page · took 34 s");
    });

    it("waits its turn before it starts, and between stages", () => {
        expect(rowFromServer(item({ state: "waiting", stage: "waiting" }), NOW).headline).toBe(
            "Waiting its turn"
        );
        expect(rowFromServer(item({ state: "waiting", stage: "splitting" }), NOW).headline).toBe(
            "Waiting to start splitting"
        );
    });
});

describe("browser rows", () => {
    it("shows the bytes going up as the first stage", () => {
        const row = rowFromLocal(task(), "me");
        expect(row.headline).toBe("Uploading · 25%");
        expect(row.detail).toBe("512 KB of 2.0 MB");
        expect(row.stages[0]).toMatchObject({ id: "added", status: "active", done: 524288 });
        expect(row.section).toBe("running");
    });

    it("says a recording is being transcribed before processing starts", () => {
        const row = rowFromLocal(
            task({ phase: "working", workLabel: "Transcribing the recording" }),
            "me"
        );
        expect(row.headline).toBe("Transcribing the recording");
        expect(row.detail).toMatch(/keep this page open/);
    });

    it("keeps an upload that never reached the server, with Retry", () => {
        const row = rowFromLocal(
            task({ phase: "failed", error: "deck.pdf: upload failed (HTTP 413)" }),
            "me"
        );
        expect(row.state).toBe("failed");
        expect(row.canRetry).toBe(true);
        expect(row.error?.message).toBe("deck.pdf: upload failed (HTTP 413)");
        expect(row.stages[0]!.status).toBe("failed");
    });
});

describe("buildRows", () => {
    const base = {
        viewerId: "me",
        cleared: new Set<string>(),
        mineOnly: false,
        now: NOW,
    };

    it("hands over to the server's row once the job is listed — never both", () => {
        const handedOff = task({
            phase: "handed-off",
            jobIds: ["job-1"],
            finishedAt: NOW - 1_000,
        });
        const before = buildRows({ ...base, items: [], local: [handedOff] });
        expect(before).toHaveLength(1);
        expect(before[0]!.origin).toBe("local");
        expect(before[0]!.headline).toBe("Waiting its turn");

        const after = buildRows({ ...base, items: [item()], local: [handedOff] });
        expect(after).toHaveLength(1);
        expect(after[0]!.origin).toBe("server");
    });

    it("lets a crawl's note go after a minute", () => {
        const crawl = task({
            kind: "link",
            phase: "handed-off",
            note: "Crawl started — pages appear here as they're found",
            finishedAt: NOW - NOTE_TTL_MS - 1,
        });
        expect(buildRows({ ...base, items: [], local: [crawl] })).toHaveLength(0);
    });

    it("orders attention, running, waiting, then finished newest first", () => {
        const rows = buildRows({
            ...base,
            local: [],
            items: [
                item({
                    jobId: "old-done",
                    state: "done",
                    stage: "ready",
                    completedAt: iso(-60_000),
                }),
                item({ jobId: "waiting", state: "waiting", stage: "waiting" }),
                item({
                    jobId: "new-done",
                    state: "done",
                    stage: "ready",
                    completedAt: iso(-1_000),
                }),
                item({ jobId: "failed", state: "failed" }),
                item({ jobId: "running" }),
            ],
        });
        expect(rows.map(row => row.jobId)).toEqual([
            "failed",
            "running",
            "waiting",
            "new-done",
            "old-done",
        ]);
    });

    it("narrows to mine, and hides finished files the viewer cleared", () => {
        const rows = buildRows({
            ...base,
            mineOnly: true,
            cleared: new Set(["done-mine"]),
            local: [],
            items: [
                item({ jobId: "theirs", mine: false, addedById: "them" }),
                item({ jobId: "done-mine", state: "done", stage: "ready", completedAt: iso(0) }),
                item({ jobId: "running-mine" }),
            ],
        });
        expect(rows.map(row => row.jobId)).toEqual(["running-mine"]);
    });
});

describe("summaries", () => {
    it("counts what is moving for the header and the tab", () => {
        const rows = buildRows({
            viewerId: "me",
            cleared: new Set(),
            mineOnly: false,
            now: NOW,
            local: [task()],
            items: [
                item({ jobId: "a" }),
                item({ jobId: "b", state: "waiting", stage: "waiting" }),
                item({ jobId: "c", state: "failed" }),
                item({ jobId: "d", state: "done", stage: "ready", completedAt: iso(0) }),
            ],
        });
        const groups = groupRows(rows);
        expect(summarySentence(groups)).toBe("2 running · 1 waiting · 1 needs attention");
        expect(tabBadge(rows)).toEqual({ count: 4, tone: "danger" });
        const overall = overallProgress(groups);
        expect(overall?.count).toBe(3);
        expect(overall!.share).toBeGreaterThan(0);
        expect(overall!.share).toBeLessThan(1);
    });

    it("is all caught up when only finished files are left", () => {
        const rows = buildRows({
            viewerId: "me",
            cleared: new Set(),
            mineOnly: false,
            now: NOW,
            local: [],
            items: [item({ state: "done", stage: "ready", completedAt: iso(0) })],
        });
        expect(summarySentence(groupRows(rows))).toBe(
            "All caught up — 1 file ready in the last 24 hours"
        );
        expect(tabBadge(rows)).toBeNull();
        expect(summarySentence(groupRows([]))).toBe("Nothing is processing");
    });
});

describe("formatting", () => {
    it("reads durations and folders the way people say them", () => {
        expect(formatDuration(4_200)).toBe("4 s");
        expect(formatDuration(3 * 60_000 + 10_000)).toBe("3 min");
        expect(formatDuration(65 * 60_000)).toBe("1 h 5 min");
        expect(formatIn(iso(2_000), NOW)).toBe("any moment now");
        expect(folderLabel("")).toBe("No folder");
        expect(folderLabel("Unfiled")).toBe("No folder");
        expect(folderLabel("Google Drive/Contracts")).toBe("Google Drive / Contracts");
        expect(stageProgress(stages({ added: { status: "done" } }))).toBe(1);
    });
});
