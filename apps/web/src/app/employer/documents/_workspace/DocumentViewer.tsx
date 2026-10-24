"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
    Folder as IconFolder,
    PanelRightClose,
    Pencil,
    Sparkles,
    Trash2,
    Upload,
    Users,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { useAuth } from "~/lib/auth-client";
import { usePeople } from "~/lib/profile/use-people";
import { IconDrive } from "~/components/icons/brand";
import {
    GoogleDriveBanner,
    setDriveBarHidden,
    useDriveLinkSummary,
    useDriveBarHidden,
    useDriveLinkStatus,
} from "./GoogleDriveBanner";
import type { DocumentType } from "../types/document";
import { getMindmap, MindmapRequestError } from "../_mindmap/lib/api";
import { openMindmapDocument } from "../_mindmap/lib/open";
import type { MindmapDoc } from "../_mindmap/model/types";
import type { RevisionRow } from "../_mindmap/ui/HistoryPanel";
import { isMindmapSource } from "./sourceApi";
import { canChangeSource, canDeleteSource } from "./sourceContextMenu";
import { audienceLabel } from "./railSections";
import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";
import {
    buildDocumentMenuItems,
    buildVersionMenuItems,
    type DocumentTargetData,
} from "./documentContextMenu";
import {
    SOURCE_META,
    sourceTypeLabel,
    type CitationHighlight,
    type PassageSelection,
    type WorkspaceSource,
    type WorkspaceTranslator,
} from "./types";
import { DocumentViewerHeader, type HeaderAction } from "./DocumentViewerHeader";
import { DocumentNotesPanel, type PrefilledAnchor } from "~/components/notes/DocumentNotesPanel";
import type { DocumentNote } from "~/server/db/schema";
import { getDocumentDisplayType } from "../types/document";
import type { PdfAnchorCapture, PdfNoteLite } from "~/components/notes/PdfViewerWithNotes";

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
    // Source-shaped rather than id-shaped: a mindmap has no document id
    // until it is published, so the id could not identify one.
    onRename: (source: WorkspaceSource, title: string) => Promise<boolean>;
    onDelete: (source: WorkspaceSource) => void;
    /** "Share" — the Share dialog: who can open this file, and at what level. */
    onRestrictAccess?: (source: WorkspaceSource) => void;
    onAskAbout: (source: WorkspaceSource) => void;
    /**
     * "Ask AI" on a selected passage: the passage (with its page) goes to the
     * chat as a card above the question, and the document stays in view. Absent, the PDF selection
     * popup offers only "+ Note".
     */
    onAskAboutPassage?: (source: WorkspaceSource, selection: PassageSelection) => void;
    onVersionChanged?: () => void;
    /** Mindmaps only: leave the preview for the editor. */
    onEdit?: (source: WorkspaceSource) => void;
    /** Mindmaps only: the citable copy was created or updated. */
    onPublished?: () => void;
    /** Mindmaps only: open straight into the branch-by-branch presenter. */
    present?: boolean;
    onExitPresent?: () => void;
}

/**
 * Below this width the versions-and-notes rail stops docking beside the
 * document and slides over it instead: 320px of rail plus a readable page
 * needs roughly this much.
 */
const NARROW_BELOW_PX = 760;

/** Remembers a reader's choice to hide the docked rail. Per browser, on purpose. */
const DETAILS_HIDDEN_KEY = "documentViewer.detailsHidden.v1";

/**
 * The server's sentence for a failed version write. A Drive-linked document
 * answers with a code in `error` (`linked_to_google_drive`) and the sentence,
 * in the reader's language, in `details`; elsewhere `details` is diagnostic.
 */
async function failureSentence(res: Response): Promise<string | undefined> {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown; details?: unknown };
    if (typeof body.error !== "string") return undefined;
    const isCode = /^[a-z_]+$/.test(body.error);
    return isCode && typeof body.details === "string" ? body.details : body.error;
}

/** Gives one version row its own right-click target without touching its markup. */
function VersionTarget({
    version,
    reverting,
    onPreview,
    onRestore,
    children,
}: {
    version: VersionRow;
    reverting: boolean;
    onPreview: () => void;
    onRestore: () => void;
    children: ReactNode;
}) {
    const t = useTranslations("workspace");
    const ctxTarget = useContextTarget({
        kind: "document-version",
        id: String(version.id),
        label: t("documentViewer.versionActions", { number: version.versionNumber }),
        data: version,
        items: () =>
            buildVersionMenuItems(
                version,
                { reverting },
                {
                    onPreview,
                    onRestore,
                    onDownload: () => window.open(version.url, "_blank", "noopener,noreferrer"),
                },
                t
            ),
    });
    return (
        <div {...ctxTarget} style={{ display: "contents" }}>
            {children}
        </div>
    );
}

