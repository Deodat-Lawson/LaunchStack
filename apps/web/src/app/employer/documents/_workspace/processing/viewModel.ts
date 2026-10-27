/**
 * What the Processing tab draws, worked out from the server's queue and the
 * adds still in the browser. Pure: no React, no fetch — tested on its own.
 */

import {
    QUEUE_STAGE_IDS,
    type ProcessingQueueItem,
    type QueueItemError,
    type QueueItemState,
    type QueueStage,
    type QueueStageId,
} from "~/lib/processing-queue/types";

import { displayFolderPath, isUnfiledFolder } from "~/lib/folders/path";

import type { LocalTask } from "./uploadTasks";

export const STAGE_LABEL: Record<QueueStageId, string> = {
    added: "Added",
    waiting: "Waiting",
    reading: "Reading",
    splitting: "Splitting",
    indexing: "Indexing",
    ready: "Ready",
};

/** What each stage does, for a tooltip or a screen reader. */
export const STAGE_ABOUT: Record<QueueStageId, string> = {
    added: "The file reaches storage",
    waiting: "In line for a free worker",
    reading: "Reading the text, with OCR for scans and images",
    splitting: "Splitting the text into sections",
    indexing: "Indexing each section for search",
    ready: "Finishing up, then it can be cited",
};

export type RowSection = "attention" | "running" | "waiting" | "done";

export interface QueueRow {
    key: string;
    origin: "local" | "server";
    name: string;
    folder: string;
    mimeType: string | null;
    addedById: string | null;
    mine: boolean;
    state: QueueItemState;
    section: RowSection;
    stage: QueueStageId;
    stages: QueueStage[];
    /** The one line under the name: what is happening now. */
    headline: string;
    /** Supporting facts: provider, pages, attempt, bytes. */
    detail: string | null;
    error: QueueItemError | null;
    attempt: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    documentId: number | null;
    jobId: string | null;
    localId: string | null;
    canRetry: boolean;
    pageCount: number | null;
    provider: string | null;
    /** Stages done, with the active one's fraction: 0…6. */
    progress: number;
}

const DAY = 24 * 60 * 60_000;
/** A handed-off add with no job to follow (a site crawl) stays this long. */
export const NOTE_TTL_MS = 60_000;

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** "4 s", "3 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "just now", "3 min ago", "2 h ago", "yesterday". */
export function formatAgo(iso: string, now: number): string {
    const ms = now - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 45_000) return "just now";
    if (ms < DAY) return `${formatDuration(ms)} ago`;
    return "yesterday";
}

/** "in 40 s", "in 3 min", "any moment now". */
export function formatIn(iso: string, now: number): string {
    const ms = Date.parse(iso) - now;
    if (!Number.isFinite(ms) || ms < 5_000) return "any moment now";
    return `in ${formatDuration(ms)}`;
}

function percent(done: number | undefined, total: number | undefined): number | null {
    if (!total || total <= 0 || done === undefined) return null;
    return Math.max(0, Math.min(1, done / total));
}

/** Stages done, plus the active stage's share when it knows one (0…6). */
export function stageProgress(stages: QueueStage[]): number {
    let value = 0;
    for (const stage of stages) {
        if (stage.status === "done") value += 1;
        else if (stage.status === "active") value += percent(stage.done, stage.total) ?? 0;
    }
    return value;
}

function sectionOf(state: QueueItemState): RowSection {
    if (state === "failed" || state === "retrying") return "attention";
    if (state === "running") return "running";
    if (state === "waiting") return "waiting";
    return "done";
}

function pendingStages(): QueueStage[] {
    return QUEUE_STAGE_IDS.map(id => ({
        id,
        status: "pending" as const,
        startedAt: null,
        endedAt: null,
    }));
}

