import { translatorFor } from "~/i18n/translate";
import {
    QUEUE_STAGE_IDS,
    type ProcessingQueueItem,
    type QueueStage,
} from "~/lib/processing-queue/types";
import { describeSourceFailure, localizeSourceFailure } from "~/lib/source-failure";

import { SourceUploadError } from "../sourceUpload";
import type { LocalTask } from "../processing/uploadTasks";
import {
    NOTE_TTL_MS,
    buildRows,
    folderLabel,
    formatDuration,
    groupRows,
    overallProgress,
    providerLabel,
    queueBadge,
    rowFromLocal,
    rowFromServer,
    stageProgress,
    summarySentence,
    type ProcessingText,
} from "../processing/viewModel";

/**
 * The Processing tab's words and order: what each row says it is doing, which
 * section it sits in, and how a browser upload hands over to the server's job
 * without showing twice. Read in English, the catalogue every test uses.
 */

const t = translatorFor("en", "processing");
const tFailure = translatorFor("en", "sources.failure");
const text: ProcessingText = {
    t,
    tu: translatorFor("en", "sources.sourceUpload"),
    describeFailure: raw => localizeSourceFailure(describeSourceFailure(raw), tFailure),
};

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
        retryCount: 0,
        createdAt: iso(-60_000),
        startedAt: iso(-5_000),
        completedAt: null,
        canRetry: false,
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
        work: null,
        failure: null,
        jobIds: [],
        note: null,
        createdAt: NOW - 4_000,
        finishedAt: null,
        ...overrides,
    };
}

const rows = (input: Partial<Parameters<typeof buildRows>[0]>) =>
    buildRows({
        items: [],
        local: [],
        viewerId: "me",
        cleared: new Set<string>(),
        mineOnly: false,
        now: NOW,
        text,
        ...input,
    });

describe("server rows", () => {
    it("says what the running stage is doing", () => {
        expect(rowFromServer(item(), NOW, text).headline).toBe("Reading the text");
        const indexing = item({
            stage: "indexing",
            stages: stages({
                added: { status: "done" },
                waiting: { status: "done" },
                reading: { status: "done" },
                splitting: { status: "done" },
                indexing: { status: "active", done: 50, total: 200 },
            }),
            provider: "DOCLING",
            pageCount: 12,
        });
        const row = rowFromServer(indexing, NOW, text);
        expect(row.headline).toBe("Indexing for search · 25%");
        expect(row.detail).toBe("50 of 200 sections · Docling · 12 pages");
        expect(row.progress).toBeCloseTo(4.25);
    });

    it("puts a retrying file under Needs attention, with when and why", () => {
        const row = rowFromServer(
            item({
                state: "retrying",
                attempt: 3,
                nextAttemptAt: iso(3 * 60_000),
                error: 'Embedding failed: 429 {"error":{"status":"RESOURCE_EXHAUSTED"}}',
            }),
            NOW,
            text
        );
        expect(row.section).toBe("attention");
        expect(row.headline).toBe("Trying again in 3 min");
        expect(row.detail).toContain("Attempt 3 of 8");
        // The raw error is worded by the Sources rail's describer, not shown raw.
        expect(row.failure?.category).toBe("embedding_quota");
        expect(row.errorMessage).toBe(tFailure("categories.embedding_quota.message"));
        expect(row.errorDetail).toContain("RESOURCE_EXHAUSTED");
    });

    it("names the stage a failed file stopped at, and only offers Retry when it can help", () => {
        const failed = rowFromServer(
            item({
                state: "failed",
                stage: "indexing",
                canRetry: true,
                error: "pipeline dead after max attempts: embedding 429 RESOURCE_EXHAUSTED",
            }),
            NOW,
            text
        );
        expect(failed.headline).toBe("Stopped while indexing");
        expect(failed.section).toBe("attention");
        expect(failed.canRetry).toBe(true);

        const unreadable = rowFromServer(
            item({
                state: "failed",
                canRetry: true,
                error: "pipeline dead after max attempts: password-protected PDF",
            }),
            NOW,
            text
        );
        expect(unreadable.failure?.retryable).toBe(false);
        expect(unreadable.canRetry).toBe(false);
    });

    it("says how long a finished file took", () => {
        const row = rowFromServer(
            item({
                state: "done",
                stage: "ready",
                startedAt: iso(-40_000),
                completedAt: iso(-6_000),
                pageCount: 1,
                provider: "NATIVE_PDF",
            }),
            NOW,
            text
        );
        expect(row.headline).toBe("Ready to search");
        expect(row.detail).toBe("Native PDF · 1 page · took 34 s");
    });

    it("waits its turn before it starts, and between stages", () => {
        expect(
            rowFromServer(item({ state: "waiting", stage: "waiting" }), NOW, text).headline
        ).toBe("Waiting its turn");
        expect(
            rowFromServer(item({ state: "waiting", stage: "splitting" }), NOW, text).headline
        ).toBe("Waiting to start splitting");
    });
});

