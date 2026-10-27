"use client";

/**
 * Local harness for the Processing tab. Mounts the real pane with its
 * session-guarded routes stubbed by a simulated worker, so every state can be
 * looked at without a backend:
 *
 * - three files walk through Waiting → Reading → Splitting → Indexing → Ready
 *   on a clock (Indexing counts sections), one after another;
 * - one is retrying (attempt 3 of 8, next try in a few minutes);
 * - one failed while reading, and Retry starts it over;
 * - a Google Drive sync is running;
 * - "Simulate an upload" sends a real `File` through the upload store, with
 *   `XMLHttpRequest` faked so the bytes "go up" over three seconds.
 *
 * `?empty=1` starts with nothing; `?error=1` makes the queue request fail.
 * Gated by the page.
 */

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import type {
    ConnectorSyncSummary,
    ProcessingQueueItem,
    ProcessingQueueResponse,
    QueueItemState,
    QueueStage,
    QueueStageId,
} from "~/lib/processing-queue/types";
import { QUEUE_STAGE_IDS } from "~/lib/processing-queue/types";

import { ProcessingQueuePane } from "~/app/employer/documents/_workspace/processing/ProcessingQueuePane";
import { startFileUploads } from "~/app/employer/documents/_workspace/processing/uploadTasks";

const VIEWER = "user_owner";
const TEAMMATE = "user_teammate";

interface SimJob {
    jobId: string;
    name: string;
    folder: string;
    mimeType: string;
    addedById: string;
    createdAt: number;
    /** Ms spent in each of waiting, reading, splitting, indexing, ready. */
    plan: [number, number, number, number, number];
    sections: number;
    pages: number;
    provider: string;
    /** Fixed states that don't move on the clock. */
    fixed?: "retrying" | "failed" | "done";
}

const now = () => Date.now();

function seed(): SimJob[] {
    const t = now();
    return [
        {
            jobId: "job-board-deck",
            name: "Q3 board deck.pdf",
            folder: "Board",
            mimeType: "application/pdf",
            addedById: VIEWER,
            createdAt: t - 2_000,
            plan: [1_500, 9_000, 2_500, 14_000, 1_500],
            sections: 186,
            pages: 42,
            provider: "Docling",
        },
        {
            jobId: "job-scan",
            name: "Signed lease (scan).pdf",
            folder: "Legal/Leases",
            mimeType: "application/pdf",
            addedById: TEAMMATE,
            createdAt: t - 1_000,
            plan: [6_000, 12_000, 2_000, 9_000, 1_500],
            sections: 64,
            pages: 18,
            provider: "Azure",
        },
        {
            jobId: "job-notes",
            name: "Customer interview notes.md",
            folder: "Research",
            mimeType: "text/markdown",
            addedById: VIEWER,
            createdAt: t,
            plan: [12_000, 1_500, 1_000, 3_000, 800],
            sections: 12,
            pages: 1,
            provider: "Text",
        },
        {
            jobId: "job-retrying",
            name: "Pricing model.xlsx",
            folder: "Finance",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            addedById: VIEWER,
            createdAt: t - 6 * 60_000,
            plan: [0, 0, 0, 0, 0],
            sections: 0,
            pages: 0,
            provider: "Docling",
            fixed: "retrying",
        },
        {
            jobId: "job-failed",
            name: "Vendor contract.docx",
            folder: "Google Drive/Contracts",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            addedById: TEAMMATE,
            createdAt: t - 40 * 60_000,
            plan: [0, 0, 0, 0, 0],
            sections: 0,
            pages: 0,
            provider: "Docling",
            fixed: "failed",
        },
        {
            jobId: "job-done",
            name: "Founder update — September.pdf",
            folder: "",
            mimeType: "application/pdf",
            addedById: VIEWER,
            createdAt: t - 3 * 60 * 60_000,
            plan: [0, 0, 0, 0, 0],
            sections: 30,
            pages: 6,
            provider: "Native PDF",
            fixed: "done",
        },
    ];
}

const iso = (ms: number) => new Date(ms).toISOString();

const STAGE_FOR: QueueStageId[] = ["waiting", "reading", "splitting", "indexing", "ready"];

