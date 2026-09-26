"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PanelLeftOpen, PanelsTopLeft, Plus } from "lucide-react";
import { useAuth, useUser } from "~/lib/auth-client";
import { firstFilled } from "~/lib/profile/resolve";
import { useMyProfile } from "~/lib/profile/use-my-profile";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { useRegisterActions } from "~/components/context-menu";
import {
    APP_TARGET_KIND,
    SELECTION_TARGET_KIND,
    copyText,
    readClipboardText,
    type ContextTarget,
    type MenuOpenContext,
    type TextSelectionInfo,
} from "~/lib/context-menu";
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
import { HISTORY_KIND_META, type HistoryEntry, MAX_SESSION_APPEND } from "~/lib/workspace-history";
import { useSettingValue } from "~/lib/settings/useSettings";
import {
    commandForEvent,
    formatKeys,
    resolveBindings,
    type ShortcutBindings,
} from "~/lib/shortcuts/commands";
import type { ShortcutHints } from "./ShortcutHint";
import { useAIChat } from "../hooks/useAIChat";
import { AccessDialog, type AccessTarget } from "./access/AccessDialog";
import { AddSourceModal } from "./AddSourceModal";
import { AskPanel, workspaceMainHeaderBarStyle, type ComposerSeed } from "./AskPanel";
import type { DocumentTargetData } from "./documentContextMenu";
import { citationWithSource, quoteBlock, transcriptMarkdown } from "./transcript";
import { CommandPalette } from "./CommandPalette";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { DocumentViewer } from "./DocumentViewer";
import { DeleteFolderDialog } from "./DeleteFolderDialog";
import { FolderDialog, type FolderDialogRequest } from "./FolderDialog";
import { MindmapEditorHost } from "./MindmapEditorHost";
import { RenameSourceDialog } from "./RenameSourceDialog";
import { SourceRail } from "./SourceRail";
import * as sessionApi from "./sessionApi";
import { useWorkspaceHistory } from "./useWorkspaceHistory";
import { StudioDrawer } from "./StudioDrawer";
import { AccountMenu } from "./AccountMenu";
import { CollapsedRail } from "./CollapsedRail";
import { renderStudioPane, type StudioPaneContext } from "./StudioPanes";
import { StudioSplitView } from "./StudioSplitView";
import type { PaneTab } from "./StudioTabs";
import {
    MAX_GROUPS,
    SOURCE_TAB_PREFIX,
    groupOf,
    sourceIdOfTab,
    tabIdOfSource,
    useStudioLayout,
} from "./paneLayout";
import * as sourceApi from "./sourceApi";
import { SOURCE_META, demotedFeatureHref, resolveStudioFeature } from "./types";
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
 * Studio features now open inline in the workspace drawer via `?feature=X`;
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
    "marketing-pipeline": "/employer/tools/growth/brand/campaigns",
    "repo-explainer": "/employer/tools/repo-explainer",
    distribution: "/employer/tools/growth/prospects",
    prospects: "/employer/tools/growth/prospects",
    growth: "/employer/tools/growth",
    workflows: "/employer/documents?feature=workflows",
    knowledge: "/employer/documents?feature=knowledge",
    meetings: "/employer/documents?feature=meetings",
};

/**
 * Feature ids that used to be Studio entries of their own and now live inside
 * Growth. Old `?feature=` links land on the right area.
 */
const RETIRED_FEATURE_HREFS: Record<string, string> = {
    marketing: "/employer/tools/growth/brand/campaigns",
    distribution: "/employer/tools/growth/prospects",
    prospects: "/employer/tools/growth/prospects",
    brand: "/employer/tools/growth/brand",
};

/**
 * A stored turn becomes a thread turn. `citations` and `attachments` are
 * replayed as they were written — the rail's own render payload, round-tripped
 * rather than re-derived, so a reopened chat shows the citations that answer
 * actually carried even if the library has moved on since.
 */
function toThreadMessage(stored: sessionApi.SessionMessagePayload): ThreadMessage {
    return {
        role: stored.role,
        text: stored.text,
        refs: stored.refs,
        citations: stored.citations as ThreadMessage["citations"],
        attachments: stored.attachments as ThreadMessage["attachments"],
        model: stored.model ?? undefined,
        tokens: stored.tokens ?? undefined,
    };
}

function toStoredMessage(message: ThreadMessage): sessionApi.SessionMessagePayload {
    return {
        role: message.role,
        text: message.text,
        refs: message.refs,
        citations: message.citations,
        attachments: message.attachments,
        model: message.model ?? null,
        tokens: message.tokens ?? null,
    };
}

