"use client";

/**
 * VersionHistoryPanel
 *
 * Modal-style panel that shows the full version history of a document and
 * lets the user:
 *   - Upload a new version (file type locked to the document's fileType)
 *   - View a past version in a new tab
 *   - Revert the document to any past version (instant — embeddings already exist)
 *   - Delete a past version (blocked for the current version and the last version)
 *
 * Everything is scoped to a single `documentId` passed in by the parent. The
 * panel owns its own data fetching and re-loads after any mutation so the UI
 * always reflects server state.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Clock,
  Upload,
  RotateCcw,
  Trash2,
  Eye,
  CheckCircle2,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import { genUploader } from "uploadthing/client";

import { Button } from "~/app/employer/documents/components/ui/button";
import type { OurFileRouter } from "~/app/api/uploadthing/core";

const { uploadFiles } = genUploader<OurFileRouter>();

/**
 * Shape of a single version as returned by `GET /api/documents/[id]/versions`.
 * Kept permissive because the server may evolve; unknown fields are ignored.
 */
interface VersionDto {
  id: number;
  versionNumber: number;
  url: string;
  mimeType: string;
  fileSize: number | null;
  uploadedBy: string | null;
  changelog: string | null;
  ocrProcessed: boolean | null;
  ocrProvider: string | null;
  createdAt: string;
  isCurrent: boolean;
}

interface VersionListResponse {
  documentId: number;
  fileType: string | null;
  currentVersionId: number | null;
  versions: VersionDto[];
}

interface VersionHistoryPanelProps {
  documentId: number;
  documentTitle: string;
  /** Called after revert/upload completes so the parent can refresh its document list. */
  onVersionsChanged?: () => void;
  /**
   * Called when the user clicks "view" on a non-current version. The parent
   * is responsible for switching its viewer into inline-preview mode for that
   * version and closing this panel. When this prop is absent, "view" falls
   * back to opening the content endpoint in a new tab.
   */
  onPreviewVersion?: (versionId: number, versionNumber: number) => void;
  onClose: () => void;
}

/** Format bytes as a short human-readable string. */
function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

/** Format an ISO timestamp as a short relative/absolute string. */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function VersionHistoryPanel({
  documentId,
  documentTitle,
  onVersionsChanged,
  onPreviewVersion,
  onClose,
}: VersionHistoryPanelProps) {
  const [data, setData] = useState<VersionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/versions`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as VersionListResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const handleFilePicked = async (file: File) => {
    if (!data?.fileType) {
      setUploadError(
        "This document's file type isn't initialized yet. Ask an admin to run the versioning backfill."
      );
      return;
    }

    // Client-side MIME guard. The server re-validates authoritatively, but
    // catching the mismatch here gives instant feedback without an upload roundtrip.
    if (file.type.toLowerCase() !== data.fileType.toLowerCase()) {
      setUploadError(
        `File type mismatch. This document is locked to ${data.fileType}; you picked ${file.type || "an unknown type"}.`
      );
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      // Stage 1: push the raw bytes to blob storage via UploadThing. Mirrors
      // the existing single-file upload path in UploadForm.tsx.
      const uploadRes = await uploadFiles("documentUploaderRestricted", {
        files: [file],
      });
      const uploaded = uploadRes?.[0];
      if (!uploaded) {
        throw new Error("Upload did not return a file URL");
      }

      // Stage 2: register the new version against the document. Server will
      // trigger the OCR pipeline and flip currentVersionId.
      const registerRes = await fetch(
        `/api/documents/${documentId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentUrl: uploaded.url,
            mimeType: file.type,
            originalFilename: file.name,
            fileSize: file.size,
          }),
        }
      );

      if (!registerRes.ok) {
        const body = (await registerRes.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        throw new Error(body.details ?? body.error ?? `HTTP ${registerRes.status}`);
      }

      await loadVersions();
      onVersionsChanged?.();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleRevert = async (versionId: number) => {
    setBusyVersionId(versionId);
    setError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/${versionId}/revert`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadVersions();
      onVersionsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleDelete = async (versionId: number, versionNumber: number) => {
    const confirmed = window.confirm(
      `Delete version ${versionNumber}? This removes the file and all its embeddings. This cannot be undone.`
    );
    if (!confirmed) return;

    setBusyVersionId(versionId);
    setError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/${versionId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        throw new Error(body.details ?? body.error ?? `HTTP ${res.status}`);
      }
      await loadVersions();
      onVersionsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyVersionId(null);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-selected
    if (file) void handleFilePicked(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground truncate">
                Version history
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                {documentTitle}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex-shrink-0"
            aria-label="Close version history"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Upload area */}
        <div className="p-5 border-b border-border">
          <label
            className={`flex items-center gap-3 rounded-xl border-2 border-dashed p-4 cursor-pointer transition-colors ${
              uploading
                ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                : "border-border hover:border-purple-400 hover:bg-muted/50"
            }`}
          >
            <input
              type="file"
              className="hidden"
              accept={data?.fileType ?? undefined}
              onChange={onFileInputChange}
              disabled={uploading || !data?.fileType}
            />
            {uploading ? (
              <Loader2 className="w-5 h-5 text-purple-600 animate-spin flex-shrink-0" />
            ) : (
              <Upload className="w-5 h-5 text-purple-600 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">
                {uploading ? "Uploading new version…" : "Upload a new version"}
              </div>
              <div className="text-xs text-muted-foreground">
                {data?.fileType
                  ? `Must be the same file type: ${data.fileType}`
                  : "Loading…"}
              </div>
            </div>
          </label>
          {uploadError && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading versions…
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && data && data.versions.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              No versions found.
            </div>
          )}

          {!loading && !error && data && data.versions.length > 0 && (
            <ul className="space-y-2">
              {data.versions.map((v) => {
                const isOnlyVersion = data.versions.length === 1;
                const canDelete = !v.isCurrent && !isOnlyVersion;
                const canRevert = !v.isCurrent;
                const isBusy = busyVersionId === v.id;

                return (
                  <li
                    key={v.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      v.isCurrent
                        ? "border-purple-400 bg-purple-50/50 dark:bg-purple-900/10"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-foreground">
                            Version {v.versionNumber}
                          </span>
                          {v.isCurrent && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">
                              <CheckCircle2 className="w-3 h-3" />
                              Current
                            </span>
                          )}
                          {v.ocrProcessed === false && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Processing
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(v.createdAt)} · {formatSize(v.fileSize)}
                          {v.ocrProvider && ` · ${v.ocrProvider}`}
                        </div>
                        {v.changelog && (
                          <div className="mt-1 text-xs text-foreground italic">
                            {v.changelog}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-md"
                          title={
                            onPreviewVersion
                              ? "Preview this version in the viewer"
                              : "View this version in a new tab"
                          }
                          disabled={isBusy}
                          onClick={() => {
                            if (onPreviewVersion) {
                              onPreviewVersion(v.id, v.versionNumber);
                              onClose();
                            } else {
                              window.open(
                                `/api/documents/${documentId}/versions/${v.id}/content`,
                                "_blank",
                                "noopener,noreferrer"
                              );
                            }
                          }}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {canRevert && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600"
                            title="Revert to this version"
                            disabled={isBusy}
                            onClick={() => void handleRevert(v.id)}
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600"
                            title="Delete this version"
                            disabled={isBusy}
                            onClick={() =>
                              void handleDelete(v.id, v.versionNumber)
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
