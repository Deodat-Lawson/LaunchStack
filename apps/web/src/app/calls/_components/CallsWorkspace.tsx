"use client";

import {
    Bookmark,
    ChevronDown,
    ChevronRight,
    Clock3,
    FileText,
    Link2,
    LockKeyhole,
    Pause,
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
import { useState } from "react";

import type { CallSnapshot, Gap, TranscriptSegment } from "@launchstack/features/call-notes";

import styles from "../calls.module.css";

function notWired(action: string) {
    console.warn(`[calls] "${action}" is not wired yet`);
}

function companyLabel(snapshot: CallSnapshot): string {
    return `Company ${snapshot.companyId}`;
}

function formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
    }).format(new Date(iso));
}

function formatClock(ms: number | null): string {
    if (ms === null) return "";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type CaptureControl = "start" | "pause" | "resume" | "retry" | "connecting" | "none";
type CaptureStatusKey = "live" | "connecting" | "paused" | "failed" | "completed";
type CaptureView = {
    badge: string;
    control: CaptureControl;
    statusKey: CaptureStatusKey;
    partial: boolean;
};
function deriveCapture(snapshot: CallSnapshot): CaptureView {
    const { lifecycle, desiredMode, outcome } = snapshot.capture;
    const partial = outcome === "partial";

    if (lifecycle === "completed")
        return { badge: "Completed", control: "none", statusKey: "completed", partial };
    if (lifecycle === "failed")
        return { badge: "Failed", control: "retry", statusKey: "failed", partial };
    if (lifecycle === "finalizing")
        return { badge: "Finalizing", control: "none", statusKey: "connecting", partial };

    if (desiredMode === "paused")
        return { badge: "Paused", control: "resume", statusKey: "paused", partial };

    switch (lifecycle) {
        case "connecting":
            return { badge: "Connecting", control: "connecting", statusKey: "connecting", partial };
        case "interrupted":
            return { badge: "Reconnecting", control: "connecting", statusKey: "connecting", partial };
        case "live":
            return { badge: "Live", control: "pause", statusKey: "live", partial };
        default:
            return { badge: "Ready", control: "start", statusKey: "connecting", partial };
    }
}

const GAP_LABELS: Record<Gap["kind"], string> = {
    user_paused: "Capture paused",
    capture_user_absent: "Capture user away",
    transport_interruption: "Connection interrupted",
    worker_unavailable: "Processing unavailable",
    provider_unknown: "Zoom interruption",
};
function gapDuration(gap: Gap): string {
    if (!gap.endedAt) return "ongoing";
    const ms = new Date(gap.endedAt).getTime() - new Date(gap.startedAt).getTime();
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function CallsWorkspace({ calls }: { calls: CallSnapshot[] }) {
    const [railOpen, setRailOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(calls[0]?.id ?? null);

    const selected = calls.find((call) => call.id === selectedId) ?? calls[0] ?? null;

    return (
        <div data-theme="light" className={`lsw-root ${styles.root}`}>
            <CallsRail
                calls={calls}
                selectedId={selected?.id ?? null}
                open={railOpen}
                onSelect={(id) => {
                    setSelectedId(id);
                    setRailOpen(false);
                }}
                onClose={() => setRailOpen(false)}
            />
            {railOpen ? (
                <button
                    type="button"
                    className={styles.railScrim}
                    aria-label="Close Calls rail"
                    onClick={() => setRailOpen(false)}
                />
            ) : null}
            {selected ? (
                <CallPanel key={selected.id} snapshot={selected} onMenu={() => setRailOpen(true)} />
            ) : (
                <main className={styles.panel} aria-label="No call selected" />
            )}
        </div>
    );
}

function CallsRail({
    calls,
    selectedId,
    open,
    onSelect,
    onClose,
}: {
    calls: CallSnapshot[];
    selectedId: string | null;
    open: boolean;
    onSelect: (id: string) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState("");

    const normalized = query.trim().toLowerCase();
    const matches = normalized
        ? calls.filter((call) => call.title.toLowerCase().includes(normalized))
        : calls;
    const live = matches.filter((call) => call.status === "active");
    const recent = matches.filter((call) => call.status !== "active");

    return (
        <aside className={`${styles.rail} ${open ? styles.railOpen : ""}`} aria-label="Calls library">
            <div className={styles.railBrand}>
                <span className={styles.brandMark}>L</span>
                <strong>LaunchStack</strong>
                <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Close Calls rail"
                    onClick={onClose}
                >
                    <X size={17} />
                </button>
            </div>
            <div className={styles.railTitle}>
                <h1>Calls</h1>
                <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Start a new capture"
                    onClick={() => notWired("start new capture")}
                >
                    <Plus size={17} />
                </button>
            </div>
            <label className={styles.search}>
                <Search size={14} />
                <input
                    aria-label="Search calls"
                    placeholder="Search calls"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </label>

            <div className={styles.railList}>
                {matches.length === 0 ? (
                    <span className={styles.railLabel}>No calls match “{query.trim()}”.</span>
                ) : null}
                {live.length ? (
                    <section>
                        <span className={styles.railLabel}>Live</span>
                        {live.map((call) => (
                            <RailItem
                                key={call.id}
                                call={call}
                                selected={call.id === selectedId}
                                onSelect={onSelect}
                            />
                        ))}
                    </section>
                ) : null}
                {recent.length ? (
                    <section>
                        <span className={styles.railLabel}>Recent</span>
                        {recent.map((call) => (
                            <RailItem
                                key={call.id}
                                call={call}
                                selected={call.id === selectedId}
                                onSelect={onSelect}
                            />
                        ))}
                    </section>
                ) : null}
            </div>
        </aside>
    );
}

function RailItem({
    call,
    selected,
    onSelect,
}: {
    call: CallSnapshot;
    selected: boolean;
    onSelect: (id: string) => void;
}) {
    const capture = deriveCapture(call);
    const isLive = call.status === "active";
    return (
        <button
            type="button"
            className={`${styles.callItem} ${selected ? styles.callItemActive : ""}`}
            aria-current={selected}
            onClick={() => onSelect(call.id)}
        >
            {isLive ? (
                <span className={styles.liveMeta}>
                    <span className={styles.liveDot} />
                    {capture.badge}
                </span>
            ) : (
                <span>{capture.badge}</span>
            )}
            <strong>{call.title}</strong>
            <span>{companyLabel(call)}</span>
        </button>
    );
}

function CallPanel({ snapshot, onMenu }: { snapshot: CallSnapshot; onMenu: () => void }) {
    const capture = deriveCapture(snapshot);
    const [noteView, setNoteView] = useState<"notes" | "enhanced">("notes");
    const enrichmentReady = snapshot.enrichment?.status === "ready";

    return (
        <main className={styles.panel}>
            <header className={styles.panelHeader}>
                <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Open Calls rail"
                    onClick={onMenu}
                >
                    <Users size={18} />
                </button>

                <span
                    className={`${styles.status} ${styles[`status_${capture.statusKey}`] ?? ""}`}
                    role="status"
                    aria-label="Capture status"
                >
                    <span className={styles.statusDot} aria-hidden="true" />
                    {capture.badge}
                    {capture.partial ? (
                        <span className={styles.partialLabel}>Partial</span>
                    ) : null}
                </span>

                <div className={styles.headerSpacer} />

                <CaptureControls control={capture.control} />

                <div className={styles.titleBlock}>
                    <div className={styles.titleLine}>
                        <button
                            type="button"
                            className={styles.titleButton}
                            aria-label="Rename call"
                            onClick={() => notWired("rename call")}
                        >
                            <h1>{snapshot.title}</h1>
                        </button>
                    </div>
                    <div className={styles.callMeta}>
                        <span>
                            <Clock3 size={13} />
                            {formatDateTime(snapshot.createdAt)}
                        </span>
                        <span>
                            <Users size={13} />
                            {snapshot.transcript.length} segments
                        </span>
                        <span>
                            <Link2 size={13} />
                            Zoom
                        </span>
                    </div>
                </div>
            </header>

            <div className={styles.panelScroll}>
                <div className={styles.panelContent}>
                    <section className={styles.note} aria-label="Call note">
                        <div className={styles.noteHeading}>
                            <div className={styles.noteSwitcher} role="tablist" aria-label="Note views">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={noteView === "notes"}
                                    className={`${styles.noteTab} ${noteView === "notes" ? styles.noteTabActive : ""}`}
                                    onClick={() => setNoteView("notes")}
                                >
                                    <FileText size={13} />
                                    My notes
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={noteView === "enhanced"}
                                    className={`${styles.noteTab} ${noteView === "enhanced" ? styles.noteTabActive : ""}`}
                                    onClick={() => setNoteView("enhanced")}
                                >
                                    <Sparkles size={13} />
                                    AI enhanced
                                    {enrichmentReady ? <span className={styles.readyDot} /> : null}
                                </button>
                            </div>
                            <small>{snapshot.note ? saveLabel(snapshot.note.saveState) : "Private"}</small>
                        </div>

                        {noteView === "notes" ? (
                            <NoteBody snapshot={snapshot} />
                        ) : (
                            <EnhancedBody snapshot={snapshot} />
                        )}

                        <div className={styles.noteFooter}>
                            {snapshot.note?.visibility === "company" ? (
                                <span>
                                    <Users size={13} />
                                    Shared with company
                                </span>
                            ) : (
                                <span>
                                    <LockKeyhole size={13} />
                                    Private note
                                </span>
                            )}
                        </div>
                    </section>

                    <TranscriptSection snapshot={snapshot} />
                </div>
            </div>
        </main>
    );
}

function saveLabel(state: "saved" | "saving" | "failed"): string {
    if (state === "saving") return "Saving…";
    if (state === "failed") return "Save failed";
    return "Saved";
}

function CaptureControls({ control }: { control: CaptureControl }) {
    if (control === "pause")
        return (
            <button type="button" className={styles.controlButton} onClick={() => notWired("pause")}>
                <Pause size={14} />
                Pause
            </button>
        );
    if (control === "resume")
        return (
            <button type="button" className={styles.primaryButton} onClick={() => notWired("resume")}>
                <Play size={14} />
                Resume
            </button>
        );
    if (control === "connecting")
        return (
            <span className={styles.connecting}>
                <Radio size={13} />
                Connecting…
            </span>
        );
    if (control === "retry")
        return (
            <button
                type="button"
                className={styles.controlButton}
                onClick={() => notWired("retry capture")}
            >
                <RefreshCcw size={14} />
                Retry capture
            </button>
        );
    if (control === "none") return null;
    return (
        <button type="button" className={styles.controlButton} onClick={() => notWired("start")}>
            <Play size={14} />
            Start
        </button>
    );
}

function NoteBody({ snapshot }: { snapshot: CallSnapshot }) {
    // note === null is a non-owner viewing a private note.
    if (!snapshot.note) {
        return (
            <div className={styles.privateNote}>
                <LockKeyhole size={17} />
                <strong>Private to the owner</strong>
                <span>The company transcript remains available.</span>
            </div>
        );
    }
    return (
        <div className={styles.noteEditor} role="textbox" aria-label="Call note" aria-readonly="true">
            {snapshot.note.contentMarkdown || "Write notes here…"}
        </div>
    );
}

function EnhancedBody({ snapshot }: { snapshot: CallSnapshot }) {
    const proposal = snapshot.enrichment?.proposal;
    if (!proposal) {
        return (
            <div className={styles.enhancedEmpty}>
                <Sparkles size={18} />
                <strong>AI enhancement starts after capture</strong>
                <span>The transcript and your notes stay separate until the suggestion is ready.</span>
            </div>
        );
    }
    return (
        <div className={styles.enhancedNote} role="tabpanel" aria-label="AI enhanced note">
            <div className={styles.enhancedHeader}>
                <span>
                    <Sparkles size={15} />
                    <strong>AI-enhanced draft</strong>
                </span>
                <button
                    type="button"
                    className={styles.controlButton}
                    onClick={() => notWired("accept/reject enrichment")}
                >
                    Review suggestion
                </button>
            </div>
            <p>{proposal.summary}</p>
        </div>
    );
}

type TimelineEntry =
    | { type: "segment"; segment: TranscriptSegment }
    | { type: "gap"; gap: Gap };

function TranscriptSection({ snapshot }: { snapshot: CallSnapshot }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");

    const normalized = query.trim().toLowerCase();
    const isSearching = normalized.length > 0;
    const partial = snapshot.capture.outcome === "partial";

    const matchedSegments = isSearching
        ? snapshot.transcript.filter(
              (segment) =>
                  (segment.speakerName ?? "").toLowerCase().includes(normalized) ||
                  segment.text.toLowerCase().includes(normalized)
          )
        : snapshot.transcript;

    const timeline: TimelineEntry[] = [];
    if (isSearching) {
        for (const segment of matchedSegments) {
            timeline.push({ type: "segment", segment });
        }
    } else {
        const sortedGaps = [...snapshot.gaps].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        let gapIndex = 0;
        for (const segment of snapshot.transcript) {
            while (gapIndex < sortedGaps.length) {
                const gap = sortedGaps[gapIndex];
                if (!gap || gap.startedAt > segment.receivedAt) break;
                timeline.push({ type: "gap", gap });
                gapIndex += 1;
            }
            timeline.push({ type: "segment", segment });
        }
        for (; gapIndex < sortedGaps.length; gapIndex += 1) {
            const gap = sortedGaps[gapIndex];
            if (gap) timeline.push({ type: "gap", gap });
        }
    }

    return (
        <section className={styles.transcript} aria-label="Company transcript">
            <div className={styles.transcriptHeader}>
                <button
                    type="button"
                    className={styles.transcriptToggle}
                    aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}
                >
                    <span className={styles.toggleIcon}>
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <span>
                        <strong>Transcript</strong>
                        <small>
                            <ShieldCheck size={12} />
                            {snapshot.transcript.length} segments · shared with {companyLabel(snapshot)}
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
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </label>
                ) : partial ? (
                    <span className={styles.gapSummary}>Capture had gaps · Partial</span>
                ) : null}
            </div>

            {open ? (
                <div className={styles.transcriptBody} aria-label="Transcript segments">
                    {timeline.length ? (
                        timeline.map((entry) =>
                            entry.type === "segment" ? (
                                <SegmentRow
                                    key={`segment-${entry.segment.id}`}
                                    segment={entry.segment}
                                    bookmark={snapshot.bookmarks.find(
                                        (item) => item.segmentId === entry.segment.id
                                    )}
                                />
                            ) : (
                                <div className={styles.gap} key={`gap-${entry.gap.id}`}>
                                    <Pause size={13} />
                                    <strong>{GAP_LABELS[entry.gap.kind]}</strong>
                                    <span>{gapDuration(entry.gap)} not transcribed</span>
                                </div>
                            )
                        )
                    ) : (
                        <div className={styles.transcriptEmpty}>
                            {isSearching
                                ? `No transcript matches “${query.trim()}”.`
                                : "Transcript appears when Zoom connects."}
                        </div>
                    )}
                </div>
            ) : null}
        </section>
    );
}

function SegmentRow({
    segment,
    bookmark,
}: {
    segment: TranscriptSegment;
    bookmark: CallSnapshot["bookmarks"][number] | undefined;
}) {
    return (
        <article className={styles.segment}>
            <div className={styles.segmentMeta}>
                <strong>{segment.speakerName ?? "Unknown speaker"}</strong>
                <span>{formatClock(segment.providerStartMs)}</span>
            </div>
            <p>{segment.text}</p>
            <button
                type="button"
                className={`${styles.bookmarkButton} ${bookmark ? styles.bookmarkSaved : ""}`}
                aria-label="Bookmark segment"
                onClick={() => notWired("bookmark segment")}
            >
                <Bookmark size={14} fill={bookmark ? "currentColor" : "none"} />
            </button>
            {bookmark?.comment ? (
                <span className={styles.bookmarkComment}>{bookmark.comment}</span>
            ) : null}
        </article>
    );
}
