"use client";

import { useEffect, useState } from "react";
import { IconFolder } from "./icons";
import type { WorkspaceFolder } from "./types";

export interface RenameFolderDialogProps {
  open: boolean;
  folder: WorkspaceFolder | null;
  onClose: () => void;
  existingFolders: string[];
  /** Called after a successful rename so the parent can refetch folders. */
  onRenamed: (newName: string) => void;
  /** Called after a successful delete so the parent can refetch folders. */
  onDeleted?: () => void;
}

export function RenameFolderDialog({
  open,
  folder,
  onClose,
  existingFolders,
  onRenamed,
  onDeleted,
}: RenameFolderDialogProps) {
  const [name, setName] = useState(folder?.name ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && folder) {
      setName(folder.name);
      setError(null);
    }
  }, [open, folder]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open || !folder) return null;

  // Category IDs look like "cat-<n>" when sourced from the GetCategories API.
  const categoryId = folder.id.startsWith("cat-")
    ? Number(folder.id.slice("cat-".length))
    : null;
  const backedByDb = Number.isFinite(categoryId);

  const trimmed = name.trim();
  const taken =
    trimmed !== folder.name &&
    existingFolders.some((f) => f.toLowerCase() === trimmed.toLowerCase());
  const ok = trimmed.length > 0 && !taken && trimmed !== folder.name;

  const submit = async () => {
    if (!ok || submitting || !categoryId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/Categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      onRenamed(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename folder");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!onDeleted || !categoryId) return;
    if (
      !confirm(
        `Delete "${folder.name}"? Documents inside will keep the folder name as a label but the folder itself will be removed.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/Categories/DeleteCategories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: categoryId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete folder");
    } finally {
      setDeleting(false);
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
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}
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
            <div style={{ fontSize: 15, fontWeight: 700 }}>Rename folder</div>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={submitting || deleting}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
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
          {!backedByDb && (
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>
              This folder isn&apos;t stored as a category yet. Create it first via
              &ldquo;New folder&rdquo;.
            </div>
          )}
          {taken && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
              Another folder already uses &ldquo;{trimmed}&rdquo;.
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
            alignItems: "center",
          }}
        >
          {onDeleted && backedByDb && (
            <button
              onClick={() => void remove()}
              disabled={submitting || deleting}
              style={{
                fontSize: 12,
                color: "var(--danger)",
                fontWeight: 500,
              }}
            >
              {deleting ? "Deleting…" : "Delete folder"}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            disabled={submitting || deleting}
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
            disabled={!ok || submitting || deleting || !backedByDb}
            onClick={() => void submit()}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "7px 14px",
              borderRadius: 7,
              background:
                ok && !submitting && backedByDb ? "var(--accent)" : "var(--line)",
              color: ok && !submitting && backedByDb ? "white" : "var(--ink-3)",
              cursor:
                ok && !submitting && backedByDb ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
