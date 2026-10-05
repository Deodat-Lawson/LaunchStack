"use client";

import {
    AudioLines,
    CalendarDays,
    Check,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Copy,
    FileText,
    Home,
    Info,
    Link as LinkIcon,
    LockKeyhole,
    Mic,
    Minus,
    Pause,
    Play,
    RefreshCw,
    Search,
    Sparkles,
    Square,
    Trash2,
    Users,
    X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
    CallNote,
    CallSnapshot,
    Gap,
    NoteVisibility,
    TranscriptSegment,
} from "@launchstack/pipelines/call-notes";
import { renderEnrichedNoteProposal } from "@launchstack/pipelines/call-notes/enrichment";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { EnrichmentPreviewState } from "~/lib/call-notes-enrichment-stream";
import { CallsChat } from "./CallsChat";
import { CallNoteEditor } from "./CallNoteEditor";
import { EnrichmentPreview, ProposalReviewNotice } from "./EnrichmentPreview";
import type { CallNoteDraft } from "./useCallNoteDrafts";
import styles from "../calls.module.css";

function formatClock(ms: number | null): string {
    if (ms === null) return "";
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function dateLabel(iso: string): string {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}),
    });
}

function captureLabel(snapshot: CallSnapshot): string {
    const { lifecycle, desiredMode, pausedReason } = snapshot.capture;
    if (lifecycle === "completed") return "Completed";
    if (lifecycle === "failed") return "Failed";
    if (lifecycle === "finalizing") return "Finalizing";
    if (desiredMode === "stopped") return "Stopping";
    if (desiredMode === "paused")
        return pausedReason === "worker_error" ? "Paused — capture error" : "Paused";
    if (lifecycle === "interrupted") return "Reconnecting";
    if (lifecycle === "live") return "Live";
    return "Connecting";
}

function noteTitle(snapshot: CallSnapshot): string {
    return snapshot.note?.title ?? snapshot.title;
}
const GAP_LABELS: Record<Gap["kind"], string> = {
    user_paused: "Capture paused",
    capture_user_absent: "Capture user away",
    transport_interruption: "Connection interrupted",
    worker_unavailable: "Processing unavailable",
    capture_unknown: "Capture interrupted",
};

function gapDuration(gap: Gap): string {
    if (!gap.endedAt) return "ongoing";
    const seconds = Math.max(
        0,
        Math.round((new Date(gap.endedAt).getTime() - new Date(gap.startedAt).getTime()) / 1000)
    );
    if (seconds < 60) return `${seconds}s`;
    const remainder = seconds % 60;
    return `${Math.floor(seconds / 60)}m${remainder ? ` ${remainder}s` : ""}`;
}

// Local audio channels are provenance, not speaker identification.
function speakerLabel(segment: TranscriptSegment): string {
    return segment.speakerName ?? (segment.audioChannel === "microphone" ? "Me" : "Meeting");
}

export type CaptureCommand = "start" | "resume" | "stop";
export type CallMutationStatus = {
    pending: boolean;
    error?: string;
};

type EditableContent = Pick<CallNote, "contentRich" | "contentMarkdown">;

export interface CallsWorkspaceProps {
    calls: CallSnapshot[];
    initialSelectedId?: string | null;
    onSelectCall?: (callId: string | null) => void;
    onStartCapture?: () => void;
    onResumeCapture?: (callId: string) => void;
    onStopCapture?: (callId: string) => void;
    pendingCommand?: CaptureCommand | null;
    captureUnavailableReason?: string | null;
    commandError?: string | null;
    onRetryCommand?: () => void;
    refreshError?: string | null;
    onRetryRefresh?: () => void;
    mutationStatus?: Readonly<Record<string, CallMutationStatus>>;
    onRetryMutation?: (callId: string) => void;
    noteDrafts?: Readonly<Record<string, CallNoteDraft>>;
    enrichmentPreview?: EnrichmentPreviewState;
    onNoteChange?: (callId: string, content: EditableContent) => void;
    onNoteTitleChange?: (callId: string, title: string) => void;
    onSaveNote?: (callId: string) => void;
    onDiscardNote?: (callId: string) => void;
    onSetVisibility?: (callId: string, visibility: NoteVisibility) => void;
    onRequestEnrichment?: (callId: string) => void;
    onRejectEnrichment?: (callId: string, enrichmentRunId: string) => void;
    onAcceptEnrichment?: (
        callId: string,
        enrichmentRunId: string,
        content: EditableContent
    ) => void;
    onDeleteCall?: (callId: string) => void;
}
export function CallsWorkspace({
    calls,
    initialSelectedId = null,
    onSelectCall,
    onStartCapture,
    onResumeCapture,
    onStopCapture,
    pendingCommand = null,
    captureUnavailableReason = null,
    commandError = null,
    onRetryCommand,
    refreshError = null,
    onRetryRefresh,
    mutationStatus,
    onRetryMutation,
    noteDrafts,
    enrichmentPreview,
    onNoteChange,
    onNoteTitleChange,
    onSaveNote,
    onDiscardNote,
    onSetVisibility,
    onRequestEnrichment,
    onRejectEnrichment,
    onAcceptEnrichment,
    onDeleteCall,
}: CallsWorkspaceProps) {
    const [selectedId, setSelectedId] = useState(initialSelectedId);
    useEffect(() => {
        setSelectedId(previous => (previous === initialSelectedId ? previous : initialSelectedId));
    }, [initialSelectedId]);
    const selected = calls.find(call => call.id === selectedId) ?? null;
    const captureActive = calls.some(isCaptureActive);
    const [infoOpen, setInfoOpen] = useState(false);
    const select = (id: string | null) => {
        if (id === selectedId) return;
        setSelectedId(id);
        setInfoOpen(false);
        onSelectCall?.(id);
    };
    const selectedMutation = selected ? mutationStatus?.[selected.id] : undefined;

    return (
        <Popover open={infoOpen} onOpenChange={setInfoOpen}>
            <div className={cn("lsw-root", styles.root)}>
                {selected ? (
                    <CallPanel
                        key={selected.id}
                        snapshot={selected}
                        onHome={() => select(null)}
                        onStartCapture={onStartCapture}
                        onResumeCapture={onResumeCapture}
                        onStopCapture={onStopCapture}
                        captureActive={captureActive}
                        pendingCommand={pendingCommand}
                        captureUnavailableReason={captureUnavailableReason}
                        noteDraft={noteDrafts?.[selected.id]}
                        enrichmentPreview={
                            enrichmentPreview?.callId === selected.id
                                ? enrichmentPreview
                                : undefined
                        }
                        mutationStatus={mutationStatus?.[selected.id]}
                        onNoteChange={onNoteChange}
                        onNoteTitleChange={onNoteTitleChange}
                        onSaveNote={onSaveNote}
                        onDiscardNote={onDiscardNote}
                        onSetVisibility={onSetVisibility}
                        onRequestEnrichment={onRequestEnrichment}
                        onRejectEnrichment={onRejectEnrichment}
                        onAcceptEnrichment={onAcceptEnrichment}
                        onDeleteCall={onDeleteCall}
                    />
                ) : (
                    <CallsHome
                        calls={calls}
                        onSelect={select}
                        onStartCapture={onStartCapture}
                        captureActive={captureActive}
                        pendingCommand={pendingCommand}
                        captureUnavailableReason={captureUnavailableReason}
                    />
                )}
                <PopoverContent
                    className={styles.infoPopover}
                    align="end"
                    sideOffset={12}
                    aria-label="Local capture"
                    onOpenAutoFocus={event => event.preventDefault()}
                >
                    <div className={styles.popoverHeading}>
                        <strong>Local capture</strong>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={styles.iconButton}
                            aria-label="Close capture information"
                            onClick={() => setInfoOpen(false)}
                        >
                            <X size={16} className="size-4" />
                        </Button>
                    </div>
                    <p>
                        Start a capture when you are ready. A worker on your configured Mac records
                        microphone and computer audio locally; no bot joins the call.
                    </p>
                    <p>
                        The capture worker owns device permissions and sends only the resulting
                        transcript evidence to Call Notes. This page never requests browser
                        microphone access.
                    </p>
                </PopoverContent>
                {refreshError && (
                    <CommandFeedback message={refreshError} onRetry={onRetryRefresh} />
                )}
                {selected && selectedMutation?.error && (
                    <CommandFeedback
                        message={selectedMutation.error}
                        onRetry={() => onRetryMutation?.(selected.id)}
                    />
                )}
                {commandError && (
                    <CommandFeedback message={commandError} onRetry={onRetryCommand} />
                )}
                {!selected && <CallsChat snapshot={null} />}
            </div>
        </Popover>
    );
}

