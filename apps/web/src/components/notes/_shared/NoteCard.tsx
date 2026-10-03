"use client";

import { useMemo } from "react";
import { Edit2, Quote as QuoteIcon, Trash2 } from "lucide-react";
import type { DocumentNote } from "~/server/db/schema";
import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";
import { relativeTime } from "~/lib/workspace-history";
import { type NoteAnchorLite } from "./anchor";
import styles from "./NoteCard.module.css";
import { iconBtnStyle, metaChipStyle, statusBadge } from "./styles";

interface NoteCardProps {
    note: DocumentNote;
    editing: boolean;
    /**
     * The card the document is currently showing. Docs keeps exactly one
     * comment open — it lifts, shows its whole body and reveals its actions,
     * while the rest stay quiet — and that one-at-a-time focus is most of
     * what makes the column readable rather than a wall of boxes.
     */
    active?: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onClick?: () => void;
}

/** Body lines an unfocused card shows before clamping. */
const COLLAPSED_LINES = 3;

export function NoteCard({
    note,
    editing,
    active = false,
    onEdit,
    onDelete,
    onClick,
}: NoteCardProps) {
    const anchor = note.anchor as NoteAnchorLite | null;
    const badge = statusBadge(note.anchorStatus);
    const body = useMemo(
        // The card is a summary, not a document, so the markdown is flattened
        // rather than rendered — agent notes are markdown-only, and showing it
        // raw put a literal `**Decision:**` on the card.
        () => plainTextOfMarkdown(note.contentMarkdown ?? note.content ?? ""),
        [note.contentMarkdown, note.content]
    );
    // No page chip: indexing stores page 1 for every chunk, so every note
    // claimed "Page 1" regardless of where its passage actually sits. The
    // anchor's page is still used to scroll — it is only the badge that lied.
    const ctxTarget = useContextTarget({
        kind: "note",
        id: String(note.id),
        label: note.title ? `Actions for “${note.title}”` : "Note actions",
        data: note,
        items: () => [
            ...(onClick
                ? [
                      {
                          type: "item" as const,
                          id: "go",
                          label: "Go to this note",
                          icon: "open" as const,
                          onSelect: onClick,
                      },
                  ]
                : []),
            {
                type: "item" as const,
                id: "edit",
                label: "Edit",
                icon: "rename" as const,
                onSelect: onEdit,
            },
            {
                type: "item" as const,
                id: "copy",
                label: "Copy note text",
                icon: "copy" as const,
                onSelect: () =>
                    void copyText(note.contentMarkdown ?? note.content ?? note.title ?? ""),
            },
            { type: "separator" as const, id: "sep" },
            {
                type: "item" as const,
                id: "delete",
                label: "Delete…",
                icon: "delete" as const,
                danger: true,
                onSelect: onDelete,
            },
        ],
    });

    const quote = anchor?.quote?.exact?.trim();
    const highlighted = active || editing;

    return (
        <div
            {...ctxTarget}
            className={styles.card}
            data-note-card
            data-active={active ? "true" : undefined}
            data-editing={editing ? "true" : undefined}
            aria-current={active ? "true" : undefined}
            onClick={e => {
                if ((e.target as HTMLElement).closest("[data-note-action]")) return;
                onClick?.();
            }}
            style={{
                position: "relative",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${highlighted ? "var(--accent)" : "var(--line-2)"}`,
                background: "var(--panel)",
                cursor: onClick ? "pointer" : "default",
                // Docs lifts the open comment toward the reader rather than
                // recolouring it — the card stays legible, only its depth
                // changes, so a long column does not turn into stripes.
                boxShadow: highlighted ? "0 2px 10px oklch(0 0 0 / 0.13)" : "none",
                transition: "box-shadow 120ms ease, border-color 120ms ease",
            }}
        >
            {/* The quoted passage, as context above the note — Docs shows the
                highlighted text this way: one quiet line, never the body. */}
            {quote && (
                <div
                    style={{
                        display: "flex",
                        gap: 5,
                        alignItems: "baseline",
                        color: "var(--ink-3)",
                        fontSize: 11,
                        fontStyle: "italic",
                        lineHeight: 1.45,
                        marginBottom: 7,
                        paddingBottom: 7,
                        borderBottom: "1px solid var(--line-2)",
                    }}
                >
                    <QuoteIcon
                        size={10}
                        style={{
                            flexShrink: 0,
                            color: "var(--accent)",
                            alignSelf: "flex-start",
                            marginTop: 3,
                        }}
                    />
                    <span
                        style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            // The passage is context, not content. Even open,
                            // it never takes more than a couple of lines.
                            WebkitLineClamp: active ? 3 : 2,
                            overflow: "hidden",
                        }}
                    >
                        {quote}
                    </span>
                </div>
            )}

            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                }}
            >
                <div style={{ minWidth: 0, flex: 1 }}>
                    {note.title && (
                        <div
                            style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--ink)",
                                marginBottom: 2,
                            }}
                        >
                            {note.title}
                        </div>
                    )}
                    {body && (
                        <div
                            style={{
                                fontSize: 11.5,
                                color: "var(--ink-2)",
                                lineHeight: 1.5,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                // Closed cards clamp so the column scans; the
                                // open one shows everything, which is the
                                // whole reason to open it.
                                ...(active
                                    ? {}
                                    : {
                                          display: "-webkit-box",
                                          WebkitBoxOrient: "vertical",
                                          WebkitLineClamp: COLLAPSED_LINES,
                                          overflow: "hidden",
                                      }),
                            }}
                        >
                            {body}
                        </div>
                    )}
                </div>

                {/* Actions ride at the top-right and appear on hover or focus,
                    so a resting column is text rather than rows of buttons.
                    They stay reachable by keyboard because it is opacity that
                    changes, not mounting. */}
                <div
                    data-note-action
                    className={styles.actions}
                    style={{
                        display: "flex",
                        gap: 2,
                        flexShrink: 0,
                    }}
                >
                    <button type="button" onClick={onEdit} title="Edit" style={iconBtnStyle}>
                        <Edit2 size={12} />
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        title="Delete"
                        style={{ ...iconBtnStyle, color: "var(--danger)" }}
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 7,
                }}
            >
                <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--ink-4)", marginRight: 2 }}
                    title={note.createdAt ? new Date(note.createdAt).toLocaleString() : undefined}
                >
                    {note.createdAt ? relativeTime(new Date(note.createdAt).toISOString()) : ""}
                </span>
                {note.tags?.map(t => (
                    <span key={t} style={metaChipStyle}>
                        #{t}
                    </span>
                ))}
                {badge && (
                    <span
                        style={{
                            ...metaChipStyle,
                            background: badge.bg,
                            color: badge.color,
                            border: "1px solid " + badge.color,
                        }}
                    >
                        {badge.icon}
                        {badge.label}
                    </span>
                )}
            </div>
        </div>
    );
}

/**
 * Flatten markdown to the text a reader would see, for the card body.
 *
 * Deliberately lossy and deliberately not a renderer: the card is a clamped
 * 11px summary, where a heading or a list marker is noise. The editor still
 * gets the real structure via `markdownToTiptapJson`.
 */
export function plainTextOfMarkdown(markdown: string): string {
    return markdown
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/^\s{0,3}>\s?/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+[.)]\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
