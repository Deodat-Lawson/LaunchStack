"use client";

import { useMemo } from "react";
import { Edit2, Quote as QuoteIcon, Trash2 } from "lucide-react";
import type { DocumentNote } from "@launchstack/core/db/schema/document-notes";
import {
  type NoteAnchorLite,
  primaryPageOfAnchor,
} from "./anchor";
import { iconBtnStyle, metaChipStyle, statusBadge } from "./styles";

interface NoteCardProps {
  note: DocumentNote;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClick?: () => void;
}

export function NoteCard({
  note,
  editing,
  onEdit,
  onDelete,
  onClick,
}: NoteCardProps) {
  const anchor = note.anchor as NoteAnchorLite | null;
  const badge = statusBadge(note.anchorStatus);
  const preview = useMemo(() => {
    const md = (note.contentMarkdown ?? note.content ?? "").trim();
    if (!md) return "";
    return md.length > 220 ? md.slice(0, 220) + "…" : md;
  }, [note.contentMarkdown, note.content]);
  const page = primaryPageOfAnchor(anchor);

  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-note-action]")) return;
        onClick?.();
      }}
      style={{
        padding: 10,
        margin: "0 6px",
        borderRadius: 8,
        border: editing ? "1px solid var(--accent)" : "1px solid var(--line-2)",
        background: editing ? "var(--accent-soft)" : "var(--panel)",
        cursor: onClick ? "pointer" : "default",
      }}
    >
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
          {preview && (
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-2)",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {preview}
            </div>
          )}
          {anchor?.quote?.exact && (
            <div
              style={{
                display: "flex",
                gap: 4,
                alignItems: "flex-start",
                marginTop: 6,
                padding: "4px 6px 4px 8px",
                borderLeft: "2px solid var(--accent)",
                color: "var(--ink-2)",
                fontSize: 11,
                fontStyle: "italic",
                background: "var(--panel-2)",
                borderRadius: "0 4px 4px 0",
              }}
            >
              <QuoteIcon
                size={11}
                style={{ flexShrink: 0, marginTop: 2, color: "var(--accent)" }}
              />
              <span
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {anchor.quote.exact.slice(0, 180)}
                {anchor.quote.exact.length > 180 ? "…" : ""}
              </span>
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              marginTop: 6,
            }}
          >
            {page !== null && (
              <span style={metaChipStyle}>Page {page}</span>
            )}
            {(note.tags as string[] | null)?.map((t) => (
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
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              marginTop: 4,
            }}
          >
            {note.createdAt
              ? new Date(note.createdAt).toLocaleString()
              : ""}
          </div>
        </div>
        <div
          data-note-action
          style={{ display: "flex", gap: 2, flexShrink: 0 }}
        >
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            style={iconBtnStyle}
          >
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
    </div>
  );
}
