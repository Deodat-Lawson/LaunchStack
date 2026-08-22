"use client";

import {
    Bookmark,
    Check,
    ChevronDown,
    ChevronRight,
    Clock3,
    Eye,
    EyeOff,
    FileText,
    Link2,
    LockKeyhole,
    Menu,
    MoreHorizontal,
    Pause,
    Pencil,
    Play,
    Plus,
    Radio,
    RefreshCcw,
    Search,
    ShieldCheck,
    Sparkles,
    Users,
    X,
} from "lucide-react";
import React, {
    type FormEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import styles from "./call-notes-prototype.module.css";

type Scenario = "detected" | "failure" | "review";
type CaptureStatus = "idle" | "connecting" | "live" | "paused" | "failed" | "completed";
type Visibility = "company" | "private";
type TranscriptSegment = { id: string; speaker: string; timestamp: string; text: string };
type GapMarker = { id: string; label: string; duration: string; afterSegmentId: string | null };
type BookmarkRecord = { segmentId: string; comment: string };
type CallRecord = {
    id: string;
    title: string;
    providerTopic: string;
    status: CaptureStatus;
    outcome: "ready" | "partial" | "completed";
    owner: string;
    company: string;
    note: string;
    noteRevision: number;
    visibility: Visibility;
    segments: TranscriptSegment[];
    gaps: GapMarker[];
    bookmarks: BookmarkRecord[];
    proposal: string;
    enrichmentReady: boolean;
};

type Engine = {
    call: CallRecord;
    setCall: React.Dispatch<React.SetStateAction<CallRecord>>;
    detectedNotice: boolean;
    dismissDetected: () => void;
    startDetected: () => void;
    manualOpen: boolean;
    openManualStart: () => void;
    closeManualStart: () => void;
    startManual: (value: string) => void;
    manualError: string;
    retryCapture: () => void;
    deleteFailedCall: () => void;
    noteDraft: string;
    updateNote: (value: string) => void;
    saveState: "saved" | "saving";
    viewerMode: boolean;
    setViewerMode: React.Dispatch<React.SetStateAction<boolean>>;
    reviewOpen: boolean;
    openReview: () => void;
    acceptProposal: (proposal: string) => void;
    rejectProposal: () => void;
    toast: string;
    setToast: React.Dispatch<React.SetStateAction<string>>;
    bookmarkTarget: string | null;
    openBookmark: (segmentId: string) => void;
    closeBookmark: () => void;
    saveBookmark: (comment: string) => void;
    evidenceOpen: boolean;
    evidenceTarget: TranscriptSegment | null;
    openEvidence: (segmentId?: string) => void;
    closeEvidence: () => void;
    pauseCapture: () => void;
    resumeCapture: () => void;
};

export type CallNotesPrototypeProps = { initialScenario?: Scenario };

const DEFAULT_TOPIC = "Northstar pricing review";
const FAILURE_MESSAGE =
    "Could not start RTMS. Zoom did not make a live transcript stream available.";
const BASE_SEGMENTS: TranscriptSegment[] = [
    {
        id: "s1",
        speaker: "Maya Chen",
        timestamp: "00:42",
        text: "Thanks for making time. We want to understand where the first launch cohort needs more confidence.",
    },
    {
        id: "s2",
        speaker: "Jordan Ellis",
        timestamp: "01:18",
        text: "The workflow is clear, but pricing still feels hard to explain to an operations lead in one sentence.",
    },
    {
        id: "s3",
        speaker: "Maya Chen",
        timestamp: "02:14",
        text: "If we can keep the launch plan focused on one measurable outcome, our team can champion it internally.",
    },
    {
        id: "s4",
        speaker: "Priya Shah",
        timestamp: "03:07",
        text: "A short pilot with the current team would give us the evidence we need before broadening the rollout.",
    },
];
const STREAM_SEGMENTS: TranscriptSegment[] = [
    {
        id: "s5",
        speaker: "Jordan Ellis",
        timestamp: "04:02",
        text: "The other question is how much guidance the first workspace gets during setup.",
    },
    {
        id: "s6",
        speaker: "Maya Chen",
        timestamp: "04:39",
        text: "Let us make the success check visible on day one and revisit the wider rollout next week.",
    },
    {
        id: "s7",
        speaker: "Priya Shah",
        timestamp: "05:21",
        text: "That gives us a sensible path: one pilot, one outcome, then a shared decision.",
    },
];
const REVIEW_NOTE =
    "Launch the focused pricing pilot with the first cohort. Keep the onboarding promise concrete, name one success signal, and revisit expansion after the team has evidence from the first week.";
const REVIEW_PROPOSAL =
    "Launch a focused pricing pilot with the first cohort, anchored on a single measurable outcome. Keep the onboarding promise concrete, then use the first week of evidence to decide whether to expand. The team can champion the workflow when the success check is visible.";

function createCall(scenario: Scenario): CallRecord {
    const base = {
        title: DEFAULT_TOPIC,
        providerTopic: DEFAULT_TOPIC,
        owner: "You",
        company: "Northstar Labs",
        noteRevision: 1,
        visibility: "company" as const,
        gaps: [] as GapMarker[],
    };
    if (scenario === "failure")
        return {
            ...base,
            id: "call-failure",
            status: "failed",
            outcome: "ready",
            note: "",
            segments: [],
            bookmarks: [],
            proposal: "",
            enrichmentReady: false,
        };
    if (scenario === "review")
        return {
            ...base,
            id: "call-review",
            status: "completed",
            outcome: "completed",
            note: REVIEW_NOTE,
            noteRevision: 2,
            segments: BASE_SEGMENTS,
            bookmarks: [{ segmentId: "s3", comment: "Keep the exact customer wording." }],
            proposal: REVIEW_PROPOSAL,
            enrichmentReady: true,
        };
    return {
        ...base,
        id: "call-detected",
        status: "idle",
        outcome: "ready",
        note: "",
        segments: BASE_SEGMENTS.slice(0, 2),
        bookmarks: [],
        proposal: "",
        enrichmentReady: false,
    };
}

function useCallNotesEngine(scenario: Scenario): Engine {
    const [call, setCall] = useState<CallRecord>(() => createCall(scenario));
    const [detectedNotice, setDetectedNotice] = useState(scenario === "detected");
    const [manualOpen, setManualOpen] = useState(false);
    const [manualError, setManualError] = useState("");
    const [retrying, setRetrying] = useState(false);
    const [noteDraft, setNoteDraft] = useState(() => createCall(scenario).note);
    const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
    const [viewerMode, setViewerMode] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [toast, setToast] = useState("");
    const [bookmarkTarget, setBookmarkTarget] = useState<string | null>(null);
    const [evidenceOpen, setEvidenceOpen] = useState(false);
    const [evidenceTarget, setEvidenceTarget] = useState<TranscriptSegment | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const connectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const showToast = useCallback((message: string) => {
        setToast(message);
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToast(""), 2600);
    }, []);
    const clearConnectTimer = useCallback(() => {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = undefined;
    }, []);
    const beginConnecting = useCallback(
        (isRetry = false) => {
            clearConnectTimer();
            setManualError("");
            setDetectedNotice(false);
            setManualOpen(false);
            setRetrying(isRetry);
            setCall(current => ({ ...current, status: "connecting", outcome: "ready" }));
        },
        [clearConnectTimer]
    );

    useEffect(() => {
        if (call.status !== "connecting") return;
        clearConnectTimer();
        connectTimerRef.current = setTimeout(
            () => {
                setCall(current => ({
                    ...current,
                    status: "live",
                    segments: current.segments.length
                        ? current.segments
                        : BASE_SEGMENTS.slice(0, 2),
                }));
                setRetrying(false);
            },
            retrying ? 90 : 110
        );
        return clearConnectTimer;
    }, [call.status, clearConnectTimer, retrying]);

    useEffect(() => {
        if (call.status !== "live") return;
        const interval = setInterval(() => {
            setCall(current => {
                if (current.status !== "live") return current;
                const next = STREAM_SEGMENTS.find(
                    candidate => !current.segments.some(segment => segment.id === candidate.id)
                );
                return next ? { ...current, segments: [...current.segments, next] } : current;
            });
        }, 240);
        return () => clearInterval(interval);
    }, [call.status]);

    useEffect(
        () => () => {
            clearConnectTimer();
            clearTimeout(saveTimerRef.current);
            clearTimeout(toastTimerRef.current);
        },
        [clearConnectTimer]
    );

    const updateNote = useCallback((value: string) => {
        setNoteDraft(value);
        setCall(current => ({ ...current, note: value }));
        setSaveState("saving");
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => setSaveState("saved"), 360);
    }, []);
    const pauseCapture = useCallback(() => {
        setCall(current =>
            current.status !== "live"
                ? current
                : {
                      ...current,
                      status: "paused",
                      outcome: "partial",
                      gaps: [
                          ...current.gaps,
                          {
                              id: `gap-${current.gaps.length + 1}`,
                              label: "user-paused",
                              duration: "00:08",
                              afterSegmentId: current.segments.at(-1)?.id ?? null,
                          },
                      ],
                  }
        );
        showToast("Paused · transcript gap retained");
    }, [showToast]);
    const resumeCapture = useCallback(() => {
        setCall(current =>
            current.status === "paused" ? { ...current, status: "live" } : current
        );
        showToast("Capture resumed");
    }, [showToast]);
    const startManual = useCallback(
        (value: string) => {
            const trimmed = value.trim();
            const meetingId = trimmed.replace(/[\s-]/g, "");
            if (!trimmed || (!/zoom\.us\//i.test(trimmed) && !/^\d{7,}$/.test(meetingId))) {
                setManualError("Enter a Zoom join URL or meeting ID.");
                return;
            }
            beginConnecting(false);
        },
        [beginConnecting]
    );
    const openEvidence = useCallback(
        (segmentId?: string) => {
            setEvidenceTarget(
                call.segments.find(segment => segment.id === segmentId) ??
                    call.segments[2] ??
                    call.segments[0] ??
                    null
            );
            setEvidenceOpen(true);
        },
        [call.segments]
    );
    const acceptProposal = useCallback(
        (proposal: string) => {
            setCall(current => ({
                ...current,
                proposal,
                note: proposal,
                noteRevision: current.noteRevision + 1,
                enrichmentReady: false,
            }));
            setNoteDraft(proposal);
            setReviewOpen(false);
            showToast("Revision accepted");
        },
        [showToast]
    );

    useEffect(() => {
        if (!evidenceOpen) return;
        const close = (event: globalThis.KeyboardEvent) =>
            event.key === "Escape" && setEvidenceOpen(false);
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [evidenceOpen]);

    return {
        call,
        setCall,
        detectedNotice,
        dismissDetected: () => setDetectedNotice(false),
        startDetected: () => beginConnecting(false),
        manualOpen,
        openManualStart: () => {
            setManualError("");
            setManualOpen(true);
        },
        closeManualStart: () => {
            setManualError("");
            setManualOpen(false);
        },
        startManual,
        manualError,
        retryCapture: () => beginConnecting(true),
        deleteFailedCall: () => {
            setCall(current =>
                current.status !== "failed" || current.note.trim()
                    ? current
                    : { ...current, id: "call-deleted", title: "No selected Call", status: "idle" }
            );
            showToast("Failed Call deleted");
        },
        noteDraft,
        updateNote,
        saveState,
        viewerMode,
        setViewerMode,
        reviewOpen,
        openReview: () => setReviewOpen(true),
        acceptProposal,
        rejectProposal: () => {
            setReviewOpen(false);
            showToast("Proposal rejected · current note preserved");
        },
        toast,
        setToast,
        bookmarkTarget,
        openBookmark: setBookmarkTarget,
        closeBookmark: () => setBookmarkTarget(null),
        saveBookmark: (comment: string) => {
            if (!bookmarkTarget) return;
            setCall(current => ({
                ...current,
                bookmarks: [
                    ...current.bookmarks.filter(item => item.segmentId !== bookmarkTarget),
                    { segmentId: bookmarkTarget, comment: comment.trim() },
                ],
            }));
            setBookmarkTarget(null);
            showToast("Bookmark shared with company");
        },
        evidenceOpen,
        evidenceTarget,
        openEvidence,
        closeEvidence: () => setEvidenceOpen(false),
        pauseCapture,
        resumeCapture,
    };
}

function IconButton({
    label,
    children,
    onClick,
}: {
    label: string;
    children: ReactNode;
    onClick?: () => void;
}) {
    return (
        <button type="button" className={styles.iconButton} aria-label={label} onClick={onClick}>
            {children}
        </button>
    );
}

function CaptureStatusBadge({ call }: { call: CallRecord }) {
    const label =
        call.status === "idle"
            ? "Ready"
            : `${call.status[0]!.toUpperCase()}${call.status.slice(1)}`;
    return (
        <span
            className={`${styles.status} ${styles[`status_${call.status}`]}`}
            role="status"
            aria-label="Capture status"
        >
            <span className={styles.statusDot} aria-hidden="true" />
            {label}
            {call.outcome === "partial" ? (
                <span className={styles.partialLabel}>Partial</span>
            ) : null}
        </span>
    );
}

function CallsRail({
    engine,
    open,
    onClose,
}: {
    engine: Engine;
    open: boolean;
    onClose: () => void;
}) {
    const { call } = engine;
    const isActive =
        call.status === "connecting" || call.status === "live" || call.status === "paused";
    return (
        <aside
            className={`${styles.rail} ${open ? styles.railOpen : ""}`}
            aria-label="Calls library"
        >
            <div className={styles.railBrand}>
                <span className={styles.brandMark}>L</span>
                <strong>LaunchStack</strong>
                <IconButton label="Close Calls rail" onClick={onClose}>
                    <X size={17} />
                </IconButton>
            </div>
            <div className={styles.railTitle}>
                <h1>Calls</h1>
                <IconButton label="Start a new capture" onClick={engine.openManualStart}>
                    <Plus size={17} />
                </IconButton>
            </div>
            <label className={styles.search}>
                <Search size={14} />
                <input aria-label="Search Calls" placeholder="Search calls" />
            </label>
            <div className={styles.railList}>
                {isActive ? (
                    <section>
                        <span className={styles.railLabel}>Live</span>
                        <button
                            type="button"
                            className={`${styles.callItem} ${styles.callItemActive}`}
                            onClick={onClose}
                        >
                            <span className={styles.liveMeta}>
                                <span className={styles.liveDot} />
                                {call.status === "paused"
                                    ? "Paused"
                                    : call.status === "connecting"
                                      ? "Connecting"
                                      : "Live"}
                            </span>
                            <strong>{call.title}</strong>
                            <span>{call.owner} · now</span>
                        </button>
                    </section>
                ) : null}
                <section>
                    <span className={styles.railLabel}>Recent</span>
                    {call.id !== "call-deleted" && !isActive ? (
                        <button
                            type="button"
                            className={`${styles.callItem} ${!isActive ? styles.callItemActive : ""}`}
                            onClick={onClose}
                        >
                            <span>
                                {call.status === "failed"
                                    ? "Failed"
                                    : call.status === "completed"
                                      ? "Completed"
                                      : "Today"}
                            </span>
                            <strong>{call.title}</strong>
                            <span>{call.company}</span>
                        </button>
                    ) : null}
                    <button type="button" className={styles.callItem}>
                        <span>Yesterday</span>
                        <strong>Q3 customer discovery</strong>
                        <span>Northstar Labs</span>
                    </button>
                    <button type="button" className={styles.callItem}>
                        <span>Aug 12</span>
                        <strong>Weekly launch sync</strong>
                        <span>LaunchStack</span>
                    </button>
                </section>
            </div>
            <button
                type="button"
                className={styles.railFooter}
                onClick={() => engine.setViewerMode(value => !value)}
            >
                {engine.viewerMode ? <EyeOff size={15} /> : <Users size={15} />}
                {engine.viewerMode ? "Exit teammate view" : "Preview as teammate"}
            </button>
        </aside>
    );
}

function DetectedNotice({ engine }: { engine: Engine }) {
    if (!engine.detectedNotice) return null;
    return (
        <section className={styles.notice} role="region" aria-label="Detected Zoom call">
            <span className={styles.noticeIcon}>
                <Radio size={15} />
            </span>
            <div>
                <strong>Zoom call detected</strong>
                <span>{engine.call.providerTopic}</span>
            </div>
            <button type="button" className={styles.primaryButton} onClick={engine.startDetected}>
                Start capture
            </button>
            <button type="button" className={styles.textButton} onClick={engine.dismissDetected}>
                Dismiss
            </button>
        </section>
    );
}

function CaptureControls({ engine }: { engine: Engine }) {
    const { call } = engine;
    if (engine.viewerMode)
        return (
            <span className={styles.readOnly}>
                <Eye size={13} /> Read only
            </span>
        );
    if (call.status === "live")
        return (
            <button type="button" className={styles.controlButton} onClick={engine.pauseCapture}>
                <Pause size={14} />
                Pause
            </button>
        );
    if (call.status === "paused")
        return (
            <button type="button" className={styles.primaryButton} onClick={engine.resumeCapture}>
                <Play size={14} />
                Resume
            </button>
        );
    if (call.status === "connecting")
        return (
            <span className={styles.connecting}>
                <Radio size={13} />
                Connecting…
            </span>
        );
    return (
        <button type="button" className={styles.controlButton} onClick={engine.openManualStart}>
            <Play size={14} />
            Start
        </button>
    );
}

function CallNoteEditor({ engine }: { engine: Engine }) {
    const editorRef = useRef<HTMLDivElement>(null);
    const isOwner = !engine.viewerMode;
    const noteVisible = engine.call.visibility === "company" || isOwner;
    useEffect(() => {
        if (editorRef.current && editorRef.current.textContent !== engine.noteDraft)
            editorRef.current.textContent = engine.noteDraft;
    }, [engine.call.noteRevision, engine.noteDraft]);

    if (!noteVisible) {
        return (
            <div className={styles.privateNote}>
                <LockKeyhole size={17} />
                <strong>Private to the owner</strong>
                <span>The company transcript remains available.</span>
            </div>
        );
    }
    return (
        <div
            ref={editorRef}
            className={styles.noteEditor}
            role="textbox"
            aria-label="Call Note"
            contentEditable={isOwner}
            suppressContentEditableWarning
            onInput={() => engine.updateNote(editorRef.current?.textContent ?? "")}
            data-placeholder="Write notes here…"
        />
    );
}

function TranscriptSection({ engine }: { engine: Engine }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const { call } = engine;
    const normalizedQuery = query.trim().toLowerCase();
    const visibleSegments = normalizedQuery
        ? call.segments.filter(
              segment =>
                  segment.speaker.toLowerCase().includes(normalizedQuery) ||
                  segment.text.toLowerCase().includes(normalizedQuery)
          )
        : call.segments;

    return (
        <section className={styles.transcript} aria-label="Company Transcript">
            <div className={styles.transcriptHeader}>
                <button
                    type="button"
                    className={styles.transcriptToggle}
                    aria-label={`Transcript · ${open ? "collapse" : "expand"}`}
                    aria-expanded={open}
                    onClick={() => setOpen(value => !value)}
                >
                    <span className={styles.toggleIcon}>
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <span>
                        <strong>Transcript</strong>
                        <small>
                            <ShieldCheck size={12} />
                            {call.segments.length} segments · shared with {call.company}
                        </small>
                    </span>
                </button>
                {open ? (
                    <label className={styles.transcriptSearch}>
                        <Search size={14} />
                        <input
                            aria-label="Search transcript"
                            placeholder="Search transcript"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                        {query ? (
                            <button
                                type="button"
                                aria-label="Clear transcript search"
                                onClick={() => setQuery("")}
                            >
                                <X size={13} />
                            </button>
                        ) : null}
                    </label>
                ) : call.outcome === "partial" ? (
                    <span className={styles.gapSummary}>Capture paused · Partial</span>
                ) : null}
            </div>
            {open ? (
                <div className={styles.transcriptBody} aria-label="Transcript segments">
                    {visibleSegments.length ? (
                        visibleSegments.map(segment => {
                            const bookmark = call.bookmarks.find(
                                item => item.segmentId === segment.id
                            );
                            const gaps = call.gaps.filter(gap => gap.afterSegmentId === segment.id);
                            return (
                                <React.Fragment key={segment.id}>
                                    <article className={styles.segment}>
                                        <div className={styles.segmentMeta}>
                                            <strong>{segment.speaker}</strong>
                                            <span>{segment.timestamp}</span>
                                        </div>
                                        <p>{segment.text}</p>
                                        {!engine.viewerMode ? (
                                            <button
                                                type="button"
                                                className={`${styles.bookmarkButton} ${bookmark ? styles.bookmarkSaved : ""}`}
                                                aria-label={`Bookmark segment ${segment.timestamp}`}
                                                onClick={() => engine.openBookmark(segment.id)}
                                            >
                                                <Bookmark
                                                    size={14}
                                                    fill={bookmark ? "currentColor" : "none"}
                                                />
                                            </button>
                                        ) : null}
                                        {bookmark?.comment ? (
                                            <span className={styles.bookmarkComment}>
                                                {bookmark.comment}
                                            </span>
                                        ) : null}
                                    </article>
                                    {gaps.map(gap => (
                                        <div className={styles.gap} key={gap.id}>
                                            <Pause size={13} />
                                            <strong>Capture paused</strong>
                                            <span>{gap.duration} not transcribed</span>
                                        </div>
                                    ))}
                                </React.Fragment>
                            );
                        })
                    ) : (
                        <div className={styles.transcriptEmpty}>
                            {call.segments.length
                                ? `No transcript matches “${query.trim()}”.`
                                : "Transcript appears when Zoom connects."}
                        </div>
                    )}
                </div>
            ) : null}
        </section>
    );
}

function CallHeader({ engine, onMenu }: { engine: Engine; onMenu: () => void }) {
    const { call } = engine;
    const [renaming, setRenaming] = useState(false);
    const [title, setTitle] = useState(call.title);
    const save = () => {
        const next = title.trim() || "Untitled call";
        engine.setCall(current => ({ ...current, title: next }));
        setTitle(next);
        setRenaming(false);
        engine.setToast("Call title updated");
    };
    return (
        <header className={styles.panelHeader}>
            <IconButton label="Open Calls rail" onClick={onMenu}>
                <Menu size={18} />
            </IconButton>
            <CaptureStatusBadge call={call} />
            <div className={styles.headerSpacer} />
            <CaptureControls engine={engine} />
            <IconButton label="More Call actions">
                <MoreHorizontal size={18} />
            </IconButton>
            <div className={styles.titleBlock}>
                <div className={styles.titleLine}>
                    {renaming && !engine.viewerMode ? (
                        <input
                            aria-label="Call title"
                            className={styles.titleInput}
                            value={title}
                            autoFocus
                            onChange={event => setTitle(event.target.value)}
                            onBlur={save}
                            onKeyDown={event => event.key === "Enter" && save()}
                        />
                    ) : (
                        <button
                            type="button"
                            className={styles.titleButton}
                            aria-label={engine.viewerMode ? "Call title" : "Rename Call"}
                            onClick={() => !engine.viewerMode && setRenaming(true)}
                        >
                            <h1>{call.title}</h1>
                            {!engine.viewerMode ? <Pencil size={14} /> : null}
                        </button>
                    )}
                </div>
                <div className={styles.callMeta}>
                    <span>
                        <Clock3 size={13} />
                        Today, 10:00 AM
                    </span>
                    <span>
                        <Users size={13} />3 people
                    </span>
                    <span>
                        <Link2 size={13} />
                        Zoom
                    </span>
                </div>
            </div>
        </header>
    );
}

function CallPanel({ engine, onMenu }: { engine: Engine; onMenu: () => void }) {
    const { call } = engine;
    const [noteView, setNoteView] = useState<"notes" | "enhanced">("notes");
    const activeNoteView = engine.viewerMode ? "notes" : noteView;

    if (call.id === "call-deleted") {
        return (
            <main className={styles.panel}>
                <CallHeader engine={engine} onMenu={onMenu} />
                <div className={styles.emptyPanel}>
                    <FileText size={22} />
                    <h2>Failed Call deleted</h2>
                    <p>Select another Call or start a new capture.</p>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={engine.openManualStart}
                    >
                        Start capture
                    </button>
                </div>
            </main>
        );
    }
    return (
        <main className={styles.panel}>
            <CallHeader engine={engine} onMenu={onMenu} />
            <div className={styles.panelScroll}>
                <div className={styles.panelContent}>
                    <DetectedNotice engine={engine} />
                    {call.status === "failed" ? (
                        <section className={styles.failure} role="alert">
                            <div>
                                <strong>Capture failed</strong>
                                <span>{FAILURE_MESSAGE}</span>
                            </div>
                            <button
                                type="button"
                                className={styles.controlButton}
                                onClick={engine.retryCapture}
                            >
                                <RefreshCcw size={14} />
                                Retry capture
                            </button>
                            {!call.note.trim() ? (
                                <button
                                    type="button"
                                    className={styles.textButton}
                                    onClick={engine.deleteFailedCall}
                                >
                                    Delete
                                </button>
                            ) : null}
                        </section>
                    ) : null}
                    <section className={styles.note} aria-label="Call Note">
                        <div className={styles.noteHeading}>
                            <div
                                className={styles.noteSwitcher}
                                role="tablist"
                                aria-label="Note views"
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={activeNoteView === "notes"}
                                    className={`${styles.noteTab} ${activeNoteView === "notes" ? styles.noteTabActive : ""}`}
                                    onClick={() => setNoteView("notes")}
                                >
                                    <FileText size={13} />
                                    My notes
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={activeNoteView === "enhanced"}
                                    className={`${styles.noteTab} ${activeNoteView === "enhanced" ? styles.noteTabActive : ""}`}
                                    disabled={engine.viewerMode}
                                    onClick={() => setNoteView("enhanced")}
                                >
                                    <Sparkles size={13} />
                                    AI enhanced
                                    {call.enrichmentReady ? (
                                        <span
                                            className={styles.readyDot}
                                            aria-label="Enrichment ready"
                                        />
                                    ) : null}
                                </button>
                            </div>
                            <small>
                                {activeNoteView === "enhanced"
                                    ? call.enrichmentReady
                                        ? "Ready to review"
                                        : "Available after capture"
                                    : engine.viewerMode
                                      ? "Read only"
                                      : engine.saveState === "saving"
                                        ? "Saving…"
                                        : "Saved"}
                            </small>
                        </div>
                        {activeNoteView === "notes" ? (
                            <div role="tabpanel" aria-label="My notes">
                                <CallNoteEditor engine={engine} />
                            </div>
                        ) : (
                            <div
                                className={styles.enhancedNote}
                                role="tabpanel"
                                aria-label="AI enhanced note"
                            >
                                {call.enrichmentReady ? (
                                    <>
                                        <div className={styles.enhancedHeader}>
                                            <span>
                                                <Sparkles size={15} />
                                                <strong>AI-enhanced draft</strong>
                                            </span>
                                            <button
                                                type="button"
                                                className={styles.controlButton}
                                                aria-label="Review enrichment"
                                                onClick={engine.openReview}
                                            >
                                                Review suggestion
                                            </button>
                                        </div>
                                        <p>{call.proposal}</p>
                                    </>
                                ) : (
                                    <div className={styles.enhancedEmpty}>
                                        <Sparkles size={18} />
                                        <strong>AI enhancement starts after capture</strong>
                                        <span>
                                            The transcript and your notes stay separate until the
                                            suggestion is ready.
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className={styles.noteFooter}>
                            {activeNoteView === "enhanced" ? (
                                <>
                                    <span>
                                        <LockKeyhole size={13} />
                                        Owner-only suggestion
                                    </span>
                                    <span>Grounded in transcript and bookmarks</span>
                                </>
                            ) : engine.viewerMode ? (
                                <span>
                                    <Eye size={13} />
                                    {call.visibility === "company"
                                        ? "Shared with company"
                                        : "Private note"}
                                </span>
                            ) : (
                                <label className={styles.visibility}>
                                    <input
                                        type="checkbox"
                                        role="switch"
                                        aria-label="Shared with company"
                                        checked={call.visibility === "company"}
                                        onChange={event =>
                                            engine.setCall(current => ({
                                                ...current,
                                                visibility: event.target.checked
                                                    ? "company"
                                                    : "private",
                                            }))
                                        }
                                    />
                                    {call.visibility === "company" ? (
                                        <Users size={13} />
                                    ) : (
                                        <LockKeyhole size={13} />
                                    )}
                                    {call.visibility === "company"
                                        ? "Shared with company"
                                        : "Private to you"}
                                </label>
                            )}
                            {activeNoteView === "notes" ? (
                                <span>Revision {call.noteRevision}</span>
                            ) : null}
                        </div>
                    </section>
                    <TranscriptSection engine={engine} />
                </div>
            </div>
        </main>
    );
}

function ManualStartDialog({ engine }: { engine: Engine }) {
    const [value, setValue] = useState("");
    if (!engine.manualOpen) return null;
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        engine.startManual(value);
    };
    return (
        <div className={styles.overlay} role="presentation">
            <section
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="manual-title"
            >
                <div className={styles.dialogHeader}>
                    <div>
                        <span>New capture</span>
                        <h2 id="manual-title">Start a Zoom Call</h2>
                    </div>
                    <IconButton
                        label="Close start capture dialog"
                        onClick={engine.closeManualStart}
                    >
                        <X size={18} />
                    </IconButton>
                </div>
                <form onSubmit={submit}>
                    <label className={styles.field}>
                        <span>Zoom URL or meeting ID</span>
                        <input
                            autoFocus
                            value={value}
                            onChange={event => setValue(event.target.value)}
                            placeholder="zoom.us/j/…"
                        />
                    </label>
                    {engine.manualError ? (
                        <p className={styles.fieldError}>{engine.manualError}</p>
                    ) : null}
                    <div className={styles.dialogActions}>
                        <button
                            type="button"
                            className={styles.textButton}
                            onClick={engine.closeManualStart}
                        >
                            Cancel
                        </button>
                        <button type="submit" className={styles.primaryButton}>
                            Start capture
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}

function BookmarkDialog({ engine }: { engine: Engine }) {
    const [comment, setComment] = useState("");
    useEffect(() => {
        if (engine.bookmarkTarget) setComment("");
    }, [engine.bookmarkTarget]);
    if (!engine.bookmarkTarget) return null;
    const target = engine.call.segments.find(segment => segment.id === engine.bookmarkTarget);
    return (
        <div className={styles.overlay} role="presentation">
            <section
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="bookmark-title"
            >
                <div className={styles.dialogHeader}>
                    <div>
                        <span>Transcript · {target?.timestamp}</span>
                        <h2 id="bookmark-title">Add Bookmark</h2>
                    </div>
                    <IconButton label="Close bookmark dialog" onClick={engine.closeBookmark}>
                        <X size={18} />
                    </IconButton>
                </div>
                <blockquote>{target?.text}</blockquote>
                <label className={styles.field}>
                    <span>
                        Bookmark comment <em>(optional)</em>
                    </span>
                    <textarea
                        aria-label="Bookmark comment"
                        value={comment}
                        onChange={event => setComment(event.target.value)}
                    />
                </label>
                <div className={styles.dialogActions}>
                    <button
                        type="button"
                        className={styles.textButton}
                        onClick={engine.closeBookmark}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => engine.saveBookmark(comment)}
                    >
                        Save Bookmark
                    </button>
                </div>
            </section>
        </div>
    );
}

function ReviewDialog({ engine }: { engine: Engine }) {
    const [proposal, setProposal] = useState(engine.call.proposal);
    useEffect(() => setProposal(engine.call.proposal), [engine.call.proposal]);
    if (!engine.reviewOpen) return null;
    const citation =
        engine.call.segments.find(segment => segment.id === "s3") ?? engine.call.segments[0];
    return (
        <div className={styles.overlay} role="presentation">
            <section
                className={`${styles.dialog} ${styles.reviewDialog}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="review-title"
            >
                <div className={styles.dialogHeader}>
                    <div>
                        <span>AI enrichment</span>
                        <h2 id="review-title">Review the suggested note</h2>
                    </div>
                    <IconButton label="Close enrichment review" onClick={engine.rejectProposal}>
                        <X size={18} />
                    </IconButton>
                </div>
                <div className={styles.reviewGrid}>
                    <section aria-label="Current Call Note">
                        <span className={styles.reviewLabel}>
                            <LockKeyhole size={12} />
                            Current note
                        </span>
                        <p>{engine.call.note || "No note yet."}</p>
                    </section>
                    <section aria-label="Enriched Note Proposal">
                        <span className={styles.reviewLabel}>
                            <Sparkles size={12} />
                            Suggested revision
                        </span>
                        <textarea
                            aria-label="Enriched note proposal"
                            value={proposal}
                            onChange={event => setProposal(event.target.value)}
                        />
                        {citation ? (
                            <button
                                type="button"
                                className={styles.citation}
                                aria-label="Open transcript evidence"
                                onClick={() => engine.openEvidence(citation.id)}
                            >
                                <Bookmark size={12} />
                                Evidence · {citation.speaker}, {citation.timestamp}
                            </button>
                        ) : null}
                    </section>
                </div>
                <div className={styles.dialogActions}>
                    <button
                        type="button"
                        className={styles.textButton}
                        onClick={engine.rejectProposal}
                    >
                        Keep current
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => engine.acceptProposal(proposal)}
                    >
                        <Check size={14} />
                        Accept proposal
                    </button>
                </div>
            </section>
        </div>
    );
}

function EvidenceDialog({ engine }: { engine: Engine }) {
    if (!engine.evidenceOpen) return null;
    return (
        <div className={styles.overlayTop} role="presentation">
            <section
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="evidence-title"
            >
                <div className={styles.dialogHeader}>
                    <div>
                        <span>Bookmark evidence</span>
                        <h2 id="evidence-title">Transcript evidence</h2>
                    </div>
                    <IconButton label="Close transcript evidence" onClick={engine.closeEvidence}>
                        <X size={18} />
                    </IconButton>
                </div>
                {engine.evidenceTarget ? (
                    <blockquote>
                        <strong>
                            {engine.evidenceTarget.speaker} · {engine.evidenceTarget.timestamp}
                        </strong>
                        <p>{engine.evidenceTarget.text}</p>
                    </blockquote>
                ) : null}
            </section>
        </div>
    );
}

export function CallNotesPrototype({ initialScenario }: CallNotesPrototypeProps = {}) {
    const routeScenario =
        initialScenario ??
        (typeof window === "undefined"
            ? undefined
            : new URLSearchParams(window.location.search).get("scenario"));
    const scenario: Scenario =
        routeScenario === "failure" || routeScenario === "review" ? routeScenario : "detected";
    const engine = useCallNotesEngine(scenario);
    const [railOpen, setRailOpen] = useState(false);
    return (
        <div data-theme="light" className={`lsw-root ${styles.root}`}>
            <CallsRail engine={engine} open={railOpen} onClose={() => setRailOpen(false)} />
            {railOpen ? (
                <button
                    type="button"
                    className={styles.railScrim}
                    aria-label="Close Calls rail"
                    onClick={() => setRailOpen(false)}
                />
            ) : null}
            <CallPanel engine={engine} onMenu={() => setRailOpen(true)} />
            <ManualStartDialog engine={engine} />
            <BookmarkDialog engine={engine} />
            <ReviewDialog engine={engine} />
            <EvidenceDialog engine={engine} />
            {engine.toast ? (
                <div className={styles.toast} role="status" aria-live="polite">
                    <Check size={14} />
                    {engine.toast}
                </div>
            ) : null}
        </div>
    );
}

export default CallNotesPrototype;
