"use client";

/**
 * The Processing tab: every file on its way into the workspace, and where it
 * is — uploading, waiting for a worker, having its text read (OCR for scans
 * and images), split into sections, indexed for search, ready.
 *
 * - **Needs attention** first: a file that stopped (with the reason, in
 *   words, and Retry) or one the worker is about to try again.
 * - **Running now**: what is being worked on this moment. Files are worked
 *   on several at a time; uploads go up two at a time.
 * - **Waiting**: in line for a free worker or a free upload slot.
 * - **Finished**: the last 24 hours, newest first; "Clear finished" hides
 *   them for you.
 *
 * Everyone's files you can see are listed (yours, teammates' in folders you
 * share, connector syncs); "Mine" narrows it. The tab opens itself when you
 * add something (see WorkspaceShell's `openProcessing`), and the tab strip
 * shows how many files are still moving beside its name.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    Check,
    Copy,
    ExternalLink,
    FileAudio,
    FileCode,
    FileImage,
    FileSpreadsheet,
    FileText,
    FileVideo,
    Globe,
    Layers,
    Loader2,
    Plus,
    Presentation,
    RotateCw,
    X,
} from "lucide-react";
import { toast } from "sonner";

import { IconDrive, IconGmail } from "~/components/icons/brand";
import { ProfileAvatar } from "~/components/ProfileAvatar";
import { ToolFrame, ToolMark } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, type ToolHost } from "~/components/tool-app/nav";
import { EmptyState } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type {
    ConnectorSyncSummary,
    ProcessingQueueResponse,
    ProcessingRetryResponse,
} from "~/lib/processing-queue/types";
import { usePeople } from "~/lib/profile/use-people";
import { cn } from "~/lib/utils";

import { StageBar } from "./StageBar";
import {
    QUEUE_ENDPOINT,
    patchProcessingQueue,
    refreshProcessingQueue,
    useProcessingQueue,
} from "./queueStore";
import { dismissLocalTask, retryLocalTask, useLocalTasks } from "./uploadTasks";
import {
    buildRows,
    folderLabel,
    formatAgo,
    formatDuration,
    groupRows,
    overallProgress,
    summarySentence,
    type QueueRow,
} from "./viewModel";

export interface ProcessingQueuePaneProps {
    /** What the workspace hands a tool's tab: focus, memory. */
    host?: ToolHost;
    /** The signed-in member's auth id — "Mine", and "you" for their own files. */
    viewerId: string | null;
    /** Workspace + member, for remembering "Mine" and what was cleared. */
    storageScope?: string;
    /** Open a finished (or running) file in a tab of its own. */
    onOpenDocument?: (documentId: number) => void;
    /** The Add a source dialog. */
    onAddSource?: () => void;
    /** A file finished or failed — the sidebar's badges should catch up. */
    onSettled?: () => void;
}

export function ProcessingQueuePane({ host, ...props }: ProcessingQueuePaneProps) {
    return (
        <ToolNavProvider toolId="processing" roots={[]} host={host}>
            <ProcessingQueueFrame {...props} />
        </ToolNavProvider>
    );
}

const ABOUT =
    "Every file on its way into the workspace and the stage it is at: uploading, waiting for a worker, reading the text (OCR for scans and images), splitting into sections, indexing for search. Opens by itself when you add something.";

const MAX_CLEARED = 500;

function readStored<T>(key: string | null, fallback: T): T {
    if (!key || typeof window === "undefined") return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeStored(key: string | null, value: unknown) {
    if (!key || typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private mode or a full quota: the choice lasts for this visit only.
    }
}

/** Ticks every second while something is moving (elapsed times), else every 30 s. */
function useNow(fast: boolean, offsetMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), fast ? 1_000 : 30_000);
        return () => window.clearInterval(id);
    }, [fast]);
    return now + offsetMs;
}