function itemFor(job: SimJob, at: number): ProcessingQueueItem {
    const stages: QueueStage[] = QUEUE_STAGE_IDS.map(id => ({
        id,
        status: "pending",
        startedAt: null,
        endedAt: null,
    }));
    const added = stages[0]!;
    added.status = "done";
    added.startedAt = iso(job.createdAt);
    added.endedAt = iso(job.createdAt);
    const base = {
        jobId: job.jobId,
        documentId: 9000 + job.jobId.length,
        name: job.name,
        folder: job.folder,
        mimeType: job.mimeType,
        addedById: job.addedById,
        mine: job.addedById === VIEWER,
        maxAttempts: 8,
        createdAt: iso(job.createdAt),
        canRetry: false,
        stageSource: "recorded" as const,
    };

    if (job.fixed === "done") {
        for (const stage of stages) {
            stage.status = "done";
            stage.startedAt = iso(job.createdAt);
            stage.endedAt = iso(job.createdAt + 20_000);
        }
        return {
            ...base,
            state: "done",
            stage: "ready",
            stages,
            attempt: 1,
            nextAttemptAt: null,
            error: null,
            pageCount: job.pages,
            provider: job.provider,
            startedAt: iso(job.createdAt + 1_000),
            completedAt: iso(job.createdAt + 21_000),
        };
    }
    if (job.fixed === "retrying" || job.fixed === "failed") {
        stages[1]!.status = "done";
        stages[1]!.startedAt = iso(job.createdAt);
        stages[1]!.endedAt = iso(job.createdAt + 2_000);
        stages[2]!.status = job.fixed === "failed" ? "failed" : "active";
        stages[2]!.startedAt = iso(job.createdAt + 2_000);
        if (job.fixed === "failed") stages[2]!.endedAt = iso(job.createdAt + 30 * 60_000);
        const state: QueueItemState = job.fixed;
        return {
            ...base,
            state,
            stage: "reading",
            stages,
            attempt: job.fixed === "failed" ? 8 : 3,
            nextAttemptAt: job.fixed === "retrying" ? iso(at + 3 * 60_000 + 20_000) : null,
            error:
                job.fixed === "failed"
                    ? {
                          message: "The converter couldn't open this file.",
                          detail: 'pipeline dead after max attempts: Document converter /convert failed: 400 Bad Request — {"error":{"code":"unsupported-file"}}',
                      }
                    : {
                          message:
                              "The AI provider is out of credit or rate-limited — try again later.",
                          detail: "429 Too Many Requests",
                      },
            pageCount: null,
            provider: job.provider,
            startedAt: iso(job.createdAt + 2_000),
            completedAt: job.fixed === "failed" ? iso(job.createdAt + 30 * 60_000) : null,
            canRetry: job.fixed === "failed",
        };
    }

    // On the clock: which stage is it in?
    let elapsed = at - job.createdAt;
    let index = 0;
    let stageStart = job.createdAt;
    while (index < job.plan.length && elapsed >= job.plan[index]!) {
        elapsed -= job.plan[index]!;
        stageStart += job.plan[index]!;
        index += 1;
    }
    let cursor = job.createdAt;
    for (let i = 0; i < STAGE_FOR.length; i++) {
        const stage = stages[i + 1]!;
        if (i < index) {
            stage.status = "done";
            stage.startedAt = iso(cursor);
            stage.endedAt = iso(cursor + job.plan[i]!);
        } else if (i === index) {
            stage.status = "active";
            stage.startedAt = iso(stageStart);
        }
        cursor += job.plan[i]!;
    }
    if (index >= STAGE_FOR.length) {
        return {
            ...base,
            state: "done",
            stage: "ready",
            stages,
            attempt: 1,
            nextAttemptAt: null,
            error: null,
            pageCount: job.pages,
            provider: job.provider,
            startedAt: iso(job.createdAt + job.plan[0]),
            completedAt: iso(cursor),
        };
    }
    const indexing = stages[4]!;
    if (index === 3) {
        indexing.total = job.sections;
        indexing.done = Math.floor((elapsed / job.plan[3]) * job.sections);
    }
    if (index >= 2) stages[2]!.detail = `${job.provider} · ${job.pages} pages`;
    return {
        ...base,
        state: index === 0 ? "waiting" : "running",
        stage: index === 0 ? "waiting" : STAGE_FOR[index]!,
        stages,
        attempt: index === 0 ? 0 : 1,
        nextAttemptAt: null,
        error: null,
        pageCount: index >= 2 ? job.pages : null,
        provider: index >= 2 ? job.provider : null,
        startedAt: index === 0 ? null : iso(job.createdAt + job.plan[0]),
        completedAt: null,
    };
}

function respond(jobs: SimJob[], driveStarted: number): ProcessingQueueResponse {
    const at = now();
    const items = jobs.map(job => itemFor(job, at));
    const connectors: ConnectorSyncSummary[] = [
        at - driveStarted < 25_000
            ? {
                  provider: "google-drive",
                  account: "founders@example.com",
                  status: "running",
                  lastSyncAt: iso(driveStarted),
                  report: null,
                  error: null,
              }
            : {
                  provider: "google-drive",
                  account: "founders@example.com",
                  status: "ok",
                  lastSyncAt: iso(driveStarted + 25_000),
                  report: { discovered: 14, stored: 3, unchanged: 11, skipped: 0, failed: 0 },
                  error: null,
              },
    ];
    const count = (state: QueueItemState) => items.filter(item => item.state === state).length;
    return {
        items,
        connectors,
        summary: {
            running: count("running"),
            waiting: count("waiting"),
            retrying: count("retrying"),
            failed: count("failed"),
            done: count("done"),
        },
        serverTime: iso(at),
    };
}

