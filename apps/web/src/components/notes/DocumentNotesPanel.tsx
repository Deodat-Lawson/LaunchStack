"use client";

import { useCallback, useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { FileText, Plus } from "lucide-react";
import type { DocumentNote } from "@launchstack/core/db/schema/document-notes";
import {
  buildAnchorFromDraft,
  type DraftState,
  EMPTY_DRAFT,
  type NoteAnchorLite,
  type PrefilledAnchor,
  primaryPageOfAnchor,
} from "./_shared/anchor";
import { NoteCard } from "./_shared/NoteCard";
import { NoteDraftEditor } from "./_shared/NoteDraftEditor";
import { BacklinksPanel } from "./BacklinksPanel";

export type { PrefilledAnchor } from "./_shared/anchor";

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
      anchorPage: primaryPageOfAnchor(anchor)?.toString() ?? "",
      anchorQuads: Array.isArray(primary?.quads) ? primary!.quads! : [],
    });
    setError(null);
  };

  const cancelDraft = () => {
    setDraft(EMPTY_DRAFT);
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
        {error && draft.id === null && (
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
          <NoteDraftEditor
            draft={draft}
            setDraft={setDraft}
            saving={saving}
            error={error}
            onSave={() => void saveDraft()}
            onCancel={cancelDraft}
            supportsAnchor
            editingExisting={editingExisting}
          />
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

        {documentId && (
          <BacklinksPanel
            documentId={documentId}
            onOpenNote={(id) => onNoteClick?.({ id, page: null })}
          />
        )}
      </div>
    </div>
  );
}
