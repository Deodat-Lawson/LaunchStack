"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import {
  AlertTriangle,
  Edit2,
  FileText,
  MapPin,
  Plus,
  Quote as QuoteIcon,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import type { DocumentNote } from "@launchstack/core/db/schema/document-notes";
import {
  StickyNoteEditor,
  tiptapJsonToMarkdown,
} from "./StickyNoteEditor";

/**
 * Anchor shape the client cares about. Deliberately loose on `primary` so
 * format-specific overlays can extend without forcing a type bump on every
 * surface. See `NoteAnchor` in `@launchstack/core/db/schema/document-notes`
 * for the full server-side shape.
 */
type NoteAnchorLite = {
  type: "pdf" | "docx" | "media" | "image" | "code" | "markdown" | "text";
  primary?: unknown;
  quote: { exact: string; prefix?: string; suffix?: string };
  chunkIdAtCreate?: number;
};

export interface PrefilledAnchor {
  /** Page number (1-indexed). */
  page: number;
  /** Normalized quads in [0, 1] space, first is the "headline" box. */
  quads: Array<[number, number, number, number]>;
  /** Exact quoted span. Prefix/suffix may be empty initially. */
  quote: { exact: string; prefix?: string; suffix?: string };
}

interface Props {
  /** Document identifier — stringified so it matches `documentNotes.documentId`. */
  documentId: string | null;
  /** Current version the document is being viewed against. */
  versionId: number | null;
  /** Called after any CRUD success so the caller can refresh surrounding UI. */
  onChanged?: () => void;
  /**
   * When set, the panel switches into "new note" draft mode with this anchor
   * pre-populated — used by the PDF viewer when the user highlights text and
   * clicks "Add note here". The parent clears this after the panel consumes it.
   */
  prefilledAnchor?: PrefilledAnchor | null;
  /** Fired when the user clicks an existing note card. The parent can then
   * scroll the document viewer to the anchored location. */
  onNoteClick?: (note: { id: number; page: number | null }) => void;
}

type DraftState = {
  id: number | "new" | null;
  title: string;
  rich: JSONContent | null;
  text: string;
  tags: string[];
  anchorQuote: string;
  anchorPage: string;
  /** Captured quads from PDF selection; empty when user typed the anchor manually. */
  anchorQuads: Array<[number, number, number, number]>;
};

const EMPTY_DRAFT: DraftState = {
  id: null,
  title: "",
  rich: null,
  text: "",
  tags: [],
  anchorQuote: "",
  anchorPage: "",
  anchorQuads: [],
};

function statusBadge(status: string | null | undefined) {
  if (status === "drifted")
    return {
      label: "Anchor moved",
      color: "oklch(0.5 0.18 70)",
      bg: "oklch(0.96 0.06 70)",
      icon: <AlertTriangle size={10} />,
    };
  if (status === "orphaned")
    return {
      label: "Unanchored",
      color: "oklch(0.5 0.2 30)",
      bg: "oklch(0.96 0.04 30)",
      icon: <AlertTriangle size={10} />,
    };
  return null;
}