export function WorkspaceShell() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isLoaded, isSignedIn, userId, signOut } = useAuth();
    const { user } = useUser();
    const { data: myProfile } = useMyProfile();

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
        permissionsLoaded,
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
    /**
     * The open chat's stored id, mirrored in `?session=<id>` so a reload — or a
     * link to yourself — lands back in the same conversation.
     *
     * Held in a ref as well as the URL because a send that *creates* the
     * session must know, in that same callback, that the next send is an
     * append; waiting for the router to land would save the second turn as a
     * second chat.
     */
    const sessionParam = searchParams.get("session");
    const sessionIdRef = useRef<string | null>(null);
    /** The session whose transcript is already on screen — the hydrate guard. */
    const hydratedSession = useRef<string | null>(null);
    const continuationRef = useRef<{ title: string; context: string } | null>(null);
    useEffect(() => {
        continuationRef.current = continuation;
    }, [continuation]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    /** Which AddSourceModal tab to open on — set by the Knowledge connector strip. */
    const [addTab, setAddTab] = useState<string | undefined>(undefined);
    /** A folder the Add dialog should pre-select — "New source in this folder". */
    const [addFolder, setAddFolder] = useState<string | null>(null);
    /** Clipboard contents handed to the Add dialog by "Paste to create a source". */
    const [addPrefill, setAddPrefill] = useState<{ url?: string; text?: string } | null>(null);
    /** A passage the composer should start from — set by "Ask about this" on a selection. */
    const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
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
    /** `&present=1` opens a mindmap's preview straight into the presenter. */
    const presentParam = searchParams.get("present") === "1";
    const [viewerSource, setViewerSource] = useState<WorkspaceSource | null>(null);
    const editing = editParam && viewerSource !== null && sourceApi.isMindmapSource(viewerSource);
    /** Read by the shortcut listener so the editor's own keys win while it is open. */
    const editingRef = useRef(false);
    /** The latest `expandFeature`, for the keyboard handler declared before it. */
    const expandFeatureRef = useRef<(featureId: string) => void>(() => undefined);
    /** The same, for the verbs that act on whichever column has the focus. */
    const paneVerbsRef = useRef({
        split: () => undefined as void,
        close: () => undefined as void,
        focusAdjacent: (_delta: -1 | 1) => undefined as void,
    });
    /** Cited passage to locate + highlight when the viewer was opened from a citation. */
    const [viewerHighlight, setViewerHighlight] = useState<CitationHighlight | null>(null);

    const sourceUrl = useCallback(
        (id: string | null, edit = false) => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("source");
            params.delete("edit");
            params.delete("present");
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
    /** What the delete dialog is about: one source from its row, or a multi-selection. */
    const [deleteTargets, setDeleteTargets] = useState<WorkspaceSource[] | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    /** The folder or document whose access dialog is open. */
    const [accessTarget, setAccessTarget] = useState<AccessTarget | null>(null);
    const [studioOpen, setStudioOpen] = useState(false);
    /**
     * Which apps are open, in which column, and which one each column shows.
     * Every open app stays mounted, so switching keeps drafts, scroll and undo.
     *
     * `open` both inserts and focuses, which is why it is bound to the old
     * `setActiveFeatureId` name: a tab can be closed now, and every existing
     * `setActiveFeatureId("chat")` has to mean "bring chat back".
     */
    const {
        layout,
        open: setActiveFeatureId,
        openBeside,
        close: closeTabIn,
        closeOthers,
        closeToRight,
        move: moveTab,
        split: splitTab,
        pair: pairTabs,
        merge: mergeColumns,
        focusGroup,
        focusAdjacentGroup,
    } = useStudioLayout();
    /** What the focused column shows — the app most verbs act on. */
    const activeFeatureId =
        layout.groups.find(group => group.id === layout.activeGroupId)?.activeId ?? "";
    /** Close a tab wherever it happens to be. */
    const closeTab = useCallback(
        (id: string) => {
            const group = groupOf(layout, id);
            if (group) closeTabIn(group.id, id);
        },
        [layout, closeTabIn]
    );
    /**
     * The map the Mindmap tab is editing. Held here rather than read off
     * `?source=&edit=1` because the URL moves on while the tab stays open —
     * previewing another source must not unmount a live editor.
     */
    const [editedMindmapId, setEditedMindmapId] = useState<string | null>(null);
    const editedMindmap = sources.find(source => source.id === editedMindmapId);
    /** `?source=…&edit=1` opens the map in the Mindmap tab and shows that tab. */
    useEffect(() => {
        if (!editing || viewerSource?.id !== sourceParam) return;
        setEditedMindmapId(sourceParam);
        setActiveFeatureId("mindmap");
    }, [editing, sourceParam, viewerSource?.id, setActiveFeatureId]);
    /**
     * The editor owns the keyboard only while its column is the focused one
     * and nothing is laid over it. Visible is not enough: with the map in one
     * column and the chat in another, both are on screen, and the editor
     * would otherwise eat Delete, the arrow keys and its single-letter tools
     * while someone types next to it.
     */
    const mindmapGroupFocused = groupOf(layout, "mindmap")?.id === layout.activeGroupId;
    const mindmapTabActive =
        activeFeatureId === "mindmap" &&
        mindmapGroupFocused &&
        Boolean(editedMindmap?.mindmapId) &&
        !viewerSource;
    useEffect(() => {
        editingRef.current = mindmapTabActive;
    }, [mindmapTabActive]);
    const [railHidden, setRailHidden] = useState(false);
    const railHiddenReady = useRef(false);
    /**
     * On a phone the sidebar cannot dock: at 390px its 280px left the chat —
     * and any document beside it — a column one word wide. Below the
     * breakpoint it becomes a drawer over the workspace instead, shut until
     * asked for. `railHidden` stays the desktop choice and is not touched.
     */
    const compactViewport = useCompactViewport();
    const [railDrawerOpen, setRailDrawerOpen] = useState(false);
    useEffect(() => {
        if (!compactViewport) setRailDrawerOpen(false);
    }, [compactViewport]);
    const railVisible = compactViewport ? railDrawerOpen : !railHidden;
    // Columns cannot sit side by side on a phone. A split carried over from a
    // wider window, or made by any verb that slipped through, folds into one.
    useEffect(() => {
        if (compactViewport && layout.groups.length > 1) mergeColumns();
    }, [compactViewport, layout.groups.length, mergeColumns]);
    const toggleRail = useCallback(() => {
        if (compactViewport) setRailDrawerOpen(open => !open);
        else setRailHidden(hidden => !hidden);
    }, [compactViewport]);
    /** For the window key handler, which is bound once and must not go stale. */
    const toggleRailRef = useRef(toggleRail);
    toggleRailRef.current = toggleRail;

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

    // ---------------------------------------------------------------------
    // Session persistence
    // ---------------------------------------------------------------------

    const history = useWorkspaceHistory(Boolean(userId));
    // Destructured so the callbacks below depend on the stable functions rather
    // than on the hook's object, which is new on every history state change.
    const {
        refresh: refreshHistory,
        renameEntry: renameHistoryEntry,
        removeEntry: removeHistoryEntry,
    } = history;

    useEffect(() => {
        sessionIdRef.current = sessionParam;
    }, [sessionParam]);

    const setSessionParam = useCallback(
        (id: string | null) => {
            const params = new URLSearchParams(searchParams.toString());
            if (id) params.set("session", id);
            else params.delete("session");
            const query = params.toString();
            // `replace`, not `push`: saving a chat is not a navigation, and it
            // should not make the back button undo the last thing you typed.
            router.replace(query ? `/employer/documents?${query}` : "/employer/documents");
        },
        [router, searchParams]
    );

    /** Load a stored transcript into the composer. Runs once per session id. */
    useEffect(() => {
        if (!sessionParam || hydratedSession.current === sessionParam) return;
        hydratedSession.current = sessionParam;
        let cancelled = false;
        void (async () => {
            try {
                const stored = await sessionApi.fetchSession(sessionParam);
                if (cancelled) return;
                if (!stored) {
                    // Deleted here or in another tab. Drop the param rather
                    // than sitting on a link to nothing.
                    hydratedSession.current = null;
                    setSessionParam(null);
                    toast.error("That chat is no longer available");
                    return;
                }
                setThread((stored.messages ?? []).map(toThreadMessage));
                setContinuation(stored.continuation ?? null);
                if (stored.contextSourceIds.length > 0) setSelected(stored.contextSourceIds);
                setActiveFeatureId("chat");
            } catch {
                if (!cancelled) toast.error("Couldn't reopen that chat");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionParam, setSessionParam, setActiveFeatureId]);

    /**
     * Store a completed exchange.
     *
     * Both turns go together, after the answer lands, so the stored transcript
     * is exactly what the person saw — including an error turn, which is part
     * of that conversation whether or not it is flattering. A failure here is
     * logged and swallowed: history is a convenience, and losing it must never
     * interrupt the chat that is working.
     */
    const persistTurns = useCallback(
        async (
            turns: ThreadMessage[],
            contextSourceIds: string[],
            /** What was already on screen. Only matters for the first save. */
            priorTurns: ThreadMessage[]
        ) => {
            try {
                const openSessionId = sessionIdRef.current;
                if (openSessionId) {
                    await sessionApi.appendMessages(openSessionId, {
                        messages: turns.map(toStoredMessage),
                        contextSourceIds,
                    });
                } else {
                    // Nothing is stored yet, so the whole thread belongs to the
                    // new session — including the note that opens a continued
                    // import, which would otherwise vanish on reopen. The tail
                    // slice respects the endpoint's per-write cap.
                    const opening = [...priorTurns, ...turns].slice(-MAX_SESSION_APPEND);
                    const created = await sessionApi.createSession({
                        messages: opening.map(toStoredMessage),
                        contextSourceIds,
                        continuation: continuationRef.current,
                    });
                    sessionIdRef.current = created.id;
                    // Mark it hydrated before the URL changes: the transcript
                    // is already on screen, and refetching it would be a
                    // round trip to replace the thread with itself.
                    hydratedSession.current = created.id;
                    setSessionParam(created.id);
                }
                void refreshHistory();
            } catch (error) {
                console.error("[workspace] couldn't save this chat turn", error);
            }
        },
        [refreshHistory, setSessionParam]
    );

    const startNewChat = useCallback(() => {
        setThread([]);
        setContinuation(null);
        sessionIdRef.current = null;
        hydratedSession.current = null;
        setSessionParam(null);
        setActiveFeatureId("chat");
    }, [setSessionParam, setActiveFeatureId]);

    const resumeSession = useCallback(
        (id: string) => {
            setActiveFeatureId("chat");
            if (id === sessionIdRef.current) return;
            setSessionParam(id);
        },
        [setSessionParam, setActiveFeatureId]
    );

    const handleRenameSession = useCallback(
        (id: string, title: string) => {
            renameHistoryEntry(`chat:${id}`, title);
            sessionApi.renameSession(id, title).catch(() => {
                toast.error("Couldn't rename that chat");
                void refreshHistory();
            });
        },
        [renameHistoryEntry, refreshHistory]
    );

    const handleDeleteSession = useCallback(
        (id: string) => {
            removeHistoryEntry(`chat:${id}`);
            if (id === sessionIdRef.current) startNewChat();
            sessionApi.deleteSession(id).catch(() => {
                toast.error("Couldn't delete that chat");
                void refreshHistory();
            });
        },
        [removeHistoryEntry, refreshHistory, startNewChat]
    );

    /**
     * Delete a pipeline run — a partner discovery, a trend search, a repo
     * explainer job. Same shape as the chat delete above: drop the row now so
     * the rail responds, and put it back if the server disagrees.
     */
    const handleDeleteRun = useCallback(
        (entry: HistoryEntry) => {
            removeHistoryEntry(entry.id);
            void fetch(`/api/workspace/history/${entry.kind}/${encodeURIComponent(entry.refId)}`, {
                method: "DELETE",
            })
                .then(res => {
                    if (!res.ok) throw new Error(String(res.status));
                    toast.success("Deleted");
                })
                .catch(() => {
                    toast.error("Couldn't delete that");
                    void refreshHistory();
                });
        },
        [removeHistoryEntry, refreshHistory]
    );

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

            const userTurn: ThreadMessage = {
                role: "user",
                text: send.text,
                refs: send.refs,
                attachments: send.attachments.length > 0 ? send.attachments : undefined,
            };
            setThread(prev => [...prev, userTurn]);

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

            let assistantTurn: ThreadMessage;
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

                assistantTurn = {
                    role: "assistant",
                    text: data.summarizedAnswer ?? "No answer.",
                    citations,
                    model: data.aiModel,
                    tokens: data.tokenUsage?.totalTokens,
                    tokenBreakdown: data.tokenUsage
                        ? {
                              inputTokens: data.tokenUsage.inputTokens,
                              outputTokens: data.tokenUsage.outputTokens,
                          }
                        : undefined,
                    chunksAnalyzed: data.chunksAnalyzed,
                };
            } else {
                assistantTurn = {
                    role: "assistant",
                    text:
                        data.message ??
                        data.error ??
                        "Couldn't reach the model. Try again in a moment.",
                };
            }

            setThread(prev => [...prev, assistantTurn]);
            // `thread` here is the transcript as it stood before this send —
            // exactly the "prior turns" a first save needs.
            void persistTurns([userTurn, assistantTurn], send.refs, thread);
        },
        [sources, sendQuery, companyId, continuation, thread, persistTurns]
    );

    const seedComposer = useCallback(
        (text: string, mode: "append" | "replace") => {
            setActiveFeatureId("chat");
            setComposerSeed({ text, mode, nonce: Date.now() });
        },
        [setActiveFeatureId]
    );

    /**
     * Start a new chat that keeps the transcript up to and including `index`.
     * The stored chat is left as it was; the next send creates the new one
     * with these turns in front.
     */
    const branchFrom = useCallback(
        (index: number) => {
            setThread(prev => prev.slice(0, index + 1));
            sessionIdRef.current = null;
            hydratedSession.current = null;
            setSessionParam(null);
            setActiveFeatureId("chat");
            toast.success("Branched into a new chat", {
                description: "The turns up to here come along; the original chat is untouched.",
            });
        },
        [setSessionParam, setActiveFeatureId]
    );

    /**
     * Ask the question behind turn `index` again, as a new turn at the end.
     * Appending, not replacing, keeps the screen and the stored chat the same.
     */
    const askAgain = useCallback(
        (index: number, overrides: { webSearch?: boolean; thinking?: boolean } = {}) => {
            const turn = thread[index];
            const question =
                turn?.role === "user"
                    ? turn
                    : [...thread.slice(0, index)].reverse().find(m => m.role === "user");
            if (!question) {
                toast.error("There is no question to ask again");
                return;
            }
            void sendMessage({
                text: question.text,
                refs: question.refs ?? selected,
                attachments: question.attachments ?? [],
                webSearch: overrides.webSearch ?? composerWebSearch,
                thinking: overrides.thinking ?? composerThinking,
            });
        },
        [thread, selected, sendMessage, composerWebSearch, composerThinking]
    );

    const saveAnswerAsNote = useCallback(async (text: string) => {
        const title =
            text
                .split("\n")
                .find(line => line.trim())
                ?.replace(/[#*_>`]/g, "")
                .trim()
                .slice(0, 80) ?? "Chat answer";
        try {
            const res = await fetch("/api/notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, contentMarkdown: text, tags: ["chat"] }),
            });
            if (!res.ok) throw new Error(`Failed (${res.status})`);
            toast.success("Saved to your notebook", { description: title });
        } catch {
            toast.error("Couldn't save that note");
        }
    }, []);

    const handleOpenSource = useCallback(
        (source: WorkspaceSource) => {
            setViewerHighlight(null);
            // Already beside the chat: bring that column forward rather than
            // laying an overlay over the split.
            if (groupOf(layout, tabIdOfSource(source.id))) {
                setActiveFeatureId(tabIdOfSource(source.id));
                return;
            }
            openSource(source.id);
        },
        [openSource, layout, setActiveFeatureId]
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
        if (!deleteTargets?.length) return;
        setDeleteBusy(true);
        setDeleteError(null);
        try {
            for (const source of deleteTargets) await removeSource(source);
            setDeleteTargets(null);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : "Failed to delete source");
        } finally {
            setDeleteBusy(false);
        }
    }, [deleteTargets, removeSource]);

    const requestDelete = useCallback((targets: WorkspaceSource[]) => {
        setDeleteError(null);
        setDeleteTargets(targets);
    }, []);

    /** Put a source in the chat's context without changing what is on screen. */
    const pinSource = useCallback((source: WorkspaceSource) => {
        setSelected(prev => (prev.includes(source.id) ? prev : [source.id, ...prev]));
    }, []);

    /**
     * Ask about a document without losing it. This used to pin the source and
     * close the preview, so the thing being asked about vanished the moment
     * the question started. Now the document moves into a tab of its own
     * beside the chat, and the chat takes the focus.
     */
    const handleAskAbout = useCallback(
        (source: WorkspaceSource) => {
            pinSource(source);
            // The overlay and the column would both be showing it otherwise.
            if (sourceParam) closeSource();
            setViewerHighlight(null);
            if (compactViewport) {
                // No room for two columns: the document becomes a tab beside
                // the chat's in the same strip, and the chat comes forward.
                setActiveFeatureId(tabIdOfSource(source.id));
                setActiveFeatureId("chat");
                return;
            }
            pairTabs(tabIdOfSource(source.id), "chat");
        },
        [pinSource, sourceParam, closeSource, pairTabs, compactViewport, setActiveFeatureId]
    );

    /**
     * "Ask AI" on a passage: the document stays beside the chat, and the
     * passage lands in the composer as a quote for the question to be
     * written under — not sent, since the question is the reader's to ask.
     */
    const askAboutPassage = useCallback(
        (source: WorkspaceSource, quote: string) => {
            handleAskAbout(source);
            seedComposer(quoteBlock(quote), "append");
        },
        [handleAskAbout, seedComposer]
    );

    /** Send a question about a selected passage, scoped to the document it came from. */
    const askAboutSelection = useCallback(
        (prefix: string, target: ContextTarget, ctx: MenuOpenContext) => {
            const home = selectionHome(ctx);
            const quote = (target.data as TextSelectionInfo).text;
            if (home?.kind === "document") handleAskAbout(home.source);
            setActiveFeatureId("chat");
            const from = home?.kind === "document" ? ` from “${home.source.title}”` : "";
            void sendMessage({
                text: `${prefix}${from}:\n\n${quoteBlock(quote).trimEnd()}`,
                refs: home?.kind === "document" ? [home.source.id] : selected,
                attachments: [],
                webSearch: composerWebSearch,
                thinking: composerThinking,
            });
        },
        [
            handleAskAbout,
            sendMessage,
            selected,
            composerWebSearch,
            composerThinking,
            setActiveFeatureId,
        ]
    );

    const openAdd = useCallback((tabId?: string) => {
        setAddTab(tabId);
        setAddOpen(true);
    }, []);

    /**
     * "Paste to create a source": a link on the clipboard opens the URL tab
     * prefilled, anything else opens the Paste tab with the text in place. A
     * browser that refuses clipboard reads still gets the Paste tab, empty.
     */
    const pasteToCreateSource = useCallback(async () => {
        const text = (await readClipboardText())?.trim() ?? null;
        if (text === null) {
            toast.info("Clipboard access was refused — paste with ⌘V instead");
            setAddPrefill(null);
            openAdd("paste");
            return;
        }
        if (!text) {
            toast.info("The clipboard is empty");
            return;
        }
        if (/^https?:\/\/\S+$/i.test(text)) {
            setAddPrefill({ url: text });
            openAdd("url");
        } else {
            setAddPrefill({ text });
            openAdd("paste");
        }
    }, [openAdd]);

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

    /** Opens the Studio picker — the header “Studio” control and the ⌘J toggle. */
    const openFeature = useCallback(() => setStudioOpen(true), []);

    /**
     * Every way of picking an app ends here: the picker, the Studio menu, the
     * command palette, a keyboard shortcut and `?feature=`. One of three
     * things happens, and never nothing: the app opens in a tab, a separate
     * app is navigated to, or — for the palette rows that are shortcuts to
     * somewhere else entirely — we follow that destination.
     */
    const expandFeature = useCallback(
        (featureId: string) => {
            const feature = resolveStudioFeature(featureId);
            // A separate app with its own routes and chrome. Navigate; a tab
            // cannot hold a route tree.
            if (feature?.external && feature.href) {
                setStudioOpen(false);
                router.push(feature.href);
                return;
            }
            if (!feature) {
                // Retired ids and palette rows that point outside Studio.
                const href = RETIRED_FEATURE_HREFS[featureId] ?? demotedFeatureHref(featureId);
                if (href) {
                    setStudioOpen(false);
                    router.push(href);
                }
                return;
            }
            // Fails closed: `can` answers false until permissions load.
            if (!can(feature.requires)) return;
            setActiveFeatureId(featureId);
            setStudioOpen(false);
        },
        [can, router, setActiveFeatureId]
    );
    expandFeatureRef.current = expandFeature;
    paneVerbsRef.current = {
        split: () => activeFeatureId && splitTab(activeFeatureId),
        close: () => {
            const group = groupOf(layout, activeFeatureId);
            if (!group) return;
            releaseTabs([activeFeatureId]);
            closeTabIn(group.id, activeFeatureId);
        },
        focusAdjacent: focusAdjacentGroup,
    };

    /**
     * The strip shows the open apps this person may see. An id whose feature
     * is gated is kept in the reducer but dropped here, so the tab comes back
     * if the permission does.
     */
    /**
     * Where the chat panel's own chrome sends people. Settings is a Studio app
     * now, so following the link would leave the workspace and close every
     * open tab to reach something that is one tab away. The hash is how the
     * settings panel picks its section, mounted or not.
     */
    const navigateStudio = useCallback(
        (href: string) => {
            const url = new URL(href, window.location.origin);
            if (url.pathname === "/employer/settings") {
                if (url.hash) window.location.hash = url.hash;
                expandFeature("settings");
                return;
            }
            router.push(href);
        },
        [expandFeature, router]
    );

    /**
     * What a tab id draws as. Two kinds live in the strip: Studio apps, named
     * by the registry, and sources opened beside the chat, which carry the
     * `source:` prefix so they cannot collide with an app id. An id that
     * resolves to nothing — a gated app, a source that has since gone — is
     * dropped from the strip rather than drawn without a name.
     */
    const tabFor = useCallback(
        (id: string): PaneTab | undefined => {
            if (id.startsWith(SOURCE_TAB_PREFIX)) {
                const source = sources.find(item => item.id === sourceIdOfTab(id));
                if (!source) return undefined;
                const meta = SOURCE_META[source.type] ?? SOURCE_META.doc;
                return { id, label: source.title, Icon: meta.Icon, desc: meta.label };
            }
            const feature = resolveStudioFeature(id);
            return feature && can(feature.requires) ? feature : undefined;
        },
        [sources, can]
    );

    /**
     * A source open in a column can be deleted from the rail, or trashed from
     * the viewer, while it is on screen. Close its tab rather than leaving a
     * column holding a document that is not in the library any more.
     */
    useEffect(() => {
        if (sourcesLoading) return;
        for (const group of layout.groups) {
            for (const id of group.tabIds) {
                if (!id.startsWith(SOURCE_TAB_PREFIX)) continue;
                if (!sources.some(source => source.id === sourceIdOfTab(id))) {
                    closeTabIn(group.id, id);
                }
            }
        }
    }, [sources, sourcesLoading, layout, closeTabIn]);

    /**
     * Show a tab. Studio apps go through `expandFeature`, which knows about
     * permissions, external apps and retired ids; a source is not in that
     * registry and simply becomes the visible tab of its column.
     */
    const selectTab = useCallback(
        (id: string) => {
            // The editor reports what changed by unmounting, and a tab does
            // not unmount; refresh as it leaves instead, or the rail keeps
            // the pre-edit title.
            if (activeFeatureId === "mindmap" && id !== "mindmap") void refresh();
            if (id.startsWith(SOURCE_TAB_PREFIX)) {
                setActiveFeatureId(id);
                return;
            }
            expandFeature(id);
        },
        [activeFeatureId, refresh, setActiveFeatureId, expandFeature]
    );

    /**
     * The mindmap tab owns more than a pane: an edited map, and `&edit=1` in
     * the URL. Every way of closing it has to let go of both — its own close,
     * "close the others", "close everything to the right", and the keyboard.
     */
    const releaseTabs = useCallback(
        (closing: string[]) => {
            if (!closing.includes("mindmap")) return;
            setEditedMindmapId(null);
            if (editing) closeSource();
            void refresh();
        },
        [editing, closeSource, refresh]
    );

    /** Which ids a verb is about to take out of a column. */
    const tabsRemovedBy = useCallback(
        (groupId: string, id: string, verb: "others" | "right") => {
            const group = layout.groups.find(item => item.id === groupId);
            if (!group) return [];
            const at = group.tabIds.indexOf(id);
            return verb === "others"
                ? group.tabIds.filter(other => other !== id)
                : group.tabIds.slice(at + 1);
        },
        [layout]
    );

    /** Put a source in a column of its own, beside whatever is open. */
    const openSourceBeside = useCallback(
        (source: WorkspaceSource) => {
            // The overlay and the column would otherwise both be showing a
            // document, one on top of the other.
            closeSource();
            setViewerHighlight(null);
            // "To the side" has no side on a phone; it opens as a tab.
            if (compactViewport) setActiveFeatureId(tabIdOfSource(source.id));
            else openBeside(tabIdOfSource(source.id));
        },
        [closeSource, openBeside, compactViewport, setActiveFeatureId]
    );

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
        if (featureParam && RETIRED_FEATURE_HREFS[featureParam]) {
            router.replace(RETIRED_FEATURE_HREFS[featureParam]);
            return;
        }
        if (featureParam) {
            const feature = resolveStudioFeature(featureParam);
            if (feature?.external && feature.href) {
                // A separate app: hand over to its route and stop here. Falling
                // through would strip the param with a second navigation to this
                // page, which cancels the first.
                router.replace(feature.href);
                return;
            }
            // A gated app must not be dropped just because permissions have
            // not landed. Wait for them — the effect re-runs — but only for
            // the feature param, so a connector return still toasts on time.
            if (feature?.requires && !permissionsLoaded) return;
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
                gmail: "gmail",
            };
            const label: Record<string, string> = {
                "google-drive": "Google Drive",
                slack: "Slack",
                github: "GitHub",
                gmail: "Gmail",
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

    // The workspace's share of the right-click fallback: what you can make
    // from empty space. Registered only while this shell is mounted.
    useRegisterActions([
        {
            id: "workspace.new-chat",
            label: "New chat",
            icon: "newChat",
            order: 0,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: () => startNewChat(),
        },
        {
            id: "workspace.add-knowledge",
            label: "Add knowledge",
            icon: "plus",
            shortcut: "⌘U",
            order: 1,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: () => openAdd(),
        },
        {
            id: "workspace.paste-source",
            label: "Paste to create a source",
            icon: "paste",
            order: 2,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: () => pasteToCreateSource(),
        },
        {
            id: "workspace.palette",
            label: "Command palette",
            icon: "command",
            shortcut: "⌘K",
            order: 3,
            // The palette does not list a way to open itself.
            palette: false,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: () => setPalOpen(true),
        },
        {
            id: "workspace.split",
            label: "Split to the right",
            icon: "split",
            shortcut: "⌘⌥\\",
            order: 5,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            disabled: () =>
                layout.groups.length >= MAX_GROUPS
                    ? "Every column is taken."
                    : (groupOf(layout, activeFeatureId)?.tabIds.length ?? 0) < 2
                      ? "There is only one app in this column."
                      : false,
            run: () => {
                if (activeFeatureId) splitTab(activeFeatureId);
            },
        },
        {
            id: "workspace.focus-next-column",
            label: "Focus the next column",
            icon: "move",
            order: 6,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            disabled: () => (layout.groups.length < 2 ? "The workspace is not split." : false),
            run: () => focusAdjacentGroup(1),
        },
        {
            id: "workspace.toggle-rail",
            label: railVisible ? "Hide sidebar" : "Show sidebar",
            icon: "sidebar",
            shortcut: "⌘\\",
            order: 4,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: toggleRail,
        },
    ]);

    // Session-level verbs on chat turns, and what a selected passage can
    // become. The panel and the viewer declare the targets; these are the
    // verbs that need the shell's session state to run.
    useRegisterActions([
        {
            id: "chat.message.ask-again",
            label: "Ask again",
            icon: "retry",
            order: 10,
            appliesTo: target => target.kind === "chat-message",
            disabled: () => (isSending ? "Wait for the current answer." : false),
            children: target => {
                const { index } = target.data as { index: number };
                return [
                    {
                        type: "item",
                        id: "chat.message.ask-again.same",
                        label: "Ask again",
                        icon: "retry",
                        onSelect: () => askAgain(index),
                    },
                    {
                        type: "item",
                        id: "chat.message.ask-again.web",
                        label: "Ask again with web search",
                        icon: "globe",
                        onSelect: () => askAgain(index, { webSearch: true }),
                    },
                    {
                        type: "item",
                        id: "chat.message.ask-again.think",
                        label: "Ask again with extended thinking",
                        icon: "brain",
                        onSelect: () => askAgain(index, { thinking: true }),
                    },
                ];
            },
            run: () => undefined,
        },
        {
            id: "chat.message.branch",
            label: "Branch a new chat from here",
            icon: "branch",
            order: 11,
            appliesTo: target =>
                target.kind === "chat-message" || target.kind === "chat-user-message",
            run: target => branchFrom((target.data as { index: number }).index),
        },
        {
            id: "chat.message.save-note",
            label: "Save answer as a note",
            icon: "note",
            order: 12,
            appliesTo: target => target.kind === "chat-message",
            run: target => saveAnswerAsNote((target.data as { msg: ThreadMessage }).msg.text),
        },
        {
            id: "chat.message.save-source",
            label: "Save answer as a source",
            icon: "plus",
            order: 13,
            appliesTo: target => target.kind === "chat-message",
            run: target => {
                setAddPrefill({ text: (target.data as { msg: ThreadMessage }).msg.text });
                openAdd("paste");
            },
        },
        {
            id: "chat.save-transcript-source",
            label: "Save transcript as a source",
            icon: "plus",
            order: 10,
            appliesTo: target => target.kind === "chat",
            disabled: target =>
                (target.data as { thread: ThreadMessage[] }).thread.length === 0
                    ? "Nothing to save yet."
                    : false,
            run: target => {
                const data = target.data as { thread: ThreadMessage[]; sources: WorkspaceSource[] };
                setAddPrefill({ text: transcriptMarkdown(data.thread, data.sources) });
                openAdd("paste");
            },
        },
        {
            id: "selection.ask",
            label: "Ask about this",
            icon: "ask",
            order: 0,
            appliesTo: (target, ctx) =>
                target.kind === SELECTION_TARGET_KIND && selectionHome(ctx) !== null,
            run: (target, ctx) => {
                const home = selectionHome(ctx);
                const quote = (target.data as TextSelectionInfo).text;
                if (home?.kind === "document") askAboutPassage(home.source, quote);
                else seedComposer(quoteBlock(quote), "append");
            },
        },
        {
            id: "selection.explain",
            label: "Explain this",
            icon: "explain",
            order: 1,
            appliesTo: (target, ctx) =>
                target.kind === SELECTION_TARGET_KIND && selectionHome(ctx) !== null,
            run: (target, ctx) => askAboutSelection("Explain this passage", target, ctx),
        },
        {
            id: "selection.summarise",
            label: "Summarise this",
            icon: "transcript",
            order: 2,
            appliesTo: (target, ctx) =>
                target.kind === SELECTION_TARGET_KIND && selectionHome(ctx) !== null,
            run: (target, ctx) => askAboutSelection("Summarise this passage", target, ctx),
        },
        {
            id: "selection.copy-cited",
            label: "Copy with citation",
            icon: "quote",
            order: 3,
            appliesTo: (target, ctx) =>
                target.kind === SELECTION_TARGET_KIND && selectionHome(ctx)?.kind === "document",
            run: async (target, ctx) => {
                const home = selectionHome(ctx);
                if (home?.kind !== "document") return;
                const text = citationWithSource(
                    (target.data as TextSelectionInfo).text,
                    home.source
                );
                if (await copyText(text)) toast.success("Copied with citation");
            },
        },
        {
            id: "selection.note",
            label: "Add a note with this",
            icon: "note",
            order: 4,
            appliesTo: (target, ctx) => {
                const home = selectionHome(ctx);
                return (
                    target.kind === SELECTION_TARGET_KIND &&
                    home?.kind === "document" &&
                    Boolean(home.addNote)
                );
            },
            run: (target, ctx) => {
                const home = selectionHome(ctx);
                if (home?.kind === "document")
                    home.addNote?.((target.data as TextSelectionInfo).text);
            },
        },
    ]);

    // Keyboard shortcuts: the registry in ~/lib/shortcuts/commands, with the
    // member's overrides from Settings → Shortcuts applied on top.
    const shortcutOverrides = useSettingValue<ShortcutBindings>("shortcuts.bindings");
    const bindings = useMemo(() => resolveBindings(shortcutOverrides), [shortcutOverrides]);
    const bindingsRef = useRef(bindings);
    bindingsRef.current = bindings;
    /** The member's keys, formatted for the controls that show them. */
    const shortcutHints = useMemo<ShortcutHints>(() => {
        const hint = (id: string) => {
            const keys = bindings.get(id);
            return keys ? formatKeys(keys) : null;
        };
        return {
            palette: hint("palette.toggle"),
            add: hint("source.add"),
            rail: hint("rail.toggle"),
            search: hint("search.focus"),
            studio: hint("studio.toggle"),
        };
    }, [bindings]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Something focused has already acted on this key — the tab strip
            // closing a tab, for instance. Don't run a second command on it.
            if (e.defaultPrevented) return;
            const tag = (e.target as HTMLElement | null)?.tagName;
            const inInput =
                tag === "INPUT" ||
                tag === "TEXTAREA" ||
                Boolean((e.target as HTMLElement | null)?.isContentEditable);
            const command = commandForEvent(e, bindingsRef.current, { inInput });
            if (!command) return;
            // The mindmap editor binds its own ⌘K, `/` and tool keys on the
            // same window; while it is focused, its map wins. The column
            // verbs are the exception: they move between columns and close
            // this one, so the editor must not be able to trap someone in it.
            if (editingRef.current && !command.id.startsWith("pane.")) return;
            e.preventDefault();
            switch (command.id) {
                case "palette.toggle":
                    setPalOpen(v => !v);
                    break;
                case "source.add":
                    setAddOpen(true);
                    break;
                case "studio.toggle":
                    setStudioOpen(v => !v);
                    break;
                case "rail.toggle":
                    toggleRailRef.current();
                    break;
                case "search.focus": {
                    // By attribute, not placeholder: the placeholder changes
                    // with the sidebar's tab, and on History this found nothing.
                    document.querySelector<HTMLInputElement>("[data-rail-search]")?.focus();
                    break;
                }
                case "settings.open":
                    expandFeatureRef.current("settings");
                    break;
                case "pane.split":
                    paneVerbsRef.current.split();
                    break;
                case "pane.focusNext":
                    paneVerbsRef.current.focusAdjacent(1);
                    break;
                case "pane.focusPrevious":
                    paneVerbsRef.current.focusAdjacent(-1);
                    break;
                case "pane.close":
                    paneVerbsRef.current.close();
                    break;
                default:
                    if (command.id.startsWith("feature.")) {
                        expandFeatureRef.current(command.id.slice("feature.".length));
                    }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    if (!isLoaded) return <LoadingPage />;
    if (!isSignedIn) return <LoadingPage />;

    // While a legacy `?view=X` redirect is in flight, avoid flashing the workspace.
    if (legacyRedirect) return <LoadingPage />;

    // How this workspace sees you; the session's name until the profile loads.
    const me = myProfile?.effective;
    const userName = me?.displayName ?? firstFilled(user?.name) ?? undefined;
    const userEmail = me?.email ?? user?.email;

    /** The account, at the sidebar's foot or as the collapsed strip's avatar. */
    const accountMenu = (variant: "row" | "avatar") => (
        <AccountMenu
            variant={variant}
            userName={userName}
            userEmail={userEmail}
            userTitle={me?.title}
            avatarUrl={me?.avatarUrl}
            onOpenSettings={() => expandFeature("settings")}
            onSignOut={() => signOut({ redirectUrl: LANDING_URL })}
        />
    );

    return (
        <div
            data-drift-immersive="true"
            style={{
                display: "flex",
                // `dvh`, not `vh`: on mobile `100vh` is the viewport with the
                // URL bar retracted, so the workspace's own bottom chrome ends
                // up underneath the browser's.
                height: "calc(100dvh - var(--drift-backbar-h, 0px))",
                width: "100%",
                overflow: "hidden",
                position: "relative",
            }}
        >
            {compactViewport ? (
                <Sheet open={railDrawerOpen} onOpenChange={setRailDrawerOpen}>
                    {/* The sidebar brings its own close; the sheet's would sit
                        on top of it in the same corner. */}
                    <SheetContent
                        side="left"
                        className="w-auto max-w-[85vw] gap-0 p-0 sm:max-w-[85vw] [&>button:last-child]:hidden"
                    >
                        <SheetTitle className="sr-only">Sources</SheetTitle>
                        <SourceRail
                            sources={sources}
                            folders={folders}
                            selected={selected}
                            setSelected={setSelected}
                            onOpenAdd={() => openAdd()}
                            onOpenKnowledge={() => expandFeature("knowledge")}
                            onOpenPalette={() => setPalOpen(true)}
                            shortcuts={shortcutHints}
                            accountSlot={accountMenu("row")}
                            onOpenSource={source => {
                                // Out of the way of what it opened, on a phone.
                                setRailDrawerOpen(false);
                                handleOpenSource(source);
                            }}
                            onOpenSourceBeside={source => {
                                setRailDrawerOpen(false);
                                openSourceBeside(source);
                            }}
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
                                    ? folder =>
                                          setFolderDialog({ mode: "rename", path: folder.name })
                                    : undefined
                            }
                            onMoveFolder={
                                canManageFolders
                                    ? (path, target) => void handleMoveFolder(path, target)
                                    : undefined
                            }
                            onDeleteFolder={
                                canManageFolders
                                    ? folder => setDeleteFolderPath(folder.name)
                                    : undefined
                            }
                            onShareFolder={openFolderAccess}
                            onRestrictAccess={openDocumentAccess}
                            onRenameSource={source => setRenameSource(source)}
                            onDeleteSource={source => requestDelete([source])}
                            onDeleteSources={requestDelete}
                            onAddToFolder={path => {
                                setAddFolder(path);
                                openAdd();
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
                            onClose={() =>
                                compactViewport ? setRailDrawerOpen(false) : setRailHidden(true)
                            }
                            history={{
                                entries: history.entries,
                                loading: history.loading,
                                error: history.error,
                                degraded: history.degraded,
                                activeSessionId: sessionParam,
                                onNewChat: startNewChat,
                                onResumeSession: resumeSession,
                                onOpenRun: entry => {
                                    if (entry.href) router.push(entry.href);
                                },
                                onRenameSession: handleRenameSession,
                                onDeleteSession: handleDeleteSession,
                                onDeleteRun: handleDeleteRun,
                                onRefresh: () => void refreshHistory(),
                            }}
                        />
                    </SheetContent>
                </Sheet>
            ) : !railHidden ? (
                <SourceRail
                    sources={sources}
                    folders={folders}
                    selected={selected}
                    setSelected={setSelected}
                    onOpenAdd={() => openAdd()}
                    onOpenKnowledge={() => expandFeature("knowledge")}
                    onOpenPalette={() => setPalOpen(true)}
                    shortcuts={shortcutHints}
                    accountSlot={accountMenu("row")}
                    onOpenSource={source => {
                        // Out of the way of what it opened, on a phone.
                        setRailDrawerOpen(false);
                        handleOpenSource(source);
                    }}
                    onOpenSourceBeside={source => {
                        setRailDrawerOpen(false);
                        openSourceBeside(source);
                    }}
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
                    onDeleteSource={source => requestDelete([source])}
                    onDeleteSources={requestDelete}
                    onAddToFolder={path => {
                        setAddFolder(path);
                        openAdd();
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
                    onClose={() =>
                        compactViewport ? setRailDrawerOpen(false) : setRailHidden(true)
                    }
                    history={{
                        entries: history.entries,
                        loading: history.loading,
                        error: history.error,
                        degraded: history.degraded,
                        activeSessionId: sessionParam,
                        onNewChat: startNewChat,
                        onResumeSession: resumeSession,
                        onOpenRun: entry => {
                            if (entry.href) router.push(entry.href);
                        },
                        onRenameSession: handleRenameSession,
                        onDeleteSession: handleDeleteSession,
                        onDeleteRun: handleDeleteRun,
                        onRefresh: () => void refreshHistory(),
                    }}
                />
            ) : (
                <CollapsedRail
                    onExpand={toggleRail}
                    onOpenPalette={() => setPalOpen(true)}
                    shortcuts={shortcutHints}
                    onOpenAdd={() => openAdd()}
                    accountSlot={accountMenu("avatar")}
                />
            )}

            <StudioSplitView
                layout={layout}
                splittable={!compactViewport}
                studioKeys={shortcutHints.studio}
                tabFor={tabFor}
                onSelect={selectTab}
                onClose={(groupId, id) => {
                    releaseTabs([id]);
                    closeTabIn(groupId, id);
                }}
                onCloseOthers={(groupId, id) => {
                    releaseTabs(tabsRemovedBy(groupId, id, "others"));
                    closeOthers(groupId, id);
                }}
                onCloseToRight={(groupId, id) => {
                    releaseTabs(tabsRemovedBy(groupId, id, "right"));
                    closeToRight(groupId, id);
                }}
                onSplit={splitTab}
                onMove={moveTab}
                onFocusGroup={focusGroup}
                onOpenStudio={openFeature}
                // App-wide controls live in the sidebar now. The strip keeps
                // only its own tabs — plus, on a phone, the button that opens
                // the drawer those controls are in.
                leadingSlot={
                    compactViewport && !railDrawerOpen ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-ink-3 hover:bg-line-2 hover:text-ink size-7 shrink-0 rounded-md"
                            title={"Show sidebar  ⌘\\"}
                            aria-label="Show sidebar"
                            onClick={toggleRail}
                        >
                            <PanelLeftOpen className="size-4" />
                        </Button>
                    ) : undefined
                }
                emptyState={
                    <div className="bg-surface text-ink-3 flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                        <PanelsTopLeft className="text-ink-3 size-9" strokeWidth={1.25} />
                        <h2 className="text-ink text-base font-medium">
                            Your workspace, ready when you are
                        </h2>
                        <p className="max-w-sm text-sm">Open an app from Studio to get started.</p>
                        <Button variant="outline" onClick={openFeature}>
                            <Plus className="size-4" />
                            Open Studio
                        </Button>
                    </div>
                }
                renderPane={paneId => {
                    const paneGroup = groupOf(layout, paneId);
                    const paneFocused =
                        paneGroup?.id === layout.activeGroupId && paneGroup.activeId === paneId;
                    return paneId === "chat" ? (
                        <AskPanel
                            leadingChromeInsetPx={0}
                            sources={sources}
                            selected={selected}
                            setSelected={setSelected}
                            thread={thread}
                            sendMessage={sendMessage}
                            isSending={isSending}
                            onOpenCitation={handleOpenCitation}
                            onOpenSource={handleOpenSource}
                            composerSeed={composerSeed}
                            onOpenAdd={() => setAddOpen(true)}
                            onNewChat={startNewChat}
                            openPalette={() => setPalOpen(true)}
                            onStudioNavigate={navigateStudio}
                            webSearch={composerWebSearch}
                            onToggleWebSearch={() => setComposerWebSearch(v => !v)}
                            thinking={composerThinking}
                            onToggleThinking={() => setComposerThinking(v => !v)}
                        />
                    ) : paneId.startsWith(SOURCE_TAB_PREFIX) ? (
                        <EmbeddedSourcePane
                            sourceId={sourceIdOfTab(paneId)}
                            sources={sources}
                            onClose={() => closeTab(paneId)}
                            onRename={handleRenameSource}
                            onDelete={source => void handleDeleteSource(source)}
                            onRestrictAccess={openDocumentAccess}
                            onAskAbout={handleAskAbout}
                            onAskAboutPassage={askAboutPassage}
                            onVersionChanged={() => void refresh()}
                            onEdit={source => openSource(source.id, true)}
                            onPublished={() => void refresh()}
                        />
                    ) : paneId === "mindmap" && editedMindmap?.mindmapId ? (
                        // The editor stays mounted behind a source preview —
                        // that is the point of tabs — so it is told when it is
                        // covered rather than being torn down and rebuilt.
                        <div className="h-full min-h-0">
                            <MindmapEditorHost
                                key={editedMindmap.mindmapId}
                                mindmapId={editedMindmap.mindmapId}
                                active={paneFocused && !viewerSource}
                                onBack={() => {
                                    setEditedMindmapId(null);
                                    openSource(editedMindmap.id);
                                }}
                                onChanged={() => void refresh()}
                                onAskAboutNode={text => {
                                    // Pin the map, leave the editor, and start
                                    // the question from the topic's text.
                                    // The editor is already a tab of its own,
                                    // so pin only — a preview beside it would
                                    // show the same map twice.
                                    pinSource(editedMindmap);
                                    seedComposer(quoteBlock(text), "append");
                                }}
                            />
                        </div>
                    ) : (
                        <ExpandedFeatureView
                            featureId={paneId}
                            onPaneExit={() => closeTab(paneId)}
                            paneContext={{
                                knowledge: {
                                    sources,
                                    folders,
                                    selected,
                                    setSelected,
                                    onOpenSource: handleOpenSource,
                                    onOpenSourceBeside: openSourceBeside,
                                    onOpenAdd: openAdd,
                                    onAskAbout: ids => {
                                        setSelected(ids);
                                        setActiveFeatureId("chat");
                                    },
                                    onRenameSource: source => setRenameSource(source),
                                    onDeleteSource: source => requestDelete([source]),
                                    onDeleteSources: requestDelete,
                                    onRestrictAccess: openDocumentAccess,
                                    onMoveToFolder: (id, name) => void handleMoveToFolder(id, name),
                                },
                                mindmap: { onCreate: () => openAdd("mindmap") },
                                sessions: {
                                    onImported: refresh,
                                    onOpenDocument: id => openSource(`d${id}`),
                                    onContinue: id => void startContinuation(id),
                                },
                                investors: {
                                    onDraftInChat: prompt => seedComposer(prompt, "replace"),
                                    onSaveAsSource: markdown => {
                                        setAddPrefill({ text: markdown });
                                        openAdd("paste");
                                    },
                                },
                            }}
                        />
                    );
                }}
            />

            <StudioDrawer
                open={studioOpen}
                activeFeatureId={activeFeatureId}
                onClose={() => setStudioOpen(false)}
                onPickFeature={expandFeature}
            />

            <AddSourceModal
                open={addOpen}
                initialTab={addTab}
                initialUrl={addPrefill?.url}
                initialText={addPrefill?.text}
                onClose={() => {
                    setAddOpen(false);
                    setAddTab(undefined);
                    setAddPrefill(null);
                    setAddFolder(null);
                }}
                userId={userId ?? null}
                defaultCategory={addFolder ?? activeFolder ?? UNFILED_FOLDER}
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
                history={history.entries}
                onPickHistory={entry => {
                    setPalOpen(false);
                    // As the History tab does: a chat reopens, a run opens
                    // its own surface.
                    if (HISTORY_KIND_META[entry.kind].resumable) resumeSession(entry.refId);
                    else if (entry.href) router.push(entry.href);
                }}
                onPickSource={id => {
                    setSelected(prev => (prev.includes(id) ? prev : [id, ...prev]));
                }}
                onPickFeature={id => {
                    setPalOpen(false);
                    setTimeout(() => expandFeature(id), 100);
                }}
                onPickSetting={key => {
                    setPalOpen(false);
                    // The hub reads the hash on mount and on change; the row
                    // scrolls itself into view.
                    window.location.hash = key;
                    setTimeout(() => expandFeature("settings"), 100);
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
                open={Boolean(deleteTargets?.length)}
                title={deleteDialogCopy(deleteTargets).title}
                body={deleteDialogCopy(deleteTargets).body}
                confirmLabel="Delete"
                busy={deleteBusy}
                error={deleteError}
                onConfirm={() => void confirmDeleteSource()}
                onClose={() => {
                    if (deleteBusy) return;
                    setDeleteTargets(null);
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
                    onAskAboutPassage={askAboutPassage}
                    onVersionChanged={() => void refresh()}
                    onEdit={source => openSource(source.id, true)}
                    onPublished={() => void refresh()}
                    present={presentParam}
                    onExitPresent={() => router.replace(sourceUrl(viewerSource.id))}
                />
            )}
        </div>
    );
}

/**
 * A source in a column of its own, beside the chat rather than over it.
 *
 * The viewer is the same one the overlay uses; only its placement differs.
 * The source is looked up on every render because the library moves under it,
 * so a rename retitles the pane. The missing case is a belt to the shell's
 * braces: the shell closes a tab whose source has gone, and this keeps the
 * column readable for the render in between.
 */
/** Below this, the sidebar is a drawer rather than a docked column. */
const COMPACT_VIEWPORT_BELOW_PX = 768;

/** Whether the window is phone-narrow. False on the server and on first paint. */
function useCompactViewport(): boolean {
    const [compact, setCompact] = useState(false);
    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;
        const query = window.matchMedia(`(max-width: ${COMPACT_VIEWPORT_BELOW_PX - 1}px)`);
        const update = () => setCompact(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return compact;
}

function EmbeddedSourcePane({
    sourceId,
    sources,
    onClose,
    ...viewerProps
}: {
    sourceId: string;
    sources: WorkspaceSource[];
    onClose: () => void;
    onRename: (source: WorkspaceSource, title: string) => Promise<boolean>;
    onDelete: (source: WorkspaceSource) => void;
    onRestrictAccess: (source: WorkspaceSource) => void;
    onAskAbout: (source: WorkspaceSource) => void;
    onAskAboutPassage: (source: WorkspaceSource, quote: string) => void;
    onVersionChanged: () => void;
    onEdit: (source: WorkspaceSource) => void;
    onPublished: () => void;
}) {
    const source = sources.find(item => item.id === sourceId);

    if (!source) {
        return (
            <div className="text-ink-3 flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[13px]">
                <p>This source is no longer in the library.</p>
                <Button variant="outline" size="sm" onClick={onClose}>
                    Close
                </Button>
            </div>
        );
    }

    return <DocumentViewer embedded source={source} onClose={onClose} {...viewerProps} />;
}

interface ExpandedFeatureViewProps {
    featureId: string;
    /** Close this app's tab when the pane invokes its exit / close callback. */
    onPaneExit: () => void;
    /** Workspace-owned data some panes need (Knowledge in particular). */
    paneContext?: StudioPaneContext;
}

/**
 * One app's panel. The tab strip above owns navigation; this is the panel's
 * own chrome, aligned with the AskPanel header (jump, Studio, avatar).
 */
function ExpandedFeatureView({ featureId, onPaneExit, paneContext }: ExpandedFeatureViewProps) {
    const feature = resolveStudioFeature(featureId);

    return (
        <main
            style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
                background: "var(--bg)",
            }}
        >
            <div style={workspaceMainHeaderBarStyle()}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {feature?.label ?? "Studio"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{feature?.desc ?? ""}</div>
                </div>
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
                        This app is not available.
                    </div>
                )}
            </div>
        </main>
    );
}

/** Title and body for the delete dialog: one source by name, several by count. */
function deleteDialogCopy(targets: WorkspaceSource[] | null): { title: string; body: string } {
    if (!targets?.length) return { title: "", body: "" };
    if (targets.length === 1) {
        const source = targets[0]!;
        return sourceApi.isMindmapSource(source)
            ? {
                  title: "Move this mindmap to the trash?",
                  body: `“${source.title}” will leave the library. You can undo this right after.`,
              }
            : {
                  title: "Delete this source?",
                  body: `“${source.title}” will be removed from this workspace. This cannot be undone.`,
              };
    }
    const mindmaps = targets.filter(sourceApi.isMindmapSource).length;
    const documents = targets.length - mindmaps;
    const parts: string[] = [];
    if (documents > 0) {
        parts.push(
            `${documents} ${documents === 1 ? "document" : "documents"} will be removed from this workspace — this cannot be undone`
        );
    }
    if (mindmaps > 0) {
        parts.push(
            `${mindmaps} ${mindmaps === 1 ? "mindmap goes" : "mindmaps go"} to the trash, where you can undo`
        );
    }
    return {
        title: `Delete ${targets.length} sources?`,
        body: `${parts.join("; ")}.`,
    };
}

type SelectionHome =
    | { kind: "document"; source: WorkspaceSource; addNote?: (text: string) => void }
    | { kind: "chat" };

/** Where a text selection lives — the open document, or the chat — read off the target chain. */
function selectionHome(ctx: MenuOpenContext): SelectionHome | null {
    for (const target of ctx.chain) {
        if (target.kind === "document") {
            const data = target.data as DocumentTargetData;
            return { kind: "document", source: data.source, addNote: data.addNote };
        }
        if (
            target.kind === "chat-message" ||
            target.kind === "chat-user-message" ||
            target.kind === "chat"
        ) {
            return { kind: "chat" };
        }
    }
    return null;
}