/** "2h ago", "Yesterday", "5 days ago", then a date — in the reader's language. */
function useHumanDate(): (raw: string) => string {
    const t = useTranslations("workspace.relativeTime");
    const format = useFormatter();
    return useCallback(
        (raw: string) => {
            if (!raw) return "";
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) return raw;
            const diffMs = Date.now() - d.getTime();
            const diffHr = Math.floor(diffMs / 3_600_000);
            if (diffHr < 1) return t("justNow");
            if (diffHr < 24) return t("hoursAgo", { count: diffHr });
            const diffDay = Math.floor(diffHr / 24);
            if (diffDay === 1) return t("yesterday");
            if (diffDay < 14) return t("daysAgo", { count: diffDay });
            return format.dateTime(d);
        },
        [t, format]
    );
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
    present = false,
    onExitPresent,
    onRename,
    onDelete,
    onRestrictAccess,
    onAskAbout,
    onAskAboutPassage,
    onVersionChanged,
    onEdit,
    onPublished,
}: DocumentViewerProps) {
    const router = useRouter();
    const t = useTranslations("workspace");
    const tc = useTranslations("common");
    const tSourceTypes = useTranslations("sources.sourceTypes");
    const tAudience = useTranslations("sources.audience");
    const tSourceMenu = useTranslations("sources.contextMenu");
    const tMindmapErrors = useTranslations("mindmap.errors");
    const tDrive = useTranslations("sources.googleDriveBanner");
    const driveLinkSummary = useDriveLinkSummary();
    /** A new map's starter text, read by the fetch without making it re-run. */
    const starter = useTranslations("mindmap.starter");
    const starterRef = useRef(starter);
    starterRef.current = starter;
    const humanDate = useHumanDate();
    const { userId } = useAuth();
    const sourceType = SOURCE_META[source.type] ? source.type : "doc";
    const meta = SOURCE_META[sourceType];
    const Icon = meta.Icon;
    // A mindmap is its own row: no document to fetch, no file versions, and
    // notes only once it has a published copy to hang them on.
    const isMindmap = isMindmapSource(source);
    const persisted = isMindmap
        ? typeof source.mindmapId === "number" && source.mindmapId > 0
        : typeof source.documentId === "number" && source.documentId > 0;
    // ADR-014: a file shared with you to view opens, but does not rename or delete.
    const editable = canChangeSource(source);
    const deletable = canDeleteSource(source);
    // "Added by Ada · 2h ago", under the title — the name as they appear in
    // this workspace now. A map's published copy was made by whoever
    // published it, not whoever drew it, so maps say nothing here.
    const adder = !isMindmap ? (source.addedBy ?? null) : null;
    const adderLook = usePeople(adder && adder.authUserId !== userId ? [adder.authUserId] : []);
    const adderName = adder
        ? adder.authUserId === userId
            ? t("documentViewer.you")
            : (adderLook[adder.authUserId]?.displayName ?? adder.name)
        : null;
    const addedLine =
        adderName === null
            ? null
            : source.added
              ? t("documentViewer.addedByWithTime", { name: adderName, time: source.added })
              : t("documentViewer.addedBy", { name: adderName });
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
    /** A restore or delete that has been asked for, pending the confirm dialog. */
    const [confirming, setConfirming] = useState<
        { action: "restore"; versionId: number } | { action: "delete" } | null
    >(null);
    const [fullDoc, setFullDoc] = useState<DocumentType | null>(null);
    /** A `failureText`, worded in the reader's language where it is shown. */
    const [fullDocError, setFullDocError] = useState<string | null>(null);
    const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [sidebarTab, setSidebarTab] = useState<"versions" | "notes">("versions");
    /**
     * Versions and notes sit in a 320px rail beside the document. In a Studio
     * column that can be most of the width, so below this the rail becomes a
     * panel the Details button slides over the document instead.
     */
    const rootRef = useRef<HTMLDivElement>(null);
    const [viewerWidth, setViewerWidth] = useState(0);
    const narrow = viewerWidth > 0 && viewerWidth < NARROW_BELOW_PX;
    useEffect(() => {
        const element = rootRef.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        // Measured as an overlay too, not only in a column: on a phone the
        // full-screen preview is just as narrow, and a docked 320px rail
        // there left the document a sliver beside it.
        const observer = new ResizeObserver(([entry]) => {
            const width = entry?.contentRect.width ?? 0;
            // A pane with no box — hidden, or mid-reparent — has no layout
            // question to answer.
            if (width > 0) setViewerWidth(Math.round(width));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    /**
     * Whether versions and notes are showing. Wide, the rail is docked and
     * shown unless the reader hid it — a choice remembered across documents,
     * since someone who reads without it wants that everywhere. Narrow, it
     * is an overlay, shut until asked for, and never remembered: opening it
     * there is always for one thing.
     */
    const [dockHidden, setDockHidden] = useState(false);
    const [overlayOpen, setOverlayOpen] = useState(false);
    useEffect(() => {
        try {
            if (localStorage.getItem(DETAILS_HIDDEN_KEY) === "1") setDockHidden(true);
        } catch {
            // Private mode / blocked storage — fall back to shown.
        }
    }, []);
    const detailsVisible = narrow ? overlayOpen : !dockHidden;
    const setDetailsVisible = useCallback(
        (visible: boolean) => {
            if (narrow) {
                setOverlayOpen(visible);
                return;
            }
            setDockHidden(!visible);
            try {
                localStorage.setItem(DETAILS_HIDDEN_KEY, visible ? "0" : "1");
            } catch {
                // Quota / private mode — the choice just is not remembered.
            }
        },
        [narrow]
    );

    /**
     * The Google Drive line over a linkable document. It can be hidden — a
     * choice remembered across documents, like the rail — and the header's
     * Drive button brings it back, so nothing it offers is lost with it.
     */
    const driveDocumentId =
        !isMindmap && typeof source.documentId === "number" && source.documentId > 0
            ? source.documentId
            : null;
    const drive = useDriveLinkStatus(driveDocumentId);
    const driveBarHidden = useDriveBarHidden();
    const driveLink = drive.status?.link ?? null;
    /**
     * Bring the rail into view for something that happens in it — a new
     * note's draft, a pin's card. Not remembered: it is shown for this, and
     * the reader's own choice stands for the next document.
     */
    const showDetails = useCallback(() => {
        setOverlayOpen(true);
        setDockHidden(false);
    }, []);
    const [pdfNotes, setPdfNotes] = useState<DocumentNote[]>([]);
    const [notesNonce, setNotesNonce] = useState(0);
    const [pdfAnchorDraft, setPdfAnchorDraft] = useState<PrefilledAnchor | null>(null);
    const [pdfScrollToNoteId, setPdfScrollToNoteId] = useState<number | null>(null);
    /**
     * A note click locates its passage by text, the same way a citation does.
     * Kept separate from the `highlight` prop so a later citation click wins:
     * the prop is the shell's intent, this is the panel's.
     */
    const [noteHighlight, setNoteHighlight] = useState<CitationHighlight | null>(null);

    // A new citation from the shell supersedes whatever note was being shown.
    useEffect(() => {
        if (highlight) setNoteHighlight(null);
    }, [highlight]);
    /** A passage handed to the notes panel by the context menu, as a new note's body. */
    const [noteSeed, setNoteSeed] = useState<string | null>(null);
    /** The PDF viewer's current selection, so a note started from the menu keeps its anchor. */
    const pdfSelection = useRef<PdfAnchorCapture | null>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);

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
                if (!res.ok) throw new StatusError(res.status);
                const data = (await res.json()) as DocumentType[];
                if (cancelled) return;
                setFullDoc(data.find(d => d.id === source.documentId) ?? null);
            } catch (err) {
                if (!cancelled) setFullDocError(failureText(err));
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
                const { doc } = openMindmapDocument(detail, starterRef.current);
                setMindmapDoc({ doc, key: `${detail.id}:${detail.revision}` });
            } catch (err) {
                if (!cancelled) setMindmapError(failureText(err));
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
                    ? t("documentViewer.publishedNew")
                    : t("documentViewer.publishedUpdate")
            );
            onPublished?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("documentViewer.publishFailed"));
        } finally {
            setPublishing(false);
        }
    }, [onPublished, source.citability, source.folder, source.mindmapId, t]);

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
    // the user can type the body without hunting for the sidebar. Switching
    // the tab is not enough in a narrow column — beside the chat, where Ask AI
    // now puts documents — because the whole panel is folded away there, and
    // "+ Note" opened a draft nobody could see.
    useEffect(() => {
        if (!pdfAnchorDraft && !noteSeed) return;
        setSidebarTab("notes");
        showDetails();
    }, [pdfAnchorDraft, noteSeed, showDetails]);

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
                    throw new StatusError(res.status);
                }
                const data = (await res.json()) as VersionsResponse;
                if (cancelled) return;
                setVersions(data.versions);
                setActiveVersionId(data.currentVersionId);
                setExpectedMime(data.fileType);
            } catch (err) {
                if (!cancelled) setVersionsError(failureText(err));
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
                    message: t("documentViewer.upload.typeMismatch", {
                        expected: expectedMime,
                        actual: file.type || t("documentViewer.upload.unknownType"),
                    }),
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
                                ? t("documentViewer.upload.signIn")
                                : t("documentViewer.upload.storageFailed", { status: xhr.status }),
                    });
                    return;
                }

                let storage: { url: string } | null = null;
                try {
                    storage = JSON.parse(xhr.responseText) as { url: string };
                } catch {
                    setUploadState({
                        phase: "error",
                        message: t("documentViewer.upload.invalidStorage"),
                    });
                    return;
                }
                if (!storage?.url) {
                    setUploadState({ phase: "error", message: t("documentViewer.upload.noUrl") });
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
                            throw new Error(
                                (await failureSentence(res)) ??
                                    t("documentViewer.failedStatus", { status: res.status })
                            );
                        }
                        setUploadState({ phase: "idle" });
                        await refreshVersions();
                        onVersionChanged?.();
                    } catch (err) {
                        setUploadState({
                            phase: "error",
                            message:
                                err instanceof Error
                                    ? err.message
                                    : t("documentViewer.upload.versionFailed"),
                        });
                    }
                })();
            };
            xhr.ontimeout = () =>
                setUploadState({ phase: "error", message: t("documentViewer.upload.timedOut") });
            xhr.onerror = () =>
                setUploadState({ phase: "error", message: t("documentViewer.upload.unavailable") });
            xhr.send(storageForm);
        },
        [source.documentId, expectedMime, uploadState.phase, refreshVersions, onVersionChanged, t]
    );

    const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) uploadNewVersion(file);
    };

    const requestRestore = (versionId: number) => {
        if (!source.documentId) return;
        setConfirming({ action: "restore", versionId });
    };

    const restoreVersion = async (versionId: number) => {
        if (!source.documentId) return;
        setReverting(true);
        try {
            const res = await fetch(
                `/api/documents/${source.documentId}/versions/${versionId}/revert`,
                { method: "POST" }
            );
            if (!res.ok) {
                throw new Error(
                    (await failureSentence(res)) ??
                        t("documentViewer.failedStatus", { status: res.status })
                );
            }
            await refreshVersions();
            onVersionChanged?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("documentViewer.restoreFailed"));
        } finally {
            setReverting(false);
        }
    };

    const deleteDocument = () => {
        if (!persisted) return;
        setConfirming({ action: "delete" });
    };

    const openOriginal = () => {
        if (isMindmap) {
            if (editable) onEdit?.(source);
            return;
        }
        if (!source.documentId) return;
        router.push(`/employer/documents/viewer?docId=${source.documentId}`);
    };

    const notesAvailable = !isMindmap || Boolean(source.documentId);
    const addNote = useCallback((text: string) => {
        setSidebarTab("notes");
        // In a PDF the selection carries its page and quads: anchor the note
        // there, exactly as the viewer's own "+ Note" button would.
        const anchored = pdfSelection.current;
        if (anchored && anchored.quote.exact === text) {
            setPdfAnchorDraft({
                page: anchored.page,
                quads: anchored.quads,
                quote: anchored.quote,
            });
            return;
        }
        setNoteSeed(text);
    }, []);

    /**
     * The whole viewer is one right-click target; version rows and note
     * cards inside it declare their own and win when clicked directly.
     */
    const documentTarget = useContextTarget<DocumentTargetData>({
        kind: "document",
        id: source.id,
        label: t("common.actionsFor", { name: source.title }),
        data: { source, addNote: persisted && notesAvailable ? addNote : undefined },
        items: () =>
            buildDocumentMenuItems(
                source,
                {
                    isMindmap,
                    askable: !isMindmap || source.citability !== "none",
                    persisted,
                    editable,
                    originalUrl: fullDoc?.url ?? null,
                },
                {
                    onAskAbout: () => onAskAbout(source),
                    onRename: () => {
                        titleInputRef.current?.focus();
                        titleInputRef.current?.select();
                    },
                    onOpenInNewTab: source.documentId
                        ? () =>
                              window.open(
                                  `/employer/documents/viewer?docId=${source.documentId}`,
                                  "_blank",
                                  "noopener,noreferrer"
                              )
                        : undefined,
                    onDownload: () => {
                        if (fullDoc?.url) window.open(fullDoc.url, "_blank", "noopener,noreferrer");
                    },
                    onCopyLink: () => {
                        const link = `${window.location.origin}/employer/documents?source=${encodeURIComponent(source.id)}`;
                        void copyText(link).then(ok => {
                            if (ok) toast.success(t("common.linkCopied"));
                        });
                    },
                    onShowVersions: () => setSidebarTab("versions"),
                    onShowNotes: notesAvailable ? () => setSidebarTab("notes") : undefined,
                    onRestrictAccess: onRestrictAccess ? () => onRestrictAccess(source) : undefined,
                    onDelete: deleteDocument,
                },
                t
            ),
    });

    const statusText =
        saveStatus === "saving"
            ? tc("status.saving")
            : saveStatus === "saved"
              ? tc("status.saved")
              : saveStatus === "error"
                ? t("documentViewer.saveFailed")
                : dirty
                  ? t("documentViewer.unsaved")
                  : tc("status.saved");
    const statusColor =
        saveStatus === "error"
            ? "var(--danger)"
            : dirty || saveStatus === "saving"
              ? "var(--accent)"
              : "var(--ok)";

    /** The header's buttons, in the order they give way when room runs out. */
    const headerActions: HeaderAction[] = [
        // A draft someone can only view opens here and nowhere else: its
        // folder gives them no edit, so the editor would refuse every save.
        ...(isMindmap && onEdit && editable
            ? [
                  {
                      id: "edit",
                      label: tc("actions.edit"),
                      icon: <Pencil className="size-3.5" />,
                      onSelect: () => onEdit(source),
                      tone: "primary" as const,
                      testId: "viewer-edit-mindmap",
                  },
              ]
            : []),
        ...(isMindmap && editable && source.citability !== "citable"
            ? [
                  {
                      id: "publish",
                      label: publishing
                          ? t("documentViewer.publishing")
                          : source.citability === "stale"
                            ? t("documentViewer.updateCitable")
                            : t("documentViewer.makeCitable"),
                      icon: <Upload className="size-3.5" />,
                      onSelect: () => void publishMindmap(),
                      disabled: publishing || !persisted,
                      hint:
                          source.citability === "stale"
                              ? t("documentViewer.staleHint")
                              : t("documentViewer.indexHint"),
                  },
              ]
            : []),
        ...(!isMindmap || source.citability !== "none"
            ? [
                  {
                      id: "ask",
                      label: t("documentViewer.askAbout"),
                      icon: <Sparkles className="size-3.5" />,
                      onSelect: () => onAskAbout(source),
                      testId: "viewer-ask",
                  },
              ]
            : []),
        ...(onRestrictAccess
            ? [
                  {
                      id: "share",
                      label: tc("actions.share"),
                      icon: <Users className="size-3.5" />,
                      onSelect: () => onRestrictAccess(source),
                      disabled: !persisted,
                      // Who can open it now, on hover: "Only you", "Shared with 3"…
                      hint: source.access
                          ? t("documentViewer.shareHint", {
                                audience: audienceLabel(source.access, null, tAudience),
                            })
                          : tc("actions.share"),
                      testId: "viewer-share",
                  },
              ]
            : []),
        ...(drive.status?.linkable
            ? [
                  {
                      id: "drive",
                      label: driveBarHidden ? tDrive("show") : tDrive("hide"),
                      icon: <IconDrive size={14} />,
                      onSelect: () => setDriveBarHidden(!driveBarHidden),
                      iconOnly: true,
                      tone: driveBarHidden ? undefined : ("on" as const),
                      // Hidden, the line's one essential fact — how fresh this
                      // copy is — still answers a hover.
                      hint: driveBarHidden
                          ? driveLink
                              ? tDrive("summaryShowHint", { summary: driveLinkSummary(driveLink) })
                              : tDrive("showHint")
                          : tDrive("hideToggleHint"),
                      testId: "viewer-drive-toggle",
                  },
              ]
            : []),
        {
            id: "delete",
            label: t("documentViewer.deleteDocument"),
            icon: <Trash2 className="size-3.5" />,
            onSelect: deleteDocument,
            iconOnly: true,
            tone: "danger",
            disabled: !deletable,
            hint: !editable
                ? t("common.viewOnly")
                : deletable
                  ? undefined
                  : tSourceMenu("deleteReserved"),
            testId: "viewer-delete",
        },
    ];

    const currentVersion = versions.find(v => v.id === activeVersionId);
    const viewingOld = activeVersionId !== null && currentVersion && !currentVersion.isCurrent;
    const restoring = confirming?.action === "restore";

    return (
        <div
            {...documentTarget}
            ref={rootRef}
            data-testid="document-viewer"
            data-narrow={narrow ? "true" : undefined}
            onKeyDown={e => {
                // An open overlay rail is the nearest thing to dismiss:
                // Escape shuts it. A dialog over it (the confirm) has already
                // handled it.
                if (e.key === "Escape" && !e.defaultPrevented && narrow && overlayOpen) {
                    e.preventDefault();
                    setOverlayOpen(false);
                }
            }}
            style={{
                // A tab's panel: one column among several, which it must not escape.
                position: "relative",
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                background: "var(--bg)",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <DocumentViewerHeader
                width={viewerWidth}
                kindIcon={<Icon size={13} />}
                kindColor={meta.color}
                title={
                    <input
                        ref={titleInputRef}
                        value={title}
                        aria-label={tc("fields.title")}
                        onChange={e => {
                            setTitle(e.target.value);
                            setDirty(true);
                        }}
                        onBlur={() => void saveTitle()}
                        readOnly={!editable}
                        title={editable ? undefined : t("common.viewOnly")}
                        // A class, not an imperative style: the old onFocus
                        // painted the field grey and nothing painted it back.
                        className="text-ink focus:bg-line-2 block w-full rounded bg-transparent px-1 text-sm font-semibold leading-[18px] outline-none read-only:focus:bg-transparent"
                    />
                }
                meta={
                    <>
                        <span>{sourceTypeLabel(tSourceTypes, sourceType)}</span>
                        <span>·</span>
                        {addedLine ? (
                            <span className="truncate" data-testid="viewer-added-by">
                                {addedLine}
                            </span>
                        ) : (
                            <span className="mono">{source.size || source.added || ""}</span>
                        )}
                        <span>·</span>
                    </>
                }
                status={{ text: statusText, color: statusColor }}
                actions={headerActions}
                details={{
                    visible: detailsVisible,
                    onToggle: () => setDetailsVisible(!detailsVisible),
                }}
            />

            <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    {driveDocumentId !== null && !driveBarHidden && (
                        <GoogleDriveBanner
                            documentId={driveDocumentId}
                            status={drive.status}
                            refresh={drive.refresh}
                            onHide={() => {
                                setDriveBarHidden(true);
                                toast(tDrive("hidden"), {
                                    description: tDrive("hiddenBody"),
                                });
                            }}
                        />
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
                            {t("documentViewer.previewingBanner", {
                                number: currentVersion?.versionNumber ?? 0,
                            })}
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
                                <MindmapPreview
                                    key={mindmapDoc.key}
                                    doc={mindmapDoc.doc}
                                    present={present}
                                    onExitPresent={onExitPresent}
                                />
                            </div>
                        ) : mindmapError ? (
                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: "60px 40px",
                                    overflowWrap: "anywhere",
                                    textAlign: "center",
                                    color: "var(--ink-3)",
                                    fontSize: 14,
                                }}
                            >
                                {t("documentViewer.mindmapError", {
                                    error: wordFailure(
                                        t,
                                        mindmapError,
                                        t("documentViewer.openMindmapFailed"),
                                        tMindmapErrors
                                    ),
                                })}
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
                                {t("common.opening")}
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
                            {t("documentViewer.processing")}
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
                                    citationHighlight={noteHighlight ?? highlight ?? null}
                                    scrollToNoteId={pdfScrollToNoteId}
                                    onCreateAnchoredNote={anchor => {
                                        setPdfAnchorDraft({
                                            page: anchor.page,
                                            quads: anchor.quads,
                                            quote: anchor.quote,
                                        });
                                    }}
                                    onAskAi={
                                        onAskAboutPassage
                                            ? selection => onAskAboutPassage(source, selection)
                                            : undefined
                                    }
                                    onNotePinClick={id => {
                                        setPdfScrollToNoteId(id);
                                        setSidebarTab("notes");
                                        // A pin opens its card, so the rail
                                        // holding it has to be showing.
                                        showDetails();
                                    }}
                                    onSelectionDraft={draft => {
                                        pdfSelection.current = draft;
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
                                overflowWrap: "anywhere",
                                color: "var(--ink-3)",
                                fontSize: 14,
                            }}
                        >
                            <div>
                                {t("documentViewer.previewError", {
                                    error: wordFailure(
                                        t,
                                        fullDocError,
                                        t("documentViewer.loadPreviewFailed")
                                    ),
                                })}
                            </div>
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
                                {t("documentViewer.openStandalone")}
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
                            {t("documentViewer.loadingPreview")}
                        </div>
                    )}
                </div>

                <aside
                    hidden={!detailsVisible}
                    data-testid="viewer-details"
                    style={{
                        width: 320,
                        maxWidth: "100%",
                        flexShrink: 0,
                        borderLeft: "1px solid var(--line)",
                        background: "var(--panel)",
                        display: detailsVisible ? "flex" : "none",
                        flexDirection: "column",
                        overflow: "hidden",
                        // Over the document rather than squeezing it, once
                        // there is not enough width for both.
                        ...(narrow
                            ? {
                                  position: "absolute",
                                  top: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 2,
                                  boxShadow: "var(--shadow-3)",
                              }
                            : null),
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
                            label={t("documentViewer.versionsTab")}
                            count={isMindmap ? revisions.length : versions.length}
                            active={sidebarTab === "versions"}
                            onClick={() => setSidebarTab("versions")}
                        />
                        {/* Notes hang off a document id; an unpublished map has none yet. */}
                        {(!isMindmap || Boolean(source.documentId)) && (
                            <TabButton
                                label={t("documentViewer.notesTab")}
                                active={sidebarTab === "notes"}
                                onClick={() => setSidebarTab("notes")}
                            />
                        )}
                        {/* Hide from where the eye already is, as well as
                            from the header's toggle. */}
                        <button
                            type="button"
                            onClick={() => setDetailsVisible(false)}
                            aria-label={t("documentViewerHeader.hideDetails")}
                            title={t("documentViewerHeader.hideDetails")}
                            data-testid="viewer-details-hide"
                            style={{
                                marginLeft: "auto",
                                alignSelf: "center",
                                width: 26,
                                height: 26,
                                borderRadius: 6,
                                color: "var(--ink-3)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                            }}
                        >
                            <PanelRightClose size={13} />
                        </button>
                    </div>

                    {sidebarTab === "notes" && (!isMindmap || Boolean(source.documentId)) ? (
                        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                            <DocumentNotesPanel
                                documentId={source.documentId ? String(source.documentId) : null}
                                versionId={activeVersionId}
                                prefilledAnchor={pdfAnchorDraft}
                                prefilledText={noteSeed}
                                // Set by a card click and by a pin click in
                                // the page, so the open card and the shown
                                // passage always name the same note.
                                activeNoteId={pdfScrollToNoteId}
                                onChanged={() => {
                                    setNotesNonce(n => n + 1);
                                    setPdfAnchorDraft(null);
                                    setNoteSeed(null);
                                }}
                                onNoteClick={({ id, page, quote, located }) => {
                                    // A note made from a selection knows where
                                    // it is, and its own pin already draws the
                                    // passage — scroll there. Searching for the
                                    // quote instead found its first copy, which
                                    // in a repetitive document is some other
                                    // line entirely.
                                    if (located) {
                                        setNoteHighlight(null);
                                        setPdfScrollToNoteId(id);
                                    } else if (quote) {
                                        // No position: agent-captured notes store
                                        // page 1 with no quads, so the quote is
                                        // the only thing that can find them.
                                        setNoteHighlight({
                                            text: quote,
                                            page: null,
                                            nonce: Date.now(),
                                        });
                                        setPdfScrollToNoteId(id);
                                    } else if (page !== null) {
                                        setPdfScrollToNoteId(id);
                                    }
                                }}
                                onDeleted={id => {
                                    // The highlight a note click drew belongs to
                                    // that note; left in place it outlived it,
                                    // marking a passage nothing annotates.
                                    if (id !== pdfScrollToNoteId) return;
                                    setNoteHighlight(null);
                                    setPdfScrollToNoteId(null);
                                }}
                            />
                        </div>
                    ) : isMindmap ? (
                        <MindmapHistory source={source} rows={revisions} humanDate={humanDate} />
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
                                    {t("documentViewer.versionHistory")}
                                </div>
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: "var(--ink-3)",
                                        marginTop: 2,
                                        marginBottom: 10,
                                    }}
                                >
                                    {t("documentViewer.uploadedRevisions")}
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
                                        ? t("documentViewer.uploadingPercent", {
                                              percent: uploadState.percent,
                                          })
                                        : uploadState.phase === "finalizing"
                                          ? t("documentViewer.indexingVersion")
                                          : t("documentViewer.uploadNewVersion")}
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
                                        {t("documentViewer.mustMatch", { mime: expectedMime })}
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
                                        {wordFailure(
                                            t,
                                            versionsError,
                                            t("documentViewer.loadVersionsFailed")
                                        )}
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
                                        {t("documentViewer.noVersions")}
                                    </div>
                                )}
                                {versions.map(v => {
                                    const active = v.id === activeVersionId;
                                    return (
                                        <VersionTarget
                                            key={v.id}
                                            version={v}
                                            reverting={reverting}
                                            onPreview={() => {
                                                setActiveVersionId(v.id);
                                                if (!v.isCurrent) previewVersion(v.id);
                                            }}
                                            onRestore={() => requestRestore(v.id)}
                                        >
                                            <button
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
                                                        {v.isCurrent
                                                            ? t("documentViewer.versionCurrent", {
                                                                  number: v.versionNumber,
                                                              })
                                                            : t("documentViewer.versionLabel", {
                                                                  number: v.versionNumber,
                                                              })}
                                                    </span>
                                                    <span
                                                        className="mono"
                                                        style={{
                                                            fontSize: 10,
                                                            color: "var(--ink-3)",
                                                        }}
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
                                        </VersionTarget>
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
                                            {t("documentViewer.previewingShort", {
                                                number: currentVersion.versionNumber,
                                            })}
                                        </div>
                                        <button
                                            disabled={reverting}
                                            onClick={() => requestRestore(currentVersion.id)}
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
                                            {reverting
                                                ? t("documentViewer.restoring")
                                                : t("documentViewer.restoreThis")}
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
                                    {t("documentViewer.details")}
                                </div>
                                {source.added && (
                                    <MetaRow
                                        label={t("documentViewer.metaAdded")}
                                        value={source.added}
                                    />
                                )}
                                {source.size && (
                                    <MetaRow
                                        label={t("documentViewer.metaSize")}
                                        value={source.size}
                                    />
                                )}
                                <MetaRow
                                    label={t("documentViewer.metaFolder")}
                                    value={
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                            }}
                                        >
                                            <IconFolder size={10} />
                                            {source.folder || t("documentViewer.unfiled")}
                                        </span>
                                    }
                                />
                                <MetaRow
                                    label={t("documentViewer.metaIndexed")}
                                    value={
                                        <span style={{ color: "var(--ok)" }}>
                                            {t("documentViewer.readyToQuery")}
                                        </span>
                                    }
                                />
                            </div>
                        </div>
                    )}
                </aside>
            </div>

            <ConfirmDialog
                open={confirming !== null}
                onOpenChange={next => {
                    if (!next) setConfirming(null);
                }}
                // Above the full-screen preview (z-80), like the header's menu.
                layerClassName="z-[90]"
                title={
                    restoring
                        ? t("documentViewer.confirmRestoreTitle")
                        : isMindmap
                          ? t("documentViewer.confirmTrashTitle", { title: source.title })
                          : t("documentViewer.confirmDeleteTitle", { title: source.title })
                }
                description={
                    restoring
                        ? t("documentViewer.confirmRestoreBody")
                        : isMindmap
                          ? t("documentViewer.confirmTrashBody")
                          : t("documentViewer.confirmDeleteBody")
                }
                confirmLabel={
                    restoring
                        ? tc("actions.restore")
                        : isMindmap
                          ? t("documentViewer.moveToTrash")
                          : tc("actions.delete")
                }
                destructive={!restoring}
                onConfirm={() => {
                    const asked = confirming;
                    setConfirming(null);
                    if (asked?.action === "restore") void restoreVersion(asked.versionId);
                    else if (asked?.action === "delete") onDelete(source);
                }}
            />
        </div>
    );
}

