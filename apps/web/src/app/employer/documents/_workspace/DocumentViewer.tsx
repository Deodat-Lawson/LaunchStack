"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Pencil, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "~/lib/auth-client";
import { IconChevronLeft, IconFolder, IconSparkle, IconTrash } from "./icons";
import { GoogleDriveBanner } from "./GoogleDriveBanner";
import type { DocumentType } from "../types/document";
import { getMindmap } from "../_mindmap/lib/api";
import { openMindmapDocument } from "../_mindmap/lib/open";
import type { MindmapDoc } from "../_mindmap/model/types";
import type { RevisionRow } from "../_mindmap/ui/HistoryPanel";
import { isMindmapSource } from "./sourceApi";
import { SOURCE_META, type CitationHighlight, type WorkspaceSource } from "./types";
import { DocumentNotesPanel, type PrefilledAnchor } from "~/components/notes/DocumentNotesPanel";
import type { DocumentNote } from "~/server/db/schema";
import { getDocumentDisplayType } from "../types/document";
import type { PdfNoteLite } from "~/components/notes/PdfViewerWithNotes";

const PdfViewerWithNotes = dynamic(
    () => import("~/components/notes/PdfViewerWithNotes").then(m => m.PdfViewerWithNotes),
    { ssr: false }
);

type UploadState =
    | { phase: "idle" }
    | { phase: "uploading"; percent: number; fileName: string }
    | { phase: "finalizing"; fileName: string }
    | { phase: "error"; message: string };

const FullDocumentViewer = dynamic(
    () => import("~/app/employer/documents/components/DocumentViewer").then(m => m.DocumentViewer),
    { ssr: false }
);

// The canvas bundle is only worth paying for when a map is actually opened.
const MindmapPreview = dynamic(
    () => import("../_mindmap/ui/MindmapPreview").then(m => m.MindmapPreview),
    { ssr: false }
);

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
    /** When opened from a citation: the cited passage to locate + highlight. */
    highlight?: CitationHighlight | null;
    onClose: () => void;
    onRename: (source: WorkspaceSource, title: string) => Promise<boolean>;
    onDelete: (source: WorkspaceSource) => void;
    onAskAbout: (source: WorkspaceSource) => void;
    onVersionChanged?: () => void;
    /** Mindmaps only: leave the preview for the editor. */
    onEdit?: (source: WorkspaceSource) => void;
    /** Mindmaps only: the citable copy was created or updated. */
    onPublished?: () => void;
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

