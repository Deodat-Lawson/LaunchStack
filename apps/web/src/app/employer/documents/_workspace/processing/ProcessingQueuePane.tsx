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
    LifeBuoy,
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
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { IconDrive, IconGmail } from "~/components/icons/brand";
import { ProfileAvatar } from "~/components/ProfileAvatar";
import { ToolFrame, ToolMark } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { ToolNavProvider, type ToolHost } from "~/components/tool-app/nav";
import { EmptyState } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { ConnectorSyncSummary } from "~/lib/processing-queue/types";
import { usePeople } from "~/lib/profile/use-people";
import { sourceFailureContactHref, useSourceFailureCopy } from "~/lib/source-failure";
import { cn } from "~/lib/utils";

import { StageBar } from "./StageBar";
import { refreshProcessingQueue, useProcessingQueue, type QueueLoadError } from "./queueStore";
import { dismissLocalTask, retryLocalTask, useLocalTasks } from "./uploadTasks";
import {
    buildRows,
    folderLabel,
    formatAgo,
    formatDuration,
    groupRows,
    overallProgress,
    summarySentence,
    type ProcessingText,
    type ProcessingTranslator,
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
    const t = useTranslations("processing");
    const tu = useTranslations("sources.sourceUpload");
    const failureCopy = useSourceFailureCopy();
    const text = useMemo<ProcessingText>(
        () => ({ t, tu, describeFailure: failureCopy.describe }),
        [t, tu, failureCopy]
    );
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
                text,
            }),
        [items, local, viewerId, clearedSet, mineOnly, now, text]
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

    const announce = useSettledAnnouncements(rows, t, onSettled);

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

    const retry = useRetry(t, onSettled);

    const header = (
        <PageHeader
            title={t("header.title")}
            accent={t("header.accent")}
            sub={
                <span data-testid="processing-summary" aria-live="polite">
                    {queue.loading && !queue.data
                        ? t("header.checking")
                        : summarySentence(groups, t)}
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
                        aria-label={t("filter.label")}
                    >
                        <ToggleGroupItem
                            value="everyone"
                            className="data-[state=on]:bg-brand-soft data-[state=on]:text-brand-ink shrink-0 px-3 text-xs"
                        >
                            {t("filter.everyone")}
                        </ToggleGroupItem>
                        <ToggleGroupItem
                            value="mine"
                            className="data-[state=on]:bg-brand-soft data-[state=on]:text-brand-ink shrink-0 px-3 text-xs"
                        >
                            {t("filter.mine")}
                        </ToggleGroupItem>
                    </ToggleGroup>
                    {groups.done.length > 0 && (
                        <Button variant="outline" size="sm" onClick={clearFinished}>
                            {t("actions.clearFinished")}
                        </Button>
                    )}
                    {onAddSource && (
                        <Button size="sm" onClick={onAddSource}>
                            <Plus className="size-3.5" />
                            {t("actions.addSource")}
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
            title={t("frame.title")}
            mark={<ToolMark icon={Layers} />}
            about={t("frame.about")}
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
                                {t("overall.onTheWay", { count: overall.count })}
                            </span>
                            <span className="text-ink-3 tabular-nums">
                                {t("overall.stepsDone", {
                                    percent: Math.round(overall.share * 100),
                                })}
                            </span>
                        </div>
                        <Progress
                            value={overall.share * 100}
                            aria-label={t("overall.label")}
                            className="h-1.5"
                        />
                    </div>
                )}

                {connectors.map((connector, i) => (
                    <ConnectorCard
                        key={`${connector.provider}:${connector.account ?? i}`}
                        connector={connector}
                        now={now}
                        t={t}
                    />
                ))}

                {queue.error && (
                    <div
                        role="status"
                        className="border-warn/40 bg-warn-soft text-ink-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                    >
                        <AlertTriangle className="text-warn size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                            {loadErrorText(queue.error, t)} {t("loadError.behind")}
                        </span>
                        <Button variant="ghost" size="sm" onClick={queue.refresh}>
                            {t("loadError.tryNow")}
                        </Button>
                    </div>
                )}

                {queue.loading && !queue.data && local.length === 0 ? (
                    <SkeletonRows rows={3} height={92} />
                ) : empty ? (
                    <EmptyState
                        title={t("empty.title")}
                        body={t("empty.body")}
                        action={
                            onAddSource ? (
                                <Button size="sm" onClick={onAddSource}>
                                    <Plus className="size-3.5" />
                                    {t("actions.addSource")}
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <>
                        <QueueSection
                            id="attention"
                            title={t("sections.attention.title")}
                            rows={groups.attention}
                            aside={t("sections.attention.aside")}
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            t={t}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                        />
                        <QueueSection
                            id="running"
                            title={t("sections.running.title")}
                            rows={groups.running}
                            aside={t("sections.running.aside")}
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            t={t}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                        />
                        <QueueSection
                            id="waiting"
                            title={t("sections.waiting.title")}
                            rows={groups.waiting}
                            aside={t("sections.waiting.aside")}
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            t={t}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                        />
                        <QueueSection
                            id="done"
                            title={t("sections.done.title")}
                            rows={groups.done}
                            aside={t("sections.done.aside")}
                            people={people}
                            viewerId={viewerId}
                            now={now}
                            t={t}
                            onOpenDocument={onOpenDocument}
                            onRetry={retry}
                            collapsible
                        />
                        {mineOnly && rows.length === 0 && (
                            <p className="text-ink-3 text-sm">
                                {t("mineEmpty.text")}{" "}
                                <button
                                    type="button"
                                    className="text-brand-ink underline underline-offset-2"
                                    onClick={() => setMine(false)}
                                >
                                    {t("mineEmpty.showEveryone")}
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
function useSettledAnnouncements(
    rows: QueueRow[],
    t: ProcessingTranslator,
    onSettled?: () => void
): string {
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
        if (finished.length) {
            parts.push(t("announce.ready", { count: finished.length, names: finished.join(", ") }));
        }
        if (failed.length) {
            parts.push(t("announce.failed", { count: failed.length, names: failed.join(", ") }));
        }
        setMessage(parts.join(" "));
        settledRef.current?.();
    }, [rows, t]);

    return message;
}

/** Why the queue didn't load, in words. */
function loadErrorText(error: QueueLoadError, t: ProcessingTranslator): string {
    switch (error.kind) {
        case "rateLimited":
            return t("loadError.rateLimited");
        case "server":
            return error.message;
        case "http":
            return t("loadError.http", { status: error.status });
        case "network":
            return t("loadError.network");
    }
}

/**
 * Retry: a browser upload starts over from its bytes; a file the worker gave
 * up on runs again through `POST /api/documents/[id]/retry` — the same route
 * as the Sources rail's Retry, which restarts the stage that died.
 */
function useRetry(t: ProcessingTranslator, onSettled?: () => void) {
    return useCallback(
        async (row: QueueRow) => {
            if (row.origin === "local") {
                if (row.localId) retryLocalTask(row.localId);
                return;
            }
            if (row.documentId === null) return;
            try {
                const res = await fetch(`/api/documents/${row.documentId}/retry`, {
                    method: "POST",
                });
                if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
                    toast.error(
                        typeof body.error === "string" && body.error
                            ? body.error
                            : t("row.retryFailed")
                    );
                    return;
                }
                toast.success(t("row.retryStarted", { name: row.name }));
            } catch {
                toast.error(t("row.retryFailed"));
                return;
            }
            onSettled?.();
            await refreshProcessingQueue();
        },
        [t, onSettled]
    );
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
    t: ProcessingTranslator;
}) {
    const [expanded, setExpanded] = useState(false);
    const { t } = rowProps;
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
                    {expanded
                        ? t("sections.showFewer")
                        : t("sections.showAll", { count: rows.length })}
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

function rowTiming(row: QueueRow, now: number, t: ProcessingTranslator): string {
    switch (row.state) {
        case "done":
        case "failed":
            return row.completedAt ? formatAgo(row.completedAt, now, t) : "";
        case "waiting": {
            // Since it joined the line — a retried file waits from the retry.
            const since = row.stages.find(stage => stage.id === "waiting")?.startedAt;
            return t("time.waiting", {
                duration: formatDuration(now - Date.parse(since ?? row.createdAt), t),
            });
        }
        default: {
            const since = row.startedAt ?? row.createdAt;
            return formatDuration(now - Date.parse(since), t);
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
    t,
}: {
    row: QueueRow;
    people: People;
    viewerId: string | null;
    now: number;
    onOpenDocument?: (documentId: number) => void;
    onRetry: (row: QueueRow) => Promise<void> | void;
    t: ProcessingTranslator;
}) {
    const Icon = fileIcon(row.name, row.mimeType);
    const [retrying, setRetrying] = useState(false);
    const person = row.addedById ? people[row.addedById] : undefined;
    const isYou = row.addedById !== null && row.addedById === viewerId;
    const who = isYou ? null : (person?.displayName ?? null);
    // Support is the way forward when a retry can't help, or one already didn't.
    const offerContact =
        row.state === "failed" &&
        row.failure !== null &&
        (!row.failure.retryable || row.retryCount > 0);
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
        const detail = row.errorDetail ?? row.errorMessage ?? "";
        try {
            await navigator.clipboard.writeText(`${row.name}\n${detail}`);
            toast.success(t("row.copied"));
        } catch {
            toast.error(t("row.copyFailed"));
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
                                    title={t("row.openFile", { name: row.name })}
                                >
                                    {row.name}
                                </button>
                            ) : (
                                <span title={row.name}>{row.name}</span>
                            )}
                        </div>
                        <span className="text-ink-3 shrink-0 text-xs tabular-nums">
                            {rowTiming(row, now, t)}
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
                            {row.detail && (
                                <span className="text-ink-3">
                                    {t("detail.separator")}
                                    {row.detail}
                                </span>
                            )}
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

                    {(failed || retryingSoon) && row.errorMessage && (
                        <div
                            className={cn(
                                "mt-3 rounded-md border px-3 py-2 text-xs",
                                failed
                                    ? "border-danger/30 bg-panel text-ink-2"
                                    : "border-warn/30 bg-panel text-ink-2"
                            )}
                        >
                            <p className="text-ink">
                                {retryingSoon
                                    ? t("row.lastTry", { message: row.errorMessage })
                                    : row.errorMessage}
                            </p>
                            {retryingSoon && (
                                <p className="text-ink-3 mt-0.5">
                                    {t("row.keepsTrying", { max: row.maxAttempts })}
                                </p>
                            )}
                            {failed && row.retryCount > 0 && (
                                <p className="text-ink-3 mt-0.5">
                                    {t("row.retriedBefore", { count: row.retryCount })}
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
                        <span className="min-w-0 truncate">{folderLabel(row.folder, t)}</span>
                        {(isYou || who) && (
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                                <ProfileAvatar
                                    name={who}
                                    src={isYou ? null : person?.avatarUrl}
                                    className="size-4"
                                    fallbackClassName="text-[8px]"
                                />
                                <span className="truncate">
                                    {isYou
                                        ? t("row.addedByYou")
                                        : t("row.addedBy", { name: who ?? "" })}
                                </span>
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
                                    {t("row.retry")}
                                </Button>
                            )}
                            {offerContact && (
                                <Button asChild size="sm" variant="ghost" className="h-7">
                                    <ToolLink
                                        href={sourceFailureContactHref({
                                            document: row.name,
                                            documentId: row.documentId ?? undefined,
                                            category: row.failure!.category,
                                            jobId: row.jobId ?? undefined,
                                        })}
                                    >
                                        <LifeBuoy className="size-3.5" />
                                        {t("row.contactUs")}
                                    </ToolLink>
                                </Button>
                            )}
                            {failed && row.errorDetail && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7"
                                    onClick={() => void copyDetails()}
                                >
                                    <Copy className="size-3.5" />
                                    {t("row.copyDetails")}
                                </Button>
                            )}
                            {failed && row.origin === "local" && row.localId && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7"
                                    onClick={() => dismissLocalTask(row.localId!)}
                                    aria-label={t("row.dismissFile", { name: row.name })}
                                >
                                    <X className="size-3.5" />
                                    {t("row.dismiss")}
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
                                    {t("row.open")}
                                </Button>
                            )}
                        </span>
                    </div>
                </div>
            </div>
        </li>
    );
}

/** Connector names are brand names; they stay as they are in every language. */
const CONNECTOR_META: Record<
    ConnectorSyncSummary["provider"],
    { name: string; Icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
    "google-drive": { name: "Google Drive", Icon: IconDrive },
    gmail: { name: "Gmail", Icon: IconGmail },
};

function ConnectorCard({
    connector,
    now,
    t,
}: {
    connector: ConnectorSyncSummary;
    now: number;
    t: ProcessingTranslator;
}) {
    const meta = CONNECTOR_META[connector.provider];
    const report = connector.report;
    let line: string;
    if (connector.status === "running") {
        line = t("connector.syncing");
    } else if (connector.status === "error") {
        line = t("connector.error");
    } else if (report) {
        const parts = [
            t("connector.queued", { count: report.stored }),
            t("connector.unchanged", { count: report.unchanged }),
        ];
        if (report.skipped) parts.push(t("connector.skipped", { count: report.skipped }));
        if (report.failed) parts.push(t("connector.failed", { count: report.failed }));
        line = t("connector.lastSync", {
            when: connector.lastSyncAt ? formatAgo(connector.lastSyncAt, now, t) : "",
            parts: parts.join(t("connector.separator")),
        });
    } else {
        line = t("connector.synced");
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
                    <span className="shrink-0 whitespace-nowrap">{meta.name}</span>
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
                    title={
                        connector.status === "error" ? (connector.error ?? undefined) : undefined
                    }
                >
                    {line}
                </div>
            </div>
            {connector.status === "running" && (
                <Loader2
                    className="text-brand size-4 shrink-0 animate-spin"
                    aria-label={t("connector.syncingLabel")}
                />
            )}
        </div>
    );
}