function CommandFeedback({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className={styles.commandError} role="alert">
            <span>{message}</span>
            {onRetry && (
                <Button variant="outline" size="sm" type="button" onClick={onRetry}>
                    Retry
                </Button>
            )}
        </div>
    );
}
function isCaptureActive(call: CallSnapshot): boolean {
    return (
        (call.status === "active" || call.status === "finalizing") &&
        call.capture.lifecycle !== "completed" &&
        call.capture.lifecycle !== "failed"
    );
}

function CallsHome({
    calls,
    onSelect,
    onStartCapture,
    captureActive,
    pendingCommand,
    captureUnavailableReason,
}: {
    calls: CallSnapshot[];
    onSelect: (id: string) => void;
    onStartCapture?: () => void;
    captureActive: boolean;
    pendingCommand: CaptureCommand | null;
    captureUnavailableReason?: string | null;
}) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [dayOffset, setDayOffset] = useState(0);
    const day = new Date();
    day.setDate(day.getDate() + dayOffset);
    const activeCalls = calls.filter(
        call =>
            isCaptureActive(call) && new Date(call.createdAt).toDateString() === day.toDateString()
    );
    const normalized = query.trim().toLowerCase();
    const groups = new Map<string, CallSnapshot[]>();
    for (const call of [...calls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
        if (normalized && !noteTitle(call).toLowerCase().includes(normalized)) continue;
        const label = dateLabel(call.createdAt);
        const group = groups.get(label);
        if (group) group.push(call);
        else groups.set(label, [call]);
    }
    const startDisabled =
        captureActive || pendingCommand !== null || Boolean(captureUnavailableReason);

    return (
        <main className={styles.panel} aria-label="Calls library">
            <header className={styles.chrome}>
                <div className={styles.chromeGroup}>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={styles.iconButton}
                        aria-label="Search notes"
                        aria-expanded={searchOpen}
                        onClick={() => {
                            setSearchOpen(value => !value);
                            setQuery("");
                        }}
                    >
                        <Search size={17} className="size-[17px]" />
                    </Button>
                </div>
                <div className={styles.chromeGroup}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="inline-flex">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className={cn(styles.pill, styles.captureButton)}
                                    type="button"
                                    aria-label="Start capture"
                                    onClick={onStartCapture}
                                    disabled={startDisabled}
                                    title={captureUnavailableReason ?? undefined}
                                >
                                    <Mic size={14} className="size-3.5" />{" "}
                                    {pendingCommand === "start" ? "Starting…" : "Start capture"}
                                </Button>
                            </span>
                        </TooltipTrigger>
                        {captureUnavailableReason && (
                            <TooltipContent>{captureUnavailableReason}</TooltipContent>
                        )}
                    </Tooltip>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={styles.pill} type="button">
                            <Info size={14} className="size-3.5" /> Capture info
                        </Button>
                    </PopoverTrigger>
                </div>
            </header>
            <div className={styles.scroll}>
                <div
                    className={cn(
                        styles.homeContent,
                        query && !groups.size && styles.noSearchResults
                    )}
                >
                    {captureUnavailableReason && (
                        <p className={styles.workerNotice} role="status">
                            {captureUnavailableReason}
                        </p>
                    )}
                    <div className={styles.sectionHeading}>
                        <h1>Coming up</h1>
                        <div className={styles.chromeGroup}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={styles.iconButton}
                                aria-label="Previous day"
                                onClick={() => setDayOffset(value => value - 1)}
                            >
                                <ChevronLeft size={17} className="size-[17px]" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={styles.iconButton}
                                aria-label="Next day"
                                onClick={() => setDayOffset(value => value + 1)}
                            >
                                <ChevronRight size={17} className="size-[17px]" />
                            </Button>
                        </div>
                    </div>
                    <section className={styles.agenda} aria-label="Call activity">
                        <div className={styles.agendaDate}>
                            <span className={styles.dayNumber}>{day.getDate()}</span>
                            <div>
                                {day.toLocaleDateString("en-US", { month: "long" })}
                                {dayOffset === 0 && <i />}
                                <small>
                                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                                </small>
                            </div>
                        </div>
                        <div className={styles.agendaEvents}>
                            {activeCalls.length ? (
                                activeCalls.map(call => (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        key={call.id}
                                        className={styles.agendaEvent}
                                        onClick={() => onSelect(call.id)}
                                    >
                                        <strong>{noteTitle(call)}</strong>
                                        <span>{captureLabel(call)} · Open note</span>
                                    </Button>
                                ))
                            ) : (
                                <div className={styles.agendaEmpty}>
                                    <span>
                                        {dayOffset === 0
                                            ? "Ready for your next call"
                                            : "No call activity"}
                                    </span>
                                    <small>Start capture when you are ready</small>
                                </div>
                            )}
                        </div>
                    </section>
                    {searchOpen && (
                        <label className={styles.search}>
                            <Search size={15} className="size-[15px]" />
                            <Input
                                autoFocus
                                aria-label="Search calls"
                                placeholder="Search your notes"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                className={styles.iconButton}
                                aria-label="Close search"
                                onClick={() => {
                                    setQuery("");
                                    setSearchOpen(false);
                                }}
                            >
                                <X size={15} className="size-[15px]" />
                            </Button>
                        </label>
                    )}
                    <div className={styles.notesList}>
                        {[...groups].map(([label, group]) => (
                            <section key={label} className={styles.dateGroup} aria-label={label}>
                                <h2>{label}</h2>
                                {group.map(call => (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        key={call.id}
                                        className={styles.noteRow}
                                        onClick={() => onSelect(call.id)}
                                    >
                                        <span
                                            className={cn(
                                                styles.noteIcon,
                                                isCaptureActive(call) && styles.activeIcon
                                            )}
                                        >
                                            {isCaptureActive(call) ? (
                                                <AudioLines size={18} className="size-[18px]" />
                                            ) : (
                                                <FileText size={17} className="size-[17px]" />
                                            )}
                                        </span>
                                        <span className={styles.noteRowText}>
                                            <strong>{noteTitle(call)}</strong>
                                            <small>
                                                {isCaptureActive(call)
                                                    ? captureLabel(call)
                                                    : call.note?.visibility === "company"
                                                      ? "Shared with company"
                                                      : "Private note"}
                                            </small>
                                        </span>
                                        {call.note?.visibility === "private" && (
                                            <LockKeyhole
                                                size={12}
                                                className={cn(styles.rowLock, "size-3")}
                                            />
                                        )}
                                        <time dateTime={call.createdAt}>
                                            {new Date(call.createdAt).toLocaleTimeString("en-US", {
                                                hour: "numeric",
                                                minute: "2-digit",
                                            })}
                                        </time>
                                    </Button>
                                ))}
                            </section>
                        ))}
                        {!groups.size && (
                            <div className={query ? styles.searchEmptyState : styles.emptyState}>
                                {!query && <FileText size={24} />}
                                <h2>
                                    {query
                                        ? "No matching notes"
                                        : "Your next conversation starts here"}
                                </h2>
                                <p>
                                    {query
                                        ? `No calls match “${query.trim()}”.`
                                        : "Start a capture when you are ready. Your note and transcript will appear here."}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}

function CallPanel({
    snapshot,
    onHome,
    onStartCapture,
    onResumeCapture,
    onStopCapture,
    captureActive,
    pendingCommand,
    captureUnavailableReason,
    noteDraft,
    enrichmentPreview,
    mutationStatus,
    onNoteChange,
    onNoteTitleChange,
    onSaveNote,
    onDiscardNote,
    onSetVisibility,
    onRequestEnrichment,
    onRejectEnrichment,
    onAcceptEnrichment,
    onDeleteCall,
}: {
    snapshot: CallSnapshot;
    onHome: () => void;
    onStartCapture?: () => void;
    onResumeCapture?: (callId: string) => void;
    onStopCapture?: (callId: string) => void;
    captureActive: boolean;
    pendingCommand: CaptureCommand | null;
    captureUnavailableReason?: string | null;
    noteDraft?: CallNoteDraft;
    enrichmentPreview?: EnrichmentPreviewState;
    mutationStatus?: CallMutationStatus;
    onNoteChange?: CallsWorkspaceProps["onNoteChange"];
    onNoteTitleChange?: CallsWorkspaceProps["onNoteTitleChange"];
    onSaveNote?: CallsWorkspaceProps["onSaveNote"];
    onDiscardNote?: CallsWorkspaceProps["onDiscardNote"];
    onSetVisibility?: CallsWorkspaceProps["onSetVisibility"];
    onRequestEnrichment?: CallsWorkspaceProps["onRequestEnrichment"];
    onRejectEnrichment?: CallsWorkspaceProps["onRejectEnrichment"];
    onAcceptEnrichment?: CallsWorkspaceProps["onAcceptEnrichment"];
    onDeleteCall?: CallsWorkspaceProps["onDeleteCall"];
}) {
    const [noteView, setNoteView] = useState<"notes" | "enhanced">("notes");
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [dockMode, setDockMode] = useState<"collapsed" | "transcript" | "chat">("collapsed");
    const dockRef = useRef<HTMLDivElement>(null);
    const previousDockMode = useRef(dockMode);
    const restoreDockFocus = useRef(true);
    const closeDock = () => {
        restoreDockFocus.current = true;
        setDockMode("collapsed");
    };
    useLayoutEffect(() => {
        const previous = previousDockMode.current;
        previousDockMode.current = dockMode;
        const selector =
            dockMode === "chat"
                ? '[aria-label="Ask about this call"]'
                : dockMode === "transcript"
                  ? '[aria-label="Close transcript"]'
                  : previous === "transcript"
                    ? '[aria-label="Show transcript"]'
                    : "[data-chat-trigger]";
        if (dockMode !== "collapsed" || (previous !== "collapsed" && restoreDockFocus.current)) {
            dockRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
        }
    }, [dockMode]);
    useEffect(() => {
        if (dockMode === "collapsed") return;
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            restoreDockFocus.current = true;
            setDockMode("collapsed");
        };
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !dockRef.current?.contains(event.target)) {
                restoreDockFocus.current = false;
                setDockMode("collapsed");
            }
        };
        window.addEventListener("keydown", escape);
        document.addEventListener("pointerdown", outside);
        return () => {
            window.removeEventListener("keydown", escape);
            document.removeEventListener("pointerdown", outside);
        };
    }, [dockMode]);
    const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
    const [proposalDraft, setProposalDraft] = useState<{
        runId: string;
        content: EditableContent;
    } | null>(null);
    const enrichment = snapshot.enrichment;
    useEffect(() => {
        if (!enrichment || enrichment.status !== "ready" || !enrichment.proposal) {
            if (enrichment?.status !== "ready") setProposalDraft(null);
            return;
        }
        const proposal = enrichment.proposal;
        setProposalDraft(current =>
            current?.runId === enrichment.id
                ? current
                : {
                      runId: enrichment.id,
                      content: renderEnrichedNoteProposal(proposal),
                  }
        );
    }, [enrichment]);
    const copyLink = async () => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("call", snapshot.id);
            await navigator.clipboard.writeText(url.toString());
            setCopyState("copied");
        } catch {
            setCopyState("failed");
        }
    };
    const stopping =
        pendingCommand === "stop" ||
        snapshot.status === "finalizing" ||
        snapshot.capture.lifecycle === "finalizing" ||
        snapshot.capture.desiredMode === "stopped";
    const showStop = snapshot.viewerCapabilities.canControlCapture && isCaptureActive(snapshot);
    const showResume = showStop && snapshot.capture.desiredMode === "paused";
    const resumeDisabled = pendingCommand !== null || Boolean(captureUnavailableReason);
    const startDisabled =
        captureActive || pendingCommand !== null || Boolean(captureUnavailableReason);
    const mutationPending = mutationStatus?.pending ?? false;
    const noteTitle = noteDraft?.title ?? snapshot.note?.title ?? snapshot.title;
    const proposalContent =
        proposalDraft && enrichment?.id === proposalDraft.runId ? proposalDraft.content : null;
    const proposalStale =
        enrichment !== null &&
        snapshot.note !== null &&
        enrichment.baseNoteRevision !== snapshot.note.revision;
    return (
        <main className={styles.panel}>
            <header className={styles.chrome}>
                <Button
                    variant="outline"
                    size="sm"
                    className={styles.homeButton}
                    aria-label="Back to all notes"
                    onClick={onHome}
                >
                    <ChevronLeft size={13} className="size-[13px]" />
                    <Home size={16} className="size-4" />
                </Button>
                <div className={styles.chromeGroup}>
                    {showResume && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="inline-flex">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className={cn(styles.pill, styles.captureButton)}
                                        type="button"
                                        aria-label="Resume capture"
                                        onClick={() => onResumeCapture?.(snapshot.id)}
                                        disabled={resumeDisabled}
                                        title={captureUnavailableReason ?? undefined}
                                    >
                                        <Play size={14} className="size-3.5" />{" "}
                                        {pendingCommand === "resume"
                                            ? "Resuming…"
                                            : "Resume capture"}
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            {captureUnavailableReason && (
                                <TooltipContent>{captureUnavailableReason}</TooltipContent>
                            )}
                        </Tooltip>
                    )}
                    {showStop && (
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(styles.pill, styles.stopButton)}
                            type="button"
                            onClick={() => onStopCapture?.(snapshot.id)}
                            disabled={stopping || pendingCommand !== null}
                        >
                            <Square size={13} className="size-[13px]" />{" "}
                            {stopping ? "Stopping…" : "Stop capture"}
                        </Button>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="inline-flex">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className={cn(styles.pill, styles.captureButton)}
                                    type="button"
                                    onClick={onStartCapture}
                                    disabled={startDisabled}
                                    title={captureUnavailableReason ?? undefined}
                                >
                                    <Mic size={14} className="size-3.5" />{" "}
                                    {pendingCommand === "start" ? "Starting…" : "Start capture"}
                                </Button>
                            </span>
                        </TooltipTrigger>
                        {captureUnavailableReason && (
                            <TooltipContent>{captureUnavailableReason}</TooltipContent>
                        )}
                    </Tooltip>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={styles.iconButton}
                            aria-label="Capture information"
                        >
                            <Info size={16} className="size-4" />
                        </Button>
                    </PopoverTrigger>
                    {snapshot.note &&
                    snapshot.viewerCapabilities.canChangeVisibility &&
                    onSetVisibility ? (
                        <Select
                            value={snapshot.note.visibility}
                            disabled={mutationPending}
                            onValueChange={visibility =>
                                onSetVisibility(snapshot.id, visibility as NoteVisibility)
                            }
                        >
                            <SelectTrigger
                                size="sm"
                                className={styles.visibilityControl}
                                aria-label="Note visibility"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="company">Shared</SelectItem>
                                <SelectItem value="private">Private</SelectItem>
                            </SelectContent>
                        </Select>
                    ) : (
                        <span className={styles.pill} title="Note visibility">
                            {snapshot.note?.visibility === "company" ? (
                                <Users size={13} className="size-[13px]" />
                            ) : (
                                <LockKeyhole size={13} className="size-[13px]" />
                            )}
                            {snapshot.note?.visibility === "company" ? "Shared" : "Private"}
                        </span>
                    )}
                    {snapshot.viewerCapabilities.canDelete && onDeleteCall && (
                        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                            <DialogTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={styles.iconButton}
                                    type="button"
                                    aria-label="Delete call"
                                    disabled={mutationPending}
                                >
                                    <Trash2 size={15} className="size-[15px]" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent aria-describedby={undefined}>
                                <DialogHeader>
                                    <DialogTitle>Delete this call and its note?</DialogTitle>
                                </DialogHeader>
                                <DialogFooter>
                                    <DialogClose asChild>
                                        <Button variant="outline" type="button">
                                            Cancel
                                        </Button>
                                    </DialogClose>
                                    <Button
                                        variant="destructive"
                                        type="button"
                                        disabled={mutationPending}
                                        onClick={() => {
                                            setDeleteOpen(false);
                                            onDeleteCall(snapshot.id);
                                        }}
                                    >
                                        Delete
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        className={styles.pill}
                        aria-label="Copy note link"
                        onClick={() => void copyLink()}
                    >
                        {copyState === "copied" ? (
                            <Check size={15} className="size-[15px]" />
                        ) : (
                            <LinkIcon size={15} className="size-[15px]" />
                        )}
                    </Button>
                    {copyState !== "idle" && (
                        <span role="status" className={styles.copyStatus}>
                            {copyState === "copied" ? "Link copied" : "Could not copy link"}
                        </span>
                    )}
                </div>
            </header>
            <div className={styles.scroll}>
                <article className={styles.noteContent}>
                    {captureUnavailableReason && !captureActive && (
                        <p className={styles.workerNotice} role="status">
                            {captureUnavailableReason}
                        </p>
                    )}
                    {snapshot.capture.lifecycle === "finalizing" && (
                        <p className={styles.workerNotice} role="status">
                            Stopping audio and saving pending Transcript segments…
                        </p>
                    )}
                    {snapshot.capture.desiredMode === "paused" &&
                        snapshot.capture.pausedReason === "worker_error" && (
                            <p className={styles.workerNotice} role="alert">
                                The Local Capture Worker stopped. The Transcript so far is kept.
                                Resume continues this Call. The worker must be running before you
                                resume.
                            </p>
                        )}
                    {snapshot.capture.lifecycle === "failed" && (
                        <p className={styles.workerNotice} role="alert">
                            Capture did not finish successfully. Saved evidence is retained. Check
                            the worker, audio permissions, and transcription service before starting
                            again.
                        </p>
                    )}
                    {snapshot.capture.outcome === "partial" && (
                        <p className={styles.workerNotice} role="status">
                            This Capture is incomplete. Saved Transcript segments and your Call Note
                            are preserved.
                        </p>
                    )}
                    <CallNoteTitle
                        title={noteTitle}
                        editable={Boolean(
                            snapshot.note &&
                                snapshot.viewerCapabilities.canEditNote &&
                                onNoteTitleChange
                        )}
                        onRename={title => onNoteTitleChange?.(snapshot.id, title)}
                    />
                    <div className={styles.noteMeta}>
                        <div className={styles.noteSwitcher} role="tablist" aria-label="Note views">
                            <Button
                                variant="ghost"
                                size="sm"
                                role="tab"
                                aria-selected={noteView === "notes"}
                                className={noteView === "notes" ? styles.selectedTab : ""}
                                onClick={() => setNoteView("notes")}
                            >
                                <FileText size={13} className="size-[13px]" /> My notes
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                role="tab"
                                aria-selected={noteView === "enhanced"}
                                className={noteView === "enhanced" ? styles.selectedTab : ""}
                                onClick={() => setNoteView("enhanced")}
                            >
                                <Sparkles size={14} className="size-3.5" /> AI enhanced
                                {(snapshot.enrichment?.status === "ready" ||
                                    snapshot.enrichment?.status === "accepted") && <i />}
                            </Button>
                        </div>
                        <span className={styles.pill}>
                            <CalendarDays size={13} className="size-[13px]" />
                            {dateLabel(snapshot.createdAt)}
                        </span>
                        <span
                            className={styles.captureStatus}
                            role="status"
                            aria-label="Capture status"
                            data-live={snapshot.capture.lifecycle === "live"}
                        >
                            <i />
                            {captureLabel(snapshot)}
                            {snapshot.capture.outcome === "partial" ? " · Partial" : ""}
                        </span>
                    </div>
                    <section className={styles.noteBody} aria-label="Call note">
                        {noteView === "notes" ? (
                            snapshot.note ? (
                                <CallNoteEditor
                                    content={
                                        snapshot.viewerCapabilities.canEditNote
                                            ? (noteDraft ?? snapshot.note)
                                            : snapshot.note
                                    }
                                    editable={
                                        snapshot.viewerCapabilities.canEditNote &&
                                        Boolean(onNoteChange)
                                    }
                                    onChange={content => onNoteChange?.(snapshot.id, content)}
                                    onSave={() => onSaveNote?.(snapshot.id)}
                                />
                            ) : (
                                <PrivateNote />
                            )
                        ) : (
                            <EnhancedBody
                                snapshot={snapshot}
                                noteDraft={noteDraft}
                                enrichmentPreview={enrichmentPreview}
                                mutationPending={mutationPending}
                                proposalContent={proposalContent}
                                proposalStale={proposalStale}
                                onProposalChange={content =>
                                    setProposalDraft(current =>
                                        enrichment
                                            ? {
                                                  runId: enrichment.id,
                                                  content,
                                              }
                                            : current
                                    )
                                }
                                onRequestEnrichment={onRequestEnrichment}
                                onRejectEnrichment={onRejectEnrichment}
                                onAcceptEnrichment={onAcceptEnrichment}
                                onSaveNote={onSaveNote}
                                onDiscardNote={onDiscardNote}
                            />
                        )}
                    </section>
                    {snapshot.note && noteView === "notes" && (
                        <NoteSaveStatus
                            snapshot={snapshot}
                            draft={noteDraft}
                            onSave={onSaveNote}
                            onDiscard={onDiscardNote}
                        />
                    )}
                </article>
            </div>
            <div
                ref={dockRef}
                className={styles.callDock}
                data-mode={dockMode}
                aria-label="Call assistant dock"
            >
                <div
                    className={styles.dockView}
                    data-active={dockMode !== "transcript"}
                    ref={element => {
                        if (element) element.inert = dockMode === "transcript";
                    }}
                    aria-hidden={dockMode === "transcript"}
                >
                    <CallsChat
                        snapshot={snapshot}
                        open={dockMode === "chat"}
                        onOpen={() => setDockMode("chat")}
                        onClose={closeDock}
                        onShowTranscript={() => setDockMode("transcript")}
                    />
                </div>
                <div
                    className={styles.dockView}
                    data-active={dockMode === "transcript"}
                    ref={element => {
                        if (element) element.inert = dockMode !== "transcript";
                    }}
                    aria-hidden={dockMode !== "transcript"}
                >
                    <TranscriptSection
                        snapshot={snapshot}
                        active={dockMode === "transcript"}
                        onClose={closeDock}
                        onShowChat={() => setDockMode("chat")}
                    />
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className={styles.dockWaveform}
                    aria-label={
                        dockMode === "transcript" ? "Collapse transcript" : "Show transcript"
                    }
                    aria-expanded={dockMode === "transcript"}
                    aria-controls={`transcript-${snapshot.id}`}
                    tabIndex={dockMode === "chat" ? -1 : 0}
                    aria-hidden={dockMode === "chat"}
                    onClick={() =>
                        dockMode === "transcript" ? closeDock() : setDockMode("transcript")
                    }
                >
                    <AudioLines size={25} className="size-[25px]" />
                    <ChevronDown size={12} className={cn(styles.transcriptChevron, "size-3")} />
                </Button>
            </div>
        </main>
    );
}

function CallNoteTitle({
    title,
    editable,
    onRename,
}: {
    title: string;
    editable: boolean;
    onRename: (title: string) => void;
}) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    const [editing, setEditing] = useState(false);
    const isEditing = editable && editing;

    // Leave the browser-owned text and selection alone while the owner types,
    // including when a polled snapshot updates the surrounding workspace.
    useLayoutEffect(() => {
        if (!isEditing && headingRef.current) headingRef.current.textContent = title;
    }, [title, isEditing]);
    useLayoutEffect(() => {
        if (!isEditing || !headingRef.current) return;
        headingRef.current.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(headingRef.current);
        selection?.removeAllRanges();
        selection?.addRange(range);
    }, [isEditing]);

    return (
        <h1
            ref={headingRef}
            className={editable ? styles.editableTitle : undefined}
            contentEditable={isEditing ? "plaintext-only" : false}
            suppressContentEditableWarning
            role={isEditing ? "textbox" : undefined}
            aria-label={isEditing ? "Call note title" : undefined}
            aria-multiline={isEditing ? false : undefined}
            title={editable && !isEditing ? "Double-click to rename" : undefined}
            tabIndex={editable ? 0 : undefined}
            onDoubleClick={() => {
                if (editable && !isEditing) setEditing(true);
            }}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (!isEditing) {
                    if (editable && (event.key === "Enter" || event.key === "F2")) {
                        event.preventDefault();
                        setEditing(true);
                    }
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                } else if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
            }}
            onBlur={event => {
                if (isEditing) {
                    const nextTitle = (event.currentTarget.textContent ?? "")
                        .replace(/[\r\n]+/g, " ")
                        .trim()
                        .slice(0, 512);
                    event.currentTarget.textContent = nextTitle || title;
                    if (nextTitle && nextTitle !== title) onRename(nextTitle);
                }
                setEditing(false);
            }}
        />
    );
}

