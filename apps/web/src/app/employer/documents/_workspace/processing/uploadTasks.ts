"use client";

/**
 * Adds that are still in the browser: the bytes of a file on their way to
 * storage, or a request the server works through before any job exists (a
 * recording transcribed, a page fetched, a video downloaded). The Add a source
 * dialog hands them here and closes; the Processing tab shows them as the
 * first stage of each file's bar, then follows the job the server started.
 *
 * A module-level store, not component state: the dialog that started an
 * upload unmounts straight away, and the upload has to outlive it. It lives
 * as long as the page — a reload drops what was still uploading, which is why
 * the workspace warns before leaving while anything is (see
 * `hasUnfinishedLocalTasks`).
 */

import { useSyncExternalStore } from "react";

import { registerDocument, uploadFileToStorage, type RegisteredDocument } from "../sourceUpload";

export type LocalTaskPhase =
    /** Waiting for a free upload slot. */
    | "waiting"
    /** Bytes going up; `loaded` / `total` say how far. */
    | "uploading"
    /** The server is working on the request (`work` says what). */
    | "working"
    /** It never reached the queue; `failure` says why. */
    | "failed"
    /** The server took it: `jobIds` are what the queue follows from here. */
    | "handed-off";

/**
 * What the server is doing with a request before any job exists — a key the
 * Processing tab words (`processing.work.<kind>`).
 */
export type LocalWork =
    | "transcribing"
    | "starting"
    | "fetchingPage"
    | "startingCrawl"
    | "downloadingVideo";

export interface LocalTask {
    id: string;
    name: string;
    /** The folder it goes to ("" or "Unfiled" = no folder). */
    category: string;
    kind: "file" | "link";
    mimeType: string | null;
    phase: LocalTaskPhase;
    /** Bytes sent so far, for a file. */
    loaded: number;
    /** Bytes in all, for a file (its size). */
    total: number;
    /** What the server is doing with it, while `working`. */
    work: LocalWork | null;
    /**
     * Why it failed: a `SourceUploadError` for a file (worded in the reader's
     * language by `sourceUploadErrorMessage`), or an Error carrying the
     * server's own sentence for a link.
     */
    failure: unknown;
    /** Ingestion jobs the server started for it. Empty while in the browser. */
    jobIds: string[];
    /** A request that queued work without naming a job (a site crawl): the server's sentence. */
    note: string | null;
    createdAt: number;
    /** When it left the browser (handed off or failed). */
    finishedAt: number | null;
}

/** How a link-shaped add reports back: the jobs it started, or a sentence. */
export interface LinkTaskResult {
    jobIds?: string[];
    note?: string | null;
}

/** Files upload two at a time; the rest wait their turn in the browser. */
export const UPLOAD_CONCURRENCY = 2;

type Listener = () => void;
type RegisteredListener = (task: LocalTask) => void;

let tasks: LocalTask[] = [];
const listeners = new Set<Listener>();
const registeredListeners = new Set<RegisteredListener>();
/** What it takes to run a task again — the file, or the request — kept off the snapshot. */
const runners = new Map<string, () => Promise<void>>();
const pending: string[] = [];
let running = 0;
let seq = 0;

function emit() {
    for (const listener of listeners) listener();
}

function update(id: string, patch: Partial<LocalTask>) {
    let changed: LocalTask | null = null;
    tasks = tasks.map(task => {
        if (task.id !== id) return task;
        changed = { ...task, ...patch };
        return changed;
    });
    if (changed) emit();
    return changed as LocalTask | null;
}

function nextId(): string {
    seq += 1;
    return `local-${Date.now().toString(36)}-${seq}`;
}

function pump() {
    while (running < UPLOAD_CONCURRENCY && pending.length > 0) {
        const id = pending.shift()!;
        const run = runners.get(id);
        if (!run) continue;
        running += 1;
        void run().finally(() => {
            running -= 1;
            pump();
        });
    }
}

function handOff(id: string, result: LinkTaskResult) {
    const done = update(id, {
        phase: "handed-off",
        jobIds: result.jobIds ?? [],
        note: result.note ?? null,
        work: null,
        finishedAt: Date.now(),
    });
    if (done) for (const listener of registeredListeners) listener(done);
}

function fail(id: string, err: unknown) {
    update(id, {
        phase: "failed",
        failure: err ?? new Error("failed"),
        work: null,
        finishedAt: Date.now(),
    });
}

