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

import React, { useCallback, useEffect, useRef, useState } from "react";
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
 * Shape of the upload bootstrap response we need here. We only read a few
 * fields — everything else the endpoint returns is ignored.
 */
interface UploadBootstrap {
  isUploadThingConfigured: boolean;
  storageProvider: "cloud" | "local";
  s3Endpoint?: string;
}

interface PresignResponse {
  presignedUrl: string;
  objectKey: string;
  bucket: string;
}

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
  /**
   * If true, trigger the file picker automatically on mount. Used by the
   * sidebar's "Upload new version" dropdown shortcut so the user lands
   * directly in the OS file chooser rather than having to click the upload
   * area inside the modal first.
   */
  autoOpenUpload?: boolean;
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
  autoOpenUpload,
  onClose,
}: VersionHistoryPanelProps) {
  const [data, setData] = useState<VersionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Storage config fetched from the same bootstrap endpoint UploadForm uses.
  // Null while loading — we block uploads until it resolves so we never fire
  // against an unknown storage backend.
  const [bootstrap, setBootstrap] = useState<UploadBootstrap | null>(null);
  // Ref on the hidden file input so the "Upload new version" dropdown
  // shortcut can programmatically open the OS file picker when the modal
  // first renders.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoOpenFiredRef = useRef(false);

  const loadBootstrap = useCallback(async () => {
    try {
      const res = await fetch("/api/employer/upload/bootstrap");
      if (!res.ok) {
        // Non-fatal — we'll fall back to assuming Vercel Blob / database
        // storage below if bootstrap can't be fetched. A failed bootstrap
        // shouldn't kill the rest of the panel (version list, revert, delete
        // still work without storage info).
        console.warn(
          `[VersionHistoryPanel] bootstrap fetch failed: HTTP ${res.status}`
        );
        setBootstrap({ isUploadThingConfigured: false, storageProvider: "cloud" });
        return;
      }
      const json = (await res.json()) as UploadBootstrap;
      setBootstrap({
        isUploadThingConfigured: Boolean(json.isUploadThingConfigured),
        storageProvider: json.storageProvider ?? "cloud",
        s3Endpoint: json.s3Endpoint,
      });
    } catch (err) {
      console.warn("[VersionHistoryPanel] bootstrap fetch threw:", err);
      setBootstrap({ isUploadThingConfigured: false, storageProvider: "cloud" });
    }
  }, []);

  /**
   * Fetch the current versions list from the server.
   *
   * When `silent: true`, we don't flip the `loading` state or clear `error`.
   * This is used by the background polling loop below — we don't want the
   * entire panel to flash into a loading spinner every 2 seconds while a
   * version is processing.
   */
  const loadVersions = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch(`/api/documents/${documentId}/versions`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as VersionListResponse;
        setData(json);
      } catch (err) {
        // Silent polling errors are swallowed — we don't want a transient
        // 500 mid-poll to wipe the panel's displayed data. Non-silent
        // errors (initial load, manual refresh) are surfaced.
        if (!silent) {
          setError(err instanceof Error ? err.message : String(err));
        } else {
          console.warn("[VersionHistoryPanel] silent poll failed:", err);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [documentId],
  );

  useEffect(() => {
    void loadVersions();
    void loadBootstrap();
  }, [loadVersions, loadBootstrap]);

  // When opened via the sidebar's "Upload new version" shortcut, fire the
  // file picker automatically. We gate on `data?.fileType` so the file input
  // is enabled (it's disabled until fileType is known), and guard with a ref
  // so the picker never opens twice in the same session if `data` re-renders.
  useEffect(() => {
    if (!autoOpenUpload) return;
    if (autoOpenFiredRef.current) return;
    if (!data?.fileType) return;
    const input = fileInputRef.current;
    if (!input) return;
    autoOpenFiredRef.current = true;
    input.click();
  }, [autoOpenUpload, data?.fileType]);

  /**
   * Background polling while any version is still being processed.
   *
   * The version panel's data is fetched once on mount and once after each
   * user action. That doesn't cover the time window between "upload
   * finished, pipeline started" and "pipeline finished, ocrProcessed is
   * now true" — during that window, the panel shows stale "Processing"
   * state forever unless the user triggers a refetch manually.
   *
   * Rather than polling always, we poll *only* when the server's most
   * recent response still reports at least one version with
   * `ocrProcessed === false`. That makes the polling load exactly
   * proportional to work-in-progress: idle when nothing is processing,
   * active during processing, automatically stops when finalizeStorage
   * flips the flag to true.
   *
   * Interval is 2 seconds — fast enough that users see the "Ready" state
   * within a few hundred milliseconds of it becoming true in the DB, but
   * not so fast that it hammers the API. The server query is cheap
   * (a simple SELECT from document_versions), so 2s is comfortable.
   */
  useEffect(() => {
    if (!data) return;
    const anyProcessing = data.versions.some((v) => v.ocrProcessed === false);
    if (!anyProcessing) return;

    const interval = setInterval(() => {
      void loadVersions({ silent: true });
    }, 2000);

    return () => clearInterval(interval);
  }, [data, loadVersions]);

  /**
   * Result of pushing raw bytes to whichever storage backend is active.
   * `storagePathname` is only populated for the local-S3 path — the versions
   * registration endpoint uses it to know the object key for future deletes.
   */
  interface BlobUploadResult {
    url: string;
    storagePathname?: string;
  }

  /**
   * Upload the file to blob storage using the same three-path strategy the
   * regular UploadForm uses. Ordered by preference:
   *
   *   1. Local SeaweedFS presigned S3 — used when the app is configured
   *      for local storage (`NEXT_PUBLIC_STORAGE_PROVIDER=local`). The
   *      browser uploads directly to the S3-compatible endpoint via a
   *      short-lived presigned URL from `/api/storage/presign`.
   *   2. UploadThing — used when `UPLOADTHING_TOKEN` is set on the server.
   *      Direct browser-to-cloud upload with no Next server hop.
   *   3. Database-backed fallback via `/api/upload-local` — posts the file
   *      to the Next server which stores it via Vercel Blob + a row in
   *      `file_uploads`. Used when neither of the above is available.
   *
   * If bootstrap hasn't loaded yet (`bootstrap === null`) we conservatively
   * take path 3, since it doesn't depend on any client-side config.
   */
  const uploadBlob = async (file: File): Promise<BlobUploadResult> => {
    // Path 1: local SeaweedFS (presigned S3)
    if (bootstrap?.storageProvider === "local" && bootstrap.s3Endpoint) {
      const presignRes = await fetch("/api/storage/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!presignRes.ok) {
        const body = await presignRes.text().catch(() => "");
        throw new Error(`Presign failed (HTTP ${presignRes.status}): ${body}`);
      }
      const { presignedUrl, objectKey, bucket } =
        (await presignRes.json()) as PresignResponse;

      const s3Res = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!s3Res.ok) {
        throw new Error(`Direct S3 upload failed (HTTP ${s3Res.status})`);
      }

      return {
        url: `${bootstrap.s3Endpoint.replace(/\/+$/, "")}/${bucket}/${objectKey}`,
        storagePathname: objectKey,
      };
    }

    // Path 2: UploadThing (only when server confirms the token is set)
    if (bootstrap?.isUploadThingConfigured) {
      const uploadRes = await uploadFiles("documentUploaderRestricted", {
        files: [file],
      });
      const uploaded = uploadRes?.[0];
      if (!uploaded?.url) {
        throw new Error("UploadThing upload did not return a file URL");
      }
      return { url: uploaded.url };
    }

    // Path 3: database-backed fallback via /api/upload-local
    const fd = new FormData();
    fd.append("file", file);
    const localRes = await fetch("/api/upload-local", {
      method: "POST",
      body: fd,
    });
    if (!localRes.ok) {
      const body = (await localRes.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        body.error ?? `Local upload failed (HTTP ${localRes.status})`
      );
    }
    const json = (await localRes.json()) as { url: string };
    return { url: json.url };
  };

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
      // Stage 1: push the raw bytes to whichever storage backend is active.
      // The helper mirrors UploadForm's three-path strategy so version
      // uploads work in every deployment the regular upload supports.
      const uploaded = await uploadBlob(file);

      // Stage 2: register the new version against the document. Server will
      // trigger the OCR pipeline and flip currentVersionId.
      const registerBody: Record<string, unknown> = {
        documentUrl: uploaded.url,
        mimeType: file.type,
        originalFilename: file.name,
        fileSize: file.size,
      };
      // Forward local-S3 metadata when we used path 1, mirroring the shape
      // `POST /api/uploadDocument` expects so future delete/blob cleanup
      // can identify the object key.
      if (uploaded.storagePathname) {
        registerBody.storageProvider = "seaweedfs";
        registerBody.storagePathname = uploaded.storagePathname;
      }

      const registerRes = await fetch(
        `/api/documents/${documentId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(registerBody),
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
              ref={fileInputRef}
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
                // "View" for the current version is a no-op in inline-preview
                // mode — the main viewer is already showing it, and flipping
                // into preview mode would show a misleading "not current"
                // banner. Hide the View button in that specific combination.
                // When the parent does NOT provide onPreviewVersion (new-tab
                // fallback mode), View stays visible for every version since
                // opening the current version in a new tab is still a valid
                // "download" action.
                const canView = !(v.isCurrent && onPreviewVersion);
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
                        {canView && (
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
                        )}
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
