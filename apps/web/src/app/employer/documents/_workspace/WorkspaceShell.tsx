"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth, useUser } from "~/lib/auth-client";
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
import { MAX_SESSION_APPEND } from "~/lib/workspace-history";
import { useSettingValue } from "~/lib/settings/useSettings";
import { commandForEvent, resolveBindings, type ShortcutBindings } from "~/lib/shortcuts/commands";
import { useAIChat } from "../hooks/useAIChat";
import { AccessDialog, type AccessTarget } from "./access/AccessDialog";
import { AddSourceModal } from "./AddSourceModal";
import {
    AskPanel,
    AvatarMenu,
    JumpToPaletteButton,
    workspaceMainHeaderBarStyle,
    type ComposerSeed,
} from "./AskPanel";
import type { DocumentTargetData } from "./documentContextMenu";
import { citationWithSource, quoteBlock, transcriptMarkdown } from "./transcript";
import { CommandPalette } from "./CommandPalette";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { DocumentViewer } from "./DocumentViewer";
import { IconChevronRight } from "./icons";
import { DeleteFolderDialog } from "./DeleteFolderDialog";
import { FolderDialog, type FolderDialogRequest } from "./FolderDialog";
import { MindmapEditorHost } from "./MindmapEditorHost";
import { RenameSourceDialog } from "./RenameSourceDialog";
import { SourceRail } from "./SourceRail";
import * as sessionApi from "./sessionApi";
import { useWorkspaceHistory } from "./useWorkspaceHistory";
import { StudioDrawer } from "./StudioDrawer";
import { StudioMenu } from "./StudioMenu";
import { renderStudioPane, type StudioPaneContext } from "./StudioPanes";
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
    "marketing-pipeline": "/employer/tools/marketing-pipeline",
    "repo-explainer": "/employer/tools/repo-explainer",
    distribution: "/employer/tools/distribution",
    prospects: "/employer/tools/prospects",
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
    "workflows",
    "marketing",
    "distribution",
    "prospects",
    "knowledge",
    "meetings",
    "metadata",
    "settings",
    "analytics",
    "mindmap",
]);

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
    useEffect(() => {
        editingRef.current = editing;
    }, [editing]);
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
    }, [sessionParam, setSessionParam]);

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
    }, [setSessionParam]);

    const resumeSession = useCallback(
        (id: string) => {
            setActiveFeatureId("chat");
            if (id === sessionIdRef.current) return;
            setSessionParam(id);
        },
        [setSessionParam]
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
                    tokens: data.chunksAnalyzed,
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

    const seedComposer = useCallback((text: string, mode: "append" | "replace") => {
        setActiveFeatureId("chat");
        setComposerSeed({ text, mode, nonce: Date.now() });
    }, []);

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
        [setSessionParam]
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

    const handleAskAbout = useCallback(
        (source: WorkspaceSource) => {
            setSelected(prev => (prev.includes(source.id) ? prev : [source.id, ...prev]));
            closeSource();
        },
        [closeSource]
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
        [handleAskAbout, sendMessage, selected, composerWebSearch, composerThinking]
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
            // A mindmap is a source, not a pane: "Mindmap" means "start one".
            if (featureId === "mindmap") {
                setStudioOpen(false);
                openAdd("mindmap");
                return;
            }
            // Separate apps own their own route: navigate rather than
            // expanding a pane whose only content is a link to that route.
            if (feature?.external && feature.href) {
                setStudioOpen(false);
                router.push(feature.href);
                return;
            }
            setActiveFeatureId(featureId);
            setStudioOpen(false);
        },
        [openAdd, router]
    );
    expandFeatureRef.current = expandFeature;

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
        if (featureParam && FEATURE_IDS.has(featureParam)) {
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
            id: "workspace.toggle-rail",
            label: railHidden ? "Show sidebar" : "Hide sidebar",
            icon: "sidebar",
            shortcut: "⌘\\",
            order: 4,
            appliesTo: target => target.kind === APP_TARGET_KIND,
            run: () => setRailHidden(v => !v),
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
                if (home?.kind === "document") handleAskAbout(home.source);
                seedComposer(quoteBlock((target.data as TextSelectionInfo).text), "append");
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
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // The mindmap editor binds its own ⌘K, `/` and tool keys on the
            // same window; while it is open, its map wins.
            if (editingRef.current) return;
            const tag = (e.target as HTMLElement | null)?.tagName;
            const inInput =
                tag === "INPUT" ||
                tag === "TEXTAREA" ||
                Boolean((e.target as HTMLElement | null)?.isContentEditable);
            const command = commandForEvent(e, bindingsRef.current, { inInput });
            if (!command) return;
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
                    setRailHidden(v => !v);
                    break;
                case "search.focus": {
                    const el = document.querySelector<HTMLInputElement>(
                        'input[placeholder="Search your knowledge"]'
                    );
                    el?.focus();
                    break;
                }
                case "settings.open":
                    expandFeatureRef.current("settings");
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
                height: "calc(100dvh - var(--drift-backbar-h, 0px))",
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
                    onNewMindmap={() => openAdd("mindmap")}
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
                    onClose={() => setRailHidden(true)}
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
                        onRefresh: () => void refreshHistory(),
                    }}
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

            {editing && viewerSource?.mindmapId ? (
                // The editor takes the main area and the rail stays, so
                // another source is one click away without "leaving". It
                // needs a definite height: this column is the flex row's
                // full height, and `minHeight: 0` lets the canvas shrink to it.
                <main
                    style={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        background: "var(--bg)",
                    }}
                >
                    <MindmapEditorHost
                        key={viewerSource.mindmapId}
                        mindmapId={viewerSource.mindmapId}
                        onBack={() => openSource(viewerSource.id)}
                        onChanged={() => void refresh()}
                        onAskAboutNode={text => {
                            // Pin the map, leave the editor, and start the
                            // question from the topic's text.
                            handleAskAbout(viewerSource);
                            seedComposer(quoteBlock(text), "append");
                        }}
                    />
                </main>
            ) : activeFeatureId === "chat" ? (
                <AskPanel
                    leadingChromeInsetPx={railHidden ? RAIL_HIDDEN_HEADER_INSET_PX : 0}
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
                            onDeleteSource: source => requestDelete([source]),
                            onDeleteSources: requestDelete,
                            onRestrictAccess: openDocumentAccess,
                            onMoveToFolder: (id, name) => void handleMoveToFolder(id, name),
                        },
                        mindmap: { onCreate: () => openAdd("mindmap") },
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