function plural(n: number, one: string, many = `${one}s`): string {
    return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function serverHeadline(item: ProcessingQueueItem, now: number): string {
    const active = item.stages.find(stage => stage.id === item.stage);
    switch (item.state) {
        case "done":
            return "Ready to search";
        case "failed":
            return `Stopped while ${STAGE_LABEL[item.stage].toLowerCase()}`;
        case "retrying":
            return item.nextAttemptAt
                ? `Trying again ${formatIn(item.nextAttemptAt, now)}`
                : "Trying again soon";
        case "waiting":
            if (item.stage === "waiting" || item.stage === "added") return "Waiting its turn";
            return `Waiting to start ${STAGE_LABEL[item.stage].toLowerCase()}`;
        case "running":
            switch (item.stage) {
                case "reading":
                    return "Reading the text";
                case "splitting":
                    return "Splitting into sections";
                case "indexing": {
                    const share = percent(active?.done, active?.total);
                    return share === null
                        ? "Indexing for search"
                        : `Indexing for search · ${Math.round(share * 100)}%`;
                }
                case "ready":
                    return "Finishing up";
                default:
                    return "Starting";
            }
    }
}

function serverDetail(item: ProcessingQueueItem): string | null {
    const parts: string[] = [];
    const indexing = item.stages.find(stage => stage.id === "indexing");
    if (item.state === "retrying" || (item.state === "running" && item.attempt > 1)) {
        parts.push(`Attempt ${item.attempt} of ${item.maxAttempts}`);
    }
    if (item.state === "running" && item.stage === "indexing" && indexing?.total) {
        parts.push(
            `${(indexing.done ?? 0).toLocaleString()} of ${plural(indexing.total, "section")}`
        );
    }
    if (item.provider) parts.push(item.provider);
    if (item.pageCount) parts.push(plural(item.pageCount, "page"));
    if (item.state === "done" && item.startedAt && item.completedAt) {
        parts.push(
            `took ${formatDuration(Date.parse(item.completedAt) - Date.parse(item.startedAt))}`
        );
    }
    return parts.length ? parts.join(" · ") : null;
}

export function rowFromServer(item: ProcessingQueueItem, now: number): QueueRow {
    return {
        key: `job:${item.jobId}`,
        origin: "server",
        name: item.name,
        folder: item.folder,
        mimeType: item.mimeType,
        addedById: item.addedById,
        mine: item.mine,
        state: item.state,
        section: sectionOf(item.state),
        stage: item.stage,
        stages: item.stages,
        headline: serverHeadline(item, now),
        detail: serverDetail(item),
        error: item.error,
        attempt: item.attempt,
        maxAttempts: item.maxAttempts,
        nextAttemptAt: item.nextAttemptAt,
        createdAt: item.createdAt,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        documentId: item.documentId,
        jobId: item.jobId,
        localId: null,
        canRetry: item.canRetry,
        pageCount: item.pageCount,
        provider: item.provider,
        progress: stageProgress(item.stages),
    };
}

export function rowFromLocal(task: LocalTask, viewerId: string | null): QueueRow {
    const stages = pendingStages();
    const added = stages[0]!;
    const waiting = stages[1]!;
    const started = new Date(task.createdAt).toISOString();
    const finished = task.finishedAt ? new Date(task.finishedAt).toISOString() : null;
    let state: QueueItemState = "running";
    let headline: string;
    let detail: string | null = null;
    let stage: QueueStageId = "added";

    switch (task.phase) {
        case "waiting":
            state = "waiting";
            headline = "Waiting to upload";
            detail = task.total ? formatBytes(task.total) : null;
            break;
        case "uploading": {
            added.status = "active";
            added.startedAt = started;
            added.done = task.loaded;
            added.total = task.total;
            const share = percent(task.loaded, task.total) ?? 0;
            headline = `Uploading · ${Math.round(share * 100)}%`;
            detail = task.total
                ? `${formatBytes(task.loaded)} of ${formatBytes(task.total)}`
                : null;
            break;
        }
        case "working":
            added.status = "active";
            added.startedAt = started;
            headline = task.workLabel ?? "Working on it";
            detail =
                task.kind === "file"
                    ? "Done before processing starts — keep this page open"
                    : "The server is fetching it";
            break;
        case "failed":
            state = "failed";
            added.status = "failed";
            added.startedAt = started;
            added.endedAt = finished;
            headline = task.kind === "file" ? "Upload failed" : "Couldn't add it";
            break;
        case "handed-off":
            state = "waiting";
            added.status = "done";
            added.startedAt = started;
            added.endedAt = finished;
            waiting.status = "active";
            waiting.startedAt = finished;
            stage = "waiting";
            headline = task.note ?? "Waiting its turn";
            break;
    }

    return {
        key: `local:${task.id}`,
        origin: "local",
        name: task.name,
        folder: task.category,
        mimeType: task.mimeType,
        addedById: viewerId,
        mine: true,
        state,
        section: sectionOf(state),
        stage,
        stages,
        headline,
        detail,
        error: task.error ? { message: task.error, detail: null } : null,
        attempt: 0,
        maxAttempts: 0,
        nextAttemptAt: null,
        createdAt: started,
        startedAt: started,
        completedAt: finished,
        documentId: null,
        jobId: task.jobIds[0] ?? null,
        localId: task.id,
        canRetry: task.phase === "failed",
        pageCount: null,
        provider: null,
        progress: stageProgress(stages),
    };
}

export interface BuildRowsInput {
    items: ProcessingQueueItem[];
    local: LocalTask[];
    viewerId: string | null;
    /** Job ids the viewer cleared from Finished. */
    cleared: ReadonlySet<string>;
    mineOnly: boolean;
    now: number;
}

/**
 * The rows, deduplicated: once the server lists a job a browser task started,
 * the server's row stands in for it.
 */
export function buildRows(input: BuildRowsInput): QueueRow[] {
    const serverJobs = new Set(input.items.map(item => item.jobId));
    const rows: QueueRow[] = [];
    for (const task of input.local) {
        if (task.phase === "handed-off") {
            if (task.jobIds.length > 0 && task.jobIds.every(id => serverJobs.has(id))) continue;
            if (
                task.jobIds.length === 0 &&
                task.finishedAt &&
                input.now - task.finishedAt > NOTE_TTL_MS
            ) {
                continue;
            }
        }
        rows.push(rowFromLocal(task, input.viewerId));
    }
    for (const item of input.items) {
        if (item.state === "done" && input.cleared.has(item.jobId)) continue;
        rows.push(rowFromServer(item, input.now));
    }
    const visible = input.mineOnly ? rows.filter(row => row.mine) : rows;
    return visible.sort(compareRows);
}

const SECTION_ORDER: Record<RowSection, number> = { attention: 0, running: 1, waiting: 2, done: 3 };

function compareRows(a: QueueRow, b: QueueRow): number {
    const bySection = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
    if (bySection) return bySection;
    // Finished: newest first. Everything else: in the order it was added, the
    // order the worker takes it in.
    if (a.section === "done") {
        return Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt);
    }
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export interface RowGroups {
    attention: QueueRow[];
    running: QueueRow[];
    waiting: QueueRow[];
    done: QueueRow[];
}

export function groupRows(rows: QueueRow[]): RowGroups {
    const groups: RowGroups = { attention: [], running: [], waiting: [], done: [] };
    for (const row of rows) groups[row.section].push(row);
    return groups;
}

/** The header's one sentence. */
export function summarySentence(groups: RowGroups): string {
    const parts: string[] = [];
    if (groups.running.length) parts.push(`${groups.running.length} running`);
    if (groups.waiting.length) parts.push(`${groups.waiting.length} waiting`);
    if (groups.attention.length) {
        parts.push(
            `${groups.attention.length} need${groups.attention.length === 1 ? "s" : ""} attention`
        );
    }
    if (parts.length === 0) {
        return groups.done.length
            ? `All caught up — ${plural(groups.done.length, "file")} ready in the last 24 hours`
            : "Nothing is processing";
    }
    return parts.join(" · ");
}

/**
 * How far the files still in progress have come, all together (0…1), and
 * how many there are — the bar under the header. Null when none are.
 */
export function overallProgress(groups: RowGroups): { share: number; count: number } | null {
    const moving = [...groups.running, ...groups.waiting, ...groups.attention].filter(
        row => row.state !== "failed"
    );
    if (moving.length === 0) return null;
    const total = moving.length * QUEUE_STAGE_IDS.length;
    const done = moving.reduce((sum, row) => sum + row.progress, 0);
    return { share: done / total, count: moving.length };
}

/** The count beside the tab's name: what is still moving, and whether anything failed. */
export function tabBadge(rows: QueueRow[]): { count: number; tone: "active" | "danger" } | null {
    const failed = rows.filter(row => row.state === "failed").length;
    const moving = rows.filter(
        row => row.section === "running" || row.section === "waiting" || row.state === "retrying"
    ).length;
    if (failed) return { count: failed + moving, tone: "danger" };
    if (moving) return { count: moving, tone: "active" };
    return null;
}

/** Where the file lives, as the sidebar names it; "No folder" for a loose one. */
export function folderLabel(folder: string): string {
    if (!folder || isUnfiledFolder(folder)) return "No folder";
    return displayFolderPath(folder);
}
