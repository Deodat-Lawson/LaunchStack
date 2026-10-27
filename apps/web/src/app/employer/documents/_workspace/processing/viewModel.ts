/**
 * What the Processing tab draws, worked out from the server's queue and the
 * adds still in the browser. Pure: no React, no fetch — tested on its own.
 * Every word comes from the `processing` catalogue through `ProcessingText`.
 */

import type { useTranslations } from "next-intl";

import { displayFolderPath, isUnfiledFolder } from "~/lib/folders/path";
import {
    QUEUE_STAGE_IDS,
    type ProcessingQueueItem,
    type QueueItemState,
    type QueueStage,
    type QueueStageId,
} from "~/lib/processing-queue/types";
import type { SourceFailure } from "~/lib/source-failure";

import { sourceUploadErrorMessage, type SourceUploadTranslator } from "../sourceUpload";
import type { LocalTask } from "./uploadTasks";

/** `useTranslations("processing")`. */
export type ProcessingTranslator = ReturnType<typeof useTranslations<"processing">>;

/** The words the view model needs, in the reader's language. */
export interface ProcessingText {
    t: ProcessingTranslator;
    /** `useTranslations("sources.sourceUpload")` — why an upload failed. */
    tu: SourceUploadTranslator;
    /** `useSourceFailureCopy().describe` — a worker's raw error, in words. */
    describeFailure: (raw: string | null | undefined) => SourceFailure;
}

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
    /** Why it stopped or is being retried, in one sentence; null when nothing went wrong. */
    errorMessage: string | null;
    /** The raw error, for "Copy details". */
    errorDetail: string | null;
    /** A server failure, categorised — whether a retry can help, what to tell support. */
    failure: SourceFailure | null;
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
    retryCount: number;
    /** Stages done, with the active one's fraction: 0…6. */
    progress: number;
}

const DAY = 24 * 60 * 60_000;
/** A handed-off add with no job to follow (a site crawl) stays this long. */
export const NOTE_TTL_MS = 60_000;

export function formatBytes(bytes: number, t: ProcessingTranslator): string {
    const fixed = (value: number, digits: number) => value.toFixed(digits);
    if (bytes < 1024) return t("size.bytes", { size: fixed(bytes, 0) });
    if (bytes < 1024 * 1024) return t("size.kb", { size: fixed(bytes / 1024, 0) });
    if (bytes < 1024 * 1024 * 1024) return t("size.mb", { size: fixed(bytes / (1024 * 1024), 1) });
    return t("size.gb", { size: fixed(bytes / (1024 * 1024 * 1024), 2) });
}

/** "4 s", "3 min", "1 h 5 min". */
export function formatDuration(ms: number, t: ProcessingTranslator): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return t("time.seconds", { count: s });
    const m = Math.floor(s / 60);
    if (m < 60) return t("time.minutes", { count: m });
    const hours = Math.floor(m / 60);
    const minutes = m % 60;
    return minutes ? t("time.hoursMinutes", { hours, minutes }) : t("time.hours", { hours });
}

/** "just now", "3 min ago", "2 h ago", "yesterday". */
export function formatAgo(iso: string, now: number, t: ProcessingTranslator): string {
    const ms = now - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 45_000) return t("time.justNow");
    if (ms < DAY) return t("time.ago", { duration: formatDuration(ms, t) });
    return t("time.yesterday");
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

/** "Docling", "Native PDF"; an unknown reader's code, title-cased. */
export function providerLabel(code: string, t: ProcessingTranslator): string {
    const key = `providers.${code.toUpperCase()}`;
    if (t.has(key as never)) return t(key as never);
    return code
        .toLowerCase()
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map(word => word[0]!.toUpperCase() + word.slice(1))
        .join(" ");
}

function serverHeadline(item: ProcessingQueueItem, now: number, t: ProcessingTranslator): string {
    const active = item.stages.find(stage => stage.id === item.stage);
    switch (item.state) {
        case "done":
            return t("headline.ready");
        case "failed":
            return t(`headline.stopped.${item.stage}`);
        case "retrying": {
            if (!item.nextAttemptAt) return t("headline.retrySoon");
            const ms = Date.parse(item.nextAttemptAt) - now;
            return !Number.isFinite(ms) || ms < 5_000
                ? t("headline.retryNow")
                : t("headline.retryIn", { duration: formatDuration(ms, t) });
        }
        case "waiting":
            if (item.stage === "waiting" || item.stage === "added") {
                return t("headline.waitingTurn");
            }
            return t(`headline.waitingFor.${item.stage}`);
        case "running":
            switch (item.stage) {
                case "reading":
                    return t("headline.reading");
                case "splitting":
                    return t("headline.splitting");
                case "indexing": {
                    const share = percent(active?.done, active?.total);
                    return share === null
                        ? t("headline.indexing")
                        : t("headline.indexingPercent", { percent: Math.round(share * 100) });
                }
                case "ready":
                    return t("headline.finishing");
                default:
                    return t("headline.starting");
            }
    }
}

function serverDetail(item: ProcessingQueueItem, t: ProcessingTranslator): string | null {
    const parts: string[] = [];
    const indexing = item.stages.find(stage => stage.id === "indexing");
    if (item.state === "retrying" || (item.state === "running" && item.attempt > 1)) {
        parts.push(t("detail.attempt", { attempt: item.attempt, max: item.maxAttempts }));
    }
    if (item.state === "running" && item.stage === "indexing" && indexing?.total) {
        parts.push(t("detail.sections", { done: indexing.done ?? 0, total: indexing.total }));
    }
    if (item.provider) parts.push(providerLabel(item.provider, t));
    if (item.pageCount) parts.push(t("detail.pages", { count: item.pageCount }));
    if (item.state === "done" && item.startedAt && item.completedAt) {
        const took = Date.parse(item.completedAt) - Date.parse(item.startedAt);
        parts.push(t("detail.took", { duration: formatDuration(took, t) }));
    }
    return parts.length ? parts.join(t("detail.separator")) : null;
}