/** Bytes "go up" over three seconds; then the register call answers with a job. */
class FakeUploadXhr {
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = "";
    open() {
        // Nothing to open: send() simulates the whole request.
    }
    abort() {
        this.onabort?.();
    }
    send(body: FormData) {
        const file = body.get("file") as File | null;
        const total = Math.max(file?.size ?? 1, 1);
        let step = 0;
        const tick = window.setInterval(() => {
            step += 1;
            this.upload.onprogress?.({
                lengthComputable: true,
                loaded: Math.min(total, Math.round((total * step) / 15)),
                total,
            } as ProgressEvent);
            if (step >= 15) {
                window.clearInterval(tick);
                this.status = 200;
                this.responseText = JSON.stringify({ url: "/api/files/1", provider: "database" });
                this.onload?.();
            }
        }, 200);
    }
}

export function ProcessingQueuePreview() {
    const [ready, setReady] = useState(false);
    const [jobs] = useState<SimJob[]>(() =>
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("empty")
            ? []
            : seed()
    );

    useEffect(() => {
        const flags = new URLSearchParams(window.location.search);
        const failQueue = flags.get("error") === "1";
        const driveStarted = now();
        const originalFetch = window.fetch.bind(window);
        const originalXhr = window.XMLHttpRequest;
        let uploads = 0;
        window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const path = new URL(url, window.location.origin).pathname;
            const json = (body: unknown, status = 200) =>
                new Response(JSON.stringify(body), {
                    status,
                    headers: { "Content-Type": "application/json" },
                });
            if (path === "/api/documents/processing-queue") {
                if (failQueue) return json({ error: "The queue is unavailable." }, 503);
                return json(respond(jobs, driveStarted));
            }
            const retry = /^\/api\/documents\/processing-queue\/([^/]+)\/retry$/.exec(path);
            if (retry && init?.method === "POST") {
                const job = jobs.find(j => j.jobId === decodeURIComponent(retry[1]!));
                if (!job) return json({ error: "Not found" }, 404);
                job.fixed = undefined;
                job.createdAt = now();
                job.plan = [1_000, 6_000, 1_500, 6_000, 1_000];
                job.sections = 48;
                job.pages = 9;
                return json({ ok: true, item: itemFor(job, now()) });
            }
            if (path === "/api/uploadDocument" && init?.method === "POST") {
                uploads += 1;
                const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {
                    documentName?: string;
                    category?: string;
                };
                const jobId = `job-upload-${uploads}`;
                jobs.unshift({
                    jobId,
                    name: body.documentName ?? "Upload",
                    folder: body.category ?? "",
                    mimeType: "application/pdf",
                    addedById: VIEWER,
                    createdAt: now(),
                    plan: [1_500, 6_000, 1_500, 8_000, 1_000],
                    sections: 72,
                    pages: 14,
                    provider: "Docling",
                });
                return json({ success: true, jobId, document: { id: 9100 + uploads } }, 202);
            }
            if (path === "/api/profile/people") {
                const look = (authUserId: string, name: string) => ({
                    authUserId,
                    name,
                    email: `${authUserId}@example.com`,
                    displayName: name,
                    title: null,
                    pronouns: null,
                    avatarUrl: null,
                    member: true,
                });
                return json({
                    people: {
                        [VIEWER]: look(VIEWER, "Sam Rivera"),
                        [TEAMMATE]: look(TEAMMATE, "Priya Natarajan"),
                    },
                });
            }
            return originalFetch(input, init);
        }) as typeof fetch;
        window.XMLHttpRequest = FakeUploadXhr as unknown as typeof XMLHttpRequest;
        setReady(true);
        return () => {
            window.fetch = originalFetch;
            window.XMLHttpRequest = originalXhr;
        };
    }, [jobs]);

    if (!ready) return null;

    return (
        <div className="bg-surface flex h-screen flex-col">
            <div className="border-line bg-panel flex items-center gap-3 border-b px-4 py-2 text-xs">
                <span className="text-ink-3">Dev harness · simulated worker</span>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                        startFileUploads([
                            {
                                file: new File(
                                    [new Uint8Array(3 * 1024 * 1024)],
                                    `Uploaded deck ${new Date().toLocaleTimeString()}.pdf`,
                                    { type: "application/pdf" }
                                ),
                                category: "Board",
                            },
                        ])
                    }
                >
                    Simulate an upload
                </Button>
            </div>
            <div className="min-h-0 flex-1 [container-type:inline-size]">
                <ProcessingQueuePane
                    viewerId={VIEWER}
                    storageScope="dev:processing"
                    onOpenDocument={id => window.alert(`Would open document ${id}`)}
                    onAddSource={() => window.alert("Would open Add a source")}
                />
            </div>
            <Toaster />
        </div>
    );
}
