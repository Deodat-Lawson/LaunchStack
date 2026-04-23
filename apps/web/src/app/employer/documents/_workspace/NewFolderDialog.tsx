"use client";

import { useEffect, useState } from "react";
import { IconFolder } from "./icons";

export interface NewFolderDialogProps {
  open: boolean;
  onClose: () => void;
  existingFolders: string[];
  /** Called with the new folder name after the server acknowledges. */
  onCreated: (name: string) => void;
}

export function NewFolderDialog({
  open,
  onClose,
  existingFolders,
  onCreated,
}: NewFolderDialogProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = name.trim();
  const taken = existingFolders.some(
    (f) => f.toLowerCase() === trimmed.toLowerCase(),
  );
  const ok = trimmed.length > 0 && !taken;

  const submit = async () => {
    if (!ok || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/Categories/AddCategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CategoryName: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      onCreated(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        background: "var(--scrim)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "lsw-fadeIn 140ms",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: "92vw",
          background: "var(--panel)",
          borderRadius: 14,
          boxShadow: "0 30px 80px var(--scrim-shadow), 0 0 0 1px var(--line)",
          overflow: "hidden",
          animation: "lsw-modalIn 180ms",
        }}
      >
        <div style={{ padding: "18px 20px 14px" }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconFolder size={14} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>New folder</div>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              marginLeft: 38,
              marginBottom: 14,
            }}
          >
            A folder is <em>where</em> a source lives — like a filesystem location.
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="e.g. YC W26 application, Fundraising Q1…"
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 9,
              fontSize: 14,
              border: `1px solid ${taken ? "var(--danger)" : "var(--line)"}`,
              background: "var(--panel)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          {taken && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
              A folder named &ldquo;{trimmed}&rdquo; already exists.
            </div>
          )}
          {error && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
              {error}
            </div>
          )}
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--line)",
            background: "var(--line-2)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              fontSize: 13,
              padding: "7px 14px",
              borderRadius: 7,
              color: "var(--ink-2)",
              border: "1px solid var(--line)",
              background: "var(--panel)",
            }}
          >
            Cancel
          </button>
          <button
            disabled={!ok || submitting}
            onClick={() => void submit()}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "7px 14px",
              borderRadius: 7,
              background: ok && !submitting ? "var(--accent)" : "var(--line)",
              color: ok && !submitting ? "white" : "var(--ink-3)",
              cursor: ok && !submitting ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Creating…" : "Create folder"}
          </button>
        </div>
      </div>
    </div>
  );
}
