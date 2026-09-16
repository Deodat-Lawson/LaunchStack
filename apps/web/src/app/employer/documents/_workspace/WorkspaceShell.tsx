"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth, useUser } from "~/lib/auth-client";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { usePermissions } from "~/lib/use-permissions";
import LoadingPage from "~/app/_components/loading";
// A just-signed-out user is a public-site audience, and the public site is a
// separate origin now (apps/landing).
import { LANDING_URL } from "~/config/landing";
import {
    UNFILED_FOLDER,
    folderLeafName,
    isFolderDescendant,
    isFolderOrDescendant,
    joinFolderPath,
    replaceFolderPrefix,
    displayFolderPath,
} from "~/lib/folders/path";
import { buildContinuationContext, parseSessionTranscript } from "~/lib/session-transcript";
import { useAIChat } from "../hooks/useAIChat";
import { AccessDialog, type AccessTarget } from "./access/AccessDialog";
import { AddSourceModal } from "./AddSourceModal";
import { AskPanel, AvatarMenu, JumpToPaletteButton, workspaceMainHeaderBarStyle } from "./AskPanel";
import { CommandPalette } from "./CommandPalette";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { DocumentViewer } from "./DocumentViewer";
import { DeleteFolderDialog } from "./DeleteFolderDialog";
import { FolderDialog, type FolderDialogRequest } from "./FolderDialog";
import { MindmapEditorHost } from "./MindmapEditorHost";
import { RenameSourceDialog } from "./RenameSourceDialog";
import { SourceRail } from "./SourceRail";
import { StudioDrawer } from "./StudioDrawer";
import { StudioMenu } from "./StudioMenu";
import { renderStudioPane, type StudioPaneContext } from "./StudioPanes";
import { StudioTabs, useStudioTabs } from "./StudioTabs";
import type { SettingsSectionId } from "./SettingsHub";
import * as sourceApi from "./sourceApi";
import { STUDIO_FEATURES_BY_ID } from "./types";
import { useWorkspaceData } from "./useWorkspaceData";
import type {
    CitationHighlight,
    ComposerSend,
    ThreadMessage,
    ThreadReference,
    WorkspaceSource,
    WorkspaceFolder,
} from "./types";