/**
 * The sidebar for a mindmap: snapshot history from the editor's explicit
 * saves, and the same Details block every source gets — with "Indexed"
 * replaced by whether answers can cite this map right now.
 */
function MindmapHistory({
    source,
    rows,
    humanDate,
}: {
    source: WorkspaceSource;
    rows: RevisionRow[];
    humanDate: (raw: string) => string;
}) {
    const t = useTranslations("workspace");
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
                    {t("documentViewer.versionHistory")}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
                    {t("documentViewer.mindmapHistoryHint")}
                </div>
            </div>
            <div style={{ padding: "0 10px 16px" }}>
                {rows.length === 0 && (
                    <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-3)" }}>
                        {t("documentViewer.noSnapshots")}
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
                                {index === 0
                                    ? t("documentViewer.revisionLatest", { number: row.revision })
                                    : t("documentViewer.revisionLabel", { number: row.revision })}
                            </span>
                            <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                                {humanDate(row.createdAt)}
                            </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>
                            {row.label ?? t("sourceRows.shapes", { count: row.nodeCount })}
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
                    {t("documentViewer.details")}
                </div>
                {source.added && (
                    <MetaRow label={t("documentViewer.metaEdited")} value={source.added} />
                )}
                {source.size && (
                    <MetaRow label={t("documentViewer.metaSize")} value={source.size} />
                )}
                <MetaRow
                    label={t("documentViewer.metaFolder")}
                    value={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <IconFolder size={10} />
                            {source.folder || t("documentViewer.unfiled")}
                        </span>
                    }
                />
                <MetaRow
                    label={t("documentViewer.metaCitable")}
                    value={
                        citability === "citable" ? (
                            <span style={{ color: "var(--ok)" }}>
                                {t("documentViewer.citableYes")}
                            </span>
                        ) : citability === "stale" ? (
                            <span style={{ color: "var(--warn)" }}>
                                {t("documentViewer.citableStale")}
                            </span>
                        ) : (
                            <span style={{ color: "var(--ink-3)" }}>
                                {t("documentViewer.citableNo")}
                            </span>
                        )
                    }
                />
            </div>
        </div>
    );
}

