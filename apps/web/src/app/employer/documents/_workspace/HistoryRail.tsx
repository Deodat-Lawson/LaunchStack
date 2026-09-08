"use client";

import React, { useMemo, useRef, useState, type CSSProperties } from "react";
import {
    CalendarDays,
    GitBranch,
    Globe,
    Mail,
    MapPin,
    MessageSquare,
    MoreHorizontal,
    Plus,
    RotateCw,
    Share2,
} from "lucide-react";

import {
    filterHistory,
    groupHistoryByRecency,
    relativeTime,
    HISTORY_KIND_META,
    HISTORY_STATUS_LABEL,
    HISTORY_STATUS_TOKEN,
    type HistoryEntry,
    type HistoryKind,
    type HistoryKindMeta,
} from "~/lib/workspace-history";

import { ContextMenu, type SourceContextMenuItem } from "./ContextMenu";

/**
 * The History tab of the source rail: chats you can pick back up and pipeline
 * runs the workspace has produced, newest first, under date headings.
 *
 * The two kinds of row look alike on purpose — both are "work that happened" —
 * and differ only in what a click does: a chat reopens in the composer, a run
 * opens the surface that produced it. A run whose vertical has no surface yet
 * still lists, as a plain row; it happened whether or not there is a page for
 * it, and a link that goes nowhere would be worse than no link.
 */

const KIND_ICONS: Record<HistoryKindMeta["icon"], typeof MessageSquare> = {
    chat: MessageSquare,
    globe: Globe,
    "map-pin": MapPin,
    "git-branch": GitBranch,
    share: Share2,
    mail: Mail,
    calendar: CalendarDays,
};

export interface HistoryRailProps {
    entries: HistoryEntry[];
    loading: boolean;
    error: string | null;
    /** Kinds whose loader failed server-side; the list says so instead of lying. */
    degraded: HistoryKind[];
    /** The chat open in the composer right now, highlighted in the list. */
    activeSessionId: string | null;
    /** Shared with the rail's search box, so one field filters whichever tab is up. */
    query: string;
    onNewChat: () => void;
    onResumeSession: (sessionId: string) => void;
    onOpenRun: (entry: HistoryEntry) => void;
    onRenameSession: (sessionId: string, title: string) => void;
    onDeleteSession: (sessionId: string) => void;
    onRefresh: () => void;
}

interface RowProps {
    entry: HistoryEntry;
    active: boolean;
    renaming: boolean;
    now: Date;
    onOpen: () => void;
    onOpenMenu: (point: { clientX: number; clientY: number }) => void;
    onCommitRename: (title: string) => void;
    onCancelRename: () => void;
}