function ProcessingQueueFrame({
    viewerId,
    storageScope,
    onOpenDocument,
    onAddSource,
    onSettled,
}: Omit<ProcessingQueuePaneProps, "host">) {
    const queue = useProcessingQueue();
    const local = useLocalTasks();
    const mineKey = storageScope ? `processing.mine.v1:${storageScope}` : null;
    const clearedKey = storageScope ? `processing.cleared.v1:${storageScope}` : null;
    const [mineOnly, setMineOnly] = useState<boolean>(() => readStored(mineKey, false));
    const [cleared, setCleared] = useState<string[]>(() => readStored(clearedKey, []));
    const clearedSet = useMemo(() => new Set(cleared), [cleared]);

    // The server's clock, not the browser's: a laptop five minutes out would
    // otherwise say a file has been "waiting -5 min".
    const offset = useMemo(() => {
        const server = queue.data ? Date.parse(queue.data.serverTime) : NaN;
        return Number.isFinite(server) ? server - Date.now() : 0;
        // Re-measure on each answer only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue.data?.serverTime]);

    const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
    const anyLocalMoving = local.some(
        task => task.phase !== "failed" && task.phase !== "handed-off"
    );
    const now = useNow(
        anyLocalMoving || items.some(item => item.state !== "done" && item.state !== "failed"),
        offset
    );

    const rows = useMemo(
        () =>
            buildRows({
                items,
                local,
                viewerId,
                cleared: clearedSet,
                mineOnly,
                now,
            }),
        [items, local, viewerId, clearedSet, mineOnly, now]
    );
    const groups = useMemo(() => groupRows(rows), [rows]);
    const overall = overallProgress(groups);
    const people = usePeople(
        useMemo(
            () =>
                [
                    ...new Set(rows.map(row => row.addedById).filter((id): id is string => !!id)),
                ].sort(),
            [rows]
        )
    );

    const announce = useSettledAnnouncements(rows, onSettled);

    const setMine = (value: boolean) => {
        setMineOnly(value);
        writeStored(mineKey, value);
    };
    const clearFinished = () => {
        const next = [
            ...new Set([...groups.done.map(row => row.jobId!).filter(Boolean), ...cleared]),
        ].slice(0, MAX_CLEARED);
        setCleared(next);
        writeStored(clearedKey, next);
    };

    const retry = useRetry();

    const header = (
        <PageHeader
            title="Processing"
            accent="queue"
            sub={
                <span data-testid="processing-summary" aria-live="polite">
                    {queue.loading && !queue.data ? "Checking…" : summarySentence(groups)}
                </span>
            }
            actions={
                <>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={mineOnly ? "mine" : "everyone"}
                        onValueChange={value => value && setMine(value === "mine")}
                        aria-label="Whose files"
                    >
                        <ToggleGroupItem
                            value="everyone"
                            className="data-[state=on]:bg-brand-soft data-[state=on]:text-brand-ink shrink-0 px-3 text-xs"
                        >
                            Everyone
                        </ToggleGroupItem>
                        <ToggleGroupItem
                            value="mine"
                            className="data-[state=on]:bg-brand-soft data-[state=on]:text-brand-ink shrink-0 px-3 text-xs"
                        >
                            Mine
                        </ToggleGroupItem>
                    </ToggleGroup>
                    {groups.done.length > 0 && (
                        <Button variant="outline" size="sm" onClick={clearFinished}>
                            Clear finished
                        </Button>
                    )}
                    {onAddSource && (
                        <Button size="sm" onClick={onAddSource}>
                            <Plus className="size-3.5" />
                            Add a source
                        </Button>
                    )}
                </>
            }
        />
    );

    const connectors = queue.data?.connectors ?? [];
    const empty = rows.length === 0 && connectors.length === 0;

    return (
        <ToolFrame
            title="Processing queue"
            mark={<ToolMark icon={Layers} />}
            about={ABOUT}
            contentClassName="mx-auto w-full max-w-[1000px]"
        >
            <div className="flex flex-col gap-6" data-testid="processing-queue">
                {header}

                {overall && (
                    <div
                        className="border-line bg-panel rounded-lg border px-4 py-3"
                        data-testid="processing-overall"
                    >
                        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs">
                            <span className="text-ink-2">
                                {overall.count} file{overall.count === 1 ? "" : "s"} on the way
                            </span>
                            <span className="text-ink-3 tabular-nums">
                                {Math.round(overall.share * 100)}% of all steps done
                            </span>
                        </div>
                        <Progress
                            value={overall.share * 100}
                            aria-label="All files in progress"
                            className="h-1.5"
                        />
                    </div>
                )}

                {connectors.map((connector, i) => (
                    <ConnectorCard
                        key={`${connector.provider}:${connector.account ?? i}`}
                        connector={connector}
                        now={now}
                    />
                ))}

                {queue.error && (
                    <div
                        role="status"
                        className="border-warn/40 bg-warn-soft text-ink-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                    >
                        <AlertTriangle className="text-warn size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                            {queue.error} What you see may be a little behind.
                        </span>
                        <Button variant="ghost" size="sm" onClick={queue.refresh}>
                            Try now
                        </Button>
                    </div>
                )}

                {queue.loading && !queue.data && local.length === 0 ? (
                    <SkeletonRows rows={3} height={92} />
                ) : empty ? (
                    <EmptyState
                        title="Files you add show up here"
                        body="Uploads, folders, links and Google Drive imports appear while their text is read and indexed, with each stage as it happens. This tab opens by itself when you add something."
                        action={
                            onAddSource ? (
                                <Button size="sm" onClick={onAddSource}>
                                    <Plus className="size-3.5" />
                                    Add a source
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <>
                        <QueueSection
                            id="attention"
                            title="Needs attention"
                            rows={groups.attention}
                            aside="Stopped, or about to be tried again"
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                        />
                        <QueueSection
                            id="running"
                            title="Running now"
                            rows={groups.running}
                            aside="Several files are worked on at the same time"
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                        />
                        <QueueSection
                            id="waiting"
                            title="Waiting"
                            rows={groups.waiting}
                            aside="Each starts as soon as a worker is free"
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                        />
                        <QueueSection
                            id="done"
                            title="Finished"
                            rows={groups.done}
                            aside="Last 24 hours"
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                            collapsible
                        />
                        {mineOnly && rows.length === 0 && (
                            <p className="text-ink-3 text-sm">
                                Nothing of yours is processing.{" "}
                                <button
                                    type="button"
                                    className="text-brand-ink underline underline-offset-2"
                                    onClick={() => setMine(false)}
                                >
                                    Show everyone&apos;s
                                </button>
                            </p>
                        )}
                    </>
                )}
                <div className="sr-only" aria-live="polite" data-testid="processing-announcer">
                    {announce}
                </div>
            </div>
        </ToolFrame>
    );
}

/**
 * Says out loud (for a screen reader) when a file finishes or stops, and
 * tells the workspace so the sidebar's badges follow without waiting for
 * their own, slower poll.
 */
function useSettledAnnouncements(rows: QueueRow[], onSettled?: () => void): string {
    const seen = useRef<Map<string, QueueRow["state"]> | null>(null);
    const [message, setMessage] = useState("");
    const settledRef = useRef(onSettled);
    settledRef.current = onSettled;

    useEffect(() => {
        const previous = seen.current;
        const next = new Map(rows.map(row => [row.key, row.state] as const));
        seen.current = next;
        if (!previous) return;
        const finished: string[] = [];
        const failed: string[] = [];
        for (const row of rows) {
            const before = previous.get(row.key);
            if (!before || before === row.state) continue;
            if (row.state === "done") finished.push(row.name);
            if (row.state === "failed") failed.push(row.name);
        }
        if (finished.length === 0 && failed.length === 0) return;
        const parts: string[] = [];
        if (finished.length)
            parts.push(`${finished.join(", ")} ${finished.length === 1 ? "is" : "are"} ready`);
        if (failed.length) parts.push(`${failed.join(", ")} stopped with an error`);
        setMessage(`${parts.join(". ")}.`);
        settledRef.current?.();
    }, [rows]);

    return message;
}

function useRetry() {
    return useCallback(async (row: QueueRow) => {
        if (row.origin === "local") {
            if (row.localId) retryLocalTask(row.localId);
            return;
        }
        if (!row.jobId) return;
        try {
            const res = await fetch(`${QUEUE_ENDPOINT}/${encodeURIComponent(row.jobId)}/retry`, {
                method: "POST",
            });
            const body = (await res
                .json()
                .catch(() => ({}))) as Partial<ProcessingRetryResponse> & {
                error?: string;
            };
            if (!res.ok || !body.item) {
                throw new Error(body.error ?? `Retry didn't start (HTTP ${res.status})`);
            }
            const item = body.item;
            patchProcessingQueue((data: ProcessingQueueResponse) => ({
                ...data,
                items: data.items.map(existing =>
                    existing.jobId === item.jobId ? item : existing
                ),
            }));
            toast.success(`Trying ${row.name} again`);
            void refreshProcessingQueue();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Retry didn't start");
        }
    }, []);
}

type People = ReturnType<typeof usePeople>;

function QueueSection({
    id,
    title,
    aside,
    rows,
    collapsible = false,
    ...rowProps
}: {
    id: string;
    title: string;
    aside: string;
    rows: QueueRow[];
    collapsible?: boolean;
    people: People;
    viewerId: string | null;
    now: number;
    onOpenDocument?: (documentId: number) => void;
    onRetry: (row: QueueRow) => Promise<void> | void;
}) {
    const [expanded, setExpanded] = useState(false);
    if (rows.length === 0) return null;
    const LIMIT = 6;
    const shown = collapsible && !expanded ? rows.slice(0, LIMIT) : rows;
    const headingId = `processing-${id}`;
    return (
        <section aria-labelledby={headingId} data-testid={`processing-section-${id}`}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 id={headingId} className="text-ink text-[13px] font-semibold">
                    {title}
                    <span className="text-ink-3 ml-1.5 font-normal tabular-nums">
                        {rows.length}
                    </span>
                </h2>
                <span className="text-ink-3 @max-sm:hidden text-xs">{aside}</span>
            </div>
            <ul className="border-line bg-panel divide-line overflow-hidden rounded-lg border [&>li+li]:border-t">
                {shown.map(row => (
                    <QueueRowView key={row.key} row={row} {...rowProps} />
                ))}
            </ul>
            {collapsible && rows.length > LIMIT && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-ink-3 mt-1.5"
                    onClick={() => setExpanded(value => !value)}
                    aria-expanded={expanded}
                >
                    {expanded ? "Show fewer" : `Show all ${rows.length}`}
                </Button>
            )}
        </section>
    );
}

function fileIcon(name: string, mimeType: string | null) {
    const mime = mimeType ?? "";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (
        mime.startsWith("image/") ||
        ["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp", "heic"].includes(ext)
    )
        return FileImage;
    if (mime.startsWith("audio/") || ["mp3", "m4a", "wav", "aac", "ogg", "flac"].includes(ext))
        return FileAudio;
    if (mime.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(ext)) return FileVideo;
    if (
        mime.includes("spreadsheet") ||
        mime === "text/csv" ||
        ["xls", "xlsx", "csv", "ods"].includes(ext)
    )
        return FileSpreadsheet;
    if (mime.includes("presentation") || ["ppt", "pptx", "odp", "key"].includes(ext))
        return Presentation;
    if (mime === "text/html" || /^https?:\/\//.test(name)) return Globe;
    if (
        ["js", "ts", "tsx", "py", "go", "rs", "java", "rb", "json", "yaml", "yml", "sh"].includes(
            ext
        )
    )
        return FileCode;
    return FileText;
}

function rowTiming(row: QueueRow, now: number): string {
    switch (row.state) {
        case "done":
            return row.completedAt ? formatAgo(row.completedAt, now) : "";
        case "failed":
            return row.completedAt ? formatAgo(row.completedAt, now) : "";
        case "waiting": {
            // Since it joined the line — a retried file waits from the retry.
            const since = row.stages.find(stage => stage.id === "waiting")?.startedAt;
            return `waiting ${formatDuration(now - Date.parse(since ?? row.createdAt))}`;
        }
        default: {
            const since = row.startedAt ?? row.createdAt;
            return formatDuration(now - Date.parse(since));
        }
    }
}

function QueueRowView({
    row,
    people,
    viewerId,
    now,
    onOpenDocument,
    onRetry,
}: {
    row: QueueRow;
    people: People;
    viewerId: string | null;
    now: number;
    onOpenDocument?: (documentId: number) => void;
    onRetry: (row: QueueRow) => Promise<void> | void;
}) {
    const Icon = fileIcon(row.name, row.mimeType);
    const [retrying, setRetrying] = useState(false);
    const person = row.addedById ? people[row.addedById] : undefined;
    const who = row.addedById && row.addedById === viewerId ? "you" : (person?.displayName ?? null);
    const failed = row.state === "failed";
    const retryingSoon = row.state === "retrying";
    const canOpen = row.documentId !== null && onOpenDocument;

    const doRetry = async () => {
        setRetrying(true);
        try {
            await onRetry(row);
        } finally {
            setRetrying(false);
        }
    };

    const copyDetails = async () => {
        const text = row.error?.detail ?? row.error?.message ?? "";
        try {
            await navigator.clipboard.writeText(`${row.name}\n${text}`);
            toast.success("Error details copied");
        } catch {
            toast.error("Couldn't copy — select the text instead");
        }
    };

    return (
        <li
            className={cn(
                "relative px-4 py-3.5",
                failed && "bg-danger-soft/30",
                retryingSoon && "bg-warn-soft/30"
            )}
            data-testid="processing-row"
            data-state={row.state}
            data-stage={row.stage}
            data-job-id={row.jobId ?? undefined}
        >
            <div className="flex items-start gap-3">
                <span
                    className={cn(
                        "bg-panel-2 text-ink-2 mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md",
                        row.state === "done" && "bg-success-soft text-success",
                        failed && "bg-danger-soft text-danger",
                        retryingSoon && "bg-warn-soft text-warn"
                    )}
                    aria-hidden
                >
                    {row.state === "done" ? (
                        <Check className="size-4" />
                    ) : failed ? (
                        <AlertTriangle className="size-4" />
                    ) : (
                        <Icon className="size-4" />
                    )}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                        <div className="text-ink min-w-0 flex-1 truncate text-[13.5px] font-medium">
                            {canOpen ? (
                                <button
                                    type="button"
                                    className="hover:text-brand-ink max-w-full truncate text-left hover:underline hover:underline-offset-2"
                                    onClick={() => onOpenDocument(row.documentId!)}
                                    title={`Open ${row.name}`}
                                >
                                    {row.name}
                                </button>
                            ) : (
                                <span title={row.name}>{row.name}</span>
                            )}
                        </div>
                        <span className="text-ink-3 shrink-0 text-xs tabular-nums">
                            {rowTiming(row, now)}
                        </span>
                    </div>
                    <div
                        className={cn(
                            "mt-0.5 flex min-w-0 items-start gap-1.5 text-xs leading-[1.45]",
                            failed ? "text-danger" : retryingSoon ? "text-warn" : "text-ink-2"
                        )}
                    >
                        {row.state === "running" && (
                            <Loader2
                                className="mt-[3px] size-3 shrink-0 animate-spin"
                                aria-hidden
                            />
                        )}
                        {retryingSoon && (
                            <RotateCw className="mt-[3px] size-3 shrink-0" aria-hidden />
                        )}
                        {/* Inline text, so a long detail wraps under the
                            headline instead of being cut off on a phone. */}
                        <p className="min-w-0">
                            <span className="font-medium">{row.headline}</span>
                            {row.detail && <span className="text-ink-3"> · {row.detail}</span>}
                        </p>
                    </div>

                    {/* A finished file needs no bar: every stage is done, and
                        the list of them is easier to scan without six full
                        segments per row. Its stage timings stay in reach
                        through the row's detail line. */}
                    {row.state !== "done" && (
                        <div className="mt-2.5">
                            <StageBar
                                stages={row.stages}
                                state={row.state}
                                name={row.name}
                                headline={row.headline}
                                now={now}
                            />
                        </div>
                    )}

                    {(failed || retryingSoon) && row.error && (
                        <div
                            className={cn(
                                "mt-3 rounded-md border px-3 py-2 text-xs",
                                failed
                                    ? "border-danger/30 bg-panel text-ink-2"
                                    : "border-warn/30 bg-panel text-ink-2"
                            )}
                        >
                            <p className="text-ink">
                                {retryingSoon ? "Last try: " : ""}
                                {row.error.message}
                            </p>
                            {retryingSoon && (
                                <p className="text-ink-3 mt-0.5">
                                    It keeps trying on its own, up to {row.maxAttempts} times; you
                                    don&apos;t need to do anything.
                                </p>
                            )}
                        </div>
                    )}

                    <div
                        className={cn(
                            "text-ink-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs",
                            row.state === "done" ? "mt-1.5" : "mt-2.5"
                        )}
                    >
                        <span className="min-w-0 truncate">{folderLabel(row.folder)}</span>
                        {who && (
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                                <ProfileAvatar
                                    name={who === "you" ? null : who}
                                    src={who === "you" ? null : person?.avatarUrl}
                                    className="size-4"
                                    fallbackClassName="text-[8px]"
                                />
                                <span className="truncate">Added by {who}</span>
                            </span>
                        )}
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                            {failed && row.canRetry && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7"
                                    disabled={retrying}
                                    onClick={() => void doRetry()}
                                >
                                    {retrying ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                        <RotateCw className="size-3.5" />
                                    )}
                                    Retry
                                </Button>
                            )}
                            {failed && row.error?.detail && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7"
                                    onClick={() => void copyDetails()}
                                >
                                    <Copy className="size-3.5" />
                                    Copy details
                                </Button>
                            )}
                            {failed && row.origin === "local" && row.localId && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7"
                                    onClick={() => dismissLocalTask(row.localId!)}
                                    aria-label={`Dismiss ${row.name}`}
                                >
                                    <X className="size-3.5" />
                                    Dismiss
                                </Button>
                            )}
                            {row.state === "done" && canOpen && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7"
                                    onClick={() => onOpenDocument(row.documentId!)}
                                >
                                    <ExternalLink className="size-3.5" />
                                    Open
                                </Button>
                            )}
                        </span>
                    </div>
                </div>
            </div>
        </li>
    );
}

