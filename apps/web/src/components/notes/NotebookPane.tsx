"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { FileText, Plus, Search, Sparkles } from "lucide-react";
import type { DocumentNote } from "@launchstack/core/db/schema/document-notes";
import {
  type DraftState,
  EMPTY_DRAFT,
  type NoteAnchorLite,
  primaryPageOfAnchor,
} from "./_shared/anchor";
import { NoteCard } from "./_shared/NoteCard";
import { NoteDraftEditor } from "./_shared/NoteDraftEditor";
import { BacklinksPanel } from "./BacklinksPanel";

/**
 * Freeform / cross-document notes surface for the Studio drawer. Unlike
 * `DocumentNotesPanel`, notes here have no `documentId` and no anchor —
 * they are scratchpad / second-brain entries scoped to the current user.
 *
 * Reuses `NoteCard` and `NoteDraftEditor` from `_shared/`. The draft editor
 * runs with `supportsAnchor={false}` so the anchor `<details>` block is
 * hidden — anchored notes belong to `DocumentNotesPanel`.
 */
export function NotebookPane() {
  const [notes, setNotes] = useState<DocumentNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [semanticIds, setSemanticIds] = useState<number[] | null>(null);
  const [semanticBusy, setSemanticBusy] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch("/api/notes?surface=notebook");
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as { notes: DocumentNote[] };
      setNotes(data.notes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch notes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void fetchNotes();
  }, [fetchNotes]);

  const filtered = useMemo(() => {
    if (semantic && semanticIds) {
      const byId = new Map(notes.map((n) => [n.id, n]));
      return semanticIds
        .map((id) => byId.get(id))
        .filter((n): n is (typeof notes)[number] => n !== undefined);
    }
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => {
      const title = (n.title ?? "").toLowerCase();
      const body = (n.contentMarkdown ?? n.content ?? "").toLowerCase();
      const tags = ((n.tags as string[] | null) ?? []).join(" ").toLowerCase();
      return title.includes(q) || body.includes(q) || tags.includes(q);
    });
  }, [notes, query, semantic, semanticIds]);

  // Run vector search when semantic mode is on and the query stabilizes.
  useEffect(() => {
    if (!semantic) {
      setSemanticIds(null);
      return;
    }
    const q = query.trim();
    if (!q) {
      setSemanticIds(null);
      return;
    }
    let cancelled = false;
    setSemanticBusy(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/notes/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, scope: "user", topK: 25 }),
        });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as {
          hits: Array<{ noteId: number }>;
        };
        if (!cancelled) {
          setSemanticIds(data.hits.map((h) => h.noteId));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed");
          setSemanticIds([]);
        }
      } finally {
        if (!cancelled) setSemanticBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [semantic, query]);

  const startNewDraft = () => {
    setDraft({ ...EMPTY_DRAFT, id: "new" });
    setError(null);
  };

  const startEditDraft = (note: DocumentNote) => {
    setDraft({
      id: note.id,
      title: note.title ?? "",
      rich: (note.contentRich as JSONContent | null) ?? null,
      text: note.contentMarkdown ?? note.content ?? "",
      tags: (note.tags as string[] | null) ?? [],
      anchorQuote: "",
      anchorPage: "",
      anchorQuads: [],
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
      const payload: Record<string, unknown> = {
        title: draft.title.trim() || undefined,
        contentRich: draft.rich ?? undefined,
        contentMarkdown: draft.text || undefined,
        tags: draft.tags,
      };

      const url = draft.id === "new" ? "/api/notes" : `/api/notes/${draft.id}`;
      const method = draft.id === "new" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }

      cancelDraft();
      await fetchNotes();
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
          display: "flex",
          flexDirection: "column",
          gap: 8,
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
            Notebook
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
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
          Cross-document scratchpad. Notes here aren&apos;t tied to a source.
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 6px 5px 8px",
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          <Search size={12} style={{ color: "var(--ink-3)" }} />
          <input
            placeholder={semantic ? "Search by meaning…" : "Filter notes…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "var(--ink)",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => setSemantic((s) => !s)}
            title={
              semantic
                ? "Switch to title/body filter"
                : "Switch to semantic search"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: 5,
              fontSize: 10,
              fontWeight: 600,
              border: "1px solid var(--line)",
              background: semantic ? "var(--accent)" : "var(--panel-2)",
              color: semantic ? "white" : "var(--ink-3)",
              cursor: "pointer",
            }}
          >
            <Sparkles size={10} />
            {semanticBusy ? "…" : "Semantic"}
          </button>
        </div>
        <button
          type="button"
          onClick={startNewDraft}
          disabled={draft.id !== null}
          style={{
            padding: "7px 10px",
            borderRadius: 7,
            background: draft.id !== null ? "var(--line)" : "var(--accent)",
            color: draft.id !== null ? "var(--ink-3)" : "white",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            cursor: draft.id !== null ? "not-allowed" : "pointer",
            border: "none",
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
          <>
            <NoteDraftEditor
              draft={draft}
              setDraft={setDraft}
              saving={saving}
              error={error}
              onSave={() => void saveDraft()}
              onCancel={cancelDraft}
              supportsAnchor={false}
              editingExisting={editingExisting}
            />
            {typeof draft.id === "number" && (
              <BacklinksPanel
                noteId={draft.id}
                onOpenNote={(id) => {
                  const n = notes.find((x) => x.id === id);
                  if (n) startEditDraft(n);
                }}
              />
            )}
          </>
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
        ) : filtered.length === 0 && draft.id === null ? (
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
            <div>
              {query ? "No matches." : "Your notebook is empty."}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
              {query
                ? "Try a different search."
                : 'Click "New note" to capture an idea.'}
            </div>
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            {filtered.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                editing={draft.id === n.id}
                onEdit={() => startEditDraft(n)}
                onDelete={() => void deleteNote(n.id)}
                onClick={() => {
                  // No-op: notebook notes have no source to scroll to.
                  startEditDraft(n);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