function NoteSaveStatus({
    snapshot,
    draft,
    onSave,
    onDiscard,
}: {
    snapshot: CallSnapshot;
    draft?: CallNoteDraft;
    onSave?: CallsWorkspaceProps["onSaveNote"];
    onDiscard?: CallsWorkspaceProps["onDiscardNote"];
}) {
    const [copyFailed, setCopyFailed] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    if (!snapshot.viewerCapabilities.canEditNote || !onSave) {
        return <footer className={styles.noteFooter}>Read-only note</footer>;
    }
    const failed = draft?.status === "failed" || draft?.status === "conflict";
    return (
        <footer className={styles.noteFooter} aria-label="Note save status">
            <span role={failed ? "alert" : "status"} aria-live="polite">
                {draft?.error ??
                    (draft?.status === "saving" ? "Saving…" : draft ? "Unsaved changes" : "Saved")}
            </span>
            {draft && draft.status !== "saving" && draft.status !== "conflict" && (
                <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => onSave(snapshot.id)}
                >
                    {failed ? "Retry save" : "Save now"}
                </Button>
            )}
            {failed && (
                <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(draft.contentMarkdown);
                            setCopyFailed(false);
                        } catch {
                            setCopyFailed(true);
                        }
                    }}
                >
                    Copy my draft
                </Button>
            )}
            {failed && onDiscard && (
                <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
                    <DialogTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            disabled={
                                draft.status === "conflict" &&
                                (snapshot.note?.revision ?? 0) <= draft.baseRevision
                            }
                        >
                            Use saved version
                        </Button>
                    </DialogTrigger>
                    <DialogContent aria-describedby={undefined}>
                        <DialogHeader>
                            <DialogTitle>
                                Discard your unsaved changes and use the saved note?
                            </DialogTitle>
                        </DialogHeader>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button variant="outline" type="button">
                                    Cancel
                                </Button>
                            </DialogClose>
                            <Button
                                type="button"
                                onClick={() => {
                                    setDiscardOpen(false);
                                    onDiscard(snapshot.id);
                                }}
                            >
                                Use saved version
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
            {copyFailed && (
                <span role="alert">Could not copy. Select and copy your text in the editor.</span>
            )}
        </footer>
    );
}