describe("browser rows", () => {
    it("shows the bytes going up as the first stage", () => {
        const row = rowFromLocal(task(), "me", text);
        expect(row.headline).toBe("Uploading · 25%");
        expect(row.detail).toBe("512 KB of 2.0 MB");
        expect(row.stages[0]).toMatchObject({ id: "added", status: "active", done: 524288 });
        expect(row.section).toBe("running");
    });

    it("says a recording is being transcribed before processing starts", () => {
        const row = rowFromLocal(task({ phase: "working", work: "transcribing" }), "me", text);
        expect(row.headline).toBe("Transcribing the recording");
        expect(row.detail).toMatch(/keep this page open/);
    });

    it("keeps an upload that never reached the server, with its reason and Retry", () => {
        const row = rowFromLocal(
            task({
                phase: "failed",
                failure: new SourceUploadError("deck.pdf", "upload", 413, null),
            }),
            "me",
            text
        );
        expect(row.state).toBe("failed");
        expect(row.canRetry).toBe(true);
        expect(row.errorMessage).toBe("deck.pdf: upload failed (HTTP 413)");
        expect(row.stages[0]!.status).toBe("failed");

        const dropped = rowFromLocal(
            task({
                phase: "failed",
                failure: new SourceUploadError("deck.pdf", "upload", 0, null),
            }),
            "me",
            text
        );
        expect(dropped.errorMessage).toBe("deck.pdf: the connection dropped during the upload");
    });
});

describe("buildRows", () => {
    it("hands over to the server's row once the job is listed — never both", () => {
        const handedOff = task({
            phase: "handed-off",
            jobIds: ["job-1"],
            finishedAt: NOW - 1_000,
        });
        const before = rows({ local: [handedOff] });
        expect(before).toHaveLength(1);
        expect(before[0]!.origin).toBe("local");
        expect(before[0]!.headline).toBe("Waiting its turn");

        const after = rows({ items: [item()], local: [handedOff] });
        expect(after).toHaveLength(1);
        expect(after[0]!.origin).toBe("server");
    });

    it("lets a crawl's note go after a minute", () => {
        const crawl = task({
            kind: "link",
            phase: "handed-off",
            note: "Crawl started for example.com",
            finishedAt: NOW - 1_000,
        });
        expect(rows({ local: [crawl] })[0]!.headline).toBe(
            "Crawl started for example.com — pages appear here as they're found"
        );
        expect(rows({ local: [{ ...crawl, finishedAt: NOW - NOTE_TTL_MS - 1 }] })).toHaveLength(0);
    });

    it("orders attention, running, waiting, then finished newest first", () => {
        const ordered = rows({
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
        expect(ordered.map(row => row.jobId)).toEqual([
            "failed",
            "running",
            "waiting",
            "new-done",
            "old-done",
        ]);
    });

    it("narrows to mine, and hides finished files the viewer cleared", () => {
        const mine = rows({
            mineOnly: true,
            cleared: new Set(["done-mine"]),
            items: [
                item({ jobId: "theirs", mine: false, addedById: "them" }),
                item({ jobId: "done-mine", state: "done", stage: "ready", completedAt: iso(0) }),
                item({ jobId: "running-mine" }),
            ],
        });
        expect(mine.map(row => row.jobId)).toEqual(["running-mine"]);
    });
});

describe("summaries", () => {
    it("counts what is moving for the header and the tab", () => {
        const items = [
            item({ jobId: "a" }),
            item({ jobId: "b", state: "waiting", stage: "waiting" }),
            item({ jobId: "c", state: "failed" }),
            item({ jobId: "d", state: "done", stage: "ready", completedAt: iso(0) }),
        ];
        const all = rows({ local: [task()], items });
        const groups = groupRows(all);
        expect(summarySentence(groups, t)).toBe("2 running · 1 waiting · 1 needs attention");
        expect(queueBadge(items, [task()])).toEqual({ count: 4, tone: "danger" });
        const overall = overallProgress(groups);
        expect(overall?.count).toBe(3);
        expect(overall!.share).toBeGreaterThan(0);
        expect(overall!.share).toBeLessThan(1);
    });

    it("is all caught up when only finished files are left", () => {
        const items = [item({ state: "done", stage: "ready", completedAt: iso(0) })];
        expect(summarySentence(groupRows(rows({ items })), t)).toBe(
            "All caught up — 1 file ready in the last 24 hours"
        );
        expect(queueBadge(items, [])).toBeNull();
        expect(summarySentence(groupRows([]), t)).toBe("Nothing is processing");
    });

    it("counts a handed-off upload until its job is listed", () => {
        const handedOff = task({ phase: "handed-off", jobIds: ["job-9"], finishedAt: NOW });
        expect(queueBadge([], [handedOff])).toEqual({ count: 1, tone: "active" });
        expect(queueBadge([item({ jobId: "job-9" })], [handedOff])).toEqual({
            count: 1,
            tone: "active",
        });
    });
});

describe("formatting", () => {
    it("reads durations, folders and readers the way people say them", () => {
        expect(formatDuration(4_200, t)).toBe("4 s");
        expect(formatDuration(3 * 60_000 + 10_000, t)).toBe("3 min");
        expect(formatDuration(65 * 60_000, t)).toBe("1 h 5 min");
        expect(folderLabel("", t)).toBe("No folder");
        expect(folderLabel("Unfiled", t)).toBe("No folder");
        expect(folderLabel("Google Drive/Contracts", t)).toBe("Google Drive / Contracts");
        expect(providerLabel("DOCLING", t)).toBe("Docling");
        expect(providerLabel("SOME_NEW_READER", t)).toBe("Some New Reader");
        expect(stageProgress(stages({ added: { status: "done" } }))).toBe(1);
    });

    it("says it in Chinese for a Chinese reader", () => {
        const zh = translatorFor("zh-CN", "processing");
        expect(formatDuration(4_200, zh)).toBe("4 秒");
        expect(rowFromServer(item(), NOW, { ...text, t: zh }).headline).toBe("正在读取文本");
    });
});
