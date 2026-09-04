"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth, useUser } from "~/lib/auth-client";
import LoadingPage from "~/app/_components/loading";
// A just-signed-out user is a public-site audience, and the public site is a
// separate origin now (apps/landing).
import { LANDING_URL } from "~/config/landing";
import { buildContinuationContext, parseSessionTranscript } from "~/lib/session-transcript";
import { useAIChat } from "../hooks/useAIChat";
import { AccessDialog, folderCategoryId, type AccessTarget } from "./access/AccessDialog";
import { AddSourceModal } from "./AddSourceModal";
import { AskPanel, AvatarMenu, JumpToPaletteButton, workspaceMainHeaderBarStyle } from "./AskPanel";
import { CommandPalette } from "./CommandPalette";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { DocumentViewer } from "./DocumentViewer";
import { IconChevronRight } from "./icons";
import { NewFolderDialog } from "./NewFolderDialog";
import { RenameFolderDialog } from "./RenameFolderDialog";
import { RenameSourceDialog } from "./RenameSourceDialog";
import { SourceRail } from "./SourceRail";
import { StudioDrawer } from "./StudioDrawer";
import { StudioMenu } from "./StudioMenu";
import { renderStudioPane, type StudioPaneContext } from "./StudioPanes";
import { STUDIO_FEATURES_BY_ID } from "./types";
import { useWorkspaceData } from "./useWorkspaceData";
import type {
    CitationHighlight,
    ComposerSend,
    ThreadMessage,
    ThreadReference,
    WorkspaceFolder,
    WorkspaceSource,
} from "./types";

/**
 * Legacy `?view=X` URL params that used to drive the deleted DocumentViewerShell.
 * Studio features now open inline in the workspace drawer via `?feature=X`;
 * upload opens inline in the AddSourceModal via `?add=1`. Admin views redirect
 * to their standalone `/employer/<name>` routes. Values folded into the default
 * workspace map to the workspace root — any `docId` in the URL is preserved so
 * the DocumentViewer modal can pick it up.
 */
const LEGACY_VIEW_REDIRECTS: Record<string, string> = {
    "document-only": "/employer/documents/viewer",
    "with-ai-qa": "/employer/documents",
    "with-ai-qa-history": "/employer/documents",
    "predictive-analysis": "/employer/documents?feature=audit",
    generator: "/employer/documents?feature=draft",
    rewrite: "/employer/documents?feature=rewrite",
    upload: "/employer/documents?add=1",
    dashboard: "/employer/home",
    analytics: "/employer/documents?feature=analytics",
    employees: "/employer/settings#people",
    settings: "/employer/settings",
    metadata: "/employer/documents?feature=metadata",
    "marketing-pipeline": "/employer/tools/marketing-pipeline",
    "repo-explainer": "/employer/tools/repo-explainer",
    notes: "/employer/documents?feature=notes",
    workflows: "/employer/documents?feature=workflows",
    knowledge: "/employer/documents?feature=knowledge",
    meetings: "/employer/documents?feature=meetings",
};

/** Extra horizontal inset for AskPanel / expanded feature headers when rail is hidden (clears overlay “show sidebar” at 12+28px + ~8px gap minus default 20px padding). */
const RAIL_HIDDEN_HEADER_INSET_PX = 28;

/**
 * Features accessible via `?feature=X`. All open the Studio drawer on the
 * corresponding pane; draft/rewrite/workflows/notes remain independently
 * reachable via the AskPanel QuickPen view.
 */
const FEATURE_IDS = new Set([
    "draft",
    "rewrite",
    "notes",
    "workflows",
    "video-gen",
    "image-gen",
    "audio-gen",
    "marketing",
    "knowledge",
    "meetings",
    "metadata",
    "settings",
    "analytics",
]);

