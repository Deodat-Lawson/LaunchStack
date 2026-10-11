"use client";

import React, { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import {
    CalendarDays,
    ChevronLeft,
    Compass,
    GitBranch,
    Globe,
    Mail,
    MapPin,
    MessageSquare,
    MoreHorizontal,
    PenLine,
    Plus,
    RotateCw,
    Share2,
    Users,
} from "lucide-react";

import {
    byPinOrder,
    filterHistory,
    movePin,
    placePin,
    relativeTime,
    sectionHistory,
    HISTORY_KIND_META,
    HISTORY_STATUS_LABEL,
    type HistoryEntry,
    type HistoryKind,
    type HistoryKindMeta,
    type HistoryStatus,
} from "~/lib/workspace-history";
import { usePeople } from "~/lib/profile/use-people";
import type { PersonLook } from "~/lib/profile/resolve";
import { cn } from "~/lib/utils";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import type { ActionMenuItem } from "~/components/ui/action-menu";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { useActionMenu, useContextTarget } from "~/components/context-menu";

import type { ArchivedHistoryState } from "./useWorkspaceHistory";

/**
 * The History tab of the source rail, laid out as Codex lays out its threads
 * (ADR-014 §5):
 *
 * - **Pinned** on top, in the order you put them (drag, or Move up / down).
 * - **Shared with you**: other people's chats, with who shared each one and a
 *   dot until you've read what's new.
 * - Then everything else, newest activity first, under date headings — your
 *   chats and the workspace's pipeline runs interleaved.
 *
 * Archive hides a row (for you only); the Archived link at the bottom shows
 * them and restores them. A chat reopens in the composer; a run opens the
 * surface that produced it; a run whose vertical has no surface yet still
 * lists, as a plain row, because a link that goes nowhere would be worse.
 */

export const HISTORY_KIND_ICONS: Record<HistoryKindMeta["icon"], typeof MessageSquare> = {
    chat: MessageSquare,
    globe: Globe,
    "map-pin": MapPin,
    "git-branch": GitBranch,
    share: Share2,
    mail: Mail,
    calendar: CalendarDays,
    compass: Compass,
    "pen-line": PenLine,
};

/** Token classes, not colours: a dot only where it carries news. */
const STATUS_DOT: Record<HistoryStatus, string> = {
    queued: "bg-ink-4",
    running: "bg-info",
    done: "bg-success",
    failed: "bg-danger",
};

/** A pinned chat being dragged within the Pinned section. The data is its session id. */
export const PINNED_CHAT_DRAG_MIME = "application/x-launchstack-pinned-chat";

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
    /** Called after the person confirms. */
    onDeleteSession: (sessionId: string) => void;
    /** Delete a pipeline run, after the person confirms. */
    onDeleteRun: (entry: HistoryEntry) => void;
    onRefresh: () => void;
    /** Pin or unpin a chat for this person. Absent: no pin verbs. */
    onSetPinned?: (entry: HistoryEntry, pinned: boolean) => void;
    /** Archive or restore a chat for this person. Absent: no archive verbs. */
    onSetArchived?: (entry: HistoryEntry, archived: boolean) => void;
    /** The whole pinned order, top first, as session ids. Absent: pins can't be moved. */
    onReorderPins?: (sessionIds: readonly string[]) => void;
    /** Open the Share dialog for one of your own chats. */
    onShareSession?: (entry: HistoryEntry) => void;
    /** "Continue in a new chat" — a private copy of a chat shared with you. */
    onContinueSession?: (entry: HistoryEntry) => void;
    /** The Archived view. Absent: no Archived link. */
    archived?: ArchivedHistoryState;
    onArchivedOpenChange?: (open: boolean) => void;
}

