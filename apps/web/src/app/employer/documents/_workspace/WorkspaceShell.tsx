"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
    capPassageText,
    cleanSelectionText,
    makePassage,
    MAX_PASSAGE_CHARS,
    type ChatPassage,
} from "~/lib/chat-passages";
import { PanelLeftOpen } from "lucide-react";
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
import { LANDING_HREF } from "~/config/landing";
import {
    UNFILED_FOLDER,
    folderLeafName,
    folderParentPath,
    isFolderDescendant,
    isFolderOrDescendant,
    joinFolderPath,
    normalizeFolderPath,
    replaceFolderPrefix,
    displayFolderPath,
} from "~/lib/folders/path";
import { buildContinuationContext, parseSessionTranscript } from "~/lib/session-transcript";
import { HISTORY_KIND_META, type HistoryEntry } from "~/lib/workspace-history";
import { useSettingValue } from "~/lib/settings/useSettings";
import {
    commandForEvent,
    formatKeys,
    resolveBindings,
    type ShortcutBindings,
} from "~/lib/shortcuts/commands";
import type { ShortcutHints } from "./ShortcutHint";
import { deriveRecallPrompt } from "~/lib/chat-turns";
import { useChatRuntime } from "./useChatRuntime";
import { backupChatEdit, removeChatEditBackup } from "./chatEditBackup";
import { ChatQueue } from "./ChatQueue";
import { ShareDialog, type ShareTarget } from "./access/ShareDialog";
import { moveOutcomeMessage } from "./railSections";
import type { TeamTarget } from "./team/types";
import { useAgents } from "./collab/useMeetings";
import type { ChatAgentOption } from "./collab/types";
import { AddSourceModal } from "./AddSourceModal";
import { AskPanel, type ComposerSeed } from "./AskPanel";
import type { DocumentTargetData } from "./documentContextMenu";
import { citationWithSource, transcriptMarkdown } from "./transcript";
import { CommandPalette } from "./CommandPalette";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { DocumentViewer } from "./DocumentViewer";
import { DeleteFolderDialog } from "./DeleteFolderDialog";
import { FolderDialog, type FolderDialogRequest } from "./FolderDialog";
import { MindmapEditorHost } from "./MindmapEditorHost";
import { RenameSourceDialog } from "./RenameSourceDialog";
import { SourceRail } from "./SourceRail";
import { RailResizeHandle, useRailWidth } from "./RailResizeHandle";
import { PaneLauncher } from "./PaneLauncher";
import { useLayoutPersistence } from "./useLayoutPersistence";
import * as sessionApi from "./sessionApi";
import { useWorkspaceHistory } from "./useWorkspaceHistory";
import { useSharedChatLive } from "./useSharedChatLive";
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
import { SOURCE_META, demotedFeatureHref, resolveStudioFeature, settingsSectionOf } from "./types";
import { TOOL_ALIASES, toolTargetFromHref } from "~/lib/tool-app/locations";
import { useWorkspaceData } from "./useWorkspaceData";
import { refreshProcessingQueue, useProcessingQueue } from "./processing/queueStore";
import {
    hasUnfinishedLocalTasks,
    onLocalTaskHandedOff,
    useLocalTasks,
} from "./processing/uploadTasks";
import { buildRows, tabBadge } from "./processing/viewModel";
import type {
    PassageSelection,
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
    "marketing-pipeline": "/employer/documents?feature=growth&at=%2Fbrand%2Fcampaigns",
    "repo-explainer": "/employer/tools/repo-explainer",
    distribution: "/employer/documents?feature=growth&at=%2Fprospects",
    prospects: "/employer/documents?feature=growth&at=%2Fprospects",
    growth: "/employer/documents?feature=growth",
    vantage: "/employer/documents?feature=vantage",
    proposals: "/employer/documents?feature=proposals",
    workflows: "/employer/documents?feature=workflows",
    knowledge: "/employer/documents?feature=knowledge",
    meetings: "/employer/documents?feature=meetings",
};

/** What an empty pane offers first, before "All apps". */
const LAUNCHER_APPS = ["chat", "knowledge", "meetings"] as const;

/**
 * Tools mount the first time their tab is shown. A restored layout can bring
 * back Growth, Proposals and Vantage behind the tab in front, and each would
 * otherwise load its data on every visit to the workspace for a screen
 * nobody is looking at. Once shown, a tool stays mounted like any tab.
 */
const MOUNT_ON_FIRST_SHOW = new Set([
    "growth",
    "proposals",
    "vantage",
    "scenarios",
    "investors",
    "draft",
    "rewrite",
]);

/**
 * Tabs a saved layout may bring back. The mindmap editor is left behind: it
 * edits one map, and which map is not part of the layout.
 */
function isRestorableTab(id: string): boolean {
    if (id === "mindmap") return false;
    return id.startsWith(SOURCE_TAB_PREFIX) || Boolean(resolveStudioFeature(id));
}

/**
 * Feature ids that used to be Studio entries of their own and now live
 * outside the Studio: the two imports that were tools are tabs of Add a
 * source. (Ids that became a place inside a tool — Brand, Prospects — are
 * `TOOL_ALIASES` and open that tool's tab there.)
 */
const RETIRED_FEATURE_HREFS: Record<string, string> = {
    artifacts: "/employer/documents?add=1&tab=artifact",
    "agent-sessions": "/employer/documents?add=1&tab=agent-sessions",
};

/**
 * Points the Settings hub at a section. The hub follows the hash, mounted or
 * not. Setting the hash it already has fires no `hashchange`, so announce it
 * instead: picking a section again, after moving to another inside the hub,
 * would otherwise leave the hub where it was.
 */