function HistoryRow({
    entry,
    active,
    renaming,
    now,
    onOpen,
    onOpenMenu,
    onCommitRename,
    onCancelRename,
}: RowProps) {
    const [hover, setHover] = useState(false);
    const [focused, setFocused] = useState(false);
    const meta = HISTORY_KIND_META[entry.kind];
    const Icon = KIND_ICONS[meta.icon];
    // A row only opens something when there is something to open: a chat
    // always resumes, a run needs a surface.
    const openable = meta.resumable || Boolean(entry.href);
    /**
     * The actions button trades places with the timestamp, but it is always in
     * the DOM: a control that only exists on hover is a control a keyboard
     * user does not have. Focus reveals it exactly as the mouse does.
     */
    const showActions = meta.resumable && (hover || active || focused);

    const subtitle =
        entry.kind === "chat"
            ? `${meta.label} · ${entry.messageCount ?? 0} ${entry.messageCount === 1 ? "turn" : "turns"}`
            : (entry.subtitle ?? meta.label);

    const rowStyle: CSSProperties = {
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        borderRadius: 6,
        textAlign: "left",
        background: active ? "var(--accent-soft)" : hover ? "var(--line-2)" : "transparent",
        color: active ? "var(--accent-ink)" : "var(--ink)",
        cursor: openable ? "pointer" : "default",
        transition: "background 100ms",
    };

    if (renaming) {
        return (
            <div style={{ ...rowStyle, background: "var(--line-2)" }}>
                <Icon size={13} style={{ marginTop: 2, color: "var(--ink-3)", flexShrink: 0 }} />
                <input
                    defaultValue={entry.title}
                    autoFocus
                    aria-label="Chat title"
                    data-testid="history-rename-input"
                    maxLength={300}
                    onBlur={e => onCommitRename(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") onCommitRename(e.currentTarget.value);
                        if (e.key === "Escape") onCancelRename();
                    }}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        padding: "1px 4px",
                        borderRadius: 4,
                        border: "1px solid var(--accent)",
                        background: "var(--panel)",
                        color: "var(--ink)",
                        outline: "none",
                    }}
                />
            </div>
        );
    }

    return (
        <div
            role="button"
            tabIndex={openable ? 0 : -1}
            aria-current={active ? "true" : undefined}
            data-testid={`history-row-${entry.id}`}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={() => {
                if (openable) onOpen();
            }}
            onKeyDown={e => {
                if (openable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onOpen();
                }
            }}
            onContextMenu={e => {
                e.preventDefault();
                onOpenMenu(e);
            }}
            style={rowStyle}
        >
            <span style={{ position: "relative", marginTop: 2, flexShrink: 0, lineHeight: 0 }}>
                <Icon size={13} style={{ color: active ? "var(--accent)" : "var(--ink-3)" }} />
                {/* A dot only where it carries news: finished chats need no badge. */}
                {entry.status !== "done" && (
                    <span
                        title={HISTORY_STATUS_LABEL[entry.status]}
                        aria-label={HISTORY_STATUS_LABEL[entry.status]}
                        style={{
                            position: "absolute",
                            right: -3,
                            bottom: -2,
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: `var(${HISTORY_STATUS_TOKEN[entry.status]})`,
                            boxShadow: "0 0 0 1.5px var(--panel)",
                        }}
                    />
                )}
            </span>

            <span style={{ flex: 1, minWidth: 0 }}>
                <span
                    style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: active ? 600 : 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                    title={entry.title}
                >
                    {entry.title}
                </span>
                <span
                    style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--ink-3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {subtitle}
                </span>
            </span>

            {/* One slot, two occupants: the timestamp sizes the slot and the
                actions button overlays it, so swapping them never nudges the
                row and a long date is never clipped by a fixed width. */}
            <span
                style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    minWidth: 18,
                    height: 18,
                    marginTop: 1,
                    flexShrink: 0,
                }}
            >
                <span
                    aria-hidden={showActions}
                    style={{
                        fontSize: 11,
                        color: "var(--ink-4)",
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                        opacity: showActions ? 0 : 1,
                        transition: "opacity 100ms",
                    }}
                >
                    {relativeTime(entry.at, now)}
                </span>
                {meta.resumable && (
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            onOpenMenu(e);
                        }}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        title="Chat actions"
                        aria-label={`Actions for ${entry.title}`}
                        style={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--ink-3)",
                            opacity: showActions ? 1 : 0,
                            transition: "opacity 100ms",
                        }}
                    >
                        <MoreHorizontal size={13} />
                    </button>
                )}
            </span>
        </div>
    );
}