function PrivateNote() {
    return (
        <div className={styles.emptyState}>
            <LockKeyhole size={20} />
            <strong>Private to the owner</strong>
            <p>The company transcript remains available.</p>
        </div>
    );
}

function EnhancedBody({
    snapshot,
    noteDraft,
    enrichmentPreview,
    mutationPending,
    proposalContent,
    proposalStale,
    onProposalChange,
    onRequestEnrichment,
    onRejectEnrichment,
    onAcceptEnrichment,
    onSaveNote,
    onDiscardNote,
}: {
    snapshot: CallSnapshot;
    noteDraft?: CallNoteDraft;
    enrichmentPreview?: EnrichmentPreviewState;
    mutationPending: boolean;
    proposalContent: EditableContent | null;
    proposalStale: boolean;
    onProposalChange: (content: EditableContent) => void;
    onRequestEnrichment?: CallsWorkspaceProps["onRequestEnrichment"];
    onRejectEnrichment?: CallsWorkspaceProps["onRejectEnrichment"];
    onAcceptEnrichment?: CallsWorkspaceProps["onAcceptEnrichment"];
    onSaveNote?: CallsWorkspaceProps["onSaveNote"];
    onDiscardNote?: CallsWorkspaceProps["onDiscardNote"];
}) {
    const [discardOpen, setDiscardOpen] = useState(false);
    if (!snapshot.note) return <PrivateNote />;

    const run = snapshot.enrichment;
    const canRequest = snapshot.viewerCapabilities.canRequestEnrichment && onRequestEnrichment;
    const canResolve = snapshot.viewerCapabilities.canResolveEnrichment;
    const noteDirty = noteDraft !== undefined;
    const status = run?.status;
    const proposal = run?.proposal;
    const requestLabel =
        status === "failed" || status === "rejected" || status === "accepted"
            ? "Regenerate enhancement"
            : "Enhance with AI";

    if (enrichmentPreview || status === "queued" || status === "generating") {
        return (
            <div role="tabpanel" aria-label="AI enhanced note">
                <EnrichmentPreview
                    markdown={enrichmentPreview?.markdown ?? ""}
                    status={
                        enrichmentPreview?.status ??
                        (status === "generating" ? "generating" : "queued")
                    }
                    error={enrichmentPreview?.error}
                />
            </div>
        );
    }

    if (!run) {
        return (
            <div className={styles.emptyState} role="tabpanel" aria-label="AI enhanced note">
                <Sparkles size={20} />
                <strong>No enhanced note yet</strong>
                <p>Summarize the call by topic, with ideas from your notes woven in and bolded.</p>
                {canRequest && (
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        className={styles.actionButton}
                        disabled={mutationPending || noteDirty}
                        onClick={() => onRequestEnrichment?.(snapshot.id)}
                    >
                        <Sparkles size={14} className="size-3.5" />{" "}
                        {noteDirty ? "Save note before enhancing" : requestLabel}
                    </Button>
                )}
            </div>
        );
    }

    if (!proposal || status === "failed") {
        return (
            <div className={styles.emptyState} role="tabpanel" aria-label="AI enhanced note">
                <Sparkles size={20} />
                <strong>
                    {status === "failed" ? "Enhancement failed" : "No enhanced note yet"}
                </strong>
                <p>
                    The original note and transcript are unchanged. Retry to generate a new
                    proposal.
                </p>
                {canRequest && (
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        className={styles.actionButton}
                        disabled={mutationPending || noteDirty}
                        onClick={() => onRequestEnrichment?.(snapshot.id)}
                    >
                        <RefreshCw size={14} className="size-3.5" />{" "}
                        {noteDirty ? "Save note before retrying" : requestLabel}
                    </Button>
                )}
            </div>
        );
    }

    const content = proposalContent ?? renderEnrichedNoteProposal(proposal);
    const reviewable = status === "ready" && canResolve;
    return (
        <div className={styles.enrichmentPanel} role="tabpanel" aria-label="AI enhanced note">
            {status !== "accepted" && <ProposalReviewNotice rejected={status === "rejected"} />}
            {proposalStale && status === "ready" && (
                <p className={styles.enrichmentWarning} role="alert">
                    This proposal was generated from Note revision {run.baseNoteRevision}, but the
                    saved note is now revision {snapshot.note.revision}. Save or regenerate before
                    accepting it.
                </p>
            )}
            {noteDirty && status === "ready" && (
                <div className={styles.enrichmentWarning} role="alert">
                    <span>
                        Save or explicitly resolve your canonical note draft before accepting this
                        proposal.
                    </span>
                    <div className={styles.enrichmentActions}>
                        {onSaveNote && noteDraft.status !== "conflict" && (
                            <Button
                                variant="secondary"
                                size="sm"
                                type="button"
                                onClick={() => onSaveNote(snapshot.id)}
                            >
                                Save note
                            </Button>
                        )}
                        {onDiscardNote && (
                            <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="secondary" size="sm" type="button">
                                        Use saved note
                                    </Button>
                                </DialogTrigger>
                                <DialogContent aria-describedby={undefined}>
                                    <DialogHeader>
                                        <DialogTitle>
                                            Discard your unsaved note changes?
                                        </DialogTitle>
                                    </DialogHeader>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button variant="outline" type="button">
                                                Cancel
                                            </Button>
                                        </DialogClose>
                                        <Button
                                            type="button"
                                            onClick={() => {
                                                setDiscardOpen(false);
                                                onDiscardNote(snapshot.id);
                                            }}
                                        >
                                            Use saved note
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        )}
                    </div>
                </div>
            )}
            <CallNoteEditor
                content={content}
                editable={reviewable && !mutationPending}
                onChange={onProposalChange}
            />
            {status === "ready" && canResolve && (
                <div className={styles.enrichmentActions}>
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        className={styles.actionButton}
                        disabled={mutationPending || noteDirty || proposalStale}
                        onClick={() =>
                            onAcceptEnrichment?.(snapshot.id, run.id, {
                                contentRich: content.contentRich,
                                contentMarkdown: content.contentMarkdown,
                            })
                        }
                    >
                        <Check size={14} className="size-3.5" /> Accept enhancement
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className={styles.secondaryAction}
                        disabled={mutationPending}
                        onClick={() => onRejectEnrichment?.(snapshot.id, run.id)}
                    >
                        Reject
                    </Button>
                </div>
            )}
            {(status === "rejected" || status === "accepted") && canRequest && (
                <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    className={styles.actionButton}
                    disabled={mutationPending || noteDirty}
                    onClick={() => onRequestEnrichment?.(snapshot.id)}
                >
                    <RefreshCw size={14} className="size-3.5" />{" "}
                    {noteDirty ? "Save note before regenerating" : requestLabel}
                </Button>
            )}
        </div>
    );
}