export function rowFromServer(
    item: ProcessingQueueItem,
    now: number,
    text: ProcessingText
): QueueRow {
    const failure = item.error !== null ? text.describeFailure(item.error) : null;
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
        headline: serverHeadline(item, now, text.t),
        detail: serverDetail(item, text.t),
        errorMessage: failure?.message ?? null,
        errorDetail: failure?.detail ?? null,
        failure,
        attempt: item.attempt,
        maxAttempts: item.maxAttempts,
        nextAttemptAt: item.nextAttemptAt,
        createdAt: item.createdAt,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        documentId: item.documentId,
        jobId: item.jobId,
        localId: null,
        canRetry: item.canRetry && (failure?.retryable ?? true),
        retryCount: item.retryCount,
        progress: stageProgress(item.stages),
    };
}

/** Why a browser task failed, in the reader's words. */
function localFailureMessage(task: LocalTask, text: ProcessingText): string {
    if (task.kind === "file") {
        return sourceUploadErrorMessage(
            task.failure,
            text.tu,
            text.t("local.uploadFailed", { name: task.name })
        );
    }
    // A link's error is the server's own sentence.
    return task.failure instanceof Error && task.failure.message
        ? task.failure.message
        : text.t("local.linkFailed", { name: task.name });
}

export function rowFromLocal(
    task: LocalTask,
    viewerId: string | null,
    text: ProcessingText
): QueueRow {
    const { t } = text;
    const stages = pendingStages();
    const added = stages[0]!;
    const waiting = stages[1]!;
    const started = new Date(task.createdAt).toISOString();
    const finished = task.finishedAt ? new Date(task.finishedAt).toISOString() : null;
    let state: QueueItemState = "running";
    let headline: string;
    let detail: string | null = null;
    let stage: QueueStageId = "added";
    let errorMessage: string | null = null;

    switch (task.phase) {
        case "waiting":
            state = "waiting";
            headline = t("local.waitingUpload");
            detail = task.total ? formatBytes(task.total, t) : null;
            break;
        case "uploading": {
            added.status = "active";
            added.startedAt = started;
            added.done = task.loaded;
            added.total = task.total;
            const share = percent(task.loaded, task.total) ?? 0;
            headline = t("local.uploading", { percent: Math.round(share * 100) });
            detail = task.total
                ? t("local.uploadedOf", {
                      loaded: formatBytes(task.loaded, t),
                      total: formatBytes(task.total, t),
                  })
                : null;
            break;
        }
        case "working":
            added.status = "active";
            added.startedAt = started;
            headline = task.work ? t(`work.${task.work}`) : t("headline.starting");
            detail = task.kind === "file" ? t("local.keepOpen") : t("local.serverFetching");
            break;
        case "failed":
            state = "failed";
            added.status = "failed";
            added.startedAt = started;
            added.endedAt = finished;
            headline = task.kind === "file" ? t("local.failedFile") : t("local.failedLink");
            errorMessage = localFailureMessage(task, text);
            break;
        case "handed-off":
            state = "waiting";
            added.status = "done";
            added.startedAt = started;
            added.endedAt = finished;
            waiting.status = "active";
            waiting.startedAt = finished;
            stage = "waiting";
            headline = task.note
                ? t("local.crawlNote", { message: task.note })
                : t("headline.waitingTurn");
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
        errorMessage,
        errorDetail: null,
        failure: null,
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
        retryCount: 0,
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
    text: ProcessingText;
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
        rows.push(rowFromLocal(task, input.viewerId, input.text));
    }
    for (const item of input.items) {
        if (item.state === "done" && input.cleared.has(item.jobId)) continue;
        rows.push(rowFromServer(item, input.now, input.text));
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
export function summarySentence(groups: RowGroups, t: ProcessingTranslator): string {
    const parts: string[] = [];
    if (groups.running.length) parts.push(t("summary.running", { count: groups.running.length }));
    if (groups.waiting.length) parts.push(t("summary.waiting", { count: groups.waiting.length }));
    if (groups.attention.length) {
        parts.push(t("summary.attention", { count: groups.attention.length }));
    }
    if (parts.length === 0) {
        return groups.done.length
            ? t("summary.allCaughtUp", { count: groups.done.length })
            : t("summary.nothing");
    }
    return parts.join(t("summary.separator"));
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

/**
 * The count beside the tab's name: files still moving, and whether anything
 * failed. Counts the same rows the tab shows (finished ones aside), without
 * wording them.
 */
export function queueBadge(
    items: readonly ProcessingQueueItem[],
    local: readonly LocalTask[]
): { count: number; tone: "active" | "danger" } | null {
    const serverJobs = new Set(items.map(item => item.jobId));
    let failed = 0;
    let moving = 0;
    for (const task of local) {
        if (task.phase === "failed") failed += 1;
        else if (task.phase !== "handed-off") moving += 1;
        else if (task.jobIds.some(id => !serverJobs.has(id))) moving += 1;
    }
    for (const item of items) {
        if (item.state === "failed") failed += 1;
        else if (item.state !== "done") moving += 1;
    }
    if (failed) return { count: failed + moving, tone: "danger" };
    if (moving) return { count: moving, tone: "active" };
    return null;
}

/** Where the file lives, as the sidebar names it; "No folder" for a loose one. */
export function folderLabel(folder: string, t: ProcessingTranslator): string {
    if (!folder || isUnfiledFolder(folder)) return t("noFolder");
    return displayFolderPath(folder);
}