const CONNECTOR_META: Record<
    ConnectorSyncSummary["provider"],
    { label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
    "google-drive": { label: "Google Drive", Icon: IconDrive },
    gmail: { label: "Gmail", Icon: IconGmail },
};

function ConnectorCard({ connector, now }: { connector: ConnectorSyncSummary; now: number }) {
    const meta = CONNECTOR_META[connector.provider];
    const report = connector.report;
    let line: string;
    if (connector.status === "running") {
        line =
            "Syncing — looking for new and changed files. Each one shows up below as it's queued.";
    } else if (connector.status === "error") {
        line = connector.error ?? "The last sync stopped with an error.";
    } else if (report) {
        const parts = [`${report.stored} queued`, `${report.unchanged} unchanged`];
        if (report.skipped) parts.push(`${report.skipped} skipped`);
        if (report.failed) parts.push(`${report.failed} failed`);
        line = `Last sync ${connector.lastSyncAt ? formatAgo(connector.lastSyncAt, now) : ""}: ${parts.join(", ")}.`;
    } else {
        line = "Synced.";
    }
    return (
        <div
            className={cn(
                "border-line bg-panel flex items-center gap-3 rounded-lg border px-4 py-3",
                connector.status === "error" && "border-danger/30"
            )}
            data-testid={`processing-connector-${connector.provider}`}
            data-status={connector.status}
        >
            <span className="bg-panel-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md">
                <meta.Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-ink flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] font-medium">
                    <span className="shrink-0 whitespace-nowrap">{meta.label}</span>
                    {connector.account && (
                        <span className="text-ink-3 min-w-0 truncate text-xs font-normal">
                            {connector.account}
                        </span>
                    )}
                </div>
                <div
                    className={cn(
                        "mt-0.5 text-xs",
                        connector.status === "error" ? "text-danger" : "text-ink-2"
                    )}
                >
                    {line}
                </div>
            </div>
            {connector.status === "running" && (
                <Loader2 className="text-brand size-4 shrink-0 animate-spin" aria-label="Syncing" />
            )}
        </div>
    );
}