function initialsOf(first?: string | null, last?: string | null, email?: string | null) {
    const parts = [first, last].filter(Boolean) as string[];
    if (parts.length > 0) {
        return parts
            .map(p => p[0]?.toUpperCase())
            .join("")
            .slice(0, 2);
    }
    if (email) return email[0]?.toUpperCase() ?? "U";
    return "U";
}

export function WorkspaceShell() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isLoaded, isSignedIn, userId, signOut } = useAuth();
    const { user } = useUser();

    // Legacy `?view=X` URLs redirect to their new destinations. Any other params
    // (docId, versionId, prompt, etc.) are carried across so deep links survive.
    const legacyView = searchParams.get("view");
    const legacyRedirect = legacyView ? LEGACY_VIEW_REDIRECTS[legacyView] : null;

    useEffect(() => {
        if (!legacyRedirect) return;
        const params = new URLSearchParams(searchParams.toString());
        params.delete("view");
        // Some redirects already include a query (e.g. `?feature=X`). Merge, not
        // clobber, so carry-over params land alongside.
        const [basePath, baseQuery] = legacyRedirect.split("?");
        if (baseQuery) {
            for (const [k, v] of new URLSearchParams(baseQuery)) params.set(k, v);
        }
        const query = params.toString();
        router.replace(query ? `${basePath}?${query}` : basePath!);
    }, [legacyRedirect, searchParams, router]);

    // Bounce unauthenticated users out of the workspace. `/` is no longer the
    // landing page on this origin — it redirects to /signin — so this lands them
    // on the sign-in screen rather than a marketing page.
    useEffect(() => {
        if (isLoaded && !isSignedIn) router.push("/");
    }, [isLoaded, isSignedIn, router]);

    const { sources, folders, companyId, refresh } = useWorkspaceData(userId ?? null);

    const [selected, setSelected] = useState<string[]>([]);
    const [thread, setThread] = useState<ThreadMessage[]>([]);
    /**
     * Set when this chat continues an imported agent session (`?continue=<docId>`):
     * the transcript's tail travels as conversationHistory on every send, and
     * the transcript document itself is pinned as a retrieval source.
     */
    const [continuation, setContinuation] = useState<{ title: string; context: string } | null>(
        null
    );
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    /** Which AddSourceModal tab to open on — set by the Knowledge connector strip. */
    const [addTab, setAddTab] = useState<string | undefined>(undefined);
    const [palOpen, setPalOpen] = useState(false);
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [renameFolder, setRenameFolder] = useState<WorkspaceFolder | null>(null);
    const [viewerSource, setViewerSource] = useState<WorkspaceSource | null>(null);
    /** Cited passage to locate + highlight when the viewer was opened from a citation. */
    const [viewerHighlight, setViewerHighlight] = useState<CitationHighlight | null>(null);
    const citationNonce = useRef(0);
    const [renameSource, setRenameSource] = useState<WorkspaceSource | null>(null);
    const [deleteSource, setDeleteSource] = useState<WorkspaceSource | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    /** The folder or document whose access dialog is open. */
    const [accessTarget, setAccessTarget] = useState<AccessTarget | null>(null);
    const [studioOpen, setStudioOpen] = useState(false);
    const [studioFeatureId, setStudioFeatureId] = useState<string | null>(null);
    /**
     * Which feature is "expanded" into the main workspace area. Defaults to
     * `chat`, which renders the AskPanel; any other id renders the corresponding
     * pane inline. Set via the drawer's Expand button or `?feature=X` deep links.
     */
    const [activeFeatureId, setActiveFeatureId] = useState<string>("chat");
    const [railHidden, setRailHidden] = useState(false);
    const railHiddenReady = useRef(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem("workspace.railHidden.v1");
            if (raw === "1") setRailHidden(true);
        } catch {
            // Private mode / corrupt storage — fall back to visible.
        }
        railHiddenReady.current = true;
    }, []);

    useEffect(() => {
        if (!railHiddenReady.current) return;
        try {
            localStorage.setItem("workspace.railHidden.v1", railHidden ? "1" : "0");
        } catch {
            // Quota / private mode — drop silently.
        }
    }, [railHidden]);

    // Composer preferences persisted across reloads so toggling Web/Think
    // doesn't reset on every refresh. Ephemeral attachments are NOT persisted —
    // those are turn-scoped, owned by the Composer.
    const [composerWebSearch, setComposerWebSearch] = useState(false);
    const [composerThinking, setComposerThinking] = useState(false);
    const composerPrefsReady = useRef(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem("askPanel.composer.v1");
            if (raw) {
                const parsed = JSON.parse(raw) as {
                    webSearch?: boolean;
                    thinking?: boolean;
                };
                if (typeof parsed.webSearch === "boolean") setComposerWebSearch(parsed.webSearch);
                if (typeof parsed.thinking === "boolean") setComposerThinking(parsed.thinking);
            }
        } catch {
            // Corrupt storage — fall back to defaults.
        }
        composerPrefsReady.current = true;
    }, []);

    useEffect(() => {
        if (!composerPrefsReady.current) return;
        try {
            localStorage.setItem(
                "askPanel.composer.v1",
                JSON.stringify({
                    webSearch: composerWebSearch,
                    thinking: composerThinking,
                })
            );
        } catch {
            // Quota / private mode — drop silently.
        }
    }, [composerWebSearch, composerThinking]);

    const { sendQuery, loading: isSending } = useAIChat();

    /**
     * Pick up an imported agent session where it left off: pin the transcript
     * document as a source, load its tail into the continuation context, and
     * open the thread with a note saying so. Fired by `?continue=<docId>` from
     * the conversation viewer and the sessions browser.
     */
    const startContinuation = useCallback(async (docId: number) => {
        setActiveFeatureId("chat");
        setSelected(prev => (prev.includes(`d${docId}`) ? prev : [`d${docId}`, ...prev]));
        try {
            const res = await fetch("/api/fetchDocument", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            if (!res.ok) throw new Error(`Failed to fetch documents (${res.status})`);
            const docs = (await res.json()) as { id: number; title: string; url: string }[];
            const doc = docs.find(d => d.id === docId);
            if (!doc) throw new Error("Document not found");

            const contentRes = await fetch(doc.url);
            if (!contentRes.ok) throw new Error(`Failed to load transcript (${contentRes.status})`);
            const parsed = parseSessionTranscript(await contentRes.text());
            const title = parsed.title ?? doc.title;

            setContinuation({ title, context: buildContinuationContext(parsed) });
            setThread(prev => [
                ...prev,
                {
                    role: "assistant",
                    text: `Continuing **${title}** — the imported transcript is pinned as a source and I have the tail of that conversation in context. Pick up wherever you left off.`,
                    refs: [`d${docId}`],
                },
            ]);
        } catch {
            toast.error("Couldn't load the imported session to continue it");
        }
    }, []);

    const sendMessage = useCallback(
        async (send: ComposerSend) => {
            // When continuing an imported session, every send carries the
            // imported tail plus the newest in-app turns. The tail-slice cap
            // keeps recency when the thread outgrows the budget.
            const conversationHistory = continuation
                ? [
                      continuation.context,
                      ...thread
                          .slice(-8)
                          .map(
                              m =>
                                  `${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 1000)}`
                          ),
                  ]
                      .join("\n\n")
                      .slice(-12000)
                : undefined;

            setThread(prev => [
                ...prev,
                {
                    role: "user",
                    text: send.text,
                    refs: send.refs,
                    attachments: send.attachments.length > 0 ? send.attachments : undefined,
                },
            ]);

            const numericIds = send.refs
                .map(r => sources.find(s => s.id === r)?.documentId)
                .filter((n): n is number => typeof n === "number");

            const scope =
                numericIds.length >= 2
                    ? "selected"
                    : numericIds.length === 1
                      ? "document"
                      : companyId
                        ? "company"
                        : "document";

            const data = await sendQuery({
                question: send.text,
                searchScope: scope,
                documentId: scope === "document" ? numericIds[0] : undefined,
                selectedDocumentIds: scope === "selected" ? numericIds : undefined,
                companyId: scope === "company" ? (companyId ?? undefined) : undefined,
                enableWebSearch: send.webSearch,
                thinkingMode: send.thinking,
                conversationHistory,
                attachments: send.attachments.map(a => ({
                    url: a.url,
                    name: a.name,
                    mimeType: a.mimeType,
                    kind: a.kind,
                })),
            });

            if (data.success) {
                const citations = (data.references ?? [])
                    .map((r): ThreadReference | null => {
                        const src = sources.find(s => s.documentId === Number(r.documentId));
                        return src
                            ? {
                                  sourceId: src.id,
                                  snippet: r.snippet ?? "",
                                  page: r.page,
                                  matchText: r.matchText,
                              }
                            : null;
                    })
                    .filter((c): c is ThreadReference => Boolean(c))
                    .slice(0, 4);

                setThread(prev => [
                    ...prev,
                    {
                        role: "assistant",
                        text: data.summarizedAnswer ?? "No answer.",
                        citations,
                        model: data.aiModel,
                        tokens: data.chunksAnalyzed,
                    },
                ]);
            } else {
                setThread(prev => [
                    ...prev,
                    {
                        role: "assistant",
                        text:
                            data.message ??
                            data.error ??
                            "Couldn't reach the model. Try again in a moment.",
                    },
                ]);
            }
        },
        [sources, sendQuery, companyId, continuation, thread]
    );

    const handleOpenSource = useCallback((source: WorkspaceSource) => {
        setViewerHighlight(null);
        setViewerSource(source);
    }, []);

    /** A citation click opens the cited document with the passage highlighted. */
    const handleOpenCitation = useCallback(
        (cite: ThreadReference) => {
            const src = sources.find(s => s.id === cite.sourceId);
            if (!src) return;
            citationNonce.current += 1;
            setViewerHighlight({
                text: cite.snippet,
                matchText: cite.matchText,
                page: cite.page ?? null,
                nonce: citationNonce.current,
            });
            setViewerSource(src);
        },
        [sources]
    );

    const handleRenameDoc = useCallback(
        async (docId: number, nextTitle: string): Promise<boolean> => {
            try {
                const res = await fetch(`/api/documents/${docId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: nextTitle }),
                });
                if (!res.ok) return false;
                await refresh();
                // Keep the viewer in sync with the new title.
                setViewerSource(v =>
                    v && v.documentId === docId ? { ...v, title: nextTitle } : v
                );
                return true;
            } catch {
                return false;
            }
        },
        [refresh]
    );

    const deleteDocumentById = useCallback(
        async (docId: number) => {
            const res = await fetch("/api/deleteDocument", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ docId: String(docId) }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error ?? "Failed to delete document");
            }
            setViewerSource(null);
            setSelected(prev => prev.filter(id => !id.endsWith(String(docId))));
            await refresh();
        },
        [refresh]
    );

    const handleDeleteDoc = useCallback(
        async (docId: number) => {
            try {
                await deleteDocumentById(docId);
            } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to delete document");
            }
        },
        [deleteDocumentById]
    );

    const confirmDeleteSource = useCallback(async () => {
        if (!deleteSource?.documentId) return;
        setDeleteBusy(true);
        setDeleteError(null);
        try {
            await deleteDocumentById(deleteSource.documentId);
            setDeleteSource(null);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : "Failed to delete document");
        } finally {
            setDeleteBusy(false);
        }
    }, [deleteSource, deleteDocumentById]);

    const handleAskAbout = useCallback((source: WorkspaceSource) => {
        setSelected(prev => (prev.includes(source.id) ? prev : [source.id, ...prev]));
        setViewerSource(null);
    }, []);

    const openAdd = useCallback((tabId?: string) => {
        setAddTab(tabId);
        setAddOpen(true);
    }, []);

    const handleMoveToFolder = useCallback(
        async (sourceId: string, folderName: string) => {
            const src = sources.find(s => s.id === sourceId);
            if (!src?.documentId) return;
            if ((src.folder ?? "Unfiled") === folderName) return;
            try {
                const res = await fetch(`/api/documents/${src.documentId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ category: folderName }),
                });
                if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { error?: string };
                    alert(body.error ?? "Failed to move document");
                    return;
                }
                await refresh();
            } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to move document");
            }
        },
        [sources, refresh]
    );

    const openFolderAccess = useCallback((folder: WorkspaceFolder) => {
        const categoryId = folderCategoryId(folder);
        if (categoryId === null) {
            toast.info("Create this folder first — it isn't stored as a category yet.");
            return;
        }
        setAccessTarget({ kind: "folder", id: categoryId, name: folder.name });
    }, []);

    const openDocumentAccess = useCallback((source: WorkspaceSource) => {
        if (!source.documentId) {
            toast.info("This source is still being indexed.");
            return;
        }
        setAccessTarget({ kind: "document", id: source.documentId, name: source.title });
    }, []);

    /** Opens the Studio drawer / sidebar only — used by the header “Studio” control and ⌘J toggle. */
    const openFeature = useCallback(
        (featureId?: string) => {
            setStudioFeatureId(featureId ?? activeFeatureId);
            setStudioOpen(true);
        },
        [activeFeatureId]
    );

    /** Fills the main workspace with a feature and closes the drawer — used by mega-menu picks, palette, FAB pins. */
    const expandFeature = useCallback(
        (featureId: string) => {
            const feature = STUDIO_FEATURES_BY_ID[featureId];
            // Separate apps (Mindmap) own their own route: navigate rather than
            // expanding a pane whose only content is a link to that route.
            if (feature?.external && feature.href) {
                setStudioOpen(false);
                router.push(feature.href);
                return;
            }
            setActiveFeatureId(featureId);
            setStudioOpen(false);
        },
        [router]
    );

    // `?feature=X` expands that Studio feature full-width on the workspace (or opens
    // Assist inline for draft flow via same ids); `?add=1` opens the AddSourceModal;
    // `?connector=<provider>&result=connected|denied|error` is a connector OAuth
    // return leg — reopen the modal on that provider's tab and toast the outcome.
    const featureParam = searchParams.get("feature");
    const addParam = searchParams.get("add");
    const connectorParam = searchParams.get("connector");
    const connectorResultParam = searchParams.get("result");
    // `?continue=<docId>` — continue an imported agent session in this chat.
    const continueParam = searchParams.get("continue");
    useEffect(() => {
        if (!featureParam && !addParam && !connectorParam && !continueParam) return;
        if (legacyRedirect) return;
        if (featureParam && FEATURE_IDS.has(featureParam)) {
            expandFeature(featureParam);
        }
        if (addParam) {
            setAddOpen(true);
        }
        if (continueParam) {
            const docId = Number.parseInt(continueParam, 10);
            if (Number.isFinite(docId)) void startContinuation(docId);
        }
        if (connectorParam) {
            const tabByProvider: Record<string, string> = {
                "google-drive": "drive",
                slack: "slack",
                github: "github",
            };
            const label: Record<string, string> = {
                "google-drive": "Google Drive",
                slack: "Slack",
                github: "GitHub",
            };
            const tab = tabByProvider[connectorParam];
            const name = label[connectorParam] ?? connectorParam;
            if (tab) {
                setAddTab(tab);
                setAddOpen(true);
            }
            if (connectorResultParam === "connected") {
                toast.success(`${name} connected`);
            } else if (connectorResultParam === "denied") {
                toast.info(`${name} connection was cancelled`);
            } else {
                toast.error(`${name} connection failed — try again`);
            }
        }
        const params = new URLSearchParams(searchParams.toString());
        params.delete("feature");
        params.delete("add");
        params.delete("connector");
        params.delete("result");
        params.delete("continue");
        const query = params.toString();
        router.replace(query ? `/employer/documents?${query}` : "/employer/documents");
    }, [
        featureParam,
        addParam,
        connectorParam,
        connectorResultParam,
        continueParam,
        legacyRedirect,
        expandFeature,
        startContinuation,
        router,
        searchParams,
    ]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName;
            const inInput = tag === "INPUT" || tag === "TEXTAREA";
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPalOpen(v => !v);
            } else if (mod && e.key.toLowerCase() === "u") {
                e.preventDefault();
                setAddOpen(true);
            } else if (mod && e.key.toLowerCase() === "j") {
                e.preventDefault();
                setStudioOpen(v => !v);
            } else if (mod && e.key === "\\") {
                e.preventDefault();
                setRailHidden(v => !v);
            } else if (e.key === "/" && !inInput) {
                e.preventDefault();
                const el = document.querySelector<HTMLInputElement>(
                    'input[placeholder="Search your sources"]'
                );
                el?.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    if (!isLoaded) return <LoadingPage />;
    if (!isSignedIn) return <LoadingPage />;

    // While a legacy `?view=X` redirect is in flight, avoid flashing the workspace.
    if (legacyRedirect) return <LoadingPage />;

    const trimmedName = user?.name.trim();
    const userName = trimmedName?.length ? trimmedName : undefined;
    const [firstName, ...restNames] = (userName ?? "").split(/\s+/);
    const userEmail = user?.email;
    const initials = initialsOf(firstName, restNames.at(-1), userEmail);

    return (
        <div
            data-drift-immersive="true"
            style={{
                display: "flex",
                // `dvh`, not `vh`: on mobile `100vh` is the viewport with the
                // URL bar retracted, so the workspace's own bottom chrome ends
                // up underneath the browser's.
                height: "100dvh",
                width: "100%",
                overflow: "hidden",
                position: "relative",
            }}
        >
            {!railHidden && (
                <SourceRail
                    sources={sources}
                    folders={folders}
                    selected={selected}
                    setSelected={setSelected}
                    onOpenAdd={() => openAdd()}
                    onOpenKnowledge={() => expandFeature("knowledge")}
                    onOpenSource={handleOpenSource}
                    onNewFolder={() => setNewFolderOpen(true)}
                    onRenameFolder={folder => setRenameFolder(folder)}
                    onShareFolder={openFolderAccess}
                    onRestrictAccess={openDocumentAccess}
                    onRenameSource={source => setRenameSource(source)}
                    onDeleteSource={source => {
                        setDeleteError(null);
                        setDeleteSource(source);
                    }}
                    onMoveToFolder={(id, name) => void handleMoveToFolder(id, name)}
                    activeFolder={activeFolder}
                    setActiveFolder={setActiveFolder}
                    activeTag={activeTag}
                    setActiveTag={setActiveTag}
                    onClose={() => setRailHidden(true)}
                />
            )}

            {railHidden && (
                <button
                    onClick={() => setRailHidden(false)}
                    title="Show sidebar  ⌘\"
                    aria-label="Show sidebar"
                    style={{
                        position: "absolute",
                        top: 14,
                        left: 12,
                        zIndex: 5,
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        color: "var(--ink-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                        transition: "background 120ms, color 120ms, border-color 120ms",
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.color = "var(--accent)";
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "var(--line)";
                        e.currentTarget.style.color = "var(--ink-2)";
                    }}
                >
                    <IconChevronRight size={14} />
                </button>
            )}

            {activeFeatureId === "chat" ? (
                <AskPanel
                    leadingChromeInsetPx={railHidden ? RAIL_HIDDEN_HEADER_INSET_PX : 0}
                    sources={sources}
                    selected={selected}
                    setSelected={setSelected}
                    thread={thread}
                    sendMessage={sendMessage}
                    isSending={isSending}
                    onOpenCitation={handleOpenCitation}
                    onOpenAdd={() => setAddOpen(true)}
                    onNewChat={() => {
                        setThread([]);
                        setContinuation(null);
                    }}
                    openPalette={() => setPalOpen(true)}
                    onStudioNavigate={href => router.push(href)}
                    userInitials={initials}
                    userName={userName}
                    userEmail={userEmail}
                    onSignOut={() => signOut({ redirectUrl: LANDING_URL })}
                    webSearch={composerWebSearch}
                    onToggleWebSearch={() => setComposerWebSearch(v => !v)}
                    thinking={composerThinking}
                    onToggleThinking={() => setComposerThinking(v => !v)}
                    studioSlot={
                        <StudioMenu
                            onOpenStudio={() => openFeature()}
                            onPickFeature={id => expandFeature(id)}
                        />
                    }
                />
            ) : (
                <ExpandedFeatureView
                    featureId={activeFeatureId}
                    leadingChromeInsetPx={railHidden ? RAIL_HIDDEN_HEADER_INSET_PX : 0}
                    onPaneExit={() => setActiveFeatureId("chat")}
                    onOpenStudio={() => openFeature()}
                    onPickFeature={id => expandFeature(id)}
                    openPalette={() => setPalOpen(true)}
                    userInitials={initials}
                    userName={userName}
                    userEmail={userEmail}
                    // Settings is a workspace surface now, not a separate destination.
                    onOpenSettings={() => expandFeature("settings")}
                    onSignOut={() => signOut({ redirectUrl: LANDING_URL })}
                    paneContext={{
                        knowledge: {
                            sources,
                            folders,
                            selected,
                            setSelected,
                            onOpenSource: handleOpenSource,
                            onOpenAdd: openAdd,
                            onAskAbout: ids => {
                                setSelected(ids);
                                setActiveFeatureId("chat");
                            },
                            onRenameSource: source => setRenameSource(source),
                            onDeleteSource: source => {
                                setDeleteError(null);
                                setDeleteSource(source);
                            },
                            onRestrictAccess: openDocumentAccess,
                            onMoveToFolder: (id, name) => void handleMoveToFolder(id, name),
                        },
                    }}
                />
            )}

            {studioOpen && (
                <StudioDrawer
                    open
                    initialFeatureId={studioFeatureId}
                    activeFeatureId={activeFeatureId}
                    onClose={() => setStudioOpen(false)}
                    onExpand={expandFeature}
                    onOpenWorkspaceChat={() => {
                        setActiveFeatureId("chat");
                        setStudioOpen(false);
                    }}
                />
            )}

            <AddSourceModal
                open={addOpen}
                initialTab={addTab}
                onClose={() => {
                    setAddOpen(false);
                    setAddTab(undefined);
                }}
                userId={userId ?? null}
                defaultCategory={activeFolder ?? folders[0]?.name ?? "Unfiled"}
                folders={folders.map(f => f.name)}
                restrictedFolders={folders.filter(f => f.restricted).map(f => f.name)}
                onUploaded={() => {
                    void refresh();
                }}
            />

            <CommandPalette
                open={palOpen}
                onClose={() => setPalOpen(false)}
                sources={sources}
                onOpenAdd={() => {
                    setPalOpen(false);
                    setTimeout(() => setAddOpen(true), 100);
                }}
                onPickSource={id => {
                    setSelected(prev => (prev.includes(id) ? prev : [id, ...prev]));
                }}
                onPickFeature={id => {
                    setPalOpen(false);
                    setTimeout(() => expandFeature(id), 100);
                }}
            />

            <NewFolderDialog
                open={newFolderOpen}
                onClose={() => setNewFolderOpen(false)}
                existingFolders={folders.map(f => f.name)}
                onCreated={() => {
                    void refresh();
                }}
            />

            <RenameFolderDialog
                open={!!renameFolder}
                folder={renameFolder}
                onClose={() => setRenameFolder(null)}
                existingFolders={folders.map(f => f.name)}
                onRenamed={newName => {
                    if (activeFolder === renameFolder?.name) setActiveFolder(newName);
                    void refresh();
                }}
                onDeleted={() => {
                    if (activeFolder === renameFolder?.name) setActiveFolder(null);
                    void refresh();
                }}
            />

            <RenameSourceDialog
                open={!!renameSource}
                source={renameSource}
                onClose={() => setRenameSource(null)}
                onRename={handleRenameDoc}
            />

            <ConfirmActionDialog
                open={!!deleteSource}
                title="Delete this source?"
                body={
                    deleteSource
                        ? `“${deleteSource.title}” will be removed from this workspace. This cannot be undone.`
                        : ""
                }
                confirmLabel="Delete"
                busy={deleteBusy}
                error={deleteError}
                onConfirm={() => void confirmDeleteSource()}
                onClose={() => {
                    if (deleteBusy) return;
                    setDeleteSource(null);
                    setDeleteError(null);
                }}
            />

            <AccessDialog
                target={accessTarget}
                onClose={() => setAccessTarget(null)}
                onSaved={() => void refresh()}
            />

            {viewerSource && (
                <DocumentViewer
                    source={viewerSource}
                    highlight={viewerHighlight}
                    onClose={() => {
                        setViewerSource(null);
                        setViewerHighlight(null);
                    }}
                    onRename={handleRenameDoc}
                    onDelete={id => void handleDeleteDoc(id)}
                    onRestrictAccess={openDocumentAccess}
                    onAskAbout={handleAskAbout}
                    onVersionChanged={() => void refresh()}
                />
            )}
        </div>
    );
}