/** A recording is transcribed inside the register request, before any job exists. */
function isRecording(file: File): boolean {
    if (file.type.startsWith("audio/")) return true;
    return /\.(mp3|m4a|wav|aac|ogg|oga|flac|webm|opus|aiff?)$/i.test(file.name);
}

export interface FileUpload {
    file: File;
    /** The folder this file goes to. */
    category: string;
    /** Its name in the library, when it should not be the file's own name. */
    documentName?: string;
}

/**
 * Upload files and register them, two at a time. Returns at once; follow the
 * tasks with `useLocalTasks`.
 */
export function startFileUploads(uploads: FileUpload[]): string[] {
    const created: LocalTask[] = uploads.map(({ file, category, documentName }) => ({
        id: nextId(),
        name: documentName ?? file.name,
        category,
        kind: "file",
        mimeType: file.type || null,
        phase: "waiting",
        loaded: 0,
        total: file.size,
        work: null,
        failure: null,
        jobIds: [],
        note: null,
        createdAt: Date.now(),
        finishedAt: null,
    }));
    created.forEach((task, i) => {
        const { file, category, documentName } = uploads[i]!;
        runners.set(task.id, async () => {
            update(task.id, {
                phase: "uploading",
                loaded: 0,
                failure: null,
                finishedAt: null,
            });
            try {
                const stored = await uploadFileToStorage(file, {
                    onProgress: (loaded, total) => update(task.id, { loaded, total }),
                });
                update(task.id, {
                    phase: "working",
                    loaded: task.total,
                    work: isRecording(file) ? "transcribing" : "starting",
                });
                const registered: RegisteredDocument = await registerDocument({
                    file,
                    url: stored.url,
                    provider: stored.provider,
                    category,
                    documentName,
                });
                handOff(task.id, { jobIds: registered?.jobId ? [registered.jobId] : [] });
            } catch (err) {
                fail(task.id, err);
            }
        });
        pending.push(task.id);
    });
    tasks = [...tasks, ...created];
    emit();
    pump();
    return created.map(task => task.id);
}

/**
 * A request the server does in one go — fetch a page, download and transcribe
 * a video. Shown as "working" with `work` until it answers.
 */
export function startLinkTask(params: {
    name: string;
    category: string;
    work: LocalWork;
    run: () => Promise<LinkTaskResult>;
}): string {
    const task: LocalTask = {
        id: nextId(),
        name: params.name,
        category: params.category,
        kind: "link",
        mimeType: null,
        phase: "working",
        loaded: 0,
        total: 0,
        work: params.work,
        failure: null,
        jobIds: [],
        note: null,
        createdAt: Date.now(),
        finishedAt: null,
    };
    const run = async () => {
        update(task.id, {
            phase: "working",
            work: params.work,
            failure: null,
            finishedAt: null,
        });
        try {
            handOff(task.id, await params.run());
        } catch (err) {
            fail(task.id, err);
        }
    };
    runners.set(task.id, run);
    tasks = [...tasks, task];
    emit();
    void run();
    return task.id;
}

/** Run a failed task again from the start (the bytes, or the request). */
export function retryLocalTask(id: string): void {
    const task = tasks.find(t => t.id === id);
    const run = runners.get(id);
    if (!task || task.phase !== "failed" || !run) return;
    if (task.kind === "file") {
        update(id, { phase: "waiting", failure: null, finishedAt: null, loaded: 0 });
        pending.push(id);
        pump();
    } else {
        void run();
    }
}

/** Forget a task: a failure someone has read, or one the queue now follows. */
export function dismissLocalTask(id: string): void {
    const before = tasks.length;
    tasks = tasks.filter(task => task.id !== id);
    runners.delete(id);
    if (tasks.length !== before) emit();
}

/** True while something has not left the browser — leaving the page would lose it. */
export function hasUnfinishedLocalTasks(): boolean {
    return tasks.some(task => task.phase === "waiting" || task.phase === "uploading");
}

/** Called once each time a task is handed to the server. Returns the unsubscribe. */
export function onLocalTaskHandedOff(listener: RegisteredListener): () => void {
    registeredListeners.add(listener);
    return () => registeredListeners.delete(listener);
}

function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function snapshot(): LocalTask[] {
    return tasks;
}

const EMPTY: LocalTask[] = [];

/** Every task still in the browser or recently handed off, in the order they were added. */
export function useLocalTasks(): LocalTask[] {
    return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** Tests only: start from nothing (call after the previous test unmounted). */
export function resetLocalTasksForTests(): void {
    tasks = [];
    runners.clear();
    pending.length = 0;
    running = 0;
    registeredListeners.clear();
}