export function HistoryRail({
    entries,
    loading,
    error,
    degraded,
    activeSessionId,
    query,
    onNewChat,
    onResumeSession,
    onOpenRun,
    onRenameSession,
    onDeleteSession,
    onRefresh,
}: HistoryRailProps) {
    const [menu, setMenu] = useState<{ x: number; y: number; entry: HistoryEntry } | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    /**
     * One timestamp for the whole render, so every "2h" in the list is
     * measured from the same instant and rows can't disagree.
     */
    const now = useRef(new Date());
    now.current = new Date();

    const groups = useMemo(
        () => groupHistoryByRecency(filterHistory(entries, query), now.current),
        [entries, query]
    );

    const menuItems = useMemo<SourceContextMenuItem[]>(() => {
        const entry = menu?.entry;
        if (!entry) return [];
        return [
            { type: "label", id: "title", label: entry.title },
            {
                type: "item",
                id: "open",
                label: "Open",
                icon: "open",
                onSelect: () => onResumeSession(entry.refId),
            },
            {
                type: "item",
                id: "rename",
                label: "Rename…",
                icon: "rename",
                onSelect: () => setRenamingId(entry.id),
            },
            { type: "separator", id: "sep" },
            {
                type: "item",
                id: "delete",
                label: "Delete chat",
                icon: "delete",
                danger: true,
                onSelect: () => onDeleteSession(entry.refId),
            },
        ];
    }, [menu, onResumeSession, onDeleteSession]);

    const totalShown = groups.reduce((sum, group) => sum + group.entries.length, 0);

    return (
        <div
            data-testid="history-rail"
            style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
            <div
                style={{
                    padding: "0 14px 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                <button
                    onClick={onNewChat}
                    data-testid="history-new-chat"
                    style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        color: "var(--ink-2)",
                        fontSize: 12,
                        fontWeight: 600,
                        transition: "border-color 120ms, color 120ms",
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.color = "var(--accent)";
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "var(--line)";
                        e.currentTarget.style.color = "var(--ink-2)";
                    }}
                >
                    <Plus size={12} />
                    New chat
                </button>
                <button
                    onClick={onRefresh}
                    title="Refresh history"
                    aria-label="Refresh history"
                    data-testid="history-refresh"
                    style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ink-3)",
                        flexShrink: 0,
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.background = "var(--line-2)";
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.background = "transparent";
                    }}
                >
                    <RotateCw
                        size={12}
                        style={{
                            animation: loading ? "lsw-spin 900ms linear infinite" : undefined,
                        }}
                    />
                </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
                {error && (
                    <div
                        style={{
                            margin: "4px 6px 8px",
                            padding: "8px 10px",
                            borderRadius: 6,
                            background: "var(--danger-soft)",
                            color: "var(--danger)",
                            fontSize: 11,
                            lineHeight: 1.4,
                        }}
                    >
                        {error}{" "}
                        <button
                            onClick={onRefresh}
                            style={{ fontWeight: 600, textDecoration: "underline" }}
                        >
                            Retry
                        </button>
                    </div>
                )}

                {degraded.length > 0 && !error && (
                    <div
                        style={{
                            margin: "4px 6px 8px",
                            padding: "6px 10px",
                            borderRadius: 6,
                            background: "var(--warn-soft)",
                            color: "var(--ink-2)",
                            fontSize: 11,
                            lineHeight: 1.4,
                        }}
                    >
                        Some activity couldn’t be loaded (
                        {degraded.map(kind => HISTORY_KIND_META[kind].label).join(", ")}).
                    </div>
                )}

                {groups.map(group => (
                    <div key={group.id} style={{ marginBottom: 6 }}>
                        <div
                            style={{
                                padding: "8px 8px 4px",
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                color: "var(--ink-4)",
                            }}
                        >
                            {group.label}
                        </div>
                        {group.entries.map(entry => (
                            <HistoryRow
                                key={entry.id}
                                entry={entry}
                                now={now.current}
                                active={entry.kind === "chat" && entry.refId === activeSessionId}
                                renaming={renamingId === entry.id}
                                onOpen={() =>
                                    entry.kind === "chat"
                                        ? onResumeSession(entry.refId)
                                        : onOpenRun(entry)
                                }
                                onOpenMenu={point =>
                                    setMenu({ x: point.clientX, y: point.clientY, entry })
                                }
                                onCommitRename={title => {
                                    setRenamingId(null);
                                    const trimmed = title.trim();
                                    if (trimmed && trimmed !== entry.title) {
                                        onRenameSession(entry.refId, trimmed);
                                    }
                                }}
                                onCancelRename={() => setRenamingId(null)}
                            />
                        ))}
                    </div>
                ))}

                {totalShown === 0 && !loading && !error && (
                    <div
                        style={{
                            padding: "32px 14px",
                            textAlign: "center",
                            color: "var(--ink-3)",
                            fontSize: 13,
                            lineHeight: 1.5,
                        }}
                    >
                        {query.trim()
                            ? "Nothing in history matches that."
                            : "Nothing here yet. Ask a question, or run a pipeline, and it shows up here."}
                    </div>
                )}

                {totalShown === 0 && loading && (
                    <div style={{ padding: "8px 8px" }} aria-hidden>
                        {[0, 1, 2].map(i => (
                            <div
                                key={i}
                                style={{
                                    height: 34,
                                    marginBottom: 6,
                                    borderRadius: 6,
                                    background: "var(--line-2)",
                                    opacity: 1 - i * 0.25,
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {menu && (
                <ContextMenu
                    open
                    x={menu.x}
                    y={menu.y}
                    items={menuItems}
                    ariaLabel={`Actions for ${menu.entry.title}`}
                    onClose={() => setMenu(null)}
                />
            )}
        </div>
    );
}
