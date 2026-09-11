"use client";

import { useState } from "react";
import { MapPin, Tag as TagIcon, X } from "lucide-react";
import {
  StickyNoteEditor,
  tiptapJsonToMarkdown,
} from "../StickyNoteEditor";
import type { DraftState } from "./anchor";

interface NoteDraftEditorProps {
  draft: DraftState;
  setDraft: (updater: (prev: DraftState) => DraftState) => void;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  /** When false, hides the anchor `<details>` block — used by Notebook. */
  supportsAnchor?: boolean;
  editingExisting: boolean;
}

export function NoteDraftEditor({
  draft,
  setDraft,
  saving,
  error,
  onSave,
  onCancel,
  supportsAnchor = true,
  editingExisting,
}: NoteDraftEditorProps) {
  const [newTag, setNewTag] = useState("");

  const addTag = () => {
    const t = newTag.trim();
    if (!t || draft.tags.includes(t)) return;
    setDraft((d) => ({ ...d, tags: [...d.tags, t] }));
    setNewTag("");
  };
  const removeTag = (t: string) =>
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }));

  return (
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

      {supportsAnchor && (
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
      )}

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

      {error && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 8px",
            borderRadius: 6,
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
          onClick={onCancel}
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
          onClick={onSave}
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
          {saving ? "Saving…" : editingExisting ? "Update" : "Save note"}
        </button>
      </div>
    </div>
  );
}