type TimelineEntry = { type: "segment"; segment: TranscriptSegment } | { type: "gap"; gap: Gap };

function TranscriptSection({
    snapshot,
    onClose,
    active,
    onShowChat,
}: {
    snapshot: CallSnapshot;
    onClose: () => void;
    active: boolean;
    onShowChat: () => void;
}) {
    const [query, setQuery] = useState("");
    const [copyStatus, setCopyStatus] = useState("");
    const bodyRef = useRef<HTMLDivElement>(null);
    const followTail = useRef(true);
    const previousQuery = useRef("");
    const normalized = query.trim().toLowerCase();
    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body || !active) return;
        if (previousQuery.current !== normalized) {
            body.scrollTop = normalized ? 0 : body.scrollHeight;
            followTail.current = !normalized;
        } else if (!normalized && followTail.current) {
            body.scrollTop = body.scrollHeight;
        }
        previousQuery.current = normalized;
    }, [snapshot.transcript.length, snapshot.gaps.length, normalized, active]);
    const timeline: TimelineEntry[] = [
        ...snapshot.transcript
            .filter(
                segment =>
                    !normalized ||
                    `${speakerLabel(segment)} ${segment.text}`.toLowerCase().includes(normalized)
            )
            .map(segment => ({ type: "segment" as const, segment })),
        ...(!normalized ? snapshot.gaps.map(gap => ({ type: "gap" as const, gap })) : []),
    ];
    timeline.sort((a, b) =>
        (a.type === "segment" ? a.segment.receivedAt : a.gap.startedAt).localeCompare(
            b.type === "segment" ? b.segment.receivedAt : b.gap.startedAt
        )
    );
    const copyTranscript = async () => {
        const text = timeline
            .map(entry =>
                entry.type === "gap"
                    ? `[${GAP_LABELS[entry.gap.kind]} · ${gapDuration(entry.gap)} not transcribed]`
                    : `${speakerLabel(entry.segment)} (${entry.segment.audioChannel}, ${formatClock(entry.segment.sourceStartMs)}): ${entry.segment.text}`
            )
            .join("\n\n");
        try {
            await navigator.clipboard.writeText(text);
            setCopyStatus("Copied");
        } catch {
            setCopyStatus("Could not copy transcript");
        }
    };
    return (
        <aside
            id={`transcript-${snapshot.id}`}
            className={styles.transcript}
            aria-label="Company transcript"
        >
            <header className={styles.transcriptHeader}>
                <label className={styles.transcriptSearch}>
                    <Search size={16} className="size-4" />
                    <Input
                        aria-label="Search transcript"
                        placeholder="Search transcript"
                        value={query}
                        onChange={event => {
                            setQuery(event.target.value);
                            setCopyStatus("");
                        }}
                    />
                </label>
                <span className={styles.transcriptCount}>
                    {normalized
                        ? `${timeline.length} matches`
                        : `${snapshot.transcript.length} segments`}
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    className={styles.iconButton}
                    aria-label="Open AI chat"
                    onClick={onShowChat}
                >
                    <Sparkles size={16} className="size-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className={styles.iconButton}
                    aria-label={normalized ? "Copy search results" : "Copy transcript"}
                    disabled={!timeline.length}
                    onClick={() => void copyTranscript()}
                >
                    {copyStatus === "Copied" ? (
                        <Check size={16} className="size-4" />
                    ) : (
                        <Copy size={16} className="size-4" />
                    )}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className={styles.iconButton}
                    aria-label="Close transcript"
                    onClick={onClose}
                >
                    <Minus size={18} className="size-[18px]" />
                </Button>
            </header>
            <div
                ref={bodyRef}
                className={styles.transcriptBody}
                aria-label="Transcript segments"
                tabIndex={0}
                onScroll={event => {
                    const body = event.currentTarget;
                    followTail.current =
                        body.scrollHeight - body.scrollTop - body.clientHeight < 48;
                }}
            >
                {timeline.map((entry, index) => {
                    if (entry.type === "gap")
                        return (
                            <div className={styles.gap} key={`gap-${entry.gap.id}`}>
                                <Pause size={13} className="size-[13px]" />
                                <strong>{GAP_LABELS[entry.gap.kind]}</strong>
                                <span>{gapDuration(entry.gap)} not transcribed</span>
                            </div>
                        );
                    const previous = timeline[index - 1];
                    const showMeta =
                        previous?.type !== "segment" ||
                        previous.segment.audioChannel !== entry.segment.audioChannel ||
                        speakerLabel(previous.segment) !== speakerLabel(entry.segment);
                    return (
                        <SegmentRow
                            key={entry.segment.id}
                            segment={entry.segment}
                            showMeta={showMeta}
                        />
                    );
                })}
                {!timeline.length && (
                    <p className={styles.transcriptEmpty}>
                        {normalized
                            ? `No transcript matches “${query.trim()}”.`
                            : "Transcript appears as the local worker streams microphone and computer audio after you start capture."}
                    </p>
                )}
            </div>
            <footer className={styles.transcriptFooter}>
                <span className={styles.transcriptCapture}>
                    <i />
                    {captureLabel(snapshot)}
                    {snapshot.capture.outcome === "partial" ? " · Partial" : ""}
                </span>
                <span className={styles.transcriptFeedback} role="status">
                    {copyStatus}
                </span>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span
                            className={styles.transcriptProvenance}
                            title="Channel labels show the audio source, not speaker identity. Local capture may be incomplete."
                        >
                            <Users size={13} className="size-[13px]" /> Company transcript
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        Channel labels show the audio source, not speaker identity. Local capture
                        may be incomplete.
                    </TooltipContent>
                </Tooltip>
            </footer>
        </aside>
    );
}

function SegmentRow({ segment, showMeta }: { segment: TranscriptSegment; showMeta: boolean }) {
    return (
        <article
            className={styles.segment}
            data-channel={segment.audioChannel}
            data-group-start={showMeta}
            aria-label={`${speakerLabel(segment)} · ${formatClock(segment.sourceStartMs)}`}
        >
            {showMeta && (
                <div className={styles.segmentMeta}>
                    <strong>{speakerLabel(segment)}</strong>
                    <span>
                        {segment.audioChannel === "microphone" ? "Microphone" : "Computer audio"}
                    </span>
                    <time>{formatClock(segment.sourceStartMs)}</time>
                </div>
            )}
            <p>{segment.text}</p>
        </article>
    );
}