interface ExpandedFeatureViewProps {
    featureId: string;
    /** Extra left inset for top bar when an overlay chrome control (show sidebar) is visible — see WorkspaceShell.RAIL_HIDDEN_HEADER_INSET_PX. */
    leadingChromeInsetPx?: number;
    /** Return to workspace chat when panes invoke their exit / close callbacks. */
    onPaneExit: () => void;
    onOpenStudio: () => void;
    onPickFeature: (featureId: string) => void;
    openPalette: () => void;
    userInitials: string;
    userName?: string;
    userEmail?: string;
    onOpenSettings: () => void;
    onSignOut?: () => void;
    /** Workspace-owned data some panes need (Knowledge in particular). */
    paneContext?: StudioPaneContext;
}

/**
 * Main-area container for a Studio feature expanded from the drawer; top bar aligns with AskPanel (jump, Studio, avatar).
 */
function ExpandedFeatureView({
    featureId,
    leadingChromeInsetPx = 0,
    onPaneExit,
    onOpenStudio,
    onPickFeature,
    openPalette,
    userInitials,
    userName,
    userEmail,
    onOpenSettings,
    onSignOut,
    paneContext,
}: ExpandedFeatureViewProps) {
    const feature = STUDIO_FEATURES_BY_ID[featureId];

    return (
        <main
            style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
                background: "var(--bg)",
            }}
        >
            <div style={workspaceMainHeaderBarStyle(leadingChromeInsetPx)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {feature?.label ?? "Studio"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{feature?.desc ?? ""}</div>
                </div>
                <JumpToPaletteButton onClick={openPalette} />
                <StudioMenu onOpenStudio={onOpenStudio} onPickFeature={onPickFeature} />
                <AvatarMenu
                    userInitials={userInitials}
                    userName={userName}
                    userEmail={userEmail}
                    onOpenSettings={onOpenSettings}
                    onSignOut={onSignOut}
                />
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
                {feature ? (
                    renderStudioPane(feature, onPaneExit, paneContext)
                ) : (
                    <div
                        style={{
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--ink-3)",
                            fontSize: 13,
                        }}
                    >
                        Unknown feature — returning to Chat…
                    </div>
                )}
            </div>
        </main>
    );
}