/**
 * Legacy `?view=X` URL params that used to drive the deleted DocumentViewerShell.
 * Studio features open in center tabs via `?feature=X`;
 * upload opens inline in the AddSourceModal via `?add=1`. Admin views redirect
 * to their standalone `/employer/<name>` routes. Values folded into the default
 * workspace map to the workspace root; other params are carried across.
 *
 * Two params are *not* one-shot: `?source=<id>` opens that source in the
 * viewer and `&edit=1` opens a mindmap's editor in its place. They stay in
 * the URL so the back button walks editor → preview → library and a link to
 * a source can be shared.
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
    distribution: "/employer/tools/distribution",
    notes: "/employer/documents?feature=notes",
    workflows: "/employer/documents?feature=workflows",
    knowledge: "/employer/documents?feature=knowledge",
    meetings: "/employer/documents?feature=meetings",
};

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
    const { loaded: permissionsLoaded } = usePermissions();
    const {
        ids: tabIds,
        activeId: activeFeatureId,
        open: setActiveFeatureId,
        close: closeTab,
        move: moveTab,
    } = useStudioTabs();
    const [settingsSection, setSettingsSection] = useState<SettingsSectionId | undefined>();

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

    const {
        sources,
        folders,
        companyId,
        can,
        refresh,
        // The URL names a source; until the list has loaded, an id that is not
        // in it yet is "not loaded", not "gone".
        loading: sourcesLoading,
    } = useWorkspaceData(userId ?? null);

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
    const [folderDialog, setFolderDialog] = useState<FolderDialogRequest | null>(null);
    const [deleteFolderPath, setDeleteFolderPath] = useState<string | null>(null);
    /**
     * The open source lives in the URL (`?source=<id>`, plus `&edit=1` for a
     * mindmap's editor) and is resolved against the loaded list here. Pushing
     * rather than replacing is what gives the back button its meaning.
     */
    const sourceParam = searchParams.get("source");
    const editParam = searchParams.get("edit") === "1";
    const [viewerSource, setViewerSource] = useState<WorkspaceSource | null>(null);
    const editing = editParam && viewerSource !== null && sourceApi.isMindmapSource(viewerSource);
    /** Read by the shortcut listener so the editor's own keys win while it is open. */
    const editingRef = useRef(false);
    useEffect(() => {
        editingRef.current = editing && activeFeatureId === "mindmap";
    }, [editing, activeFeatureId]);
    useEffect(() => {
        if (editing) setActiveFeatureId("mindmap");
    }, [editing, viewerSource?.mindmapId, setActiveFeatureId]);
    /** Cited passage to locate + highlight when the viewer was opened from a citation. */
    const [viewerHighlight, setViewerHighlight] = useState<CitationHighlight | null>(null);

    const sourceUrl = useCallback(
        (id: string | null, edit = false) => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("source");
            params.delete("edit");
            if (id) params.set("source", id);
            if (id && edit) params.set("edit", "1");
            const query = params.toString();
            return query ? `/employer/documents?${query}` : "/employer/documents";
        },
        [searchParams]
    );
    const openSource = useCallback(
        (id: string, edit = false) => router.push(sourceUrl(id, edit)),
        [router, sourceUrl]
    );
    const closeSource = useCallback(() => router.push(sourceUrl(null)), [router, sourceUrl]);

    useEffect(() => {
        if (!sourceParam) {
            setViewerSource(null);
            return;
        }
        const found = sources.find(s => s.id === sourceParam) ?? null;
        if (found) {
            setViewerSource(found);
            return;
        }
        if (sourcesLoading) return;
        // The list is loaded and the id is not in it — trashed, or a bad link.
        // Drop the param rather than holding an empty viewer open.
        setViewerSource(null);
        router.replace(sourceUrl(null));
    }, [sourceParam, sources, sourcesLoading, router, sourceUrl]);
    const citationNonce = useRef(0);
    const [renameSource, setRenameSource] = useState<WorkspaceSource | null>(null);
    const [deleteSource, setDeleteSource] = useState<WorkspaceSource | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    /** The folder or document whose access dialog is open. */
    const [accessTarget, setAccessTarget] = useState<AccessTarget | null>(null);
    const [studioOpen, setStudioOpen] = useState(false);
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
    const startContinuation = useCallback(
        async (docId: number) => {
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
                if (!contentRes.ok)
                    throw new Error(`Failed to load transcript (${contentRes.status})`);
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
        },
        [setActiveFeatureId]
    );

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

    const handleOpenSource = useCallback(
        (source: WorkspaceSource) => {
            setViewerHighlight(null);
            openSource(source.id);
        },
        [openSource]
    );

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
            openSource(src.id);
        },
        [sources, openSource]
    );

    const handleRenameSource = useCallback(
        async (source: WorkspaceSource, nextTitle: string): Promise<boolean> => {
            try {
                await sourceApi.renameSource(source, nextTitle);
                // The viewer follows the list: the refreshed row carries the
                // new title and the URL sync effect hands it over.
                await refresh();
                return true;
            } catch {
                return false;
            }
        },
        [refresh]
    );

    /**
     * Remove a source. A document is gone for good; a mindmap goes to the
     * trash and the toast offers to bring it back — the one place the two
     * kinds of delete meet the user differently.
     */
    const removeSource = useCallback(
        async (source: WorkspaceSource) => {
            const outcome = await sourceApi.deleteSource(source);
            if (sourceParam === source.id) closeSource();
            setSelected(prev => prev.filter(id => id !== source.id));
            await refresh();
            if (outcome.restore) {
                const restore = outcome.restore;
                toast("Moved to trash", {
                    description: source.title,
                    duration: 8000,
                    action: {
                        label: "Undo",
                        onClick: () => {
                            restore()
                                .then(refresh)
                                .catch(() => toast.error("Couldn't restore that mindmap"));
                        },
                    },
                });
            }
        },
        [closeSource, refresh, sourceParam]
    );

    const handleDeleteSource = useCallback(
        async (source: WorkspaceSource) => {
            try {
                await removeSource(source);
            } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to delete source");
            }
        },
        [removeSource]
    );

    const confirmDeleteSource = useCallback(async () => {
        if (!deleteSource) return;
        setDeleteBusy(true);
        setDeleteError(null);
        try {
            await removeSource(deleteSource);
            setDeleteSource(null);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : "Failed to delete source");
        } finally {
            setDeleteBusy(false);
        }
    }, [deleteSource, removeSource]);

    const handleAskAbout = useCallback(
        (source: WorkspaceSource) => {
            setSelected(prev => (prev.includes(source.id) ? prev : [source.id, ...prev]));
            closeSource();
        },
        [closeSource]
    );

    const openAdd = useCallback((tabId?: string) => {
        setAddTab(tabId);
        setAddOpen(true);
    }, []);

    const handleMoveToFolder = useCallback(
        async (sourceId: string, folderName: string) => {
            const src = sources.find(s => s.id === sourceId);
            if (!src) return;
            if ((src.folder ?? "Unfiled") === folderName) return;
            try {
                await sourceApi.moveSource(src, folderName);
                await refresh();
            } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to move source");
            }
        },
        [sources, refresh]
    );

    const openFolderAccess = useCallback((folder: WorkspaceFolder) => {
        setAccessTarget({
            kind: "folder",
            path: folder.name,
            name: displayFolderPath(folder.name),
        });
    }, []);

    const openDocumentAccess = useCallback((source: WorkspaceSource) => {
        if (!source.documentId) {
            toast.info("This source is still being indexed.");
            return;
        }
        setAccessTarget({ kind: "document", id: source.documentId, name: source.title });
    }, []);

    // Folder structure needs `folders.manage`, like every other write to the
    // library. Members see the tree; owners and admins shape it.
    const canManageFolders = can("folders.manage");
    const folderPaths = useMemo(() => folders.map(f => f.name), [folders]);

    /** One call for every folder mutation; resolves to an error message or null. */
    const folderRequest = useCallback(
        async (method: "POST" | "PATCH" | "DELETE", body: Record<string, string>) => {
            try {
                const res = await fetch("/api/folders", {
                    method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                const json = (await res.json().catch(() => ({}))) as {
                    success?: boolean;
                    message?: string;
                };
                if (!res.ok || !json.success) {
                    return json.message ?? `Request failed (${res.status})`;
                }
                await refresh();
                return null;
            } catch (err) {
                return err instanceof Error ? err.message : "Request failed";
            }
        },
        [refresh]
    );

    const handleCreateFolder = useCallback(
        (path: string) => folderRequest("POST", { path }),
        [folderRequest]
    );

    const handleRenameFolder = useCallback(
        async (path: string, newPath: string) => {
            const failure = await folderRequest("PATCH", { path, newPath });
            if (!failure && activeFolder && isFolderOrDescendant(activeFolder, path)) {
                setActiveFolder(replaceFolderPrefix(activeFolder, path, newPath));
            }
            return failure;
        },
        [folderRequest, activeFolder]
    );

    /** Drag-and-drop and the folder menu: the move is a rename to a new parent. */
    const handleMoveFolder = useCallback(
        async (path: string, targetParent: string | null) => {
            const failure = await handleRenameFolder(
                path,
                joinFolderPath(targetParent, folderLeafName(path))
            );
            if (failure) toast.error(failure);
        },
        [handleRenameFolder]
    );

    const handleDeleteFolder = useCallback(
        async (path: string) => {
            const failure = await folderRequest("DELETE", { path });
            if (!failure && activeFolder && isFolderOrDescendant(activeFolder, path)) {
                setActiveFolder(null);
            }
            return failure;
        },
        [folderRequest, activeFolder]
    );

    const deleteFolderCounts = useMemo(() => {
        if (!deleteFolderPath) return { documents: 0, subfolders: 0 };
        return {
            documents: sources.filter(s => isFolderOrDescendant(s.folder, deleteFolderPath)).length,
            subfolders: folderPaths.filter(p => isFolderDescendant(p, deleteFolderPath)).length,
        };
    }, [deleteFolderPath, sources, folderPaths]);

    const openFeature = useCallback(() => setStudioOpen(true), []);

    /** All launch paths reuse one tab per app, including formerly standalone tools. */
    const expandFeature = useCallback(
        (requestedId: string) => {
            const featureId =
                requestedId === "metadata" || requestedId === "analytics"
                    ? "settings"
                    : requestedId;
            if (!Object.hasOwn(STUDIO_FEATURES_BY_ID, featureId)) return;
            const feature = STUDIO_FEATURES_BY_ID[featureId];
            if (!feature || !can(feature.requires)) return;
            if (requestedId === "metadata") setSettingsSection("company");
            if (requestedId === "analytics") setSettingsSection("analytics");
            setActiveFeatureId(featureId);
            setStudioOpen(false);
        },
        [can, setActiveFeatureId]
    );

    const navigateStudio = useCallback(
        (href: string) => {
            const url = new URL(href, window.location.origin);
            if (url.pathname === "/employer/settings") {
                if (url.hash === "#company") setSettingsSection("company");
                expandFeature("settings");
                return;
            }
            router.push(href);
        },
        [expandFeature, router]
    );

    const visibleTabs = tabIds.flatMap(id => {
        const feature = STUDIO_FEATURES_BY_ID[id];
        return feature && can(feature.requires) ? [feature] : [];
    });
    const visibleActiveId = visibleTabs.some(feature => feature.id === activeFeatureId)
        ? activeFeatureId
        : (visibleTabs[0]?.id ?? "");

    // `?feature=X` expands that Studio feature full-width on the workspace (or opens
    // Assist inline for draft flow via same ids); `?add=1` opens the AddSourceModal;
    // `?connector=<provider>&result=connected|denied|error` is a connector OAuth
    // return leg — reopen the modal on that provider's tab and toast the outcome.
    const featureParam = searchParams.get("feature");
    const addParam = searchParams.get("add");
    /** With `?add=1`: which Add-source tab to open on (`tab=mindmap` for the template picker). */
    const tabParam = searchParams.get("tab");
    const connectorParam = searchParams.get("connector");
    const connectorResultParam = searchParams.get("result");
    // `?continue=<docId>` — continue an imported agent session in this chat.
    const continueParam = searchParams.get("continue");
    useEffect(() => {
        if (!featureParam && !addParam && !connectorParam && !continueParam) return;
        if (legacyRedirect) return;
        const requestedFeature =
            featureParam === "metadata" || featureParam === "analytics" ? "settings" : featureParam;
        if (
            requestedFeature &&
            STUDIO_FEATURES_BY_ID[requestedFeature]?.requires &&
            !permissionsLoaded
        )
            return;
        if (featureParam) {
            expandFeature(featureParam);
        }
        if (addParam) {
            if (tabParam) setAddTab(tabParam);
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
        params.delete("tab");
        params.delete("connector");
        params.delete("result");
        params.delete("continue");
        const query = params.toString();
        router.replace(query ? `/employer/documents?${query}` : "/employer/documents");
    }, [
        featureParam,
        addParam,
        tabParam,
        connectorParam,
        connectorResultParam,
        continueParam,
        legacyRedirect,
        permissionsLoaded,
        expandFeature,
        startContinuation,
        router,
        searchParams,
    ]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // The mindmap editor binds its own ⌘K, `/` and tool keys on the
            // same window; while it is open, its map wins.
            if (editingRef.current) return;
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
                    'input[placeholder="Search your knowledge"]'
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
                    onNewFolder={
                        canManageFolders
                            ? parentPath =>
                                  setFolderDialog({
                                      mode: "create",
                                      parentPath: parentPath ?? null,
                                  })
                            : undefined
                    }
                    onRenameFolder={
                        canManageFolders
                            ? folder => setFolderDialog({ mode: "rename", path: folder.name })
                            : undefined
                    }
                    onMoveFolder={
                        canManageFolders
                            ? (path, target) => void handleMoveFolder(path, target)
                            : undefined
                    }
                    onDeleteFolder={
                        canManageFolders ? folder => setDeleteFolderPath(folder.name) : undefined
                    }
                    onShareFolder={openFolderAccess}
                    onRestrictAccess={openDocumentAccess}
                    onRenameSource={source => setRenameSource(source)}
                    onDeleteSource={source => {
                        setDeleteError(null);
                        setDeleteSource(source);
                    }}
                    onMoveToFolder={
                        canManageFolders
                            ? (id, name) => void handleMoveToFolder(id, name)
                            : undefined
                    }
                    activeFolder={activeFolder}
                    setActiveFolder={setActiveFolder}
                    activeTag={activeTag}
                    setActiveTag={setActiveTag}
                    onClose={() => setRailHidden(true)}
                />
            )}

            <StudioTabs
                features={visibleTabs}
                activeId={visibleActiveId}
                onSelect={expandFeature}
                onClose={id => {
                    closeTab(id);
                    if (id === "mindmap" && editing) closeSource();
                }}
                onMove={moveTab}
                onOpenStudio={openFeature}
                leadingSlot={
                    railHidden ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-ink-3 mx-1 size-8"
                            title="Show sidebar"
                            aria-label="Show sidebar"
                            onClick={() => setRailHidden(false)}
                        >
                            <PanelLeftOpen className="size-4" />
                        </Button>
                    ) : undefined
                }
            >
                {featureId =>
                    featureId === "chat" ? (
                        <AskPanel
                            leadingChromeInsetPx={0}
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
                            onStudioNavigate={navigateStudio}
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
                    ) : featureId === "mindmap" && editing && viewerSource?.mindmapId ? (
                        <MindmapEditorHost
                            key={viewerSource.mindmapId}
                            mindmapId={viewerSource.mindmapId}
                            onBack={() => openSource(viewerSource.id)}
                            onChanged={() => void refresh()}
                        />
                    ) : (
                        <ExpandedFeatureView
                            featureId={featureId}
                            onPaneExit={() => closeTab(featureId)}
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
                                settings: { section: settingsSection },
                                sessions: {
                                    onOpenDocument: id => openSource(`d${id}`),
                                    onContinue: id => void startContinuation(id),
                                },
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
                                mindmap: { onCreate: () => openAdd("mindmap") },
                            }}
                        />
                    )
                }
            </StudioTabs>

            <StudioDrawer
                open={studioOpen}
                activeFeatureId={visibleActiveId}
                onClose={() => setStudioOpen(false)}
                onPickFeature={expandFeature}
            />

            <AddSourceModal
                open={addOpen}
                initialTab={addTab}
                onClose={() => {
                    setAddOpen(false);
                    setAddTab(undefined);
                }}
                userId={userId ?? null}
                defaultCategory={activeFolder ?? UNFILED_FOLDER}
                folders={folderPaths}
                onCreateFolder={
                    canManageFolders
                        ? path => {
                              void handleCreateFolder(path).then(failure => {
                                  if (failure) toast.error(failure);
                              });
                          }
                        : undefined
                }
                restrictedFolders={folders.filter(f => f.restricted).map(f => f.name)}
                onUploaded={() => {
                    void refresh();
                }}
                onMindmapCreated={id => {
                    setAddOpen(false);
                    setAddTab(undefined);
                    // The list must know the map before the URL names it, or
                    // the sync effect reads the id as stale and drops it.
                    void refresh().then(() => openSource(`m${id}`, true));
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

            <FolderDialog
                request={folderDialog}
                existingPaths={folderPaths}
                onSubmit={path =>
                    folderDialog?.mode === "rename"
                        ? handleRenameFolder(folderDialog.path, path)
                        : handleCreateFolder(path)
                }
                onClose={() => setFolderDialog(null)}
            />

            <DeleteFolderDialog
                path={deleteFolderPath}
                documentCount={deleteFolderCounts.documents}
                subfolderCount={deleteFolderCounts.subfolders}
                onConfirm={handleDeleteFolder}
                onClose={() => setDeleteFolderPath(null)}
            />

            <RenameSourceDialog
                open={!!renameSource}
                source={renameSource}
                onClose={() => setRenameSource(null)}
                onRename={handleRenameSource}
            />

            <ConfirmActionDialog
                open={!!deleteSource}
                title={
                    deleteSource && sourceApi.isMindmapSource(deleteSource)
                        ? "Move this mindmap to the trash?"
                        : "Delete this source?"
                }
                body={
                    deleteSource
                        ? sourceApi.isMindmapSource(deleteSource)
                            ? `“${deleteSource.title}” will leave the library. You can undo this right after.`
                            : `“${deleteSource.title}” will be removed from this workspace. This cannot be undone.`
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

            {viewerSource && !editing && (
                <DocumentViewer
                    source={viewerSource}
                    highlight={viewerHighlight}
                    onClose={() => {
                        closeSource();
                        setViewerHighlight(null);
                    }}
                    onRename={handleRenameSource}
                    onDelete={source => void handleDeleteSource(source)}
                    onRestrictAccess={openDocumentAccess}
                    onAskAbout={handleAskAbout}
                    onVersionChanged={() => void refresh()}
                    onEdit={source => openSource(source.id, true)}
                    onPublished={() => void refresh()}
                />
            )}
        </div>
    );
}

interface ExpandedFeatureViewProps {
    featureId: string;
    /** Close this app tab when the pane invokes its exit callback. */
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
 * App panel chrome; aligns with Chat while the shared tab strip owns navigation.
 */
function ExpandedFeatureView({
    featureId,
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
        <main className="bg-surface flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div style={workspaceMainHeaderBarStyle()}>
                <div className="min-w-0 flex-1">
                    <div className="text-ink text-[13px] font-semibold">
                        {feature?.label ?? "Studio"}
                    </div>
                    <div className="text-ink-3 truncate text-[11px]">{feature?.desc ?? ""}</div>
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
            <div className="min-h-0 flex-1 overflow-hidden">
                {feature ? (
                    renderStudioPane(feature, onPaneExit, paneContext)
                ) : (
                    <div className="text-ink-3 flex h-full items-center justify-center text-[13px]">
                        This app is unavailable.
                    </div>
                )}
            </div>
        </main>
    );
}
