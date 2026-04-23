"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconChevronLeft,
  IconFolder,
  IconSparkle,
  IconTrash,
} from "./icons";
import { SOURCE_META, type WorkspaceSource } from "./types";

interface VersionRow {
  id: number;
  versionNumber: number;
  url: string;
  mimeType: string;
  fileSize: number | null;
  uploadedBy: string;
  changelog: string | null;
  ocrProcessed: boolean;
  ocrProvider: string | null;
  createdAt: string;
  isCurrent: boolean;
}

interface VersionsResponse {
  documentId: number;
  fileType: string | null;
  currentVersionId: number | null;
  versions: VersionRow[];
}

export interface DocumentViewerProps {
  source: WorkspaceSource;
  onClose: () => void;
  onRename: (id: number, title: string) => Promise<boolean>;
  onDelete: (id: number) => void;
  onAskAbout: (source: WorkspaceSource) => void;
  onVersionChanged?: () => void;
}

function humanDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const diffMs = Date.now() - d.getTime();
  const diffHr = Math.floor(diffMs / 3_600_000);
  if (diffHr < 1) return "just now";
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 14) return `${diffDay} days ago`;
  return d.toLocaleDateString();
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "5px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <span style={{ color: "var(--ink)" }}>{value}</span>
    </div>
  );
}