export function DocumentNotesPanel({
  documentId,
  versionId,
  onChanged,
  prefilledAnchor,
  onNoteClick,
}: Props) {
  const [notes, setNotes] = useState<DocumentNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    if (!documentId) {
      setNotes([]);
      setIsLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/notes?documentId=${encodeURIComponent(documentId)}`,
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as { notes: DocumentNote[] };
      setNotes(data.notes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch notes");
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    setIsLoading(true);
    void fetchNotes();
  }, [fetchNotes]);

  // Open the editor automatically when the parent hands us a selection
  // captured from the PDF viewer.
  useEffect(() => {
    if (!prefilledAnchor) return;
    setDraft({
      id: "new",
      title: "",
      rich: null,
      text: "",
      tags: [],
      anchorQuote: prefilledAnchor.quote.exact,
      anchorPage: String(prefilledAnchor.page),
      anchorQuads: prefilledAnchor.quads,
    });
    setError(null);
  }, [prefilledAnchor]);

  const startNewDraft = () => {
    setDraft({ ...EMPTY_DRAFT, id: "new" });
    setError(null);
  };

  const startEditDraft = (note: DocumentNote) => {
    const anchor = note.anchor as NoteAnchorLite | null;
    const primary = anchor?.primary as
      | { kind?: string; page?: number; quads?: Array<[number, number, number, number]> }
      | undefined;
    setDraft({
      id: note.id,
      title: note.title ?? "",
      rich: (note.contentRich as JSONContent | null) ?? null,
      text: note.contentMarkdown ?? note.content ?? "",
      tags: (note.tags as string[] | null) ?? [],
      anchorQuote: anchor?.quote?.exact ?? "",
      anchorPage:
        primaryPageOfAnchor(anchor)?.toString() ?? "",
      anchorQuads: Array.isArray(primary?.quads) ? primary!.quads! : [],
    });
    setError(null);
  };

  const cancelDraft = () => {
    setDraft(EMPTY_DRAFT);
    setNewTag("");
    setError(null);
  };

  const saveDraft = async () => {
    if (!draft.id) return;
    if (!draft.title.trim() && !draft.text.trim() && !draft.rich) {
      setError("Add a title or body first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const anchor = buildAnchorFromDraft(draft);
      const payload: Record<string, unknown> = {
        title: draft.title.trim() || undefined,
        contentRich: draft.rich ?? undefined,
        contentMarkdown: draft.text || undefined,
        tags: draft.tags,
        anchor: anchor ?? undefined,
        anchorStatus: anchor ? "resolved" : undefined,
      };

      if (draft.id === "new") {
        payload.documentId = documentId ?? undefined;
        if (versionId !== null) payload.versionId = versionId;
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
      } else {
        const res = await fetch(`/api/notes/${draft.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
      }

      cancelDraft();
      await fetchNotes();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (id: number) => {
    if (!confirm("Delete this note? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const addTag = () => {
    const t = newTag.trim();
    if (!t || draft.tags.includes(t)) return;
    setDraft((d) => ({ ...d, tags: [...d.tags, t] }));
    setNewTag("");
  };
  const removeTag = (t: string) =>
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }));

  const editingExisting = draft.id !== null && draft.id !== "new";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid var(--line-2)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--ink-3)",
              textTransform: "uppercase",
            }}
          >
            Notes
          </div>
          <span
            className="mono"
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: "var(--panel-2)",
              color: "var(--ink-3)",
            }}
          >
            {notes.length}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
          Sticky annotations on this source.
        </div>
        <button
          type="button"
          onClick={startNewDraft}
          disabled={draft.id !== null || !documentId}
          style={{
            marginTop: 8,
            width: "100%",
            padding: "7px 10px",
            borderRadius: 7,
            background:
              draft.id !== null || !documentId ? "var(--line)" : "var(--accent)",
            color:
              draft.id !== null || !documentId ? "var(--ink-3)" : "white",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor:
              draft.id !== null || !documentId ? "not-allowed" : "pointer",
          }}
        >
          <Plus size={13} /> New note
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 10px 16px",
        }}
      >
        {error && (
          <div
            style={{
              margin: "0 6px 10px",
              padding: "8px 10px",
              borderRadius: 7,
              background: "oklch(0.96 0.04 30)",
              border: "1px solid oklch(0.86 0.11 30)",
              color: "oklch(0.4 0.14 30)",
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {draft.id !== null && (
          <div
            style={{
              padding: 10,
              margin: "0 6px 12px",
              borderRadius: 10,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent)",
            }}
          >
            <input
              placeholder="Title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
                outline: "none",
              }}
            />
            <StickyNoteEditor
              initialContent={draft.rich}
              placeholder="Write a rich note…"
              onChange={({ json, text }) =>
                setDraft((d) => ({
                  ...d,
                  rich: json,
                  text: tiptapJsonToMarkdown(json) || text,
                }))
              }
              autofocus={!editingExisting}
              minHeight={110}
            />

            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <MapPin size={11} /> Anchor this note (optional)
              </summary>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <textarea
                  placeholder="Paste the exact text you want this note to stick to. Keeps working even after you re-upload a new version."
                  value={draft.anchorQuote}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, anchorQuote: e.target.value }))
                  }
                  rows={2}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                    fontSize: 12,
                    resize: "vertical",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <input
                  placeholder="Page number (optional, PDFs only)"
                  value={draft.anchorPage}
                  inputMode="numeric"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, anchorPage: e.target.value }))
                  }
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                    fontSize: 12,
                    outline: "none",
                  }}
                />
              </div>
            </details>

            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <TagIcon size={11} /> Tags
              </summary>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <input
                  placeholder="Add tag"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={addTag}
                  disabled={!newTag.trim()}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 6,
                    background: newTag.trim() ? "var(--accent)" : "var(--line)",
                    color: newTag.trim() ? "white" : "var(--ink-3)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: newTag.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Add
                </button>
              </div>
              {draft.tags.length > 0 && (
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                  }}
                >
                  {draft.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "var(--panel)",
                        border: "1px solid var(--line-2)",
                        fontSize: 10,
                        color: "var(--ink-2)",
                      }}
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          color: "var(--ink-3)",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </details>

            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 6,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={cancelDraft}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={saving}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: saving ? "var(--line)" : "var(--accent)",
                  color: saving ? "var(--ink-3)" : "white",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving
                  ? "Saving…"
                  : editingExisting
                  ? "Update"
                  : "Save note"}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div
            style={{
              padding: "14px 16px",
              color: "var(--ink-3)",
              fontSize: 11,
            }}
          >
            Loading notes…
          </div>
        ) : notes.length === 0 && draft.id === null ? (
          <div
            style={{
              padding: "32px 16px",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 12,
            }}
          >
            <FileText
              size={28}
              style={{ margin: "0 auto 8px", opacity: 0.3 }}
            />
            <div>No notes on this source yet.</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
              Click &ldquo;New note&rdquo; to start.
            </div>
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            {notes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                editing={draft.id === n.id}
                onEdit={() => startEditDraft(n)}
                onDelete={() => void deleteNote(n.id)}
                onClick={() => {
                  onNoteClick?.({
                    id: n.id,
                    page: primaryPageOfAnchor(n.anchor as NoteAnchorLite | null),
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteCard({
  note,
  editing,
  onEdit,
  onDelete,
  onClick,
}: {
  note: DocumentNote;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClick?: () => void;
}) {
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
        // Don't treat clicks on the inline edit/delete icons as a card click.
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

const metaChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "1px 6px",
  borderRadius: 4,
  background: "var(--panel-2)",
  color: "var(--ink-3)",
  fontSize: 10,
  border: "1px solid var(--line-2)",
};

const iconBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--ink-3)",
  cursor: "pointer",
};

function primaryPageOfAnchor(anchor: NoteAnchorLite | null): number | null {
  if (!anchor) return null;
  const p = (anchor.primary as { page?: number } | undefined)?.page;
  return typeof p === "number" ? p : null;
}

function buildAnchorFromDraft(draft: DraftState): NoteAnchorLite | null {
  const exact = draft.anchorQuote.trim();
  if (!exact) return null;
  const pageNum = Number.parseInt(draft.anchorPage, 10);
  const primary =
    Number.isFinite(pageNum) && pageNum > 0
      ? {
          kind: "pdf" as const,
          page: pageNum,
          // Use captured quads from PDF selection when available — otherwise
          // empty array, which the rehydration worker treats as "page hint
          // only" (still useful as a search scope).
          quads: draft.anchorQuads,
        }
      : undefined;
  return {
    type: primary ? "pdf" : "text",
    primary,
    quote: { exact },
  };
}