function showSettingsSection(section: string) {
    if (!section) return;
    if (window.location.hash.replace(/^#/, "") === section) {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
        window.location.hash = section;
    }
}

/**
 * A stored turn becomes a thread turn. `citations` and `attachments` are
 * replayed as they were written — the rail's own render payload, round-tripped
 * rather than re-derived, so a reopened chat shows the citations that answer
 * actually carried even if the library has moved on since.
 */
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
        workspaceName,
        can,
        permissionsLoaded,
        permissionsError,
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
     * `?source=<id>` is a way in, not where an open source lives: a deep link,
     * a citation from another app, a shared present link. It opens the source
     * as a tab and leaves the URL. The exception is `&edit=1`, which names the
     * mindmap the Mindmap tab is editing for as long as it is open — pushed,
     * so the back button leaves the editor.
     */
    const sourceParam = searchParams.get("source");
    const editParam = searchParams.get("edit") === "1";
    /** `&present=1` opens a mindmap's tab straight into the presenter. */
    const presentParam = searchParams.get("present") === "1";
    /** The mindmap `?source=…&edit=1` names, once the list has resolved it. */
    const [editingSource, setEditingSource] = useState<WorkspaceSource | null>(null);
    const editing = editParam && editingSource !== null;
    /** Read by the shortcut listener so the editor's own keys win while it is open. */
    const editingRef = useRef(false);
    /** The latest `expandFeature`, for the keyboard handler declared before it. */
    const expandFeatureRef = useRef<(featureId: string) => void>(() => undefined);
    /** The same, for the verbs that act on whichever column has the focus. */
    const paneVerbsRef = useRef({
        split: () => undefined as void,
        splitDown: () => undefined as void,
        zoom: () => undefined as void,
        close: () => undefined as void,
        focusAdjacent: (_delta: -1 | 1) => undefined as void,
    });
    /**
     * What a source tab opens on, when it was opened for a reason: the cited
     * passage to find and highlight, or a mindmap's presenter. One at a time —
     * the latest citation wins.
     */
    const [sourceTabFocus, setSourceTabFocus] = useState<{
        sourceId: string;
        highlight?: CitationHighlight;
        present?: boolean;
    } | null>(null);

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
    const closeSource = useCallback(() => router.push(sourceUrl(null)), [router, sourceUrl]);
    const citationNonce = useRef(0);
    const [renameSource, setRenameSource] = useState<WorkspaceSource | null>(null);
    /** What the delete dialog is about: one source from its row, or a multi-selection. */
    const [deleteTargets, setDeleteTargets] = useState<WorkspaceSource[] | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    /** The folder or document whose access dialog is open. */
    /** What the Share dialog is open for — a folder, a file, or a chat (ADR-014). */
    const [accessTarget, setAccessTarget] = useState<ShareTarget | null>(null);
    /** Bumped when a Share dialog saves, so open views read who can see what again. */
    const [accessVersion, setAccessVersion] = useState(0);
    const [studioOpen, setStudioOpen] = useState(false);
    /**
     * Which apps are open, in which pane, and which one each pane shows — and
     * how the panes are split. Every open app stays mounted, so switching
     * keeps drafts, scroll and undo.
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
        splitAtRoot,
        splitPane,
        closeGroup,
        pair: pairTabs,
        merge: mergeColumns,
        focusGroup,
        focusAdjacentGroup,
        toggleZoom,
        resize: resizeSplit,
        restore: restoreLayout,
    } = useStudioLayout();
    /** What the focused column shows — the app most verbs act on. */
    const activeFeatureId =
        layout.groups.find(group => group.id === layout.activeGroupId)?.activeId ?? "";
    /** Whose layout this is: saved per member and workspace, once both are known. */
    const layoutScope = userId && companyId != null ? `${userId}:${companyId}` : null;
    /** Why the focused pane cannot be split right now, or false when it can. */
    const splitRefusal = () =>
        layout.groups.length >= MAX_GROUPS
            ? "Every pane is taken."
            : !activeFeatureId
              ? "This pane is empty: open something in it first."
              : false;
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
        if (!editing || editingSource?.id !== sourceParam) return;
        setEditedMindmapId(sourceParam);
        setActiveFeatureId("mindmap");
    }, [editing, sourceParam, editingSource?.id, setActiveFeatureId]);
    /**
     * The editor owns the keyboard only while its column is the focused one.
     * Visible is not enough: with the map in one column and the chat in
     * another, both are on screen, and the editor would otherwise eat Delete,
     * the arrow keys and its single-letter tools while someone types next to
     * it.
     */
    const mindmapGroupFocused = groupOf(layout, "mindmap")?.id === layout.activeGroupId;
    const mindmapTabActive =
        activeFeatureId === "mindmap" && mindmapGroupFocused && Boolean(editedMindmap?.mindmapId);
    useEffect(() => {
        editingRef.current = mindmapTabActive;
    }, [mindmapTabActive]);

    /**
     * Open a source the one way sources open: as a tab in the focused pane,
     * like any other — draggable to another pane, closable from its strip.
     * Already open somewhere, it comes forward there instead of opening twice.
     */
    const openSourceTab = useCallback(
        (id: string, focus?: { highlight?: CitationHighlight; present?: boolean }) => {
            setSourceTabFocus(prev =>
                focus ? { sourceId: id, ...focus } : prev?.sourceId === id ? null : prev
            );
            setActiveFeatureId(tabIdOfSource(id));
        },
        [setActiveFeatureId]
    );
    /** A source, or with `edit` a mindmap in its editor (which the URL still names). */
    const openSource = useCallback(
        (id: string, edit = false) => {
            if (edit) router.push(sourceUrl(id, true));
            else openSourceTab(id);
        },
        [router, sourceUrl, openSourceTab]
    );

    /**
     * The browser's back button out of the editor's address shows the map's
     * tab, with the editor kept in its own behind it. Closing the editor, or
     * its Back button, lets go of the map first — those are not this.
     */
    const editingIdRef = useRef<string | null>(null);
    useEffect(() => {
        const wasEditing = editingIdRef.current;
        editingIdRef.current = editing ? (editingSource?.id ?? null) : null;
        if (wasEditing && !editing && editedMindmapId === wasEditing) openSourceTab(wasEditing);
    }, [editing, editingSource?.id, editedMindmapId, openSourceTab]);

    /**
     * Resolve `?source=` against the loaded list. A mindmap with `&edit=1`
     * stays named in the URL while its editor is open; anything else opens as
     * a tab — in the presenter for `&present=1` — and the param is dropped.
     */
    useEffect(() => {
        if (!sourceParam) {
            setEditingSource(null);
            return;
        }
        const found = sources.find(s => s.id === sourceParam) ?? null;
        if (!found) {
            if (sourcesLoading) return;
            // The list is loaded and the id is not in it — trashed, or a bad link.
            setEditingSource(null);
            router.replace(sourceUrl(null));
            return;
        }
        // A draft the caller can only view opens in the viewer instead.
        if (editParam && sourceApi.isMindmapSource(found) && found.access?.canEdit !== false) {
            setEditingSource(found);
            return;
        }
        setEditingSource(null);
        openSourceTab(found.id, presentParam ? { present: true } : undefined);
        router.replace(sourceUrl(null));
    }, [
        sourceParam,
        editParam,
        presentParam,
        sources,
        sourcesLoading,
        router,
        sourceUrl,
        openSourceTab,
    ]);
    const [railHidden, setRailHidden] = useState(false);
    const railHiddenReady = useRef(false);
    const railWidth = useRailWidth();
    /**
     * On a phone the sidebar cannot dock: at 390px its 280px left the chat —
     * and any document beside it — a column one word wide. Below the
     * breakpoint it becomes a drawer over the workspace instead, shut until
     * asked for. `railHidden` stays the desktop choice and is not touched.
     */
    const compactViewport = useCompactViewport();
    // After the viewport is known: a window too narrow for panes folds them,
    // and the fold must not be saved over the arrangement.
    useLayoutPersistence({
        scope: layoutScope,
        layout,
        restore: restoreLayout,
        keep: isRestorableTab,
        paused: compactViewport,
    });
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

    // Persist the preferred agent across reloads and on the session so a
    // reopened chat keeps its voice. Web and reasoning follow automatic defaults.
    const [composerAgentKey, setComposerAgentKey] = useState<string | null>(null);
    const composerAgentKeyRef = useRef<string | null>(null);
    composerAgentKeyRef.current = composerAgentKey;
    const composerPrefsReady = useRef(false);
    // "Put in a meeting" from the Agents app: the Meetings tab opens its
    // dialog with these seats. The nonce makes a repeat request distinct.
    const [newMeetingRequest, setNewMeetingRequest] = useState<{
        workflowKey?: string | null;
        seats?: string[];
        nonce: number;
    } | null>(null);
    // "Open X in Agents" from the palette: the Agents tab selects that agent.
    const [openAgentRequest, setOpenAgentRequest] = useState<{ key: string; nonce: number } | null>(
        null
    );
    // Where a tool's tab should go next — `?feature=growth&at=…`, the
    // palette's Brand row, a history row, a link from another tool. Keyed by
    // tool; the tab consumes its request, so reopening the tab later starts
    // where the person left it rather than replaying an old request.
    const [toolRequests, setToolRequests] = useState<
        Partial<Record<string, { at: string; nonce: number }>>
    >({});
    const toolRequestNonce = useRef(0);
    const shownTools = useRef(new Set<string>());
    const requestToolLocation = useCallback((toolId: string, at: string) => {
        toolRequestNonce.current += 1;
        const nonce = toolRequestNonce.current;
        setToolRequests(prev => ({ ...prev, [toolId]: { at, nonce } }));
    }, []);
    const consumeToolRequest = useCallback((toolId: string, nonce: number) => {
        setToolRequests(prev => {
            if (prev[toolId]?.nonce !== nonce) return prev;
            const next = { ...prev };
            delete next[toolId];
            return next;
        });
    }, []);

    // The roster: one fetch, shared by the picker, `@` completion and the
    // transcript's attribution of stored turns.
    const roster = useAgents();
    const chatAgents = useMemo<ChatAgentOption[]>(
        () =>
            (roster.data?.personas ?? [])
                .filter(p => !p.archived)
                .map(p => ({
                    id: p.id,
                    displayName: p.displayName,
                    role: p.role,
                    description: p.description,
                    accent: p.accent ?? null,
                    avatarUrl: p.avatarUrl ?? null,
                    mode: p.mode,
                    tools: p.tools,
                    builtin: p.builtin,
                })),
        [roster.data]
    );

    useEffect(() => {
        try {
            const raw = localStorage.getItem("askPanel.composer.v1");
            if (raw) {
                const parsed = JSON.parse(raw) as {
                    agentKey?: string | null;
                };
                if (typeof parsed.agentKey === "string") setComposerAgentKey(parsed.agentKey);
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
                    agentKey: composerAgentKey,
                })
            );
        } catch {
            // Quota / private mode — drop silently.
        }
    }, [composerAgentKey]);

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
        markSeen: markHistorySeen,
    } = history;
    /**
     * How I reach each chat I've opened (ADR-014): my own, or someone else's
     * shared with me to read. Learned from the read; a chat this tab created
     * is mine and never appears here.
     */
    const [chatAccess, setChatAccess] = useState<
        Record<string, sessionApi.SessionAccess & { hiddenCitations: number }>
    >({});
    const chatAccessRef = useRef(chatAccess);
    chatAccessRef.current = chatAccess;
    const historyEntriesRef = useRef(history.entries);
    historyEntriesRef.current = history.entries;
    /** Someone else's chat — read live, never written to from here. */
    const isSharedWithMe = useCallback(
        (id: string) =>
            chatAccessRef.current[id]?.level === "view" ||
            historyEntriesRef.current.some(
                entry => entry.kind === "chat" && entry.refId === id && Boolean(entry.sharedBy)
            ),
        []
    );

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

    const chatRuntime = useChatRuntime({
        scopeKey: `${userId}:${companyId}`,
        thread,
        setThread,
        sessionIdRef,
        hydratedSession,
        setSessionParam,
        continuation,
        sources,
        agents: chatAgents,
        companyId: companyId ?? null,
        refreshHistory,
    });
    const {
        busy: isSending,
        open: openChat,
        newChat: newRuntimeChat,
        fork: forkRuntime,
    } = chatRuntime;
    const [editingQueued, setEditingQueued] = useState<string | null>(null);
    const composerDraftKey = `chat:${userId}:${companyId}:${chatRuntime.key}`;
    const activeComposerKey = useRef(composerDraftKey);
    activeComposerKey.current = composerDraftKey;

    /** Load a stored transcript into the composer. Runs once per session id. */
    useEffect(() => {
        if (!sessionParam || hydratedSession.current === sessionParam) return;
        setComposerSeed(null);
        setEditingQueued(null);
        hydratedSession.current = sessionParam;
        // Someone else's chat is read live (ADR-014): always fetch it, never
        // reopen what this tab cached.
        if (!isSharedWithMe(sessionParam) && openChat(sessionParam)) return;
        let cancelled = false;
        void (async () => {
            try {
                const stored = await sessionApi.fetchSession(sessionParam);
                if (cancelled) return;
                if (!stored) {
                    // Deleted here or in another tab, or no longer shared.
                    // Drop the param rather than sitting on a link to nothing.
                    hydratedSession.current = null;
                    setSessionParam(null);
                    toast.error("That chat is no longer available");
                    return;
                }
                const access = stored.access;
                if (access) {
                    setChatAccess(prev => ({
                        ...prev,
                        [sessionParam]: { ...access, hiddenCitations: stored.hiddenCitations ?? 0 },
                    }));
                    if (access.level === "view") markHistorySeen(sessionParam);
                }
                openChat(sessionParam, stored);
                setContinuation(stored.continuation ?? null);
                if (stored.contextSourceIds.length > 0) setSelected(stored.contextSourceIds);
                if (stored.agentKey !== undefined) setComposerAgentKey(stored.agentKey ?? null);
                setActiveFeatureId("chat");
            } catch {
                if (!cancelled) toast.error("Couldn't reopen that chat");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [
        sessionParam,
        setSessionParam,
        setActiveFeatureId,
        openChat,
        isSharedWithMe,
        markHistorySeen,
    ]);

    const startNewChat = useCallback(() => {
        setComposerSeed(null);
        newRuntimeChat();
        setEditingQueued(null);
        setThread([]);
        setContinuation(null);
        sessionIdRef.current = null;
        hydratedSession.current = null;
        setSessionParam(null);
        setActiveFeatureId("chat");
    }, [setSessionParam, setActiveFeatureId, newRuntimeChat]);

    const resumeSession = useCallback(
        (id: string) => {
            setActiveFeatureId("chat");
            if (id === sessionIdRef.current) return;
            setComposerSeed(null);
            setEditingQueued(null);
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
     * "Continue in a new chat" (ADR-014): the server copies a chat I can read
     * into a private one of mine — citations already filtered to what I can
     * open — and the composer moves to it.
     */
    const continueInNewChat = useCallback(
        async (id: string) => {
            try {
                const fork = await sessionApi.forkSession(id);
                // The header's title comes from History: load the copy into it
                // first, so the new chat never opens as "New chat".
                await refreshHistory();
                resumeSession(fork.id);
                toast.success("Continued in a new chat", {
                    description: "This copy is yours and private. The original is unchanged.",
                });
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't continue that chat");
            }
        },
        [refreshHistory, resumeSession]
    );

    /** The open chat is someone else's: whose, so the panel can say so; undefined when it's mine. */
    const openChatAccess = sessionParam ? chatAccess[sessionParam] : undefined;
    const openChatSharer =
        openChatAccess?.level === "view"
            ? openChatAccess.ownerAuthUserId
            : sessionParam
              ? history.entries.find(entry => entry.kind === "chat" && entry.refId === sessionParam)
                    ?.sharedBy
              : undefined;
    const readOnlyChatRef = useRef(false);
    readOnlyChatRef.current = Boolean(openChatSharer);

    useSharedChatLive({
        sessionId: openChatSharer ? sessionParam : null,
        shownCount: () => thread.length,
        onFresh: (id, stored) => {
            if (sessionIdRef.current !== id) return;
            setChatAccess(prev =>
                stored.access
                    ? {
                          ...prev,
                          [id]: { ...stored.access, hiddenCitations: stored.hiddenCitations ?? 0 },
                      }
                    : prev
            );
            openChat(id, stored);
            markHistorySeen(id);
        },
        onGone: id => {
            if (sessionIdRef.current !== id) return;
            toast.info("That chat is no longer shared with you");
            startNewChat();
            void refreshHistory();
        },
    });

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
            if (editingQueued) {
                if (!chatRuntime.queue.items.some(item => item.id === editingQueued)) {
                    toast.error(
                        "That queued message was already sent or removed. Your edits remain in the composer."
                    );
                    return false;
                }
                const saved = await chatRuntime.modifyQueue(
                    chatRuntime.queue.items.map(item =>
                        item.id === editingQueued ? { ...item, send } : item
                    )
                );
                if (saved) setEditingQueued(null);
                return saved;
            }
            return chatRuntime.submit(send);
        },
        [chatRuntime, editingQueued]
    );

    const editQueuedMessage = useCallback(
        (id: string) => {
            const item = chatRuntime.queue.items.find(queued => queued.id === id);
            if (!item) return;
            setEditingQueued(id);
            setComposerSeed({
                ...item.send,
                mode: "replace",
                nonce: Date.now(),
                draftKey: composerDraftKey,
            });
            setActiveFeatureId("chat");
        },
        [chatRuntime.queue.items, setActiveFeatureId, composerDraftKey]
    );

    const seedComposer = useCallback(
        (text: string, mode: "append" | "replace", passages?: ChatPassage[]) => {
            setActiveFeatureId("chat");
            setComposerSeed({
                text,
                mode,
                nonce: Date.now(),
                draftKey: composerDraftKey,
                ...(passages?.length ? { passages } : {}),
            });
        },
        [setActiveFeatureId, composerDraftKey]
    );

    /**
     * Start a new chat that keeps the transcript up to and including `index`.
     * The copied prefix is persisted immediately; reopening keeps its full context.
     */
    const branchFrom = useCallback(
        async (index: number) => {
            setComposerSeed(null);
            setEditingQueued(null);
            const prefix = thread
                .slice(0, index + 1)
                .map((message, position) =>
                    position === 0 && sessionIdRef.current
                        ? { ...message, forkedFromSessionId: sessionIdRef.current }
                        : message
                );
            const saving = forkRuntime(prefix);
            sessionIdRef.current = null;
            hydratedSession.current = null;
            setSessionParam(null);
            setActiveFeatureId("chat");
            if (await saving)
                toast.success("Fork saved as a new chat", {
                    description: "The turns up to here come along; the original chat is untouched.",
                });
        },
        [setSessionParam, setActiveFeatureId, forkRuntime, thread]
    );

    /**
     * Retry the question behind turn `index` after rewinding its replaced suffix.
     * Appending, not replacing, keeps the screen and the stored chat the same.
     */
    const payloadForMessage = useCallback(
        (message: ThreadMessage): ComposerSend =>
            message.send
                ? { ...message.send, webSearch: true, thinking: true }
                : {
                      text: message.text,
                      refs: message.refs ?? selected,
                      attachments: message.attachments ?? [],
                      webSearch: true,
                      thinking: true,
                      agentKey: message.agent?.key ?? composerAgentKey,
                  },
        [selected, composerAgentKey]
    );

    const askAgain = useCallback(
        async (index: number) => {
            let questionIndex = index;
            while (questionIndex >= 0 && thread[questionIndex]?.role !== "user") questionIndex--;
            const question = thread[questionIndex];
            if (!question) return;
            try {
                const send = payloadForMessage(question);
                const backup = backupChatEdit(composerDraftKey, send);
                if (!backup)
                    throw new Error(
                        "Couldn't save prompt recovery. Free browser storage before retrying; the original conversation is intact."
                    );
                const result = await chatRuntime.retry(questionIndex, send);
                if (result === true || (typeof result === "object" && result.success))
                    removeChatEditBackup(composerDraftKey, backup);
            } catch (error) {
                toast.error(
                    error instanceof Error ? error.message : "Couldn't retry this response"
                );
            }
        },
        [thread, payloadForMessage, chatRuntime, composerDraftKey]
    );

    const editFromHere = useCallback(
        async (index: number) => {
            const question = thread[index];
            if (question?.role !== "user") return;
            try {
                const send = payloadForMessage(question);
                if (!backupChatEdit(composerDraftKey, send))
                    throw new Error(
                        "Couldn't save prompt recovery. Free browser storage before editing; the original conversation is intact."
                    );
                await chatRuntime.rewind(index);
                if (activeComposerKey.current === composerDraftKey)
                    setComposerSeed({
                        ...send,
                        mode: "append",
                        nonce: Date.now(),
                        draftKey: composerDraftKey,
                    });
                else
                    toast.success(
                        "The edited question is saved with prompts in its original conversation."
                    );
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Couldn't edit this message");
            }
        },
        [thread, payloadForMessage, chatRuntime, composerDraftKey]
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
        (source: WorkspaceSource) => openSourceTab(source.id),
        [openSourceTab]
    );

    /** A citation click opens the cited document's tab with the passage highlighted. */
    const handleOpenCitation = useCallback(
        (cite: ThreadReference) => {
            const src = sources.find(s => s.id === cite.sourceId);
            if (!src) return;
            citationNonce.current += 1;
            openSourceTab(src.id, {
                highlight: {
                    text: cite.snippet,
                    matchText: cite.matchText,
                    page: cite.page ?? null,
                    nonce: citationNonce.current,
                },
            });
        },
        [sources, openSourceTab]
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
            if (compactViewport) {
                // No room for two columns: the document becomes a tab beside
                // the chat's in the same strip, and the chat comes forward.
                setActiveFeatureId(tabIdOfSource(source.id));
                setActiveFeatureId("chat");
                return;
            }
            pairTabs(tabIdOfSource(source.id), "chat");
        },
        [pinSource, pairTabs, compactViewport, setActiveFeatureId]
    );

    /**
     * "Ask AI" on a passage: the document stays beside the chat, and the
     * passage lands in the composer as a card above the question — not sent,
     * since the question is the reader's to ask. The passage travels beside
     * the question (with its page), never pasted into it.
     */
    const askAboutPassage = useCallback(
        (source: WorkspaceSource, selection: PassageSelection) => {
            const passage = passageFromSource(source, selection);
            if (!passage) return;
            handleAskAbout(source);
            seedComposer("", "append", [passage]);
        },
        [handleAskAbout, seedComposer]
    );

    /** Send a question about a selected passage, scoped to the document it came from. */
    const askAboutSelection = useCallback(
        (question: string, target: ContextTarget, ctx: MenuOpenContext) => {
            const home = selectionHome(ctx);
            const passage = passageFromSelection(target.data as TextSelectionInfo, home);
            if (!passage) return;
            if (home?.kind === "document") handleAskAbout(home.source);
            setActiveFeatureId("chat");
            void sendMessage({
                text: question,
                refs: home?.kind === "document" ? [home.source.id] : selected,
                attachments: [],
                webSearch: true,
                thinking: true,
                agentKey: composerAgentKey,
                passages: [passage],
            });
        },
        [handleAskAbout, sendMessage, selected, composerAgentKey, setActiveFeatureId]
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
                const moved = await sourceApi.moveSource(src, folderName);
                await refresh();
                // Say what the move did to who can see it (ADR-014: a file
                // private to you takes the folder's audience; Unfiled makes
                // it yours alone).
                const leaf = folderLeafName(folderName);
                toast.success(`Moved to ${leaf}`, {
                    description: moveOutcomeMessage(moved.access, leaf) ?? undefined,
                });
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't move that");
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

    /**
     * Open what a notification or an activity row points at. A file that was
     * just shared is not in the loaded list yet, so the list is refetched once
     * before giving up on it.
     */
    const openTeamTarget = useCallback(
        async (target: TeamTarget) => {
            setRailDrawerOpen(false);
            if (target.type === "chat") {
                resumeSession(target.id);
                return;
            }
            if (target.type === "folder") {
                setActiveFolder(target.path);
                return;
            }
            const known = sources.find(s => s.documentId === target.id);
            if (known) {
                handleOpenSource(known);
                return;
            }
            // Just shared with me: not in the loaded list yet. The tab opens by
            // id and fills in once the refetch lands.
            await refresh();
            openSourceTab(`d${target.id}`);
        },
        [sources, refresh, handleOpenSource, openSourceTab, resumeSession]
    );

    const shareTeamTarget = useCallback((target: TeamTarget & { name: string }) => {
        if (target.type === "chat")
            setAccessTarget({ kind: "chat", id: target.id, name: target.name });
        else if (target.type === "folder")
            setAccessTarget({
                kind: "folder",
                path: target.path,
                name: displayFolderPath(target.path),
            });
        else setAccessTarget({ kind: "document", id: target.id, name: target.name });
    }, []);

    /** The sidebar's inbox bell; the rail itself shows where the item lives. */
    const inboxRail = useMemo(
        () => ({ onOpenTarget: (target: TeamTarget) => void openTeamTarget(target) }),
        [openTeamTarget]
    );

    /**
     * A request for the sidebar to show its Sources or History half, answered
     * once (`onRevealed`). The Team tab is not in the sidebar, so opening
     * something from it asks the sidebar to show where that thing lives.
     */
    const [railReveal, setRailReveal] = useState<{
        tab: "sources" | "history";
        nonce: number;
    } | null>(null);
    const consumeRailReveal = useCallback(
        (nonce: number) => setRailReveal(current => (current?.nonce === nonce ? null : current)),
        []
    );

    const teamTab = useMemo(
        () => ({
            onOpenTarget: (target: TeamTarget) => {
                void openTeamTarget(target);
                setRailReveal({
                    tab: target.type === "chat" ? "history" : "sources",
                    nonce: Date.now(),
                });
                // A folder opens as the sidebar's scope; nothing shows if the
                // sidebar is put away, so bring it out. (A file or a chat
                // opens in a tab and needs no sidebar.)
                if (target.type === "folder") {
                    if (compactViewport) setRailDrawerOpen(true);
                    else setRailHidden(false);
                }
            },
            onShare: shareTeamTarget,
        }),
        [openTeamTarget, shareTeamTarget, compactViewport]
    );

    // ADR-014: anyone who can add sources can make a folder (a new top-level
    // one is private to them). Renaming, moving or deleting one is per folder
    // — its `access.canManage` — and filing a file needs edit on the file and
    // on the folder; the rail checks both per row.
    const canAddFolders = can("documents.upload");
    const canFileSources = can("documents.edit");
    const folderPaths = useMemo(() => folders.map(f => f.name), [folders]);
    /** Where an upload may land: folders the caller can add to (and Unfiled). */
    const uploadFolderPaths = useMemo(
        () => folders.filter(f => f.access?.canEdit !== false).map(f => f.name),
        [folders]
    );
    /** Who can see each folder, for the Add dialog's "who can see it" line. */
    const folderAccessByPath = useMemo(() => {
        const out: Record<string, NonNullable<WorkspaceFolder["access"]>> = {};
        for (const f of folders) if (f.access) out[normalizeFolderPath(f.name)] = f.access;
        return out;
    }, [folders]);

    /**
     * One call for every folder mutation; resolves to an error message or null.
     * `onData` sees the response body on success (a create's real path, a
     * move's effect on who can see it).
     */
    const folderRequest = useCallback(
        async (
            method: "POST" | "PATCH" | "DELETE",
            body: Record<string, string>,
            onData?: (data: Record<string, unknown>) => void
        ) => {
            try {
                const res = await fetch("/api/folders", {
                    method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                const json = (await res.json().catch(() => ({}))) as {
                    success?: boolean;
                    message?: string;
                    data?: Record<string, unknown>;
                };
                if (!res.ok || !json.success) {
                    return json.message ?? `Request failed (${res.status})`;
                }
                onData?.(json.data ?? {});
                await refresh();
                return null;
            } catch (err) {
                return err instanceof Error ? err.message : "Request failed";
            }
        },
        [refresh]
    );

    /**
     * Create a folder and resolve to the path it really got: a name already
     * held by a folder you can't see comes back as "Name (2)" (ADR-014), and
     * the person is told why.
     */
    const createFolderAt = useCallback(
        async (path: string): Promise<{ failure: string | null; path: string }> => {
            let actual = path;
            const failure = await folderRequest("POST", { path }, data => {
                if (typeof data.renamedTo === "string" && data.renamedTo) {
                    actual = data.renamedTo;
                    toast.info(`Created “${folderLeafName(actual)}”`, {
                        description: `This workspace already has a folder called “${folderLeafName(path)}”.`,
                    });
                }
            });
            return { failure, path: actual };
        },
        [folderRequest]
    );

    const handleCreateFolder = useCallback(
        async (path: string) => (await createFolderAt(path)).failure,
        [createFolderAt]
    );

    const handleRenameFolder = useCallback(
        async (path: string, newPath: string) => {
            let access: unknown = null;
            const failure = await folderRequest("PATCH", { path, newPath }, data => {
                access = data.access;
            });
            // A move that changed (or deliberately kept) who can see it says so.
            if (!failure && folderParentPath(path) !== folderParentPath(newPath)) {
                const leaf = folderLeafName(newPath);
                const where = folderParentPath(newPath);
                const description =
                    access === "kept_audience" || access === "inherits_folder"
                        ? moveOutcomeMessage(access, where ? folderLeafName(where) : leaf)
                        : null;
                toast.success(
                    where ? `Moved to ${folderLeafName(where)}` : `Moved ${leaf} to the top level`,
                    {
                        description: description ?? undefined,
                    }
                );
            }
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
     * command palette, a keyboard shortcut and `?feature=`. The app opens in
     * a tab — every Studio app does, tools with screens of their own
     * included. Ids that name a place inside a tool (Brand, Prospects) open
     * that tool there; the palette rows that are shortcuts to somewhere else
     * entirely follow that destination.
     */
    const expandFeature = useCallback(
        (requestedId: string, groupId?: string) => {
            const alias = TOOL_ALIASES[requestedId];
            if (alias) requestToolLocation(alias.toolId, alias.at);
            const featureId = alias?.toolId ?? requestedId;
            const feature = resolveStudioFeature(featureId);
            if (!feature) {
                // Retired ids and palette rows that point outside Studio.
                const href = RETIRED_FEATURE_HREFS[featureId] ?? demotedFeatureHref(featureId);
                if (!href) return;
                const section = settingsSectionOf(href);
                if (section !== undefined) {
                    // "Agents & nodes", "Workspace" and the like are sections
                    // of Settings, which is a tab here. Following the link
                    // would leave the workspace and close every open tab.
                    showSettingsSection(section);
                    expandFeatureRef.current("settings");
                    return;
                }
                setStudioOpen(false);
                router.push(href);
                return;
            }
            // Fails closed: `can` answers false until permissions load.
            if (!can(feature.requires)) {
                // Once they have, an app that explains its gate says why
                // nothing opened — a Guest following a Team link lands on
                // the chat otherwise, with no word. One toast per app. Not
                // when the answer failed: an owner would be told the app
                // isn't part of their role.
                if (permissionsLoaded && !permissionsError && feature.deniedNote) {
                    toast.info(`${feature.label} isn't part of your role`, {
                        id: `denied:${feature.id}`,
                        description: feature.deniedNote,
                    });
                }
                return;
            }
            setActiveFeatureId(featureId, groupId);
            setStudioOpen(false);
        },
        [can, permissionsLoaded, permissionsError, router, setActiveFeatureId, requestToolLocation]
    );
    expandFeatureRef.current = expandFeature;

    /**
     * Something was added (an upload, a folder, a link, a Drive or Gmail
     * import): show the Processing tab, which follows it from its first byte
     * to "ready". Asks the queue at once so the file is there when the tab is.
     */
    const openProcessing = useCallback(() => {
        expandFeature("processing");
        void refreshProcessingQueue();
    }, [expandFeature]);

    // An upload the dialog handed off reached the server: the library gains
    // its row now, and the queue picks up its job.
    useEffect(
        () =>
            onLocalTaskHandedOff(() => {
                void refresh();
                void refreshProcessingQueue();
            }),
        [refresh]
    );

    // Adding something opens the Processing tab: fetch its code while the
    // dialog is up, so the tab draws the moment the dialog hands over.
    useEffect(() => {
        if (addOpen) void import("./processing/ProcessingQueuePane");
    }, [addOpen]);

    // Leaving the page drops a file whose bytes are still going up.
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (!hasUnfinishedLocalTasks()) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, []);

    /** A tool's tab, at a place inside it: "/prospects/companies/12". */
    const openTool = useCallback(
        (toolId: string, at: string) => {
            requestToolLocation(toolId, at);
            expandFeature(toolId);
        },
        [expandFeature, requestToolLocation]
    );

    /**
     * An app in a pane beside what is showing — ⌘-click in Studio, or its
     * "Open beside". The same placement as a source opened to the side: the
     * pane to the right if there is one, a new one if there is room.
     */
    const openFeatureBeside = useCallback(
        (featureId: string) => {
            const feature = resolveStudioFeature(featureId);
            if (compactViewport || !feature || !can(feature.requires)) {
                expandFeature(featureId);
                return;
            }
            setStudioOpen(false);
            openBeside(featureId);
        },
        [compactViewport, can, expandFeature, openBeside]
    );
    paneVerbsRef.current = {
        split: () => splitPane("right"),
        splitDown: () => splitPane("down"),
        zoom: () => toggleZoom(),
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
            const section = settingsSectionOf(href);
            if (section !== undefined) {
                showSettingsSection(section);
                expandFeature("settings");
                return;
            }
            // A tool's screen — its old `/employer/tools/…` URL included —
            // is its tab here, not a page to leave for.
            const target = toolTargetFromHref(href);
            if (target && resolveStudioFeature(target.toolId)) {
                openTool(target.toolId, target.at);
                return;
            }
            router.push(href);
        },
        [expandFeature, openTool, router]
    );

    // The Processing tab says how many files are still moving beside its
    // name — polled only while that tab is open somewhere.
    const processingOpen = layout.groups.some(group => group.tabIds.includes("processing"));
    const processingQueue = useProcessingQueue(processingOpen);
    const localTasks = useLocalTasks();
    const processingBadge = useMemo(
        () =>
            processingOpen
                ? tabBadge(
                      buildRows({
                          items: processingQueue.data?.items ?? [],
                          local: localTasks,
                          viewerId: userId ?? null,
                          cleared: new Set(),
                          mineOnly: false,
                          now: Date.now(),
                      })
                  )
                : null,
        [processingOpen, processingQueue.data, localTasks, userId]
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
            if (!feature || !can(feature.requires)) return undefined;
            if (id === "processing" && processingBadge) {
                return {
                    ...feature,
                    count: processingBadge.count,
                    countTone: processingBadge.tone,
                };
            }
            return feature;
        },
        [sources, can, processingBadge]
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
     * permissions, places inside tools and retired ids; a source is not in that
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
            // "To the side" has no side on a phone; it opens as a tab.
            if (compactViewport) setActiveFeatureId(tabIdOfSource(source.id));
            else openBeside(tabIdOfSource(source.id));
        },
        [openBeside, compactViewport, setActiveFeatureId]
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
    // `?ask=<text>` — open the chat with this question in the composer. How
    // another app (Proposals, for one) hands a question about the sources to
    // the workspace without owning a chat of its own.
    const askParam = searchParams.get("ask");
    // `?feature=<tool>&at=<path>` — a tool's tab at one of its screens.
    const atParam = searchParams.get("at");
    useEffect(() => {
        if (!featureParam && !addParam && !connectorParam && !continueParam && !askParam) return;
        if (legacyRedirect) return;
        if (featureParam && RETIRED_FEATURE_HREFS[featureParam]) {
            router.replace(RETIRED_FEATURE_HREFS[featureParam]);
            return;
        }
        if (featureParam) {
            const feature = resolveStudioFeature(featureParam);
            // A gated app must not be dropped just because permissions have
            // not landed. Wait for them — the effect re-runs — but only for
            // the feature param, so a connector return still toasts on time.
            if (feature?.requires && !permissionsLoaded) return;
            if (feature && atParam) requestToolLocation(featureParam, atParam);
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
        if (askParam?.trim()) seedComposer(askParam.trim().slice(0, 4_000), "replace");
        if (connectorParam) {
            const tabByProvider: Record<string, string> = {
                "google-drive": "drive",
                slack: "slack",
                github: "github",
                gmail: "gmail",
            };
            // LinkedIn returns into Growth › Brand › Accounts (`feature=growth`
            // above), so it has no Add-source tab to reopen.
            const label: Record<string, string> = {
                "google-drive": "Google Drive",
                slack: "Slack",
                github: "GitHub",
                gmail: "Gmail",
                linkedin: "LinkedIn",
                bluesky: "Bluesky",
            };
            const tab = tabByProvider[connectorParam];
            const name = label[connectorParam] ?? connectorParam;
            if (tab) {
                setAddTab(tab);
                setAddOpen(true);
            }
            if (connectorResultParam === "connected") {
                toast.success(`${name} connected`);
            } else if (connectorResultParam === "no-channels") {
                toast.warning(
                    `${name} connected, but the sign-in gave no permission to post. Check the scopes under Accounts.`
                );
            } else if (connectorResultParam === "partial") {
                toast.warning(
                    `${name} connected, but its Pages could not be read. Use Refresh Pages under Accounts.`
                );
            } else if (connectorResultParam === "denied") {
                toast.info(`${name} connection was cancelled`);
            } else {
                toast.error(`${name} connection failed — try again`);
            }
        }
        const params = new URLSearchParams(searchParams.toString());
        params.delete("feature");
        params.delete("at");
        params.delete("add");
        params.delete("tab");
        params.delete("connector");
        params.delete("result");
        params.delete("continue");
        params.delete("ask");
        const query = params.toString();
        router.replace(query ? `/employer/documents?${query}` : "/employer/documents");
    }, [
        featureParam,
        addParam,
        tabParam,
        connectorParam,
        connectorResultParam,
        continueParam,
        askParam,
        atParam,
        legacyRedirect,
        permissionsLoaded,
        expandFeature,
        requestToolLocation,
        startContinuation,
        seedComposer,
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
            label: "Split right",
            icon: "split",
            shortcut: formatKeys("Mod+Alt+\\"),
            order: 5,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            disabled: () => splitRefusal(),
            run: () => splitPane("right"),
        },
        {
            id: "workspace.split-down",
            label: "Split down",
            icon: "splitDown",
            shortcut: formatKeys("Mod+Alt+Shift+\\"),
            order: 5,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            disabled: () => splitRefusal(),
            run: () => splitPane("down"),
        },
        {
            id: "workspace.zoom",
            label: layout.zoomedGroupId ? "Restore the other panes" : "Maximize this pane",
            icon: "expand",
            shortcut: formatKeys("Mod+Shift+Enter"),
            order: 6,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            disabled: () =>
                layout.groups.length < 2 && !layout.zoomedGroupId
                    ? "The workspace is not split."
                    : false,
            run: () => toggleZoom(),
        },
        {
            id: "workspace.focus-next-column",
            label: "Focus the next pane",
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
            // Someone else's chat is read-only here; it is continued as a fork.
            appliesTo: target => target.kind === "chat-message" && !readOnlyChatRef.current,
            disabled: () => (isSending ? "Wait for the current answer." : false),
            run: target => void askAgain((target.data as { index: number }).index),
        },
        {
            id: "chat.message.branch",
            label: "Branch a new chat from here",
            icon: "branch",
            order: 11,
            appliesTo: target =>
                (target.kind === "chat-message" || target.kind === "chat-user-message") &&
                !readOnlyChatRef.current,
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
                const selection = target.data as TextSelectionInfo;
                if (home?.kind === "document")
                    askAboutPassage(home.source, {
                        text: selection.text,
                        page: pageOfSelection(selection),
                    });
                else {
                    const passage = passageFromSelection(selection, home);
                    if (passage) seedComposer("", "append", [passage]);
                }
            },
        },
        {
            id: "selection.explain",
            label: "Explain this",
            icon: "explain",
            order: 1,
            appliesTo: (target, ctx) =>
                target.kind === SELECTION_TARGET_KIND && selectionHome(ctx) !== null,
            run: (target, ctx) => askAboutSelection("Explain this passage.", target, ctx),
        },
        {
            id: "selection.summarise",
            label: "Summarise this",
            icon: "transcript",
            order: 2,
            appliesTo: (target, ctx) =>
                target.kind === SELECTION_TARGET_KIND && selectionHome(ctx) !== null,
            run: (target, ctx) => askAboutSelection("Summarise this passage.", target, ctx),
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
            splitRight: hint("pane.split"),
            splitDown: hint("pane.splitDown"),
            zoom: hint("pane.zoom"),
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
            // "Focused" is the editor's own test (`isActive` in
            // MindmapEditor): with the focus in the tab strip it lets go of
            // every key, so they are the workspace's again. Closing a tab
            // leaves the focus on the tab that took its place, and when that
            // was the editor's, ⌘K went to neither palette.
            const editorHasKeys =
                editingRef.current && !document.activeElement?.closest("[data-studio-tab-strip]");
            if (editorHasKeys && !command.id.startsWith("pane.")) return;
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
                case "pane.splitDown":
                    paneVerbsRef.current.splitDown();
                    break;
                case "pane.zoom":
                    paneVerbsRef.current.zoom();
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

    /** The History tab's props — one object for the docked rail and the drawer. */
    const historyRail = useMemo(
        () => ({
            entries: history.entries,
            loading: history.loading,
            error: history.error,
            degraded: history.degraded,
            activeSessionId: sessionParam,
            onNewChat: startNewChat,
            onResumeSession: resumeSession,
            onOpenRun: (entry: HistoryEntry) => {
                if (entry.href) navigateStudio(entry.href);
            },
            onRenameSession: handleRenameSession,
            onDeleteSession: handleDeleteSession,
            onDeleteRun: handleDeleteRun,
            onRefresh: () => void refreshHistory(),
            onSetPinned: history.setPinned,
            onSetArchived: history.setArchived,
            onReorderPins: history.reorderPins,
            onShareSession: (entry: HistoryEntry) =>
                setAccessTarget({ kind: "chat", id: entry.refId, name: entry.title }),
            onContinueSession: (entry: HistoryEntry) => void continueInNewChat(entry.refId),
            archived: history.archived,
            onArchivedOpenChange: history.setArchivedOpen,
        }),
        [
            history.entries,
            history.loading,
            history.error,
            history.degraded,
            history.setPinned,
            history.setArchived,
            history.reorderPins,
            history.archived,
            history.setArchivedOpen,
            sessionParam,
            startNewChat,
            resumeSession,
            navigateStudio,
            handleRenameSession,
            handleDeleteSession,
            handleDeleteRun,
            refreshHistory,
            continueInNewChat,
        ]
    );

    if (!isLoaded) return <LoadingPage label="Opening your workspace…" />;
    if (!isSignedIn) return <LoadingPage label="Opening your workspace…" />;

    // While a legacy `?view=X` redirect is in flight, avoid flashing the workspace.
    if (legacyRedirect) return <LoadingPage label="Opening your workspace…" />;

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
            onSignOut={() => signOut({ redirectUrl: LANDING_HREF })}
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
                        // A row's menu is portaled outside the drawer; pressing
                        // in it is not "outside" — the drawer stays open and
                        // the menu item runs.
                        onInteractOutside={e => {
                            if (isInsideActionMenu(e.target)) e.preventDefault();
                        }}
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
                                canAddFolders
                                    ? parentPath =>
                                          setFolderDialog({
                                              mode: "create",
                                              parentPath: parentPath ?? null,
                                          })
                                    : undefined
                            }
                            onRenameFolder={
                                canAddFolders
                                    ? folder =>
                                          setFolderDialog({ mode: "rename", path: folder.name })
                                    : undefined
                            }
                            onMoveFolder={
                                canAddFolders
                                    ? (path, target) => void handleMoveFolder(path, target)
                                    : undefined
                            }
                            onDeleteFolder={
                                canAddFolders
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
                                canFileSources
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
                            inbox={inboxRail}
                            revealTab={railReveal}
                            onRevealed={consumeRailReveal}
                            workspaceName={workspaceName}
                            selfAuthId={userId ?? null}
                            history={historyRail}
                            loading={sourcesLoading}
                        />
                    </SheetContent>
                </Sheet>
            ) : !railHidden ? (
                <>
                    <SourceRail
                        width={railWidth.width}
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
                            canAddFolders
                                ? parentPath =>
                                      setFolderDialog({
                                          mode: "create",
                                          parentPath: parentPath ?? null,
                                      })
                                : undefined
                        }
                        onRenameFolder={
                            canAddFolders
                                ? folder => setFolderDialog({ mode: "rename", path: folder.name })
                                : undefined
                        }
                        onMoveFolder={
                            canAddFolders
                                ? (path, target) => void handleMoveFolder(path, target)
                                : undefined
                        }
                        onDeleteFolder={
                            canAddFolders ? folder => setDeleteFolderPath(folder.name) : undefined
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
                            canFileSources
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
                        inbox={inboxRail}
                        revealTab={railReveal}
                        onRevealed={consumeRailReveal}
                        workspaceName={workspaceName}
                        selfAuthId={userId ?? null}
                        history={historyRail}
                        loading={sourcesLoading}
                    />
                    <RailResizeHandle
                        width={railWidth.width}
                        onPreview={railWidth.preview}
                        onCommit={railWidth.commit}
                    />
                </>
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
                onSplitRoot={splitAtRoot}
                paneKeys={shortcutHints}
                onSplitPane={(groupId, side) => splitPane(side, groupId)}
                onCloseGroup={groupId => {
                    releaseTabs(layout.groups.find(group => group.id === groupId)?.tabIds ?? []);
                    closeGroup(groupId);
                }}
                onToggleZoom={toggleZoom}
                onResize={resizeSplit}
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
                renderEmpty={groupId => (
                    <PaneLauncher
                        title={
                            layout.groups.length > 1
                                ? "Open something here"
                                : "Your workspace, ready when you are"
                        }
                        hint={
                            layout.groups.length > 1
                                ? "Pick an app, or drag a tab or a source from the sidebar here."
                                : "Open an app to get started. Later, drag a tab or a source to any edge to split, or ⌘-click one to open it beside."
                        }
                        apps={LAUNCHER_APPS.flatMap(id => {
                            const feature = resolveStudioFeature(id);
                            return feature && can(feature.requires) ? [feature] : [];
                        })}
                        onPick={id => expandFeature(id, groupId)}
                        onMore={() => {
                            focusGroup(groupId);
                            openFeature();
                        }}
                    />
                )}
                renderPane={paneId => {
                    const paneGroup = groupOf(layout, paneId);
                    const paneFocused =
                        paneGroup?.id === layout.activeGroupId && paneGroup.activeId === paneId;
                    if (paneGroup?.activeId === paneId) shownTools.current.add(paneId);
                    if (MOUNT_ON_FIRST_SHOW.has(paneId) && !shownTools.current.has(paneId)) {
                        return null;
                    }
                    return paneId === "chat" ? (
                        <AskPanel
                            leadingChromeInsetPx={0}
                            sources={sources}
                            selected={selected}
                            setSelected={setSelected}
                            thread={thread}
                            sendMessage={sendMessage}
                            isSending={isSending}
                            draftKey={composerDraftKey}
                            threadContextOptions={history.entries
                                .filter(
                                    entry => entry.kind === "chat" && entry.refId !== sessionParam
                                )
                                .map(entry => ({ id: entry.refId, title: entry.title }))}
                            onOpenThreadContext={resumeSession}
                            promptHistory={thread
                                .map(deriveRecallPrompt)
                                .filter((text): text is string => Boolean(text))}
                            onStop={chatRuntime.stop}
                            queuedCount={chatRuntime.queue.items.length}
                            editingQueued={Boolean(editingQueued)}
                            queuedEditUnavailable={Boolean(
                                editingQueued &&
                                    !chatRuntime.queue.items.some(item => item.id === editingQueued)
                            )}
                            onCancelQueueEdit={() => setEditingQueued(null)}
                            onQueueSendOldest={() => {
                                const oldest = chatRuntime.queue.items[0];
                                if (oldest) void chatRuntime.sendNow(oldest.id);
                            }}
                            onQueueEditLatest={() => {
                                const latest = chatRuntime.queue.items.at(-1);
                                if (latest) editQueuedMessage(latest.id);
                            }}
                            queueContent={
                                <ChatQueue
                                    items={chatRuntime.queue.items}
                                    held={chatRuntime.held}
                                    busy={isSending}
                                    editingId={editingQueued}
                                    onEdit={editQueuedMessage}
                                    onCancelEdit={() => setEditingQueued(null)}
                                    onRemove={id => {
                                        if (editingQueued === id) setEditingQueued(null);
                                        void chatRuntime.modifyQueue(
                                            chatRuntime.queue.items.filter(item => item.id !== id)
                                        );
                                    }}
                                    onReorder={items => void chatRuntime.modifyQueue(items)}
                                    onResume={() => void chatRuntime.resume()}
                                    onSendNow={id => void chatRuntime.sendNow(id)}
                                />
                            }
                            onRetryMessage={
                                openChatSharer ? undefined : index => void askAgain(index)
                            }
                            onEditMessage={
                                openChatSharer ? undefined : index => void editFromHere(index)
                            }
                            onOpenParentChat={
                                thread[0]?.forkedFromSessionId
                                    ? () => resumeSession(thread[0]!.forkedFromSessionId!)
                                    : undefined
                            }
                            onForkMessage={openChatSharer ? undefined : branchFrom}
                            readOnly={
                                openChatSharer && sessionParam
                                    ? {
                                          ownerAuthUserId: openChatSharer,
                                          hiddenCitations: openChatAccess?.hiddenCitations ?? 0,
                                          onContinue: () => continueInNewChat(sessionParam),
                                      }
                                    : undefined
                            }
                            onShare={
                                sessionParam && !openChatSharer
                                    ? () =>
                                          setAccessTarget({
                                              kind: "chat",
                                              id: sessionParam,
                                              name:
                                                  history.entries.find(
                                                      entry => entry.refId === sessionParam
                                                  )?.title ?? "This chat",
                                          })
                                    : undefined
                            }
                            onSaveMessage={index => {
                                const message = thread[index];
                                if (message) void saveAnswerAsNote(message.text);
                            }}
                            onImplementPlan={text => {
                                startNewChat();
                                void chatRuntime.submit({
                                    text: `Carry out this plan using the available workspace tools and explain the result:\n\n${text}`,
                                    refs: selected,
                                    attachments: [],
                                    webSearch: true,
                                    thinking: true,
                                    agentKey: composerAgentKey,
                                    chatMode: "default",
                                    origin: "plan-implementation",
                                });
                            }}
                            title={
                                [...history.entries, ...history.archived.entries].find(
                                    entry => entry.refId === sessionParam
                                )?.title ?? "New chat"
                            }
                            onRename={
                                sessionParam && !openChatSharer
                                    ? title => handleRenameSession(sessionParam, title)
                                    : undefined
                            }
                            onOpenCitation={handleOpenCitation}
                            onOpenSource={handleOpenSource}
                            composerSeed={composerSeed}
                            onOpenAdd={() => setAddOpen(true)}
                            onNewChat={startNewChat}
                            openPalette={() => setPalOpen(true)}
                            onStudioNavigate={navigateStudio}
                            agents={chatAgents}
                            agentKey={composerAgentKey}
                            onChangeAgent={setComposerAgentKey}
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
                            highlight={
                                sourceTabFocus?.sourceId === sourceIdOfTab(paneId)
                                    ? (sourceTabFocus.highlight ?? null)
                                    : null
                            }
                            present={
                                sourceTabFocus?.sourceId === sourceIdOfTab(paneId) &&
                                sourceTabFocus.present === true
                            }
                            onExitPresent={() =>
                                setSourceTabFocus(prev =>
                                    prev?.sourceId === sourceIdOfTab(paneId) ? null : prev
                                )
                            }
                        />
                    ) : paneId === "mindmap" && editedMindmap?.mindmapId ? (
                        // The editor stays mounted behind other tabs — that is
                        // the point of tabs — so it is told when its column is
                        // not the focused one rather than being torn down.
                        <div className="h-full min-h-0">
                            <MindmapEditorHost
                                key={editedMindmap.mindmapId}
                                mindmapId={editedMindmap.mindmapId}
                                active={paneFocused}
                                onBack={() => {
                                    setEditedMindmapId(null);
                                    // Leave the editor's address; the URL
                                    // effect then shows the map in its tab.
                                    router.push(sourceUrl(editedMindmap.id));
                                }}
                                onChanged={() => void refresh()}
                                onAskAboutNode={text => {
                                    // Pin the map, leave the editor, and start
                                    // the question from the topic's text.
                                    // The editor is already a tab of its own,
                                    // so pin only — a preview beside it would
                                    // show the same map twice.
                                    pinSource(editedMindmap);
                                    const passage = passageFromSource(editedMindmap, { text });
                                    if (passage) seedComposer("", "append", [passage]);
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
                                agents: {
                                    onUseInChat: agentKey => {
                                        setComposerAgentKey(agentKey);
                                        setActiveFeatureId("chat");
                                        toast.success(
                                            `${chatAgents.find(a => a.id === agentKey)?.displayName ?? agentKey} will answer your next message`
                                        );
                                    },
                                    onStartMeeting: agentKey => {
                                        setNewMeetingRequest({
                                            seats: [agentKey],
                                            nonce: Date.now(),
                                        });
                                        expandFeature("meetings");
                                    },
                                    onOpenAgents: () => expandFeature("agents"),
                                    newMeetingRequest,
                                    openAgentRequest,
                                },
                                team: teamTab,
                                processing: {
                                    viewerId: userId ?? null,
                                    storageScope: layoutScope ?? undefined,
                                    onOpenDocument: documentId => {
                                        const id = `d${documentId}`;
                                        if (sources.some(source => source.id === id)) {
                                            openSource(id);
                                        } else {
                                            void refresh().then(() => openSource(id));
                                        }
                                    },
                                    onAddSource: () => openAdd(),
                                    onSettled: () => void refresh(),
                                },
                                investors: {
                                    onDraftInChat: prompt => seedComposer(prompt, "replace"),
                                    onSaveAsSource: markdown => {
                                        setAddPrefill({ text: markdown });
                                        openAdd("paste");
                                    },
                                },
                                tool: {
                                    // Hidden tabs stay mounted; only the
                                    // focused one may own the keyboard.
                                    active: paneFocused,
                                    request: toolRequests[paneId] ?? null,
                                    storageScope: layoutScope,
                                    openTool,
                                    openHref: navigateStudio,
                                    consumeRequest: nonce => consumeToolRequest(paneId, nonce),
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
                onPickFeature={(featureId, options) =>
                    options?.beside ? openFeatureBeside(featureId) : expandFeature(featureId)
                }
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
                defaultCategory={
                    [addFolder, activeFolder].find(
                        (path): path is string => !!path && uploadFolderPaths.includes(path)
                    ) ?? UNFILED_FOLDER
                }
                folders={uploadFolderPaths}
                onCreateFolder={
                    canAddFolders
                        ? async path => {
                              const made = await createFolderAt(path);
                              if (made.failure) toast.error(made.failure);
                              // The picker selects the folder that was really made.
                              return made.failure ? null : made.path;
                          }
                        : undefined
                }
                knownFolders={folderPaths}
                folderAccess={folderAccessByPath}
                workspaceName={workspaceName}
                onShareFolder={path =>
                    setAccessTarget({ kind: "folder", path, name: displayFolderPath(path) })
                }
                accessVersion={accessVersion}
                onUploaded={() => {
                    void refresh();
                }}
                onQueued={openProcessing}
                sessions={{
                    onImported: refresh,
                    onOpenDocument: id => openSource(`d${id}`),
                    onContinue: id => void startContinuation(id),
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
                    else if (entry.href) navigateStudio(entry.href);
                }}
                onPickSource={id => {
                    setSelected(prev => (prev.includes(id) ? prev : [id, ...prev]));
                }}
                agents={chatAgents}
                onAskAgent={agentKey => {
                    setPalOpen(false);
                    setComposerAgentKey(agentKey);
                    setActiveFeatureId("chat");
                }}
                onOpenAgent={agentKey => {
                    setPalOpen(false);
                    setOpenAgentRequest({ key: agentKey, nonce: Date.now() });
                    setTimeout(() => expandFeature("agents"), 100);
                }}
                onPickFeature={id => {
                    setPalOpen(false);
                    setTimeout(() => expandFeature(id), 100);
                }}
                onPickSetting={key => {
                    setPalOpen(false);
                    // The hub reads the hash on mount and on change; the row
                    // scrolls itself into view.
                    showSettingsSection(key);
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

            <ShareDialog
                target={accessTarget}
                onClose={() => setAccessTarget(null)}
                onSaved={() => {
                    setAccessVersion(v => v + 1);
                    void refresh();
                    void refreshHistory();
                }}
                selfAuthId={userId ?? null}
            />
        </div>
    );
}

/** True for anything inside an open context menu or its backdrop (both portaled to <body>). */
function isInsideActionMenu(target: EventTarget | null): boolean {
    return (
        target instanceof Element &&
        Boolean(target.closest('[data-testid="context-menu-backdrop"], [role="menu"]'))
    );
}

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

/**
 * A source in its tab. The source is looked up on every render because the
 * library moves under it, so a rename retitles the pane. The missing case is a
 * belt to the shell's braces: the shell closes a tab whose source has gone,
 * and this keeps the column readable for the render in between.
 */
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
    onAskAboutPassage: (source: WorkspaceSource, selection: PassageSelection) => void;
    onVersionChanged: () => void;
    onEdit: (source: WorkspaceSource) => void;
    onPublished: () => void;
    highlight: CitationHighlight | null;
    present: boolean;
    onExitPresent: () => void;
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

    return <DocumentViewer source={source} {...viewerProps} />;
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

    // No header bar of its own: the tab above already names the app, with its
    // description in the tab's tooltip, and the apps open with a heading of
    // their own. Three titles stacked in a half-width pane was two too many.
    return (
        <main className="bg-surface flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
                {feature ? (
                    renderStudioPane(feature, onPaneExit, paneContext)
                ) : (
                    <div className="text-ink-3 flex h-full items-center justify-center text-[13px]">
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

/** A selection in a source as a passage to ask about. */
function passageFromSource(
    source: WorkspaceSource,
    selection: PassageSelection
): ChatPassage | null {
    return notedPassage({
        sourceId: source.id,
        documentId: source.documentId,
        title: source.title,
        page: selection.page,
        text: selection.text,
    });
}

/** `makePassage`, saying so when a long selection had to be cut. */
function notedPassage(input: Parameters<typeof makePassage>[0]): ChatPassage | null {
    if (capPassageText(cleanSelectionText(input.text)).truncated)
        toast.info(
            `Long selection: the first ${MAX_PASSAGE_CHARS.toLocaleString()} characters were kept.`
        );
    return makePassage(input);
}

/**
 * The page a right-click selection sits on, read off the PDF page element
 * around it (react-pdf stamps `data-page-number` on each page).
 */
function pageOfSelection(selection: TextSelectionInfo): number | undefined {
    const page = Number(
        selection.container?.closest("[data-page-number]")?.getAttribute("data-page-number")
    );
    return Number.isInteger(page) && page > 0 ? page : undefined;
}

/** A right-click selection as a passage: from its document, or from this chat. */
function passageFromSelection(
    selection: TextSelectionInfo,
    home: SelectionHome | null
): ChatPassage | null {
    if (home?.kind === "document")
        return passageFromSource(home.source, {
            text: selection.text,
            page: pageOfSelection(selection),
        });
    return notedPassage({ sourceId: "chat", title: "This conversation", text: selection.text });
}

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