function TabButton({
    label,
    count,
    active,
    onClick,
}: {
    label: string;
    count?: number;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                appearance: "none",
                border: "none",
                background: "transparent",
                padding: "10px 12px 11px",
                marginBottom: -1,
                borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                color: active ? "var(--ink)" : "var(--ink-3)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
            }}
        >
            {label}
            {typeof count === "number" && (
                <span
                    className="mono"
                    style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: active ? "var(--accent-soft)" : "var(--panel-2)",
                        color: active ? "var(--accent-ink)" : "var(--ink-3)",
                    }}
                >
                    {count}
                </span>
            )}
        </button>
    );
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
    highlight,
    onClose,
    onRename,
    onDelete,
    onAskAbout,
    onVersionChanged,
    onEdit,
    onPublished,
}: DocumentViewerProps) {
    const router = useRouter();
    const { userId } = useAuth();
    const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
    const Icon = meta.Icon;
    // A mindmap is its own row: no document to fetch, no file versions, and
    // notes only once it has a published copy to hang them on.
    const isMindmap = isMindmapSource(source);
    const persisted = isMindmap
        ? typeof source.mindmapId === "number" && source.mindmapId > 0
        : typeof source.documentId === "number" && source.documentId > 0;
    const [mindmapDoc, setMindmapDoc] = useState<{ doc: MindmapDoc; key: string } | null>(null);
    const [mindmapError, setMindmapError] = useState<string | null>(null);
    const [revisions, setRevisions] = useState<RevisionRow[]>([]);
    const [publishing, setPublishing] = useState(false);
    const [title, setTitle] = useState(source.title);
    const [dirty, setDirty] = useState(false);
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [versions, setVersions] = useState<VersionRow[]>([]);
    const [versionsError, setVersionsError] = useState<string | null>(null);
    const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
    const [expectedMime, setExpectedMime] = useState<string | null>(null);
    const [reverting, setReverting] = useState(false);
    const [fullDoc, setFullDoc] = useState<DocumentType | null>(null);
    const [fullDocError, setFullDocError] = useState<string | null>(null);
    const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [sidebarTab, setSidebarTab] = useState<"versions" | "notes">("versions");
    const [pdfNotes, setPdfNotes] = useState<DocumentNote[]>([]);
    const [notesNonce, setNotesNonce] = useState(0);
    const [pdfAnchorDraft, setPdfAnchorDraft] = useState<PrefilledAnchor | null>(null);
    const [pdfScrollToNoteId, setPdfScrollToNoteId] = useState<number | null>(null);

    const isPdf = fullDoc !== null && getDocumentDisplayType(fullDoc) === "pdf";

    // Fetch the underlying document so the inline preview can render PDFs,
    // audio, DOCX, etc. via the full viewer — same endpoint the standalone
    // viewer page uses.
    useEffect(() => {
        if (isMindmap || !source.documentId || !userId || source.pending) {
            setFullDoc(null);
            return;
        }
        let cancelled = false;
        setFullDocError(null);
        void (async () => {
            try {
                const res = await fetch("/api/fetchDocument", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
                if (!res.ok) throw new Error(`Failed (${res.status})`);
                const data = (await res.json()) as DocumentType[];
                if (cancelled) return;
                setFullDoc(data.find(d => d.id === source.documentId) ?? null);
            } catch (err) {
                if (!cancelled) {
                    setFullDocError(err instanceof Error ? err.message : "Failed to load preview");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isMindmap, source.documentId, source.pending, userId]);

    // The map itself, plus its snapshot history for the sidebar.
    useEffect(() => {
        if (!isMindmap || !source.mindmapId) return;
        const mindmapId = source.mindmapId;
        let cancelled = false;
        setMindmapDoc(null);
        setMindmapError(null);
        setRevisions([]);
        void (async () => {
            try {
                const detail = await getMindmap(mindmapId);
                if (cancelled) return;
                const { doc } = openMindmapDocument(detail);
                setMindmapDoc({ doc, key: `${detail.id}:${detail.revision}` });
            } catch (err) {
                if (!cancelled) {
                    setMindmapError(
                        err instanceof Error ? err.message : "Couldn't open this mindmap"
                    );
                }
            }
        })();
        void (async () => {
            try {
                const res = await fetch(`/api/mindmaps/${mindmapId}/revisions`);
                if (!res.ok) return;
                const body = (await res.json()) as { revisions: RevisionRow[] };
                if (!cancelled) setRevisions(body.revisions ?? []);
            } catch {
                /* history is advisory; the preview stands without it */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isMindmap, source.mindmapId]);

    const publishMindmap = useCallback(async () => {
        if (!source.mindmapId) return;
        setPublishing(true);
        try {
            const res = await fetch(`/api/mindmaps/${source.mindmapId}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: source.folder || undefined }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            toast.success(
                source.citability === "none"
                    ? "Added to your sources — it will finish indexing shortly"
                    : "Citable copy updated — it will finish indexing shortly"
            );
            onPublished?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't publish this mindmap");
        } finally {
            setPublishing(false);
        }
    }, [onPublished, source.citability, source.folder, source.mindmapId]);

    useEffect(() => {
        setTitle(source.title);
        setDirty(false);
        setSaveStatus("idle");
    }, [source.id, source.title]);

    // Fetch notes for the PDF overlay whenever the doc changes or a note
    // CRUD operation bumps `notesNonce`. The DocumentNotesPanel sidebar
    // fetches its own copy independently; this duplicate is the cost of not
    // plumbing a shared store through, and is fine at note-count scales.
    useEffect(() => {
        if (!source.documentId || !isPdf) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(
                    `/api/notes?documentId=${encodeURIComponent(String(source.documentId))}`
                );
                if (!res.ok) return;
                const data = (await res.json()) as { notes: DocumentNote[] };
                if (!cancelled) setPdfNotes(data.notes ?? []);
            } catch {
                /* ignore — PDF overlay degrades to "no pins" */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [source.documentId, isPdf, notesNonce]);

    // When the PDF viewer captures a selection, pop the notes panel open so
    // the user can type the body without hunting for the sidebar.
    useEffect(() => {
        if (pdfAnchorDraft) setSidebarTab("notes");
    }, [pdfAnchorDraft]);

    // Fetch version history on mount
    useEffect(() => {
        if (isMindmap || !source.documentId) return;
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
                setExpectedMime(data.fileType);
            } catch (err) {
                if (!cancelled) {
                    setVersionsError(
                        err instanceof Error ? err.message : "Failed to load versions"
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isMindmap, source.documentId]);

    // Auto-save title rename on blur/debounce.
    const saveTitle = useCallback(async () => {
        if (!persisted) return;
        const trimmed = title.trim();
        if (!trimmed || trimmed === source.title) {
            setDirty(false);
            setSaveStatus("idle");
            return;
        }
        setSaveStatus("saving");
        const ok = await onRename(source, trimmed);
        setSaveStatus(ok ? "saved" : "error");
        setDirty(false);
    }, [title, persisted, source, onRename]);

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
        router.push(`/employer/documents/viewer?docId=${source.documentId}&versionId=${versionId}`);
    };

    const refreshVersions = useCallback(async () => {
        if (!source.documentId) return;
        const res = await fetch(`/api/documents/${source.documentId}/versions`);
        if (!res.ok) return;
        const data = (await res.json()) as VersionsResponse;
        setVersions(data.versions);
        setActiveVersionId(data.currentVersionId);
        setExpectedMime(data.fileType);
    }, [source.documentId]);

    const uploadNewVersion = useCallback(
        (file: File) => {
            if (!source.documentId) return;
            if (uploadState.phase === "uploading" || uploadState.phase === "finalizing") return;

            if (expectedMime && file.type && file.type !== expectedMime) {
                setUploadState({
                    phase: "error",
                    message: `File type must match the current version (${expectedMime}). Got ${file.type || "unknown"}.`,
                });
                return;
            }

            const storageForm = new FormData();
            storageForm.append("file", file);

            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/storage/upload", true);
            xhr.timeout = 10 * 60 * 1000;

            setUploadState({ phase: "uploading", percent: 0, fileName: file.name });

            xhr.upload.onprogress = event => {
                if (event.lengthComputable) {
                    setUploadState({
                        phase: "uploading",
                        percent: Math.round((event.loaded / event.total) * 100),
                        fileName: file.name,
                    });
                }
            };

            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    setUploadState({
                        phase: "error",
                        message:
                            xhr.status === 401
                                ? "Please sign in and try again."
                                : `Storage upload failed (HTTP ${xhr.status}).`,
                    });
                    return;
                }

                let storage: { url: string } | null = null;
                try {
                    storage = JSON.parse(xhr.responseText) as { url: string };
                } catch {
                    setUploadState({ phase: "error", message: "Invalid storage response." });
                    return;
                }
                if (!storage?.url) {
                    setUploadState({ phase: "error", message: "Storage did not return a URL." });
                    return;
                }

                setUploadState({ phase: "finalizing", fileName: file.name });

                void (async () => {
                    try {
                        const res = await fetch(`/api/documents/${source.documentId}/versions`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                documentUrl: storage.url,
                                mimeType:
                                    file.type || (expectedMime ?? "") || "application/octet-stream",
                                originalFilename: file.name,
                                fileSize: file.size,
                            }),
                        });
                        if (!res.ok) {
                            const body = (await res.json().catch(() => ({}))) as { error?: string };
                            throw new Error(body.error ?? `Failed (${res.status})`);
                        }
                        setUploadState({ phase: "idle" });
                        await refreshVersions();
                        onVersionChanged?.();
                    } catch (err) {
                        setUploadState({
                            phase: "error",
                            message: err instanceof Error ? err.message : "Version upload failed",
                        });
                    }
                })();
            };
            xhr.ontimeout = () => setUploadState({ phase: "error", message: "Upload timed out." });
            xhr.onerror = () =>
                setUploadState({ phase: "error", message: "Storage service unavailable." });
            xhr.send(storageForm);
        },
        [source.documentId, expectedMime, uploadState.phase, refreshVersions, onVersionChanged]
    );

    const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) uploadNewVersion(file);
    };

    const restoreVersion = async (versionId: number) => {
        if (!source.documentId) return;
        if (!confirm("Restore this version as the current one?")) return;
        setReverting(true);
        try {
            const res = await fetch(
                `/api/documents/${source.documentId}/versions/${versionId}/revert`,
                { method: "POST" }
            );
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error ?? `Failed (${res.status})`);
            }
            await refreshVersions();
            onVersionChanged?.();
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to restore version");
        } finally {
            setReverting(false);
        }
    };

    const deleteDocument = () => {
        if (!persisted) return;
        const prompt = isMindmap
            ? `Move "${source.title}" to the trash? You can undo it right after.`
            : `Delete "${source.title}"? This cannot be undone.`;
        if (!confirm(prompt)) return;
        onDelete(source);
    };

    const openOriginal = () => {
        if (isMindmap) {
            onEdit?.(source);
            return;
        }
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

    const currentVersion = versions.find(v => v.id === activeVersionId);
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
                            onChange={e => {
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
                            onFocus={e => {
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
                {isMindmap && onEdit && (
                    <button
                        onClick={() => onEdit(source)}
                        data-testid="viewer-edit-mindmap"
                        style={{
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "6px 12px",
                            borderRadius: 7,
                            background: "var(--accent)",
                            color: "white",
                            border: "1px solid transparent",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <Pencil style={{ width: 12, height: 12 }} /> Edit
                    </button>
                )}
                {isMindmap && source.citability !== "citable" && (
                    <button
                        onClick={() => void publishMindmap()}
                        disabled={publishing || !persisted}
                        title={
                            source.citability === "stale"
                                ? "The citable copy is older than this map"
                                : "Index this map so answers can cite it"
                        }
                        style={{
                            fontSize: 12,
                            padding: "6px 10px",
                            borderRadius: 7,
                            color: "var(--ink-2)",
                            border: "1px solid var(--line)",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            opacity: publishing ? 0.6 : 1,
                        }}
                    >
                        <Upload style={{ width: 12, height: 12 }} />
                        {publishing
                            ? "Publishing…"
                            : source.citability === "stale"
                              ? "Update citable copy"
                              : "Make citable"}
                    </button>
                )}
                {(!isMindmap || source.citability !== "none") && (
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
                )}
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
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    {!isMindmap &&
                        typeof source.documentId === "number" &&
                        source.documentId > 0 && (
                            <GoogleDriveBanner documentId={source.documentId} />
                        )}
                    {viewingOld && (
                        <div
                            style={{
                                padding: "10px 14px",
                                margin: "12px 16px 0",
                                borderRadius: 10,
                                background: "oklch(0.95 0.06 70)",
                                border: "1px solid oklch(0.86 0.11 75)",
                                color: "oklch(0.4 0.12 40)",
                                fontSize: 13,
                                flexShrink: 0,
                            }}
                        >
                            Previewing v{currentVersion?.versionNumber}. Search still uses the
                            current version.
                        </div>
                    )}
                    {isMindmap ? (
                        mindmapDoc ? (
                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    minWidth: 0,
                                    minHeight: 0,
                                    overflow: "hidden",
                                }}
                            >
                                <MindmapPreview key={mindmapDoc.key} doc={mindmapDoc.doc} />
                            </div>
                        ) : mindmapError ? (
                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: "60px 40px",
                                    textAlign: "center",
                                    color: "var(--ink-3)",
                                    fontSize: 14,
                                }}
                            >
                                Couldn&apos;t open this mindmap: {mindmapError}
                            </div>
                        ) : (
                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "var(--ink-3)",
                                    fontSize: 13,
                                }}
                            >
                                Opening…
                            </div>
                        )
                    ) : source.pending ? (
                        <div
                            style={{
                                flex: 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "60px 40px",
                                textAlign: "center",
                                color: "var(--ink-3)",
                                fontSize: 14,
                            }}
                        >
                            This source is still processing — content will appear once indexing
                            finishes.
                        </div>
                    ) : fullDoc ? (
                        <div
                            style={{
                                flex: 1,
                                overflow: "hidden",
                                display: "flex",
                                minWidth: 0,
                                minHeight: 0,
                            }}
                        >
                            {isPdf ? (
                                <PdfViewerWithNotes
                                    url={fullDoc.url}
                                    notes={toPdfNoteLites(pdfNotes)}
                                    citationHighlight={highlight ?? null}
                                    scrollToNoteId={pdfScrollToNoteId}
                                    onCreateAnchoredNote={anchor => {
                                        setPdfAnchorDraft({
                                            page: anchor.page,
                                            quads: anchor.quads,
                                            quote: anchor.quote,
                                        });
                                    }}
                                    onAiCapture={(anchor, intent) => {
                                        void fetch("/api/notes/ai-capture", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                selection: anchor.quote.exact,
                                                intent,
                                                sourceContext: {
                                                    documentId: source.documentId,
                                                    documentTitle: fullDoc?.title,
                                                    versionId: activeVersionId ?? undefined,
                                                    page: anchor.page,
                                                },
                                            }),
                                        })
                                            .then(async res => {
                                                if (!res.ok) {
                                                    throw new Error(
                                                        `AI capture failed (${res.status})`
                                                    );
                                                }
                                                setNotesNonce(n => n + 1);
                                                setSidebarTab("notes");
                                            })
                                            .catch(err => {
                                                console.error("[ai-capture] failed:", err);
                                            });
                                    }}
                                    onNotePinClick={id => {
                                        setPdfScrollToNoteId(id);
                                        setSidebarTab("notes");
                                    }}
                                />
                            ) : (
                                <div
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        minHeight: 0,
                                        overflow: "hidden",
                                    }}
                                >
                                    <FullDocumentViewer
                                        document={fullDoc}
                                        minimal
                                        highlight={highlight ?? null}
                                    />
                                </div>
                            )}
                        </div>
                    ) : fullDocError ? (
                        <div
                            style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 12,
                                padding: "60px 40px",
                                color: "var(--ink-3)",
                                fontSize: 14,
                            }}
                        >
                            <div>Couldn&apos;t load preview: {fullDocError}</div>
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
                                Open standalone viewer
                            </button>
                        </div>
                    ) : (
                        <div
                            style={{
                                flex: 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--ink-3)",
                                fontSize: 13,
                            }}
                        >
                            Loading preview…
                        </div>
                    )}
                </div>

                <aside
                    style={{
                        width: 320,
                        flexShrink: 0,
                        borderLeft: "1px solid var(--line)",
                        background: "var(--panel)",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            borderBottom: "1px solid var(--line-2)",
                            padding: "0 10px",
                            flexShrink: 0,
                        }}
                    >
                        <TabButton
                            label="Versions"
                            count={isMindmap ? revisions.length : versions.length}
                            active={sidebarTab === "versions"}
                            onClick={() => setSidebarTab("versions")}
                        />
                        {/* Notes hang off a document id; an unpublished map has none yet. */}
                        {(!isMindmap || Boolean(source.documentId)) && (
                            <TabButton
                                label="Notes"
                                active={sidebarTab === "notes"}
                                onClick={() => setSidebarTab("notes")}
                            />
                        )}
                    </div>

                    {sidebarTab === "notes" && (!isMindmap || Boolean(source.documentId)) ? (
                        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                            <DocumentNotesPanel
                                documentId={source.documentId ? String(source.documentId) : null}
                                versionId={activeVersionId}
                                prefilledAnchor={pdfAnchorDraft}
                                onChanged={() => {
                                    setNotesNonce(n => n + 1);
                                    setPdfAnchorDraft(null);
                                }}
                                onNoteClick={({ id, page }) => {
                                    if (page !== null) setPdfScrollToNoteId(id);
                                }}
                            />
                        </div>
                    ) : isMindmap ? (
                        <MindmapHistory source={source} rows={revisions} />
                    ) : (
                        <div style={{ flex: 1, overflowY: "auto" }}>
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
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: "var(--ink-3)",
                                        marginTop: 2,
                                        marginBottom: 10,
                                    }}
                                >
                                    Uploaded revisions of this source.
                                </div>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={expectedMime ?? undefined}
                                    style={{ display: "none" }}
                                    onChange={handlePickFile}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={
                                        uploadState.phase === "uploading" ||
                                        uploadState.phase === "finalizing" ||
                                        !source.documentId
                                    }
                                    style={{
                                        width: "100%",
                                        padding: "7px 10px",
                                        borderRadius: 7,
                                        background:
                                            uploadState.phase === "uploading" ||
                                            uploadState.phase === "finalizing"
                                                ? "var(--line)"
                                                : "var(--accent)",
                                        color:
                                            uploadState.phase === "uploading" ||
                                            uploadState.phase === "finalizing"
                                                ? "var(--ink-3)"
                                                : "white",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor:
                                            uploadState.phase === "uploading" ||
                                            uploadState.phase === "finalizing"
                                                ? "not-allowed"
                                                : "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                    }}
                                >
                                    {uploadState.phase === "uploading"
                                        ? `Uploading ${uploadState.percent}%…`
                                        : uploadState.phase === "finalizing"
                                          ? "Indexing new version…"
                                          : "Upload new version"}
                                </button>
                                {expectedMime && (
                                    <div
                                        className="mono"
                                        style={{
                                            fontSize: 10,
                                            color: "var(--ink-3)",
                                            marginTop: 6,
                                            textAlign: "center",
                                        }}
                                    >
                                        Must match: {expectedMime}
                                    </div>
                                )}
                                {uploadState.phase === "error" && (
                                    <div
                                        style={{
                                            marginTop: 8,
                                            padding: "8px 10px",
                                            borderRadius: 7,
                                            background: "oklch(0.96 0.04 30)",
                                            border: "1px solid oklch(0.86 0.11 30)",
                                            color: "oklch(0.4 0.14 30)",
                                            fontSize: 11,
                                            lineHeight: 1.45,
                                        }}
                                    >
                                        {uploadState.message}
                                    </div>
                                )}
                            </div>

                            <div style={{ padding: "0 10px 16px" }}>
                                {versionsError && (
                                    <div
                                        style={{
                                            padding: "10px 12px",
                                            fontSize: 11,
                                            color: "var(--ink-3)",
                                        }}
                                    >
                                        {versionsError}
                                    </div>
                                )}
                                {!versionsError && versions.length === 0 && (
                                    <div
                                        style={{
                                            padding: "10px 12px",
                                            fontSize: 11,
                                            color: "var(--ink-3)",
                                        }}
                                    >
                                        No version history available for this source.
                                    </div>
                                )}
                                {versions.map(v => {
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
                                                background: active
                                                    ? "var(--accent-soft)"
                                                    : "transparent",
                                                border: "1px solid transparent",
                                                position: "relative",
                                            }}
                                            onMouseEnter={e => {
                                                if (!active)
                                                    e.currentTarget.style.background =
                                                        "var(--line-2)";
                                            }}
                                            onMouseLeave={e => {
                                                if (!active)
                                                    e.currentTarget.style.background =
                                                        "transparent";
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
                                                        color: active
                                                            ? "var(--accent-ink)"
                                                            : "var(--ink)",
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
                                                background: reverting
                                                    ? "var(--line)"
                                                    : "var(--accent)",
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

                            <div
                                style={{ borderTop: "1px solid var(--line)", padding: "14px 16px" }}
                            >
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
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                            }}
                                        >
                                            <IconFolder size={10} />
                                            {source.folder || "Unfiled"}
                                        </span>
                                    }
                                />
                                <MetaRow
                                    label="Indexed"
                                    value={
                                        <span style={{ color: "var(--ok)" }}>✓ ready to query</span>
                                    }
                                />
                            </div>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}

/**
 * The sidebar for a mindmap: snapshot history from the editor's explicit
 * saves, and the same Details block every source gets — with "Indexed"
 * replaced by whether answers can cite this map right now.
 */
function MindmapHistory({ source, rows }: { source: WorkspaceSource; rows: RevisionRow[] }) {
    const citability = source.citability ?? "citable";
    return (
        <div style={{ flex: 1, overflowY: "auto" }}>
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
                    Snapshots saved from the editor. Restore one from its History panel.
                </div>
            </div>
            <div style={{ padding: "0 10px 16px" }}>
                {rows.length === 0 && (
                    <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-3)" }}>
                        No snapshots yet — ⌘S in the editor writes one.
                    </div>
                )}
                {rows.map((row, index) => (
                    <div
                        key={row.id}
                        style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            marginBottom: 2,
                            background: index === 0 ? "var(--accent-soft)" : "transparent",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 2,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: index === 0 ? "var(--accent-ink)" : "var(--ink)",
                                }}
                            >
                                r{row.revision}
                                {index === 0 ? " (latest)" : ""}
                            </span>
                            <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                                {humanDate(row.createdAt)}
                            </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>
                            {row.label ?? `${row.nodeCount} shape${row.nodeCount === 1 ? "" : "s"}`}
                        </div>
                    </div>
                ))}
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
                {source.added && <MetaRow label="Edited" value={source.added} />}
                {source.size && <MetaRow label="Size" value={source.size} />}
                <MetaRow
                    label="Folder"
                    value={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <IconFolder size={10} />
                            {source.folder || "Unfiled"}
                        </span>
                    }
                />
                <MetaRow
                    label="Citable"
                    value={
                        citability === "citable" ? (
                            <span style={{ color: "var(--ok)" }}>✓ answers can cite it</span>
                        ) : citability === "stale" ? (
                            <span style={{ color: "var(--warn)" }}>changes not yet citable</span>
                        ) : (
                            <span style={{ color: "var(--ink-3)" }}>not yet</span>
                        )
                    }
                />
            </div>
        </div>
    );
}

/**
 * Project a list of server-side `documentNotes` rows down to the minimal
 * shape the PDF overlay needs. Only notes with a `pdf` primary anchor can
 * render as pins; the rest show up in the sidebar list only.
 */
function toPdfNoteLites(notes: DocumentNote[]): PdfNoteLite[] {
    return notes
        .map(n => {
            const anchor = n.anchor as {
                type?: string;
                primary?: {
                    kind?: string;
                    page?: number;
                    quads?: Array<[number, number, number, number]>;
                };
                quote?: { exact?: string };
            } | null;
            if (!anchor?.primary || anchor.primary.kind !== "pdf") return null;
            const page = typeof anchor.primary.page === "number" ? anchor.primary.page : null;
            if (page === null) return null;
            const quads = Array.isArray(anchor.primary.quads) ? anchor.primary.quads : [];
            if (quads.length === 0) return null;
            const lite: PdfNoteLite = {
                id: n.id,
                title: n.title ?? null,
                page,
                quads,
                quote: anchor.quote?.exact,
                anchorStatus: (n.anchorStatus ?? "resolved") as "resolved" | "drifted" | "orphaned",
            };
            return lite;
        })
        .filter((x): x is PdfNoteLite => x !== null);
}