/** A failed fetch's HTTP status, worded where it is shown. */
class StatusError extends Error {
    constructor(readonly status: number) {
        super(`HTTP ${status}`);
    }
}

/**
 * What a failed load says, kept out of the reader's language in state so a
 * language switch rewords it: the error's own message, `failed:<status>`
 * for a bare HTTP status, or `failed:` when there is nothing usable.
 */
function failureText(err: unknown): string {
    if (err instanceof StatusError) return `failed:${err.status}`;
    // The mindmap API's own failure, when the server gave no reason.
    if (err instanceof MindmapRequestError && !err.serverMessage)
        return `failed:mindmap:${err.status}`;
    return err instanceof Error && err.message ? err.message : "failed:";
}

/** A `failureText` as the reader sees it, with `fallback` for one that says nothing. */
function wordFailure(
    t: WorkspaceTranslator,
    text: string,
    fallback: string,
    mindmapErrors?: MindmapErrorTranslator
): string {
    if (text === "failed:") return fallback;
    const mindmapStatus = /^failed:mindmap:(\d+)$/.exec(text)?.[1];
    if (mindmapStatus && mindmapErrors)
        return mindmapErrors("requestFailed", { status: mindmapStatus });
    const status = /^failed:(?:mindmap:)?(\d+)$/.exec(text)?.[1];
    return status ? t("documentViewer.failedStatus", { status }) : text;
}

type MindmapErrorTranslator = ReturnType<typeof useTranslations<"mindmap.errors">>;

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