export function DocumentViewer({
  source,
  onClose,
  onRename,
  onDelete,
  onAskAbout,
  onVersionChanged,
}: DocumentViewerProps) {
  const router = useRouter();
  const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
  const Icon = meta.Icon;
  const [title, setTitle] = useState(source.title);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    setTitle(source.title);
    setDirty(false);
    setSaveStatus("idle");
  }, [source.id, source.title]);

  // Fetch version history on mount
  useEffect(() => {
    if (!source.documentId) return;
    let cancelled = false;
    setVersionsError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/documents/${source.documentId}/versions`);
        if (!res.ok) {
          if (res.status === 403 || res.status === 401) return;
          throw new Error(`Failed (${res.status})`);
        }
        const data = (await res.json()) as VersionsResponse;
        if (cancelled) return;
        setVersions(data.versions);
        setActiveVersionId(data.currentVersionId);
      } catch (err) {
        if (!cancelled) {
          setVersionsError(err instanceof Error ? err.message : "Failed to load versions");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source.documentId]);

  // Auto-save title rename on blur/debounce.
  const saveTitle = useCallback(async () => {
    if (!source.documentId) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === source.title) {
      setDirty(false);
      setSaveStatus("idle");
      return;
    }
    setSaveStatus("saving");
    const ok = await onRename(source.documentId, trimmed);
    setSaveStatus(ok ? "saved" : "error");
    setDirty(false);
  }, [title, source.documentId, source.title, onRename]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void saveTitle(), 900);
    return () => clearTimeout(t);
  }, [dirty, saveTitle]);

  // ESC closes
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const previewVersion = (versionId: number) => {
    if (!source.documentId) return;
    router.push(
      `/employer/documents/viewer?docId=${source.documentId}&versionId=${versionId}`,
    );
  };

  const restoreVersion = async (versionId: number) => {
    if (!source.documentId) return;
    if (!confirm("Restore this version as the current one?")) return;
    setReverting(true);
    try {
      const res = await fetch(
        `/api/documents/${source.documentId}/versions/${versionId}/revert`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      // Refetch versions
      const r = await fetch(`/api/documents/${source.documentId}/versions`);
      if (r.ok) {
        const data = (await r.json()) as VersionsResponse;
        setVersions(data.versions);
        setActiveVersionId(data.currentVersionId);
      }
      onVersionChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to restore version");
    } finally {
      setReverting(false);
    }
  };

  const deleteDocument = () => {
    if (!source.documentId) return;
    if (!confirm(`Delete "${source.title}"? This cannot be undone.`)) return;
    onDelete(source.documentId);
  };

  const openOriginal = () => {
    if (!source.documentId) return;
    router.push(`/employer/documents/viewer?docId=${source.documentId}`);
  };

  const statusText =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
      ? "Saved"
      : saveStatus === "error"
      ? "Save failed"
      : dirty
      ? "Unsaved"
      : "Saved";
  const statusColor =
    saveStatus === "error"
      ? "var(--danger)"
      : dirty || saveStatus === "saving"
      ? "var(--accent)"
      : "var(--ok)";

  const currentVersion = versions.find((v) => v.id === activeVersionId);
  const viewingOld = activeVersionId !== null && currentVersion && !currentVersion.isCurrent;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "var(--bg)",
        animation: "lsw-fadeIn 180ms",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 18px",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 7,
            color: "var(--ink-2)",
            fontSize: 12,
            border: "1px solid var(--line)",
          }}
        >
          <IconChevronLeft size={12} /> Library
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "var(--line-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: meta.color,
              flexShrink: 0,
            }}
          >
            <Icon size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              onBlur={() => void saveTitle()}
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                background: "transparent",
                border: "none",
                outline: "none",
                padding: "2px 4px",
                borderRadius: 4,
                width: "100%",
              }}
              onFocus={(e) => {
                e.target.style.background = "var(--line-2)";
              }}
            />
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                display: "flex",
                gap: 6,
              }}
            >
              <span>{meta.label}</span>
              <span>·</span>
              <span className="mono">{source.size || source.added || ""}</span>
              <span>·</span>
              <span style={{ color: statusColor }}>{statusText}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => onAskAbout(source)}
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 7,
            color: "var(--ink-2)",
            border: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <IconSparkle size={12} /> Ask about this
        </button>
        <button
          onClick={deleteDocument}
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            color: "var(--danger)",
            border: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Delete document"
        >
          <IconTrash size={13} />
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "40px 0" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 32px" }}>
            {viewingOld && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "oklch(0.95 0.06 70)",
                  border: "1px solid oklch(0.86 0.11 75)",
                  color: "oklch(0.4 0.12 40)",
                  fontSize: 13,
                  marginBottom: 20,
                }}
              >
                Previewing v{currentVersion?.versionNumber}. Search still uses the current version.
              </div>
            )}
            {source.pending ? (
              <div
                style={{
                  padding: "60px 40px",
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                }}
              >
                This source is still processing — content will appear once indexing finishes.
              </div>
            ) : (
              <>
                <div
                  className="serif"
                  style={{
                    fontSize: 32,
                    lineHeight: 1.15,
                    letterSpacing: "-0.02em",
                    marginBottom: 20,
                    color: "var(--ink)",
                  }}
                >
                  {title}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    lineHeight: 1.7,
                    color: "var(--ink-2)",
                    whiteSpace: "pre-wrap",
                    minHeight: 200,
                  }}
                >
                  {source.type === "paste" ? (
                    "This note is indexed inline — open the full viewer to edit."
                  ) : (
                    <>
                      <p>
                        {meta.label} · {source.size || source.added || "indexed"}
                      </p>
                      <p style={{ marginTop: 12 }}>
                        Workspace view is a quick reference. For full preview (PDF, audio playback,
                        transcripts, inline page navigation), open the original viewer.
                      </p>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 28, display: "flex", gap: 8 }}>
                  <button
                    onClick={openOriginal}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "8px 14px",
                      borderRadius: 8,
                      background: "var(--accent)",
                      color: "white",
                    }}
                  >
                    Open original viewer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <aside
          style={{
            width: 280,
            flexShrink: 0,
            borderLeft: "1px solid var(--line)",
            background: "var(--panel)",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "16px 16px 10px" }}>
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
              Version history
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
              Uploaded revisions of this source.
            </div>
          </div>

          <div style={{ padding: "0 10px 16px" }}>
            {versionsError && (
              <div
                style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-3)" }}
              >
                {versionsError}
              </div>
            )}
            {!versionsError && versions.length === 0 && (
              <div
                style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-3)" }}
              >
                No version history available for this source.
              </div>
            )}
            {versions.map((v) => {
              const active = v.id === activeVersionId;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setActiveVersionId(v.id);
                    if (!v.isCurrent) previewVersion(v.id);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 8,
                    marginBottom: 2,
                    background: active ? "var(--accent-soft)" : "transparent",
                    border: "1px solid transparent",
                    position: "relative",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--line-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {active && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 10,
                        bottom: 10,
                        width: 2,
                        background: "var(--accent)",
                        borderRadius: "0 2px 2px 0",
                      }}
                    />
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: active ? "var(--accent-ink)" : "var(--ink)",
                      }}
                    >
                      v{v.versionNumber}
                      {v.isCurrent ? " (current)" : ""}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "var(--ink-3)" }}
                    >
                      {humanDate(v.createdAt)}
                    </span>
                  </div>
                  {v.changelog && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-3)",
                        lineHeight: 1.4,
                      }}
                    >
                      {v.changelog}
                    </div>
                  )}
                </button>
              );
            })}
            {viewingOld && currentVersion && (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  background: "var(--line-2)",
                  borderRadius: 8,
                  border: "1px dashed var(--line)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-3)",
                    marginBottom: 8,
                  }}
                >
                  Previewing v{currentVersion.versionNumber}.
                </div>
                <button
                  disabled={reverting}
                  onClick={() => void restoreVersion(currentVersion.id)}
                  style={{
                    width: "100%",
                    padding: "6px",
                    borderRadius: 6,
                    background: reverting ? "var(--line)" : "var(--accent)",
                    color: reverting ? "var(--ink-3)" : "white",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: reverting ? "not-allowed" : "pointer",
                  }}
                >
                  {reverting ? "Restoring…" : "Restore this version"}
                </button>
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--line)", padding: "14px 16px" }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                color: "var(--ink-3)",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Details
            </div>
            {source.added && <MetaRow label="Added" value={source.added} />}
            {source.size && <MetaRow label="Size" value={source.size} />}
            <MetaRow
              label="Folder"
              value={
                <span
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <IconFolder size={10} />
                  {source.folder || "Unfiled"}
                </span>
              }
            />
            <MetaRow
              label="Indexed"
              value={<span style={{ color: "var(--ok)" }}>✓ ready to query</span>}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