interface RowDrag {
    dragging: boolean;
    indicator: "before" | "after" | null;
    onDragStart: (event: DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: DragEvent<HTMLDivElement>) => void;
    onDrop: (event: DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
    /** Alt+↑ / Alt+↓ on a focused pinned row. */
    onMove: (delta: -1 | 1) => void;
}

interface RowProps {
    entry: HistoryEntry;
    active: boolean;
    renaming: boolean;
    now: Date;
    /** Who shared it, for a chat shared with you (resolved lazily; absent while loading). */
    sharer?: PersonLook;
    drag?: RowDrag;
    onOpen: () => void;
    /** The row's actions, built fresh when the menu opens. */
    menuItems: () => ActionMenuItem[];
    onCommitRename: (title: string) => void;
    onCancelRename: () => void;
}

function turns(count: number | undefined): string {
    const n = count ?? 0;
    return `${n} ${n === 1 ? "turn" : "turns"}`;
}

function HistoryRow({
    entry,
    active,
    renaming,
    now,
    sharer,
    drag,
    onOpen,
    menuItems,
    onCommitRename,
    onCancelRename,
}: RowProps) {
    const menu = useActionMenu();
    const menuLabel = `Actions for ${entry.title}`;
    const ctxTarget = useContextTarget({
        kind: "history-entry",
        id: entry.id,
        label: menuLabel,
        data: entry,
        items: menuItems,
    });
    const meta = HISTORY_KIND_META[entry.kind];
    const Icon = HISTORY_KIND_ICONS[meta.icon];
    // A row only opens something when there is something to open: a chat
    // always resumes, a run needs a surface.
    const openable = meta.resumable || Boolean(entry.href);
    const sharedWithMe = Boolean(entry.sharedBy);
    const sharerName = sharer?.displayName ?? null;

    const subtitle =
        entry.kind === "chat"
            ? sharedWithMe
                ? `${sharerName ?? "Shared with you"} · ${turns(entry.messageCount)}`
                : `${meta.label} · ${turns(entry.messageCount)}`
            : (entry.subtitle ?? meta.label);

    if (renaming) {
        return (
            <div className="bg-line-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5">
                <Icon className="text-ink-3 size-[13px] shrink-0" />
                <Input
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
                    className="h-6 rounded px-1 text-[13px]"
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
            {...ctxTarget}
            draggable={drag ? true : undefined}
            onDragStart={drag?.onDragStart}
            onDragOver={drag?.onDragOver}
            onDrop={drag?.onDrop}
            onDragEnd={drag?.onDragEnd}
            onClick={() => {
                if (openable) onOpen();
            }}
            onKeyDown={e => {
                if (drag && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    drag.onMove(e.key === "ArrowUp" ? -1 : 1);
                    return;
                }
                if (openable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onOpen();
                }
            }}
            className={cn(
                "group relative flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
                "focus-visible:ring-brand/50 focus-visible:ring-2",
                active ? "bg-brand-soft text-brand-ink" : "text-ink hover:bg-line-2",
                openable ? "cursor-pointer" : "cursor-default",
                drag?.dragging && "opacity-50"
            )}
        >
            {drag?.indicator && (
                <span
                    aria-hidden
                    className={cn(
                        "bg-brand pointer-events-none absolute inset-x-1 h-0.5 rounded-full",
                        drag.indicator === "before" ? "-top-px" : "-bottom-px"
                    )}
                />
            )}

            <span className="relative mt-0.5 shrink-0 leading-none">
                {sharedWithMe ? (
                    <ProfileAvatar
                        name={sharerName}
                        email={sharer?.email}
                        src={sharer?.avatarUrl}
                        className="-ml-px size-5"
                        fallbackClassName="text-[9px]"
                    />
                ) : (
                    <Icon className={cn("size-[13px]", active ? "text-brand" : "text-ink-3")} />
                )}
                {entry.status !== "done" && (
                    <span
                        title={HISTORY_STATUS_LABEL[entry.status]}
                        aria-label={HISTORY_STATUS_LABEL[entry.status]}
                        className={cn(
                            "ring-panel absolute -bottom-0.5 -right-[3px] size-1.5 rounded-full ring-[1.5px]",
                            STATUS_DOT[entry.status]
                        )}
                    />
                )}
            </span>

            <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1">
                    <span
                        className={cn(
                            "truncate text-[13px]",
                            active || entry.unread ? "font-semibold" : "font-medium"
                        )}
                        title={entry.title}
                    >
                        {entry.title}
                    </span>
                    {entry.shared && (
                        <Users
                            role="img"
                            aria-label="Shared"
                            className="text-ink-3 size-3 shrink-0"
                        />
                    )}
                </span>
                <span className="text-ink-3 block truncate text-[11px]">{subtitle}</span>
            </span>

            {/* One slot, two occupants: the timestamp sizes the slot and the
                actions button overlays it on hover or focus, so swapping them
                never nudges the row. The button is always in the DOM — a
                control that only exists on hover is one a keyboard user
                doesn't have. */}
            <span className="relative mt-px flex h-[18px] min-w-[18px] shrink-0 items-center justify-end gap-1.5">
                {entry.unread && (
                    <span
                        aria-label="Unread"
                        title="New since you last opened it"
                        className="bg-brand size-2 shrink-0 rounded-full"
                    />
                )}
                <span
                    className={cn(
                        "text-ink-4 whitespace-nowrap text-[11px] tabular-nums transition-opacity",
                        meta.resumable && "group-focus-within:opacity-0 group-hover:opacity-0",
                        meta.resumable && active && "opacity-0"
                    )}
                >
                    {relativeTime(entry.at, now)}
                </span>
                {meta.resumable && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={e => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            menu.open({
                                x: rect.right,
                                y: rect.bottom,
                                items: menuItems(),
                                ariaLabel: menuLabel,
                                kind: "history-entry",
                            });
                        }}
                        title="Chat actions"
                        aria-label={menuLabel}
                        className={cn(
                            "text-ink-3 absolute right-0 top-0 size-[18px] rounded opacity-0 transition-opacity",
                            "focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
                            active && "opacity-100"
                        )}
                    >
                        <MoreHorizontal className="size-[13px]" />
                    </Button>
                )}
            </span>
        </div>
    );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
    return (
        <h3
            id={id}
            className="text-ink-4 m-0 px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.06em]"
        >
            {children}
        </h3>
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
    onDeleteRun,
    onRefresh,
    onSetPinned,
    onSetArchived,
    onReorderPins,
    onShareSession,
    onContinueSession,
    archived,
    onArchivedOpenChange,
}: HistoryRailProps) {
    const [renamingId, setRenamingId] = useState<string | null>(null);
    /** The chat or run a delete has been asked for, pending the confirm dialog. */
    const [pendingDelete, setPendingDelete] = useState<HistoryEntry | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ refId: string; after: boolean } | null>(null);
    /**
     * One timestamp for the whole render, so every "2h" in the list is
     * measured from the same instant and rows can't disagree.
     */
    const now = useRef(new Date());
    now.current = new Date();

    const showArchived = Boolean(archived?.open);

    const sections = useMemo(
        () => sectionHistory(filterHistory(entries, query), now.current),
        [entries, query]
    );
    const archivedRows = useMemo(
        () =>
            filterHistory(archived?.entries ?? [], query).sort(
                (a, b) => Date.parse(b.at) - Date.parse(a.at)
            ),
        [archived?.entries, query]
    );

    /** The full pinned order — unfiltered, so a move under a search never reshuffles hidden pins. */
    const pinOrder = useMemo(
        () =>
            entries
                .filter(entry => entry.pinned)
                .sort(byPinOrder)
                .map(entry => entry.refId),
        [entries]
    );

    const sharerIds = useMemo(
        () =>
            [...entries, ...(archived?.entries ?? [])]
                .map(entry => entry.sharedBy)
                .filter((id): id is string => Boolean(id)),
        [entries, archived?.entries]
    );
    const people = usePeople(sharerIds);
    const sharerOf = (entry: HistoryEntry) => (entry.sharedBy ? people[entry.sharedBy] : undefined);

    const reorder = useCallback(
        (next: readonly string[]) => {
            if (next !== pinOrder) onReorderPins?.(next);
        },
        [pinOrder, onReorderPins]
    );

    const movePinned = useCallback(
        (refId: string, delta: -1 | 1) =>
            reorder(movePin(pinOrder, refId, pinOrder.indexOf(refId) + delta)),
        [pinOrder, reorder]
    );

    /**
     * What a row offers. A chat of yours: pin, share, rename, archive, delete.
     * A chat shared with you: pin, continue it as your own, archive (for you).
     * A run: open (when it has a surface) and delete.
     */
    const itemsFor = useCallback(
        (entry: HistoryEntry): ActionMenuItem[] => {
            if (entry.kind !== "chat") {
                const items: ActionMenuItem[] = [
                    { type: "label", id: "title", label: entry.title },
                ];
                // A vertical with no surface yet still has a row worth
                // removing, so the open is conditional and the delete is not.
                if (entry.href) {
                    items.push({
                        type: "item",
                        id: "open",
                        label: "Open",
                        icon: "open",
                        onSelect: () => onOpenRun(entry),
                    });
                    items.push({ type: "separator", id: "sep" });
                }
                items.push({
                    type: "item",
                    id: "delete",
                    // The ellipsis promises the confirm that follows, matching
                    // how the source rail labels its own destructive items.
                    label: "Delete…",
                    icon: "delete",
                    danger: true,
                    onSelect: () => setPendingDelete(entry),
                });
                return items;
            }

            const mine = !entry.sharedBy;
            const items: ActionMenuItem[] = [
                { type: "label", id: "title", label: entry.title },
                {
                    type: "item",
                    id: "open",
                    label: "Open",
                    icon: "open",
                    onSelect: () => onResumeSession(entry.refId),
                },
            ];
            if (onSetPinned && !entry.archived) {
                items.push({
                    type: "item",
                    id: "pin",
                    label: entry.pinned ? "Unpin" : "Pin",
                    icon: "pin",
                    onSelect: () => onSetPinned(entry, !entry.pinned),
                });
            }
            if (entry.pinned && onReorderPins) {
                const at = pinOrder.indexOf(entry.refId);
                items.push(
                    {
                        type: "item",
                        id: "move-up",
                        label: "Move up",
                        icon: "sortAsc",
                        shortcut: "⌥↑",
                        disabled: at <= 0,
                        onSelect: () => movePinned(entry.refId, -1),
                    },
                    {
                        type: "item",
                        id: "move-down",
                        label: "Move down",
                        icon: "sortDesc",
                        shortcut: "⌥↓",
                        disabled: at < 0 || at >= pinOrder.length - 1,
                        onSelect: () => movePinned(entry.refId, 1),
                    }
                );
            }
            if (mine && onShareSession && !entry.archived) {
                items.push({
                    type: "item",
                    id: "share",
                    label: "Share…",
                    icon: "share",
                    onSelect: () => onShareSession(entry),
                });
            }
            if (!mine && onContinueSession) {
                items.push({
                    type: "item",
                    id: "continue",
                    label: "Continue in a new chat",
                    icon: "branch",
                    onSelect: () => onContinueSession(entry),
                });
            }
            if (mine && !entry.archived) {
                items.push({
                    type: "item",
                    id: "rename",
                    label: "Rename…",
                    icon: "rename",
                    onSelect: () => setRenamingId(entry.id),
                });
            }
            items.push({ type: "separator", id: "sep" });
            if (onSetArchived) {
                items.push(
                    entry.archived
                        ? {
                              type: "item",
                              id: "unarchive",
                              label: "Unarchive",
                              icon: "restore",
                              onSelect: () => onSetArchived(entry, false),
                          }
                        : {
                              type: "item",
                              id: "archive",
                              label: "Archive",
                              icon: "archive",
                              onSelect: () => onSetArchived(entry, true),
                          }
                );
            }
            if (mine) {
                items.push({
                    type: "item",
                    id: "delete",
                    label: "Delete chat…",
                    icon: "delete",
                    danger: true,
                    onSelect: () => setPendingDelete(entry),
                });
            }
            return items;
        },
        [
            onResumeSession,
            onOpenRun,
            onSetPinned,
            onSetArchived,
            onReorderPins,
            onShareSession,
            onContinueSession,
            pinOrder,
            movePinned,
        ]
    );

    const endDrag = () => {
        setDragging(null);
        setDropTarget(null);
    };

    const dragFor = (entry: HistoryEntry): RowDrag | undefined => {
        if (!onReorderPins || !entry.pinned) return undefined;
        return {
            dragging: dragging === entry.refId,
            indicator:
                dropTarget?.refId === entry.refId && dragging && dragging !== entry.refId
                    ? dropTarget.after
                        ? "after"
                        : "before"
                    : null,
            onDragStart: event => {
                event.dataTransfer.setData(PINNED_CHAT_DRAG_MIME, entry.refId);
                event.dataTransfer.effectAllowed = "move";
                setDragging(entry.refId);
            },
            onDragOver: event => {
                if (!dragging) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const after = event.clientY > rect.top + rect.height / 2;
                if (dropTarget?.refId !== entry.refId || dropTarget.after !== after) {
                    setDropTarget({ refId: entry.refId, after });
                }
            },
            onDrop: event => {
                event.preventDefault();
                const moved = event.dataTransfer.getData(PINNED_CHAT_DRAG_MIME) || dragging;
                const after =
                    dropTarget?.refId === entry.refId
                        ? dropTarget.after
                        : event.clientY >
                          event.currentTarget.getBoundingClientRect().top +
                              event.currentTarget.getBoundingClientRect().height / 2;
                endDrag();
                if (moved) reorder(placePin(pinOrder, moved, entry.refId, after));
            },
            onDragEnd: endDrag,
            onMove: delta => movePinned(entry.refId, delta),
        };
    };

    const renderRow = (entry: HistoryEntry, withDrag = false) => (
        <HistoryRow
            key={entry.id}
            entry={entry}
            now={now.current}
            active={entry.kind === "chat" && entry.refId === activeSessionId}
            renaming={renamingId === entry.id}
            sharer={sharerOf(entry)}
            drag={withDrag ? dragFor(entry) : undefined}
            onOpen={() => (entry.kind === "chat" ? onResumeSession(entry.refId) : onOpenRun(entry))}
            menuItems={() => itemsFor(entry)}
            onCommitRename={title => {
                setRenamingId(null);
                const trimmed = title.trim();
                if (trimmed && trimmed !== entry.title) {
                    onRenameSession(entry.refId, trimmed);
                }
            }}
            onCancelRename={() => setRenamingId(null)}
        />
    );

    const totalShown =
        sections.pinned.length +
        sections.shared.length +
        sections.recent.reduce((sum, group) => sum + group.entries.length, 0);
    const archivedCount = archived?.count ?? null;

    const deletingChat = pendingDelete?.kind === "chat";

    return (
        <div data-testid="history-rail" className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-1.5 px-3.5 pb-2">
                {showArchived ? (
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-ink-2 h-7 gap-1 px-2 text-xs"
                            onClick={() => onArchivedOpenChange?.(false)}
                            data-testid="history-archived-back"
                        >
                            <ChevronLeft className="size-3.5" />
                            History
                        </Button>
                        <span className="text-ink-2 flex-1 truncate text-xs font-semibold">
                            Archived
                        </span>
                    </>
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onNewChat}
                        data-testid="history-new-chat"
                        className="text-ink-2 hover:border-brand hover:text-brand h-7 flex-1 gap-1.5 text-xs font-semibold"
                    >
                        <Plus className="size-3" />
                        New chat
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRefresh}
                    title="Refresh history"
                    aria-label="Refresh history"
                    data-testid="history-refresh"
                    className="text-ink-3 size-[26px] shrink-0"
                >
                    <RotateCw
                        className={cn(
                            "size-3",
                            loading && "animate-spin motion-reduce:animate-none"
                        )}
                    />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {error && !showArchived && (
                    <div className="bg-danger-soft text-danger mx-1.5 mb-2 mt-1 rounded-md px-2.5 py-2 text-[11px] leading-snug">
                        {error}{" "}
                        <Button
                            variant="link"
                            className="text-danger h-auto p-0 text-[11px] font-semibold underline"
                            onClick={onRefresh}
                        >
                            Retry
                        </Button>
                    </div>
                )}

                {degraded.length > 0 && !error && !showArchived && (
                    <div className="bg-warn-soft text-ink-2 mx-1.5 mb-2 mt-1 rounded-md px-2.5 py-1.5 text-[11px] leading-snug">
                        Some activity couldn’t be loaded (
                        {degraded.map(kind => HISTORY_KIND_META[kind].label).join(", ")}).
                    </div>
                )}

                {showArchived ? (
                    <section aria-label="Archived chats" data-testid="history-archived">
                        {archived?.error && (
                            <div className="bg-danger-soft text-danger mx-1.5 mb-2 mt-1 rounded-md px-2.5 py-2 text-[11px]">
                                {archived.error}
                            </div>
                        )}
                        {archivedRows.map(entry => renderRow(entry))}
                        {archivedRows.length === 0 && !archived?.loading && !archived?.error && (
                            <p className="text-ink-3 m-0 px-3.5 py-8 text-center text-[13px] leading-normal">
                                {query.trim()
                                    ? "No archived chat matches that."
                                    : "Nothing archived. Archive a chat from its menu to tuck it away here."}
                            </p>
                        )}
                    </section>
                ) : (
                    <>
                        {sections.pinned.length > 0 && (
                            <section
                                aria-labelledby="history-pinned"
                                className="mb-1.5"
                                data-testid="history-section-pinned"
                            >
                                <SectionHeading id="history-pinned">Pinned</SectionHeading>
                                {sections.pinned.map(entry => renderRow(entry, true))}
                            </section>
                        )}

                        {sections.shared.length > 0 && (
                            <section
                                aria-labelledby="history-shared"
                                className="mb-1.5"
                                data-testid="history-section-shared"
                            >
                                <SectionHeading id="history-shared">Shared with you</SectionHeading>
                                {sections.shared.map(entry => renderRow(entry))}
                            </section>
                        )}

                        {sections.recent.map(group => (
                            <section
                                key={group.id}
                                aria-labelledby={`history-${group.id}`}
                                className="mb-1.5"
                            >
                                <SectionHeading id={`history-${group.id}`}>
                                    {group.label}
                                </SectionHeading>
                                {group.entries.map(entry => renderRow(entry))}
                            </section>
                        ))}

                        {totalShown === 0 && !loading && !error && (
                            <p className="text-ink-3 m-0 px-3.5 py-8 text-center text-[13px] leading-normal">
                                {query.trim()
                                    ? "Nothing in history matches that."
                                    : "Nothing here yet. Ask a question, or run a pipeline, and it shows up here."}
                            </p>
                        )}
                    </>
                )}

                {((totalShown === 0 && loading && !showArchived) ||
                    (showArchived && archived?.loading && archivedRows.length === 0)) && (
                    <div className="px-2 py-2" aria-hidden>
                        {[0, 1, 2].map(i => (
                            <Skeleton
                                key={i}
                                className="mb-1.5 h-[34px]"
                                style={{ opacity: 1 - i * 0.25 }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {archived && onArchivedOpenChange && !showArchived && (
                <div className="border-line-2 border-t px-3.5 py-1.5">
                    <Button
                        variant="link"
                        className="text-ink-3 hover:text-ink h-auto p-0 text-xs"
                        onClick={() => onArchivedOpenChange(true)}
                        data-testid="history-archived-link"
                    >
                        Archived
                        {archivedCount ? (
                            <span className="text-ink-4 tabular-nums">· {archivedCount}</span>
                        ) : null}
                    </Button>
                </div>
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                onOpenChange={next => {
                    if (!next) setPendingDelete(null);
                }}
                title={deletingChat ? "Delete this chat?" : "Delete this run?"}
                description={
                    pendingDelete
                        ? deletingChat
                            ? `“${pendingDelete.title}” and all its messages will be deleted${pendingDelete.shared ? ", including for the people you shared it with" : ""}. This cannot be undone.`
                            : `“${pendingDelete.title}” will be removed from history. This cannot be undone.`
                        : undefined
                }
                onConfirm={() => {
                    const target = pendingDelete;
                    setPendingDelete(null);
                    if (!target) return;
                    if (target.kind === "chat") onDeleteSession(target.refId);
                    else onDeleteRun(target);
                }}
            />
        </div>
    );
}
