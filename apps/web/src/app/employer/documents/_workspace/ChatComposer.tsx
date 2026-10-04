"use client";

import React, {
    Suspense,
    lazy,
    type Dispatch,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ArrowUp,
    Bot,
    Brain,
    Check,
    FileText,
    Globe,
    Paperclip,
    Save,
    Search,
    Settings2,
    Square,
    Star,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { useContextTarget } from "~/components/context-menu";
import { copyText, readClipboardText } from "~/lib/context-menu";
import type { ChatSendResult } from "~/lib/chat-turns";
import {
    mentionQueryAt,
    mentionedAgentKeys,
    resolveChatTurn,
    usableAsPrimary,
    usableAsSubagent,
} from "~/lib/agents/definition";
import { cn } from "~/lib/utils";
import { useChatRoutes, type ChatRouteName } from "../hooks/useChatRoutes";
import { SourceChip, type ComposerSeed } from "./AskPanel";
import { AgentAvatar } from "./collab/AgentAvatar";
import type { ChatAgentOption } from "./collab/types";
import { buildComposerMenuItems } from "./chatContextMenu";
import { ChatAttachmentChip } from "./ChatAttachmentChip";
import { safeChatUri } from "./ChatMarkdown";
import type { ComposerSend, EphemeralAttachment, WorkspaceSource } from "./types";
import {
    ATTACH_MAX_COUNT,
    COMPOSER_MAX_CHARACTERS,
    FILE_MAX_BYTES,
    IMAGE_MAX_BYTES,
    TOTAL_IMAGE_MAX_BYTES,
    caretAtVisualBoundary,
    checkComposerAttachmentAvailability,
    composerDocumentWithoutContext,
    isComposerDraft,
    kindForFile,
    listContinuation,
    modelSearchMatches,
    readComposerStorage,
    shouldAttachPaste,
    writeComposerStorage,
    type ComposerDraft,
    type ComposerAttachmentAvailability,
    type ComposerPreferences,
    type PromptStash,
} from "./composerState";
import type { ComposerContext, RichChatEditorHandle } from "./RichChatEditor";
import type { JSONContent } from "@tiptap/react";
import {
    needsComposerImagePreparation,
    normalizeComposerFile,
    resizeComposerImage,
} from "./composerImages";

let serializeRichDocument: ((document: JSONContent) => string) | undefined;
let validateRichDocument: ((document: unknown) => document is JSONContent) | undefined;
const RichChatEditor = lazy(async () => {
    const richModule = await import("./RichChatEditor");
    serializeRichDocument = richModule.composerJsonToMarkdown;
    validateRichDocument = richModule.validComposerDocument;
    return richModule;
});

const attachmentAvailabilityKey = (attachment: EphemeralAttachment) =>
    `${attachment.id}:${attachment.url}`;

export type ComposerSendResult = boolean | ChatSendResult;

export interface ComposerProps {
    sources: WorkspaceSource[];
    selected: string[];
    setSelected: Dispatch<SetStateAction<string[]>>;
    onSend: (send: ComposerSend) => void | ComposerSendResult | Promise<ComposerSendResult>;
    disabled?: boolean;
    active?: boolean;
    onStop?: () => void;
    onNewChat?: () => void;
    draftKey?: string;
    promptHistory?: string[];
    queuedCount?: number;
    onQueueEditLatest?: () => void;
    onQueueSendOldest?: () => void;
    editingQueued?: boolean;
    queuedEditUnavailable?: boolean;
    onCancelQueueEdit?: () => void;
    threadContextOptions?: { id: string; title: string }[];
    folderContextOptions?: { id: string; name: string }[];
    onOpenThreadContext?: (id: string) => void;
    webSearch: boolean;
    onToggleWebSearch: () => void;
    thinking: boolean;
    onToggleThinking: () => void;
    onOpenSource?: (source: WorkspaceSource) => void;
    seed?: ComposerSeed | null;
    agents: ChatAgentOption[];
    agentKey: string | null;
    onChangeAgent: (key: string | null) => void;
}

interface UploadRow {
    id: string;
    file: File;
    kind: "image" | "text";
    replacesId?: string;
    status: "uploading" | "failed" | "canceled";
    progress: number;
    error?: string;
}
const ROUTES: ChatRouteName[] = ["default", "fast", "reasoning", "vision"];
function defaultSendKey(): ComposerPreferences["sendKey"] {
    return typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches
        ? "mod-enter"
        : "enter";
}
const COMMANDS = [
    { id: "new", name: "/new", detail: "Start a new conversation" },
    { id: "model", name: "/model", detail: "Choose a configured model" },
    { id: "plan", name: "/plan", detail: "Plan before answering" },
    { id: "default", name: "/default", detail: "Return to normal answers" },
    { id: "sources", name: "/sources", detail: "Choose source context" },
] as const;

export function Composer({
    sources,
    selected,
    setSelected,
    onSend,
    disabled = false,
    active = false,
    onStop,
    onNewChat,
    draftKey,
    promptHistory = [],
    queuedCount = 0,
    onQueueEditLatest,
    onQueueSendOldest,
    editingQueued = false,
    queuedEditUnavailable = false,
    onCancelQueueEdit,
    threadContextOptions = [],
    folderContextOptions = [],
    onOpenThreadContext,
    webSearch,
    onToggleWebSearch,
    thinking,
    onToggleThinking,
    onOpenSource,
    seed,
    agents,
    agentKey,
    onChangeAgent,
}: ComposerProps) {
    const [text, setText] = useState("");
    const [focus, setFocus] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [attachments, setAttachments] = useState<EphemeralAttachment[]>([]);
    const [attachmentAvailability, setAttachmentAvailability] = useState<
        Record<string, ComposerAttachmentAvailability>
    >({});
    const [uploads, setUploads] = useState<UploadRow[]>([]);
    const [preparingFiles, setPreparingFiles] = useState(false);
    const [missingFiles, setMissingFiles] = useState<string[]>([]);
    const [attachError, setAttachError] = useState<string | null>(null);
    const [storageError, setStorageError] = useState(false);
    const [failedPromptAvailable, setFailedPromptAvailable] = useState(false);
    const [modelRoute, setModelRoute] = useState<ChatRouteName>("default");
    const [modelRoutes, setModelRoutes] = useState<ChatRouteName[]>([]);
    const [threadRefs, setThreadRefs] = useState<string[]>([]);
    const [inspectedThread, setInspectedThread] = useState<string | null>(null);
    const [reasoningEffort, setReasoningEffort] = useState<string | undefined>();
    const [chatMode, setChatMode] = useState<"default" | "plan">("default");
    const [modelOpen, setModelOpen] = useState(false);
    const [modelSearch, setModelSearch] = useState("");
    const [sourceOpen, setSourceOpen] = useState(false);
    const [sourceSearch, setSourceSearch] = useState("");
    const [stashes, setStashes] = useState<PromptStash[]>([]);
    const [stashOpen, setStashOpen] = useState(false);
    const [sendKey, setSendKey] = useState<ComposerPreferences["sendKey"]>(defaultSendKey);
    const [favorites, setFavorites] = useState<string[]>([]);
    const [followUp, setFollowUp] = useState<"queue" | "interrupt">("queue");
    const [editorMode, setEditorMode] = useState<"plain" | "rich">("plain");
    const [richContent, setRichContent] = useState<JSONContent | null>(null);
    const [loadedKey, setLoadedKey] = useState<string | undefined>();
    const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
    const [slash, setSlash] = useState<{ query: string; start: number } | null>(null);
    const [completionIndex, setCompletionIndex] = useState(0);
    const [recallIndex, setRecallIndex] = useState<number | null>(null);
    const ref = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadsRef = useRef<UploadRow[]>([]);
    const attachmentsRef = useRef<EphemeralAttachment[]>([]);
    const verifiedUploads = useRef(new Set<string>());
    const reattachInputRef = useRef<HTMLInputElement>(null);
    const reattachAttachmentId = useRef<string | null>(null);
    const reattachOriginKey = useRef<string | undefined>(undefined);
    const requests = useRef(new Map<string, XMLHttpRequest>());
    const shiftPaste = useRef(false);
    const beforeQueueEdit = useRef<ComposerDraft | null>(null);
    const richRef = useRef<RichChatEditorHandle>(null);
    const richChipIds = useRef<ComposerContext[]>([]);
    const latestDraft = useRef<ComposerDraft | null>(null);
    const latestStashes = useRef<PromptStash[]>([]);
    const preparingFileNames = useRef<string[]>([]);
    const preparingBatches = useRef(new Map<string, string[]>());
    const preparationGeneration = useRef(0);
    const appliedSeedNonce = useRef<number | null>(null);
    const editingState = useRef(editingQueued);
    editingState.current = editingQueued;
    const scopedKey = draftKey ? `launchstack:composer:${draftKey}` : undefined;
    const currentScopeKey = useRef(scopedKey);
    currentScopeKey.current = scopedKey;
    latestStashes.current = stashes;
    const preferencesKey = draftKey?.startsWith("chat:")
        ? `launchstack:composer-preferences:${draftKey.split(":").slice(0, 3).join(":")}`
        : scopedKey
          ? `${scopedKey}:preferences`
          : undefined;
    const callbacks = useRef({
        selected,
        webSearch,
        thinking,
        agentKey,
        setSelected,
        onToggleWebSearch,
        onToggleThinking,
        onChangeAgent,
    });
    callbacks.current = {
        selected,
        webSearch,
        thinking,
        agentKey,
        setSelected,
        onToggleWebSearch,
        onToggleThinking,
        onChangeAgent,
    };
    const configuredRoutes = useChatRoutes();
    const chatRoutes = {
        ...configuredRoutes,
        config: configuredRoutes.config ?? {
            routes: {
                default: { available: false },
                fast: { available: false },
                reasoning: { available: false },
                vision: { available: false },
            },
        },
    };
    const uploading = uploads.some(row => row.status === "uploading");
    const uploadBlocked = uploads.length > 0 || preparingFiles || missingFiles.length > 0;
    const unavailableSources = selected.filter(id => !sources.some(source => source.id === id));
    const unavailableThreads = threadRefs.filter(
        id => !threadContextOptions.some(thread => thread.id === id)
    );
    const unavailableContext = unavailableSources.length > 0 || unavailableThreads.length > 0;
    const unavailableAttachments = attachments.filter(
        attachment =>
            attachmentAvailability[attachmentAvailabilityKey(attachment)] === "unavailable"
    );
    const overLimit = text.length > COMPOSER_MAX_CHARACTERS;
    const hasContent = Boolean(
        text.trim() || attachments.length || uploads.length || missingFiles.length
    );
    const canSend =
        hasContent &&
        !disabled &&
        !uploadBlocked &&
        !overLimit &&
        !unavailableContext &&
        !unavailableAttachments.length &&
        !queuedEditUnavailable;
    latestDraft.current = {
        text,
        attachments,
        refs: selected,
        modelRoute,
        modelRoutes,
        threadRefs,
        reasoningEffort,
        chatMode,
        webSearch,
        thinking,
        agentKey,
        richContent,
        pendingFiles: [
            ...missingFiles,
            ...uploads.map(row => row.file.name),
            ...preparingFileNames.current,
        ],
    };
    const selSources = selected
        .map(id => sources.find(source => source.id === id))
        .filter((source): source is WorkspaceSource => Boolean(source));
    const agent = agents.find(option => option.id === agentKey) ?? null;
    const mentionable = useMemo(() => agents.filter(usableAsSubagent), [agents]);
    const mentionedKey = mentionedAgentKeys(
        text,
        mentionable.map(option => option.id)
    )[0];
    const turnAgent =
        (mentionedKey ? agents.find(option => option.id === mentionedKey) : null) ?? agent;
    const turnEffects = resolveChatTurn(
        turnAgent ? { tools: turnAgent.tools, route: null, style: null, temperature: null } : null,
        { webSearch, thinking, hasAttachments: attachments.length > 0 }
    );
    const routeInfo = chatRoutes.config.routes[modelRoute];
    const effortInfo =
        modelRoute === "default" && thinking
            ? chatRoutes.config.routes.reasoning.reasoning
            : routeInfo?.reasoning;
    const effortOptions =
        effortInfo?.controllable && effortInfo.mode === "effort" ? (effortInfo.efforts ?? []) : [];
    const mentionMatches = mention
        ? [
              ...mentionable
                  .filter(
                      option =>
                          option.id.startsWith(mention.query) ||
                          option.displayName.toLowerCase().startsWith(mention.query)
                  )
                  .slice(0, 6)
                  .map(option => ({
                      key: `agent:${option.id}`,
                      label: option.displayName,
                      detail: `@${option.id}`,
                      agent: option,
                      source: null as WorkspaceSource | null,
                      sourceIds: null as string[] | null,
                      threadId: null as string | null,
                  })),
              ...sources
                  .filter(source => source.title.toLowerCase().includes(mention.query))
                  .slice(0, 6)
                  .map(source => ({
                      key: `source:${source.id}`,
                      label: source.title,
                      detail: "Source context",
                      agent: null as ChatAgentOption | null,
                      source,
                      sourceIds: null as string[] | null,
                      threadId: null as string | null,
                  })),
              ...[...new Set(sources.map(source => source.folder).filter(Boolean))]
                  .map(folder => ({
                      id: folder,
                      name:
                          folderContextOptions.find(option => option.id === folder)?.name ?? folder,
                  }))
                  .filter(folder => folder.name.toLowerCase().includes(mention.query))
                  .slice(0, 4)
                  .map(folder => ({
                      key: `folder:${folder.id}`,
                      label: folder.name,
                      detail: "Folder context",
                      agent: null as ChatAgentOption | null,
                      source: null as WorkspaceSource | null,
                      sourceIds: sources
                          .filter(source => source.folder === folder.id)
                          .map(source => source.id),
                      threadId: null as string | null,
                  })),
              ...threadContextOptions
                  .filter(thread => thread.title.toLowerCase().includes(mention.query))
                  .slice(0, 6)
                  .map(thread => ({
                      key: `thread:${thread.id}`,
                      label: thread.title,
                      detail: "Conversation context",
                      agent: null as ChatAgentOption | null,
                      source: null as WorkspaceSource | null,
                      sourceIds: null as string[] | null,
                      threadId: thread.id,
                  })),
          ]
        : [];
    const slashMatches = slash
        ? COMMANDS.filter(command => command.id.startsWith(slash.query))
        : [];
    const completionCount = slash ? slashMatches.length : mentionMatches.length;
    const richContexts = useMemo<ComposerContext[]>(
        () => [
            ...selected.map(id => {
                const source = sources.find(item => item.id === id);
                return {
                    id,
                    kind: "source" as const,
                    label: source?.title ?? `Unavailable source ${id}`,
                    unavailable: !source,
                    markdown: `[Source: ${(source?.title ?? id).replace(/([\\\[\]])/g, "\\$1")}](#launchstack-source-${encodeURIComponent(id)})`,
                };
            }),
            ...attachments.map(attachment => ({
                id: attachment.id,
                kind: "attachment" as const,
                label: attachment.name,
                markdown: `[${attachment.name.replace(/([\\\[\]])/g, "\\$1")}](${attachment.url})`,
                attachment,
            })),
            ...threadRefs.map(id => ({
                id,
                kind: "thread" as const,
                label:
                    threadContextOptions.find(thread => thread.id === id)?.title ??
                    "Referenced conversation",
                markdown: `[Conversation: ${threadContextOptions.find(thread => thread.id === id)?.title ?? id}](#launchstack-thread-${encodeURIComponent(id)})`,
                unavailable: !threadContextOptions.some(thread => thread.id === id),
            })),
        ],
        [selected, sources, attachments, threadRefs, threadContextOptions]
    );

    const updateAttachments = useCallback((next: EphemeralAttachment[]) => {
        attachmentsRef.current = next;
        setAttachments(next);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        const origin = scopedKey;
        const pending = attachments.filter(
            attachment => !verifiedUploads.current.has(attachmentAvailabilityKey(attachment))
        );
        setAttachmentAvailability(previous =>
            Object.fromEntries<ComposerAttachmentAvailability>(
                attachments.map(attachment => [
                    attachmentAvailabilityKey(attachment),
                    verifiedUploads.current.has(attachmentAvailabilityKey(attachment))
                        ? "available"
                        : previous[attachmentAvailabilityKey(attachment)] === "unavailable"
                          ? "unavailable"
                          : safeChatUri(attachment.url, true)
                            ? "checking"
                            : "unavailable",
                ])
            )
        );
        let next = 0;
        const probe = async () => {
            while (next < pending.length && !controller.signal.aborted) {
                const attachment = pending[next++]!;
                const url = safeChatUri(attachment.url, true);
                if (!url) continue;
                const availability = await checkComposerAttachmentAvailability(
                    url,
                    controller.signal
                );
                if (!controller.signal.aborted && currentScopeKey.current === origin)
                    setAttachmentAvailability(previous => ({
                        ...previous,
                        [attachmentAvailabilityKey(attachment)]:
                            availability === "unknown" &&
                            previous[attachmentAvailabilityKey(attachment)] === "unavailable"
                                ? "unavailable"
                                : availability,
                    }));
            }
        };
        void Promise.all(Array.from({ length: Math.min(4, pending.length) }, probe));
        return () => controller.abort();
    }, [attachments, scopedKey]);
    const updateUploads = useCallback((next: UploadRow[]) => {
        uploadsRef.current = next;
        setUploads(next);
    }, []);
    const focusAt = (position?: number) =>
        window.requestAnimationFrame(() => {
            if (editorMode === "rich") {
                richRef.current?.focus();
                return;
            }
            ref.current?.focus();
            if (position !== undefined) ref.current?.setSelectionRange(position, position);
        });
    const applyDraft = useCallback(
        (draft: ComposerDraft) => {
            verifiedUploads.current.clear();
            setText(draft.text);
            setRichContent(
                draft.richContent && typeof draft.richContent === "object"
                    ? (draft.richContent as JSONContent)
                    : null
            );
            updateAttachments(draft.attachments);
            setModelRoute(ROUTES.includes(draft.modelRoute!) ? draft.modelRoute! : "default");
            setModelRoutes((draft.modelRoutes ?? []).filter(route => ROUTES.includes(route)));
            setThreadRefs((draft.threadRefs ?? []).filter(id => typeof id === "string"));
            setMissingFiles(draft.pendingFiles ?? []);
            setReasoningEffort(draft.reasoningEffort);
            setChatMode(draft.chatMode === "plan" ? "plan" : "default");
            const current = callbacks.current;
            current.setSelected(draft.refs);
            if (draft.webSearch !== current.webSearch) current.onToggleWebSearch();
            if (draft.thinking !== current.thinking) current.onToggleThinking();
            if (draft.agentKey !== current.agentKey) current.onChangeAgent(draft.agentKey);
            setRecallIndex(null);
        },
        [updateAttachments]
    );
    useEffect(() => {
        preparationGeneration.current++;
        preparingBatches.current.clear();
        preparingFileNames.current = [];
        setPreparingFiles(false);
        requests.current.forEach(request => request.abort());
        requests.current.clear();
        updateUploads([]);
        const stored = readComposerStorage<unknown>(scopedKey, null);
        const suspended = readComposerStorage<unknown>(
            scopedKey ? `${scopedKey}:suspended-draft` : undefined,
            null
        );
        if (isComposerDraft(suspended)) {
            if (editingState.current) {
                beforeQueueEdit.current = suspended;
                if (isComposerDraft(stored)) applyDraft(stored);
                else applyDraft(suspended);
            } else {
                applyDraft(suspended);
                beforeQueueEdit.current = null;
                writeComposerStorage(scopedKey ? `${scopedKey}:suspended-draft` : undefined, null);
            }
        } else if (isComposerDraft(stored)) applyDraft(stored);
        else {
            setText("");
            setRichContent(null);
            updateAttachments([]);
            setModelRoute("default");
            setModelRoutes([]);
            setThreadRefs([]);
            setMissingFiles([]);
            setReasoningEffort(undefined);
            setChatMode("default");
        }
        const savedStashes = readComposerStorage<unknown>(
            scopedKey ? `${scopedKey}:stashes` : undefined,
            []
        );
        setStashes(
            Array.isArray(savedStashes)
                ? savedStashes.filter(
                      (value): value is PromptStash =>
                          isComposerDraft(value) &&
                          typeof (value as PromptStash).id === "string" &&
                          typeof (value as PromptStash).savedAt === "number"
                  )
                : []
        );
        const preferences = readComposerStorage<Partial<ComposerPreferences>>(preferencesKey, {});
        setSendKey(
            preferences?.sendKey === "mod-enter" || preferences?.sendKey === "enter"
                ? preferences.sendKey
                : defaultSendKey()
        );
        setFavorites(
            Array.isArray(preferences?.favorites)
                ? preferences.favorites.filter(value => ROUTES.includes(value as ChatRouteName))
                : []
        );
        setFollowUp(preferences?.followUp === "interrupt" ? "interrupt" : "queue");
        setEditorMode(preferences?.editorMode === "rich" ? "rich" : "plain");
        if (!isComposerDraft(stored)) {
            if (ROUTES.includes(preferences.modelRoute!)) setModelRoute(preferences.modelRoute!);
            if (typeof preferences?.reasoningEffort === "string")
                setReasoningEffort(preferences.reasoningEffort);
        }
        setLoadedKey(scopedKey);
        setStorageError(false);
        // Keys identify a different user/workspace/thread. Only switching that scope hydrates a draft.
    }, [scopedKey, preferencesKey, applyDraft, updateAttachments, updateUploads]);
    useEffect(() => {
        if (loadedKey !== scopedKey) return;
        const saved = writeComposerStorage(scopedKey, {
            text,
            attachments,
            refs: selected,
            modelRoute,
            modelRoutes,
            threadRefs,
            reasoningEffort,
            chatMode,
            webSearch,
            thinking,
            agentKey,
            richContent,
            pendingFiles: [
                ...missingFiles,
                ...uploads.map(row => row.file.name),
                ...preparingFileNames.current,
            ],
        } satisfies ComposerDraft);
        setStorageError(!saved);
    }, [
        loadedKey,
        scopedKey,
        text,
        attachments,
        selected,
        modelRoute,
        modelRoutes,
        threadRefs,
        reasoningEffort,
        chatMode,
        webSearch,
        thinking,
        agentKey,
        richContent,
        uploads,
        missingFiles,
        preparingFiles,
    ]);
    useEffect(() => {
        if (loadedKey === scopedKey)
            writeComposerStorage(preferencesKey, {
                sendKey,
                favorites,
                followUp,
                editorMode,
                modelRoute,
                reasoningEffort,
            });
    }, [
        loadedKey,
        scopedKey,
        preferencesKey,
        sendKey,
        favorites,
        followUp,
        editorMode,
        modelRoute,
        reasoningEffort,
    ]);
    useEffect(() => {
        const currentRequests = requests.current;
        const currentPreparationGeneration = preparationGeneration;
        const currentPreparingBatches = preparingBatches.current;
        return () => {
            currentPreparationGeneration.current++;
            currentPreparingBatches.clear();
            currentRequests.forEach(request => request.abort());
        };
    }, []);
    useEffect(() => {
        if (!ref.current) return;
        ref.current.style.height = "auto";
        ref.current.style.height = `${Math.min(ref.current.scrollHeight, 240)}px`;
    }, [text]);
    useEffect(() => {
        const focusShortcut = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.shiftKey &&
                event.key.toLowerCase() === "m"
            ) {
                event.preventDefault();
                setModelOpen(true);
                return;
            }
            if (
                (event.metaKey || event.ctrlKey) &&
                event.shiftKey &&
                event.key.toLowerCase() === "l"
            ) {
                event.preventDefault();
                if (editorMode === "rich") richRef.current?.focus();
                else ref.current?.focus();
            }
        };
        window.addEventListener("keydown", focusShortcut);
        return () => window.removeEventListener("keydown", focusShortcut);
    }, [editorMode]);
    useEffect(() => {
        if (editingQueued && !beforeQueueEdit.current)
            beforeQueueEdit.current = {
                text,
                attachments,
                refs: selected,
                modelRoute,
                modelRoutes,
                threadRefs,
                reasoningEffort,
                chatMode,
                webSearch,
                thinking,
                agentKey,
                richContent,
                pendingFiles: [
                    ...missingFiles,
                    ...uploads.map(row => row.file.name),
                    ...preparingFileNames.current,
                ],
            };
        if (editingQueued && beforeQueueEdit.current)
            writeComposerStorage(
                scopedKey ? `${scopedKey}:suspended-draft` : undefined,
                beforeQueueEdit.current
            );
        if (editingQueued && (uploadsRef.current.length || preparingFiles)) {
            preparationGeneration.current++;
            preparingBatches.current.clear();
            preparingFileNames.current = [];
            setPreparingFiles(false);
            requests.current.forEach(request => request.abort());
            requests.current.clear();
            updateUploads([]);
            setMissingFiles([]);
        } else if (!editingQueued && beforeQueueEdit.current) {
            const previous = beforeQueueEdit.current;
            beforeQueueEdit.current = null;
            applyDraft(previous);
            writeComposerStorage(scopedKey ? `${scopedKey}:suspended-draft` : undefined, null);
        }
        if (editingQueued) setMissingFiles([]);
        // The transition owns this snapshot: subsequent edits must not overwrite the suspended draft.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingQueued]);
    useEffect(() => {
        if (!seed) return;
        const seen = readComposerStorage<number | null>(
            scopedKey ? `${scopedKey}:last-seed` : undefined,
            null
        );
        if (seed.nonce === appliedSeedNonce.current || seed.nonce === seen) return;
        appliedSeedNonce.current = seed.nonce;
        writeComposerStorage(scopedKey ? `${scopedKey}:last-seed` : undefined, seed.nonce);
        setRichContent(null);
        setText(previous =>
            seed.mode === "replace" || !previous.trim()
                ? seed.text
                : `${previous.replace(/\s+$/, "")}\n\n${seed.text}`
        );
        if (seed.attachments) {
            verifiedUploads.current.clear();
            updateAttachments(seed.attachments);
        }
        if (seed.refs) callbacks.current.setSelected(seed.refs);
        if (seed.modelRoute) setModelRoute(seed.modelRoute);
        if (seed.modelRoutes) setModelRoutes(seed.modelRoutes);
        if (seed.threadRefs) setThreadRefs(seed.threadRefs);
        if (seed.reasoningEffort) setReasoningEffort(seed.reasoningEffort);
        if (seed.chatMode) setChatMode(seed.chatMode);
        const controls = callbacks.current;
        if (seed.webSearch !== undefined && seed.webSearch !== controls.webSearch)
            controls.onToggleWebSearch();
        if (seed.thinking !== undefined && seed.thinking !== controls.thinking)
            controls.onToggleThinking();
        if (seed.agentKey !== undefined && seed.agentKey !== controls.agentKey)
            controls.onChangeAgent(seed.agentKey);
        setRecallIndex(null);
        window.requestAnimationFrame(() => {
            ref.current?.focus();
            ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length);
        });
    }, [seed, scopedKey, updateAttachments]);

    const syncCompletion = (value: string) => {
        const caret =
            editorMode === "rich"
                ? (richRef.current?.getSelection().start ?? value.length)
                : (ref.current?.selectionStart ?? value.length);
        setMention(mentionQueryAt(value, caret));
        const match = /(?:^|\s)\/([a-z]*)$/i.exec(value.slice(0, caret));
        setSlash(
            match ? { query: match[1]!.toLowerCase(), start: caret - match[1]!.length - 1 } : null
        );
        setCompletionIndex(0);
    };
    const replaceSelection = (insert: string) => {
        if (editorMode === "rich") {
            richRef.current?.insertText(insert);
            return;
        }
        const start = ref.current?.selectionStart ?? text.length;
        const end = ref.current?.selectionEnd ?? text.length;
        setText(text.slice(0, start) + insert + text.slice(end));
        setRecallIndex(null);
        focusAt(start + insert.length);
    };
    const selectCompletion = (index: number) => {
        const caret =
            editorMode === "rich"
                ? (richRef.current?.getSelection().start ?? text.length)
                : (ref.current?.selectionStart ?? text.length);
        if (slash) {
            const command = slashMatches[index];
            if (!command) return;
            setText(text.slice(0, slash.start) + text.slice(caret));
            if (command.id === "new") {
                requests.current.forEach(request => request.abort());
                updateUploads([]);
                setText("");
                updateAttachments([]);
                onNewChat?.();
            }
            if (command.id === "model") setModelOpen(true);
            if (command.id === "sources") setSourceOpen(true);
            if (command.id === "plan") setChatMode("plan");
            if (command.id === "default") setChatMode("default");
        } else if (mention) {
            const option = mentionMatches[index];
            if (!option) return;
            const insert = option.agent
                ? `@${option.agent.id} `
                : option.source
                  ? `[Source: ${option.source.title}](#launchstack-source-${encodeURIComponent(option.source.id)}) `
                  : option.threadId
                    ? `[Conversation: ${option.label}](#launchstack-thread-${encodeURIComponent(option.threadId)}) `
                    : option.sourceIds
                      ? `[Folder: ${option.label}](#launchstack-folder-${encodeURIComponent(option.key.slice(7))}) `
                      : "";
            setText(`${text.slice(0, mention.start)}${insert}${text.slice(caret)}`);
            if (option.source)
                setSelected(previous =>
                    previous.includes(option.source!.id)
                        ? previous
                        : [...previous, option.source!.id]
                );
            if (option.sourceIds)
                setSelected(previous => [...new Set([...previous, ...option.sourceIds!])]);
            if (option.threadId)
                setThreadRefs(previous => [...new Set([...previous, option.threadId!])]);
            focusAt(mention.start + insert.length);
        }
        setMention(null);
        setSlash(null);
        setRecallIndex(null);
    };
    const handleSend = (oppositeFollowUp = false) => {
        if (!canSend) return false;
        const snapshot = latestDraft.current!;
        const originKey = scopedKey;
        const payload: ComposerSend = {
            text: text.trim().length ? text.trim() : "Please review the attached files.",
            recallText:
                richContent && serializeRichDocument && validateRichDocument?.(richContent)
                    ? serializeRichDocument(composerDocumentWithoutContext(richContent))
                    : text,
            origin: text.trim() ? "user" : "attachment",
            refs: selected,
            attachments,
            webSearch,
            thinking,
            agentKey: mentionedKey ?? agentKey,
            modelRoute:
                modelRoute === "default" &&
                attachments.some(item => item.kind === "image") &&
                !routeInfo?.vision?.supported
                    ? "vision"
                    : modelRoute === "default" && thinking && !routeInfo?.reasoning?.controllable
                      ? "reasoning"
                      : modelRoute,
            ...(modelRoutes.length >= 2 ? { modelRoutes } : {}),
            ...(threadRefs.length ? { threadRefs } : {}),
            ...(reasoningEffort && effortOptions.includes(reasoningEffort)
                ? { reasoningEffort }
                : {}),
            chatMode,
            ...(active
                ? {
                      followUp: oppositeFollowUp
                          ? followUp === "queue"
                              ? "interrupt"
                              : "queue"
                          : followUp,
                  }
                : {}),
        };
        const retryDraft = (failedModelRoutes?: ChatRouteName[]): ComposerDraft =>
            failedModelRoutes?.length
                ? {
                      ...snapshot,
                      modelRoute: failedModelRoutes[0],
                      modelRoutes: failedModelRoutes.length >= 2 ? failedModelRoutes : [],
                  }
                : snapshot;
        const recover = (failedModelRoutes?: ChatRouteName[]) => {
            const failedDraft = retryDraft(failedModelRoutes);
            if (currentScopeKey.current !== originKey) {
                const stored = readComposerStorage<unknown>(originKey, null);
                const hasNewerDraft =
                    isComposerDraft(stored) &&
                    Boolean(
                        stored.text.trim().length > 0 ||
                            stored.attachments.length > 0 ||
                            (stored.pendingFiles?.length ?? 0) > 0 ||
                            (stored.threadRefs?.length ?? 0) > 0
                    );
                if (hasNewerDraft) {
                    const saved = readComposerStorage<unknown>(
                        originKey ? `${originKey}:stashes` : undefined,
                        []
                    );
                    const safeStashes = Array.isArray(saved)
                        ? saved.filter(
                              (item): item is PromptStash =>
                                  isComposerDraft(item) &&
                                  typeof (item as PromptStash).id === "string"
                          )
                        : [];
                    const persisted = writeComposerStorage(
                        originKey ? `${originKey}:stashes` : undefined,
                        [
                            {
                                ...failedDraft,
                                failedSend: true,
                                id: crypto.randomUUID(),
                                savedAt: Date.now(),
                            },
                            ...safeStashes,
                        ]
                    );
                    toast.error(
                        persisted
                            ? "Message wasn't sent. The failed prompt was saved in the original conversation; its newer draft is safe."
                            : "Message wasn't sent and draft storage is unavailable. Copy the original question from its conversation history."
                    );
                } else {
                    const persisted = writeComposerStorage(originKey, failedDraft);
                    toast.error(
                        persisted
                            ? "Message wasn't sent. Its draft was restored in the original conversation."
                            : "Message wasn't sent and draft storage is unavailable. Copy the original question from its conversation history."
                    );
                }
                return;
            }
            const current = latestDraft.current;
            if (
                !current?.text.trim() &&
                !current?.attachments.length &&
                !current?.threadRefs?.length &&
                !current?.pendingFiles?.length
            ) {
                applyDraft(failedDraft);
                setAttachError("Message wasn't sent. Your draft has been restored.");
            } else {
                const next = [
                    {
                        ...failedDraft,
                        failedSend: true,
                        id: crypto.randomUUID(),
                        savedAt: Date.now(),
                    },
                    ...latestStashes.current,
                ];
                saveStashes(next);
                setAttachError(
                    "Message wasn't sent. The failed prompt is saved; your current draft is safe."
                );
                setFailedPromptAvailable(true);
            }
        };
        let accepted: ReturnType<ComposerProps["onSend"]>;
        try {
            accepted = onSend(payload);
        } catch {
            setAttachError("Message wasn't sent. Your draft is still here.");
            return false;
        }
        if (accepted === false) {
            setAttachError("Message wasn't sent. Your draft is still here.");
            return false;
        }
        if (
            accepted &&
            typeof accepted === "object" &&
            "success" in accepted &&
            !accepted.success
        ) {
            applyDraft(retryDraft(accepted.failedModelRoutes));
            setAttachError(
                "Some model responses failed. Your draft is ready to retry only those models."
            );
            return false;
        }
        setText("");
        setRichContent(null);
        richChipIds.current = [];
        setThreadRefs([]);
        updateAttachments([]);
        setMention(null);
        setSlash(null);
        setRecallIndex(null);
        setAttachError(null);
        setFailedPromptAvailable(false);
        focusAt(0);
        if (accepted && typeof accepted === "object" && "then" in accepted)
            void accepted
                .then(result => {
                    if (!result) recover();
                    else if (typeof result === "object" && !result.success)
                        recover(result.failedModelRoutes);
                })
                .catch(() => recover());
        return true;
    };
    const uploadFile = (row: UploadRow) => {
        updateUploads(
            uploadsRef.current.map(item =>
                item.id === row.id
                    ? { ...item, status: "uploading", progress: 0, error: undefined }
                    : item
            )
        );
        const request = new XMLHttpRequest();
        requests.current.set(row.id, request);
        request.open("POST", "/api/storage/upload");
        request.upload.onprogress = event => {
            if (event.lengthComputable)
                updateUploads(
                    uploadsRef.current.map(item =>
                        item.id === row.id
                            ? { ...item, progress: Math.round((event.loaded / event.total) * 100) }
                            : item
                    )
                );
        };
        const fail = (error: string, status: UploadRow["status"] = "failed") => {
            requests.current.delete(row.id);
            updateUploads(
                uploadsRef.current.map(item =>
                    item.id === row.id ? { ...item, status, error } : item
                )
            );
        };
        request.onload = () => {
            if (!requests.current.has(row.id)) return;
            let data: { url?: string; objectKey?: string; error?: string } = {};
            try {
                data = JSON.parse(request.responseText) as typeof data;
            } catch {
                /* Report the upload's HTTP failure below. */
            }
            if (request.status < 200 || request.status >= 300 || !data.url) {
                fail(
                    data.error ??
                        `Upload failed (${request.status || "network error"}). Retry or remove this file.`
                );
                return;
            }
            requests.current.delete(row.id);
            const completed: EphemeralAttachment = {
                id: data.objectKey?.length ? data.objectKey : row.id,
                name: row.file.name,
                mimeType: row.file.type.length ? row.file.type : "text/plain",
                size: row.file.size,
                url: data.url,
                kind: row.kind,
            };
            verifiedUploads.current.add(attachmentAvailabilityKey(completed));
            updateAttachments([
                ...attachmentsRef.current.filter(item => item.id !== row.replacesId),
                completed,
            ]);
            updateUploads(uploadsRef.current.filter(item => item.id !== row.id));
        };
        request.onerror = () => fail("Upload failed. Check your connection, then retry.");
        request.onabort = () => fail("Upload canceled. Retry or remove this file.", "canceled");
        const form = new FormData();
        form.append("file", row.file);
        form.append("purpose", "chat");
        request.send(form);
    };
    const cancelPreparation = () => {
        preparationGeneration.current++;
        preparingBatches.current.clear();
        preparingFileNames.current = [];
        setPreparingFiles(false);
    };
    const addFiles = (files: File[], prepared = false, replacesId?: string) => {
        if (!files.length) return;
        files = files.map(normalizeComposerFile);
        const retainedAttachments = attachmentsRef.current.filter(item => item.id !== replacesId);
        if (
            retainedAttachments.length +
                uploadsRef.current.length +
                preparingFileNames.current.length +
                files.length >
            ATTACH_MAX_COUNT
        ) {
            setAttachError(
                `Attach up to ${ATTACH_MAX_COUNT} files per message. Remove files before adding more.`
            );
            return;
        }
        if (!prepared && files.some(needsComposerImagePreparation)) {
            const generation = preparationGeneration.current;
            const batchId = crypto.randomUUID();
            preparingBatches.current.set(
                batchId,
                files.map(file => file.name)
            );
            preparingFileNames.current = Array.from(preparingBatches.current.values()).flat();
            setPreparingFiles(true);
            void Promise.all(
                files.map(async file => {
                    try {
                        return { file: await resizeComposerImage(file), error: null };
                    } catch (error) {
                        return {
                            file: null,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : `“${file.name}” exceeds 10 MiB. Resize it before attaching.`,
                        };
                    }
                })
            )
                .then(results => {
                    if (generation !== preparationGeneration.current) return;
                    preparingBatches.current.delete(batchId);
                    preparingFileNames.current = Array.from(
                        preparingBatches.current.values()
                    ).flat();
                    setPreparingFiles(preparingBatches.current.size > 0);
                    addFiles(
                        results.flatMap(result => (result.file ? [result.file] : [])),
                        true,
                        replacesId
                    );
                    const errors = results.flatMap(result => (result.error ? [result.error] : []));
                    if (errors.length) setAttachError(errors.join(" "));
                })
                .catch(() => {
                    if (generation !== preparationGeneration.current) return;
                    preparingBatches.current.delete(batchId);
                    preparingFileNames.current = Array.from(
                        preparingBatches.current.values()
                    ).flat();
                    setPreparingFiles(preparingBatches.current.size > 0);
                    setAttachError("Images could not be prepared. Attach them again.");
                });
            return;
        }
        setAttachError(null);
        if (
            retainedAttachments.length + uploadsRef.current.length + files.length >
            ATTACH_MAX_COUNT
        ) {
            setAttachError(
                `Attach up to ${ATTACH_MAX_COUNT} files per message. Remove files before adding more.`
            );
            return;
        }
        const next: UploadRow[] = [];
        const presentImages = retainedAttachments.filter(item => item.kind === "image");
        const uploadingImages = uploadsRef.current.filter(item => item.kind === "image");
        let imageCount = presentImages.length + uploadingImages.length;
        let imageBytes =
            presentImages.reduce((sum, item) => sum + item.size, 0) +
            uploadingImages.reduce((sum, item) => sum + item.file.size, 0);
        const errors: string[] = [];
        for (const file of files) {
            const kind = kindForFile(file);
            if (!kind) {
                errors.push(
                    `“${file.name}” is unsupported. Attach images, PDF, DOCX, or text. Add audio and video through Sources.`
                );
                continue;
            }
            if (file.size > (kind === "image" ? IMAGE_MAX_BYTES : FILE_MAX_BYTES)) {
                errors.push(
                    `“${file.name}” is too large. ${kind === "image" ? "Images: 10 MiB" : "Documents: 50 MiB"} per file.`
                );
                continue;
            }
            if (kind === "image") {
                if (!chatRoutes.visionEnabled) {
                    errors.push(
                        chatRoutes.visionDisabledReason ??
                            "Images need an image-capable model on the vision route."
                    );
                    continue;
                }
                const vision = chatRoutes.config.routes.vision.vision;
                if (vision?.mimeTypes?.length && !vision.mimeTypes.includes(file.type)) {
                    errors.push(
                        `“${file.name}” is not supported by the configured image model. Convert it to ${vision.mimeTypes.join(", ")}.`
                    );
                    continue;
                }
                if (vision?.maxImages !== undefined && imageCount >= vision.maxImages) {
                    errors.push(
                        `This image model accepts at most ${vision.maxImages} image(s) per message.`
                    );
                    continue;
                }
                if (imageBytes + file.size > TOTAL_IMAGE_MAX_BYTES) {
                    errors.push("Images in one message must total 80 MiB or less.");
                    continue;
                }
                imageCount++;
                imageBytes += file.size;
            }
            next.push({
                id: crypto.randomUUID(),
                file,
                kind,
                status: "uploading",
                progress: 0,
                ...(replacesId ? { replacesId } : {}),
            });
            setMissingFiles(previous => previous.filter(name => name !== file.name));
        }
        if (errors.length) setAttachError(errors.join(" "));
        updateUploads([...uploadsRef.current, ...next]);
        next.forEach(uploadFile);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };
    const removeUpload = (id: string) => {
        requests.current.get(id)?.abort();
        requests.current.delete(id);
        updateUploads(uploadsRef.current.filter(item => item.id !== id));
    };
    const saveStashes = (next: PromptStash[]) => {
        setStashes(next);
        if (!writeComposerStorage(scopedKey ? `${scopedKey}:stashes` : undefined, next))
            setStorageError(true);
    };
    const restoreStash = (stash: PromptStash) => {
        const current = latestDraft.current;
        const keepCurrent = Boolean(
            current && (current.text.trim().length > 0 || current.attachments.length > 0)
        );
        applyDraft(
            stash.failedSend
                ? stash
                : {
                      ...stash,
                      modelRoute,
                      modelRoutes,
                      reasoningEffort,
                      chatMode,
                      webSearch,
                      thinking,
                      agentKey,
                  }
        );
        saveStashes([
            ...(keepCurrent && current
                ? [{ ...current, id: crypto.randomUUID(), savedAt: Date.now() }]
                : []),
            ...stashes.filter(item => item.id !== stash.id),
        ]);
        setFailedPromptAvailable(false);
        setStashOpen(false);
        focusAt(stash.text.length);
    };
    const detachQueuedEdit = () => {
        const suspended = beforeQueueEdit.current;
        if (
            suspended &&
            (suspended.text.trim() ||
                suspended.attachments.length ||
                suspended.pendingFiles?.length ||
                suspended.threadRefs?.length)
        ) {
            saveStashes([
                { ...suspended, id: crypto.randomUUID(), savedAt: Date.now() },
                ...latestStashes.current,
            ]);
        }
        beforeQueueEdit.current = null;
        writeComposerStorage(scopedKey ? `${scopedKey}:suspended-draft` : undefined, null);
        setAttachError(null);
        onCancelQueueEdit?.();
        focusAt(text.length);
    };
    const handleStash = () => {
        if (uploadBlocked) {
            setAttachError("Finish, retry, or remove uploads before saving a prompt.");
            return;
        }
        if (hasContent) {
            saveStashes([
                {
                    id: crypto.randomUUID(),
                    savedAt: Date.now(),
                    text,
                    attachments,
                    refs: selected,
                    webSearch,
                    thinking,
                    agentKey,
                    modelRoute,
                    modelRoutes,
                    threadRefs,
                    reasoningEffort,
                    chatMode,
                    richContent,
                },
                ...stashes,
            ]);
            setText("");
            updateAttachments([]);
            setMention(null);
            setSlash(null);
            setRecallIndex(null);
            setRichContent(null);
            setThreadRefs([]);
            richChipIds.current = [];
            toast.success("Prompt saved. Press ⌘/Ctrl+S in an empty composer to restore it.");
        } else if (stashes.length === 1) restoreStash(stashes[0]!);
        else if (stashes.length > 1) setStashOpen(true);
        else toast.info("No saved prompts yet.");
    };
    const onComposerKeyDown = (event: KeyboardEvent | React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
            ("nativeEvent" in event ? event.nativeEvent.isComposing : event.isComposing) ||
            event.keyCode === 229
        )
            return;
        const modifier = event.metaKey || event.ctrlKey;
        if (
            modifier &&
            event.shiftKey &&
            event.key === "Enter" &&
            queuedCount &&
            onQueueSendOldest
        ) {
            event.preventDefault();
            onQueueSendOldest();
            return;
        }
        if (modifier && event.altKey && event.key === "Enter") {
            event.preventDefault();
            if (handleSend()) onNewChat?.();
            return;
        }
        if (modifier && event.key.toLowerCase() === "v") shiftPaste.current = event.shiftKey;
        if (modifier && event.key.toLowerCase() === "s") {
            event.preventDefault();
            handleStash();
            return;
        }
        if (event.key === "Tab" && event.shiftKey && !modifier) {
            event.preventDefault();
            setChatMode(previous => (previous === "plan" ? "default" : "plan"));
            return;
        }
        if (
            event.altKey &&
            event.key === "ArrowUp" &&
            (editorMode === "rich"
                ? richRef.current?.getSelection().atStart
                : ref.current?.selectionStart === 0) &&
            queuedCount &&
            onQueueEditLatest
        ) {
            event.preventDefault();
            onQueueEditLatest();
            return;
        }
        if (completionCount) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setCompletionIndex(
                    index =>
                        (index + (event.key === "ArrowDown" ? 1 : -1) + completionCount) %
                        completionCount
                );
                return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                selectCompletion(completionIndex);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                setSlash(null);
                return;
            }
        }
        if (
            (event.key === "ArrowUp" || event.key === "ArrowDown") &&
            !modifier &&
            !event.altKey &&
            !event.shiftKey &&
            !attachments.length &&
            !uploads.length &&
            promptHistory.length
        ) {
            const direction = event.key === "ArrowUp" ? "up" : "down";
            const recalling = recallIndex !== null && text === promptHistory[recallIndex];
            if (
                (!text && direction === "up") ||
                (recalling &&
                    (editorMode === "rich"
                        ? direction === "up"
                            ? richRef.current?.getSelection().atStart
                            : richRef.current?.getSelection().atEnd
                        : ref.current && caretAtVisualBoundary(ref.current, direction)))
            ) {
                const next =
                    direction === "up"
                        ? Math.max(0, (recallIndex ?? promptHistory.length) - 1)
                        : (recallIndex ?? promptHistory.length) + 1;
                event.preventDefault();
                setRecallIndex(next < promptHistory.length ? next : null);
                setText(next < promptHistory.length ? promptHistory[next]! : "");
                focusAt(
                    direction === "up"
                        ? 0
                        : next < promptHistory.length
                          ? promptHistory[next]!.length
                          : 0
                );
                return;
            }
        }
        if (
            editorMode === "plain" &&
            event.key === "Enter" &&
            !event.shiftKey &&
            !modifier &&
            sendKey === "mod-enter" &&
            ref.current &&
            ref.current.selectionStart === ref.current.selectionEnd
        ) {
            const continuation = listContinuation(text, ref.current.selectionStart);
            if (continuation) {
                event.preventDefault();
                setText(
                    text.slice(0, continuation.start) +
                        continuation.replacement +
                        text.slice(continuation.end)
                );
                setRecallIndex(null);
                focusAt(continuation.start + continuation.replacement.length);
                return;
            }
        }
        if (event.key === "Enter" && !event.shiftKey && (sendKey === "enter" || modifier)) {
            if (editorMode === "rich" && !modifier && richRef.current?.isInList()) return;
            event.preventDefault();
            if (!hasContent && active) onStop?.();
            else handleSend(modifier);
        }
    };
    const selectedText = () =>
        ref.current
            ? ref.current.value.slice(ref.current.selectionStart, ref.current.selectionEnd)
            : "";
    const composerTarget = useContextTarget({
        kind: "composer",
        label: "Composer actions",
        editable: true,
        items: () =>
            buildComposerMenuItems(
                {
                    hasSelection: selectedText().length > 0,
                    hasContent,
                    uploading,
                    disabled,
                    webSearch,
                    thinking,
                    reasoningEnabled: Boolean(chatRoutes.reasoningEnabled),
                    reasoningDisabledReason: chatRoutes.reasoningDisabledReason,
                },
                {
                    onCut: () => {
                        void copyText(selectedText()).then(ok => {
                            if (ok) replaceSelection("");
                            else toast.error("Couldn't cut");
                        });
                    },
                    onCopy: () => {
                        void copyText(selectedText());
                    },
                    onPaste: () => {
                        void readClipboardText().then(value => {
                            if (value === null)
                                toast.info(
                                    "Clipboard access was refused. Paste with your keyboard."
                                );
                            else if (shouldAttachPaste(value, text, selectedText().length))
                                addFiles([
                                    new File([value], `pasted-text-${Date.now()}.txt`, {
                                        type: "text/plain",
                                    }),
                                ]);
                            else replaceSelection(value);
                        });
                    },
                    onAttach: () => fileInputRef.current?.click(),
                    onToggleWebSearch,
                    onToggleThinking,
                    onClear: () => {
                        cancelPreparation();
                        requests.current.forEach(request => request.abort());
                        updateUploads([]);
                        updateAttachments([]);
                        setMissingFiles([]);
                        setText("");
                        setRichContent(null);
                        richChipIds.current = [];
                        setThreadRefs([]);
                        setAttachError(null);
                        setRecallIndex(null);
                    },
                }
            ),
    });

    return (
        <div
            {...composerTarget}
            data-testid="chat-composer"
            className={cn(
                "bg-panel border-line mx-auto w-full max-w-[760px] rounded-xl border p-3.5 shadow-sm transition-colors",
                (focus || dragging) && "border-brand ring-brand/15 ring-4"
            )}
            onDragOver={event => {
                if (event.dataTransfer.types.includes("Files")) {
                    event.preventDefault();
                    setDragging(true);
                }
            }}
            onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDragging(false);
            }}
            onDrop={event => {
                if (event.dataTransfer.files.length) {
                    event.preventDefault();
                    setDragging(false);
                    addFiles(Array.from(event.dataTransfer.files));
                }
            }}
        >
            {dragging && (
                <p className="text-brand mb-2 text-sm">Drop files to attach them to this message</p>
            )}
            {selected.length > 0 && (
                <div className="border-line mb-2.5 flex flex-wrap items-center gap-1.5 border-b border-dashed pb-2.5">
                    <span className="mono text-ink-3 text-[10px] uppercase">Context</span>
                    {selSources.map(source => (
                        <SourceChip
                            key={source.id}
                            source={source}
                            size="sm"
                            onOpen={onOpenSource ? () => onOpenSource(source) : undefined}
                            onRemove={() =>
                                setSelected(previous => previous.filter(id => id !== source.id))
                            }
                        />
                    ))}
                    {unavailableSources.map(id => (
                        <span
                            key={id}
                            className="border-line text-ink-3 inline-flex max-w-full items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs"
                            title="This source was removed or is no longer accessible. Restore access or remove this context before sending."
                        >
                            <span className="max-w-[240px] truncate">
                                Unavailable source · {id}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={`Remove unavailable source ${id}`}
                                onClick={() =>
                                    setSelected(previous => previous.filter(item => item !== id))
                                }
                            >
                                <X className="size-3" />
                            </Button>
                        </span>
                    ))}
                </div>
            )}
            {(attachments.length > 0 || uploads.length > 0) && (
                <div className="border-line mb-2.5 flex flex-wrap gap-1.5 border-b border-dashed pb-2.5">
                    {attachments.map(attachment => (
                        <ChatAttachmentChip
                            key={attachment.id}
                            attachment={attachment}
                            galleryItems={attachments}
                            availability={
                                attachmentAvailability[attachmentAvailabilityKey(attachment)]
                            }
                            onReattach={() => {
                                reattachAttachmentId.current = attachment.id;
                                reattachOriginKey.current = scopedKey;
                                reattachInputRef.current?.click();
                            }}
                            onRemove={() =>
                                updateAttachments(
                                    attachments.filter(item => item.id !== attachment.id)
                                )
                            }
                        />
                    ))}
                    {uploads.map(row => (
                        <div
                            key={row.id}
                            className="border-line bg-line-2 text-ink-2 flex max-w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                        >
                            <FileText className="size-3.5" />
                            <span className="max-w-[160px] truncate">{row.file.name}</span>
                            {row.status === "uploading" ? (
                                <>
                                    <progress
                                        max={100}
                                        value={row.progress}
                                        aria-label={`Uploading ${row.file.name}`}
                                        className="h-1.5 w-16 accent-[var(--accent)]"
                                    />
                                    <span>{row.progress}%</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-1.5 text-xs"
                                        onClick={() => requests.current.get(row.id)?.abort()}
                                        aria-label={`Cancel upload ${row.file.name}`}
                                    >
                                        Cancel
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <span className="text-danger max-w-[220px]" role="alert">
                                        {row.error}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-1.5 text-xs"
                                        onClick={() => uploadFile(row)}
                                        aria-label={`Retry upload ${row.file.name}`}
                                    >
                                        Retry
                                    </Button>
                                </>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={`Remove upload ${row.file.name}`}
                                onClick={() => removeUpload(row.id)}
                            >
                                <X className="size-3" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}
            {threadRefs.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {threadRefs.map(id => (
                        <span
                            key={id}
                            className={cn(
                                "border-line bg-line-2 text-ink-2 inline-flex max-w-[260px] items-center gap-1 rounded-md border px-1 text-xs",
                                unavailableThreads.includes(id) && "text-ink-3 border-dashed"
                            )}
                            title={
                                unavailableThreads.includes(id)
                                    ? "This conversation was removed or is no longer accessible. Restore access or remove its context before sending."
                                    : undefined
                            }
                        >
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 min-w-0 px-1 text-xs"
                                onClick={() => setInspectedThread(id)}
                            >
                                <span className="truncate">
                                    {threadContextOptions.find(thread => thread.id === id)?.title ??
                                        `Unavailable conversation · ${id}`}
                                </span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={`Remove conversation context ${threadContextOptions.find(thread => thread.id === id)?.title ?? id}`}
                                onClick={() =>
                                    setThreadRefs(previous => previous.filter(item => item !== id))
                                }
                            >
                                <X className="size-3" />
                            </Button>
                        </span>
                    ))}
                </div>
            )}
            {missingFiles.length > 0 && (
                <div className="border-line mb-2 space-y-1 rounded-md border p-2">
                    {missingFiles.map((name, index) => (
                        <div
                            key={`${name}:${index}`}
                            className="text-ink-2 flex flex-wrap items-center gap-2 text-xs"
                        >
                            <span className="min-w-0 flex-1 break-all">
                                {name}: upload did not finish. Attach this file again before
                                sending.
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                Attach again
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={`Remove missing file ${name}`}
                                onClick={() =>
                                    setMissingFiles(previous =>
                                        previous.filter((_, itemIndex) => itemIndex !== index)
                                    )
                                }
                            >
                                <X className="size-3" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}
            {unavailableContext && (
                <p role="status" className="text-ink-3 mb-2 text-xs">
                    Some selected context is unavailable. Restore access or remove its chips before
                    sending.
                </p>
            )}
            {preparingFiles && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p role="status" className="text-ink-3 text-xs">
                        Preparing images for upload…
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={cancelPreparation}
                    >
                        Cancel image preparation
                    </Button>
                </div>
            )}
            {unavailableAttachments.length > 0 && (
                <p role="status" className="text-ink-3 mb-2 text-xs">
                    Some attached files are unavailable. Attach them again or remove them before
                    sending.
                </p>
            )}
            {failedPromptAvailable && (
                <Button
                    variant="outline"
                    size="sm"
                    className="mb-2 text-xs"
                    onClick={() => setStashOpen(true)}
                >
                    Restore failed prompt
                </Button>
            )}
            {attachError && (
                <p role="alert" className="text-danger mb-2 text-xs">
                    {attachError}
                </p>
            )}
            {completionCount > 0 && (
                <div
                    id="composer-completions"
                    role="listbox"
                    aria-label={
                        slash ? "Commands" : sources.length ? "Agents and sources" : "Agents"
                    }
                    className="border-line bg-panel mb-2 max-h-56 overflow-y-auto rounded-lg border shadow-sm"
                >
                    {(slash
                        ? slashMatches.map(command => ({
                              key: command.id,
                              label: command.name,
                              detail: command.detail,
                          }))
                        : mentionMatches
                    ).map((option, index) => (
                        <Button
                            key={option.key}
                            id={`composer-option-${index}`}
                            role="option"
                            aria-selected={index === completionIndex}
                            variant="ghost"
                            className={cn(
                                "h-auto w-full justify-start rounded-none px-3 py-2 text-left text-xs",
                                index === completionIndex && "bg-brand-soft text-brand-ink"
                            )}
                            onMouseDown={event => {
                                event.preventDefault();
                                selectCompletion(index);
                            }}
                        >
                            <span>{option.label}</span>
                            <span className="text-ink-3 font-normal">{option.detail}</span>
                        </Button>
                    ))}
                </div>
            )}
            {editorMode === "rich" ? (
                <Suspense
                    fallback={<p className="text-ink-3 py-3 text-sm">Loading rich editor…</p>}
                >
                    <RichChatEditor
                        ref={richRef}
                        value={text}
                        content={richContent}
                        contexts={richContexts}
                        placeholder="Write a message…"
                        onChange={(value, content, contexts) => {
                            const removedSources = richChipIds.current
                                .filter(
                                    item =>
                                        item.kind === "source" &&
                                        !contexts.some(next => next.id === item.id)
                                )
                                .map(item => item.id);
                            const addedSources = contexts
                                .filter(item => item.kind === "source")
                                .map(item => item.id);
                            if (
                                removedSources.length ||
                                addedSources.some(id => !selected.includes(id))
                            )
                                setSelected(previous => [
                                    ...new Set([
                                        ...previous.filter(id => !removedSources.includes(id)),
                                        ...addedSources,
                                    ]),
                                ]);
                            const removedFiles = richChipIds.current
                                .filter(
                                    item =>
                                        item.kind === "attachment" &&
                                        item.attachment?.kind !== "image" &&
                                        !contexts.some(next => next.id === item.id)
                                )
                                .map(item => item.id);
                            const restoredFiles = contexts.flatMap(item =>
                                item.kind === "attachment" &&
                                item.attachment &&
                                !attachmentsRef.current.some(
                                    attachment => attachment.id === item.id
                                )
                                    ? [item.attachment]
                                    : []
                            );
                            if (removedFiles.length || restoredFiles.length)
                                updateAttachments([
                                    ...attachmentsRef.current.filter(
                                        item => !removedFiles.includes(item.id)
                                    ),
                                    ...restoredFiles,
                                ]);
                            const removedThreads = richChipIds.current
                                .filter(
                                    item =>
                                        item.kind === "thread" &&
                                        !contexts.some(next => next.id === item.id)
                                )
                                .map(item => item.id);
                            const addedThreads = contexts
                                .filter(item => item.kind === "thread")
                                .map(item => item.id);
                            if (
                                removedThreads.length ||
                                addedThreads.some(id => !threadRefs.includes(id))
                            )
                                setThreadRefs(previous => [
                                    ...new Set([
                                        ...previous.filter(id => !removedThreads.includes(id)),
                                        ...addedThreads,
                                    ]),
                                ]);
                            richChipIds.current = contexts;
                            setText(value);
                            setRichContent(content);
                            setRecallIndex(null);
                            syncCompletion(value);
                        }}
                        onKeyDown={event => {
                            onComposerKeyDown(event);
                            return event.defaultPrevented;
                        }}
                        onPaste={(event, selectedLength) => {
                            const files = Array.from(event.clipboardData?.files ?? []);
                            if (files.length) {
                                addFiles(files);
                                return true;
                            }
                            const value = event.clipboardData?.getData("text/plain") ?? "";
                            const bypass = shiftPaste.current;
                            shiftPaste.current = false;
                            if (!bypass && shouldAttachPaste(value, text, selectedLength)) {
                                addFiles([
                                    new File([value], `pasted-text-${Date.now()}.txt`, {
                                        type: "text/plain",
                                    }),
                                ]);
                                return true;
                            }
                            return false;
                        }}
                        onOpenContext={context => {
                            if (context.kind === "source") {
                                const source = sources.find(item => item.id === context.id);
                                if (source) onOpenSource?.(source);
                            }
                            if (context.kind === "thread") setInspectedThread(context.id);
                            if (context.kind === "attachment")
                                document
                                    .querySelector<HTMLButtonElement>(
                                        `[aria-label="Preview ${CSS.escape(context.label)}"]`
                                    )
                                    ?.click();
                        }}
                    />
                </Suspense>
            ) : (
                <textarea
                    ref={ref}
                    value={text}
                    aria-label="Chat message"
                    aria-describedby="composer-hint"
                    aria-invalid={overLimit}
                    aria-controls={completionCount ? "composer-completions" : undefined}
                    aria-activedescendant={
                        completionCount ? `composer-option-${completionIndex}` : undefined
                    }
                    className="text-ink placeholder:text-ink-3 min-h-[44px] w-full resize-none border-0 bg-transparent text-[15px] leading-6 outline-none"
                    placeholder={
                        agent
                            ? `Ask ${agent.displayName}, your ${agent.role.toLowerCase()}… or @mention another agent`
                            : selSources.length > 0
                              ? `Ask anything about ${selSources.length === 1 ? "this source" : `these ${selSources.length} sources`}…`
                              : "Ask anything. Pick sources on the left, type @ to bring in an agent."
                    }
                    onChange={event => {
                        setText(event.target.value);
                        setRichContent(null);
                        setRecallIndex(null);
                        syncCompletion(event.target.value);
                    }}
                    onClick={() => syncCompletion(text)}
                    onFocus={() => setFocus(true)}
                    onBlur={() => {
                        setFocus(false);
                        setMention(null);
                        setSlash(null);
                        shiftPaste.current = false;
                    }}
                    onPaste={event => {
                        const files = Array.from(event.clipboardData.files);
                        if (files.length) {
                            event.preventDefault();
                            addFiles(files);
                            return;
                        }
                        const value = event.clipboardData.getData("text/plain");
                        if (
                            !shiftPaste.current &&
                            shouldAttachPaste(value, text, selectedText().length)
                        ) {
                            event.preventDefault();
                            addFiles([
                                new File([value], `pasted-text-${Date.now()}.txt`, {
                                    type: "text/plain",
                                }),
                            ]);
                        }
                        shiftPaste.current = false;
                    }}
                    onKeyUp={event => {
                        if (event.key === "Shift" || event.key.toLowerCase() === "v")
                            shiftPaste.current = false;
                    }}
                    onKeyDown={onComposerKeyDown}
                />
            )}
            <input
                ref={fileInputRef}
                aria-label="Attach files"
                type="file"
                multiple
                accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*,.pdf,.doc,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.rtf,.log,.html,.htm"
                className="hidden"
                onChange={event => addFiles(Array.from(event.target.files ?? []))}
            />
            <input
                ref={reattachInputRef}
                className="hidden"
                type="file"
                aria-label="Reattach unavailable file"
                accept="image/*,.pdf,.doc,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.rtf,.log,.html,.htm"
                onChange={event => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length && reattachOriginKey.current === scopedKey)
                        addFiles(files, false, reattachAttachmentId.current ?? undefined);
                    reattachAttachmentId.current = null;
                    event.target.value = "";
                }}
            />
            <div className="border-line-2 mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
                <AgentPicker
                    agents={agents}
                    agent={agent}
                    mentioned={
                        mentionedKey && mentionedKey !== agentKey
                            ? (agents.find(option => option.id === mentionedKey) ?? null)
                            : null
                    }
                    onChange={onChangeAgent}
                />
                <Popover open={modelOpen} onOpenChange={setModelOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            aria-label="Choose model"
                            className="text-ink-2 h-8 max-w-[180px] text-xs"
                        >
                            <Brain className="size-3" />
                            <span className="truncate">
                                {modelRoutes.length >= 2
                                    ? `${modelRoutes.length} models`
                                    : (routeInfo?.model ?? "Model")}
                            </span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        className="w-[min(340px,calc(100vw-2rem))] p-2"
                        onKeyDown={event => {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                const choices = Array.from(
                                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                                        '[role="option"]:not(:disabled)'
                                    )
                                );
                                if (choices.length) {
                                    event.preventDefault();
                                    const index = choices.indexOf(
                                        document.activeElement as HTMLButtonElement
                                    );
                                    choices[
                                        index < 0
                                            ? event.key === "ArrowDown"
                                                ? 0
                                                : choices.length - 1
                                            : (index +
                                                  (event.key === "ArrowDown" ? 1 : -1) +
                                                  choices.length) %
                                              choices.length
                                    ]?.focus();
                                }
                                return;
                            }
                            const number = Number(
                                event.code?.startsWith("Digit") ? event.code.slice(5) : event.key
                            );
                            if (event.altKey && number >= 1 && number <= 4) {
                                const route = ROUTES[number - 1]!;
                                if (chatRoutes.config.routes[route]?.available) {
                                    event.preventDefault();
                                    setModelRoute(route);
                                    setReasoningEffort(undefined);
                                    setModelOpen(false);
                                }
                            }
                        }}
                    >
                        <Input
                            aria-label="Search models"
                            placeholder="Search configured models…"
                            value={modelSearch}
                            onChange={event => setModelSearch(event.target.value)}
                            className="mb-2 text-xs"
                        />
                        <div role="listbox" aria-label="Configured models">
                            {[...ROUTES]
                                .sort(
                                    (a, b) =>
                                        Number(favorites.includes(b)) -
                                        Number(favorites.includes(a))
                                )
                                .filter(route =>
                                    modelSearchMatches(
                                        `${route} ${chatRoutes.config.routes[route]?.model ?? ""}`,
                                        modelSearch
                                    )
                                )
                                .map(route => {
                                    const info = chatRoutes.config.routes[route];
                                    return (
                                        <div key={route} className="flex items-center gap-1">
                                            <Button
                                                role="option"
                                                aria-selected={modelRoute === route}
                                                variant="ghost"
                                                disabled={!info?.available}
                                                title={info?.unavailableReason}
                                                className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left text-xs"
                                                onClick={() => {
                                                    setModelRoute(route);
                                                    setReasoningEffort(undefined);
                                                    setModelOpen(false);
                                                }}
                                            >
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-medium">
                                                        {info?.model ?? `${route} route`}
                                                    </span>
                                                    <span className="text-ink-3 block capitalize">
                                                        {route}
                                                        {!info?.available ? " · unavailable" : ""}
                                                    </span>
                                                </span>
                                                {modelRoute === route && (
                                                    <Check className="size-3" />
                                                )}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                aria-label={`${favorites.includes(route) ? "Unfavorite" : "Favorite"} ${route} model`}
                                                onClick={() =>
                                                    setFavorites(previous =>
                                                        previous.includes(route)
                                                            ? previous.filter(
                                                                  value => value !== route
                                                              )
                                                            : [...previous, route]
                                                    )
                                                }
                                            >
                                                <Star
                                                    className={cn(
                                                        "size-3",
                                                        favorites.includes(route) &&
                                                            "text-brand fill-current"
                                                    )}
                                                />
                                            </Button>
                                        </div>
                                    );
                                })}
                        </div>
                        <fieldset className="border-line mt-2 border-t pt-2">
                            <legend className="text-ink-2 px-1 text-xs">
                                Compare independent model responses
                            </legend>
                            {ROUTES.filter(route => chatRoutes.config.routes[route]?.available).map(
                                route => (
                                    <label
                                        key={route}
                                        className="text-ink-2 flex items-center gap-2 px-2 py-1.5 text-xs"
                                    >
                                        <input
                                            type="checkbox"
                                            aria-label={`Compare ${route} model`}
                                            checked={modelRoutes.includes(route)}
                                            onChange={event =>
                                                setModelRoutes(previous =>
                                                    event.target.checked
                                                        ? [...previous, route]
                                                        : previous.filter(item => item !== route)
                                                )
                                            }
                                        />
                                        <span>
                                            {chatRoutes.config.routes[route].model} · {route}
                                        </span>
                                    </label>
                                )
                            )}
                            <p className="text-ink-3 px-2 py-1 text-[10px]">
                                Select two or more. Each response is saved in its own conversation.
                            </p>
                        </fieldset>
                        {chatRoutes.loading && (
                            <p className="text-ink-3 px-2 text-xs">Loading model configuration…</p>
                        )}
                        {effortOptions.length > 0 && (
                            <label className="text-ink-2 mt-2 block border-t pt-2 text-xs">
                                Reasoning effort
                                <select
                                    aria-label="Reasoning effort"
                                    value={reasoningEffort ?? ""}
                                    className="border-line bg-panel mt-1 h-8 w-full rounded-md border px-2"
                                    onChange={event =>
                                        setReasoningEffort(event.target.value || undefined)
                                    }
                                >
                                    <option value="">
                                        {effortInfo?.defaultEffort
                                            ? `Provider default (${effortInfo.defaultEffort})`
                                            : "Provider default"}
                                    </option>
                                    {effortOptions.map(effort => (
                                        <option key={effort} value={effort}>
                                            {effort}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </PopoverContent>
                </Popover>
                <ToolbarPill
                    label="Attach"
                    title={`Attach up to ${ATTACH_MAX_COUNT} files`}
                    icon={<Paperclip className="size-3" />}
                    active={attachments.length > 0}
                    disabled={disabled}
                    onClick={() => fileInputRef.current?.click()}
                    badge={
                        attachments.length + uploads.length
                            ? String(attachments.length + uploads.length)
                            : undefined
                    }
                />
                <Popover open={sourceOpen} onOpenChange={setSourceOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-ink-2 h-8 text-xs"
                            aria-label="Choose sources"
                        >
                            <Search className="size-3" />
                            <span className="@max-sm:sr-only">Sources</span>
                            {selected.length > 0 && <span>{selected.length}</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[min(320px,calc(100vw-2rem))] p-2">
                        <Input
                            aria-label="Search sources"
                            placeholder="Search source context…"
                            value={sourceSearch}
                            onChange={event => setSourceSearch(event.target.value)}
                            className="mb-2 text-xs"
                        />
                        <div className="max-h-64 overflow-auto">
                            {sources
                                .filter(source =>
                                    source.title.toLowerCase().includes(sourceSearch.toLowerCase())
                                )
                                .map(source => (
                                    <Button
                                        key={source.id}
                                        variant="ghost"
                                        size="sm"
                                        className="w-full justify-start text-xs"
                                        aria-pressed={selected.includes(source.id)}
                                        onClick={() =>
                                            setSelected(previous =>
                                                previous.includes(source.id)
                                                    ? previous.filter(id => id !== source.id)
                                                    : [...previous, source.id]
                                            )
                                        }
                                    >
                                        <span className="min-w-0 flex-1 truncate text-left">
                                            {source.title}
                                        </span>
                                        {selected.includes(source.id) && (
                                            <Check className="size-3" />
                                        )}
                                    </Button>
                                ))}
                            {sources.length === 0 && (
                                <p className="text-ink-3 p-2 text-xs">
                                    Add sources to choose context.
                                </p>
                            )}
                        </div>
                        {selected.length > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="mt-1 w-full text-xs"
                                onClick={() => setSelected([])}
                            >
                                Clear source context
                            </Button>
                        )}
                    </PopoverContent>
                </Popover>
                <ToolbarPill
                    label="Web"
                    title="Search the web in addition to your sources"
                    icon={<Globe className="size-3" />}
                    active={webSearch}
                    onClick={onToggleWebSearch}
                />
                <ToolbarPill
                    label="Think"
                    title={
                        chatRoutes.reasoningEnabled
                            ? "Reason before answering"
                            : (chatRoutes.reasoningDisabledReason ??
                              "Configure a controllable reasoning model to enable this")
                    }
                    icon={<Brain className="size-3" />}
                    active={thinking && chatRoutes.reasoningEnabled}
                    disabled={!chatRoutes.reasoningEnabled}
                    onClick={onToggleThinking}
                />
                <ToolbarPill
                    label={chatMode === "plan" ? "Plan" : "Default"}
                    title="Toggle planning mode"
                    icon={<FileText className="size-3" />}
                    active={chatMode === "plan"}
                    onClick={() =>
                        setChatMode(previous => (previous === "plan" ? "default" : "plan"))
                    }
                />
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={hasContent ? "Save prompt" : "Restore saved prompts"}
                    title="Save or restore prompt (⌘/Ctrl+S)"
                    onClick={handleStash}
                >
                    <Save className="size-3.5" />
                </Button>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Composer settings"
                        >
                            <Settings2 className="size-3.5" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-3">
                        <p className="text-ink mb-2 text-sm font-medium">Editor</p>
                        <div className="mb-3 flex gap-1">
                            <Button
                                variant={editorMode === "plain" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setEditorMode("plain")}
                            >
                                Plain Markdown
                            </Button>
                            <Button
                                variant={editorMode === "rich" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setEditorMode("rich")}
                            >
                                Rich text
                            </Button>
                        </div>
                        <p className="text-ink mb-2 text-sm font-medium">Send message with</p>
                        <div className="flex gap-1">
                            <Button
                                variant={sendKey === "enter" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setSendKey("enter")}
                            >
                                Enter
                            </Button>
                            <Button
                                variant={sendKey === "mod-enter" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setSendKey("mod-enter")}
                            >
                                ⌘/Ctrl+Enter
                            </Button>
                        </div>
                        <p className="text-ink mt-3 text-sm font-medium">
                            While a response is running
                        </p>
                        <div className="mt-1 flex gap-1">
                            <Button
                                variant={followUp === "queue" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFollowUp("queue")}
                            >
                                Queue
                            </Button>
                            <Button
                                variant={followUp === "interrupt" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFollowUp("interrupt")}
                            >
                                Interrupt
                            </Button>
                        </div>
                        <p className="text-ink-3 mt-2 text-xs">
                            Interrupt stops the current response and starts your follow-up with the
                            conversation context. ⌘/Ctrl+Enter uses the other action.
                        </p>
                        <p className="text-ink-3 mt-3 text-xs">
                            Shift+Enter adds a line. ⌘/Ctrl+Shift+L focuses the composer. ⌘/Ctrl+S
                            saves or restores a prompt. ↑ recalls sent prompts in an empty composer.
                        </p>
                    </PopoverContent>
                </Popover>
                <div className="ml-auto flex items-center gap-2">
                    <span className="mono text-ink-3 @max-sm:hidden text-[10px]">
                        {sendKey === "enter" ? "↵" : "⌘/Ctrl+↵"} to{" "}
                        {editingQueued ? "save" : active ? followUp : "send"}
                    </span>
                    <Button
                        size="icon"
                        className="size-9"
                        aria-label={
                            editingQueued
                                ? "Save queued message"
                                : !hasContent && active
                                  ? "Stop response"
                                  : active
                                    ? followUp === "queue"
                                        ? "Queue message"
                                        : "Interrupt with message"
                                    : "Send message"
                        }
                        title={
                            editingQueued
                                ? "Save queued message"
                                : !hasContent && active
                                  ? "Stop response"
                                  : active
                                    ? followUp === "queue"
                                        ? "Queue message for the next turn"
                                        : "Stop the current response and send this follow-up"
                                    : "Send message"
                        }
                        disabled={!hasContent && active ? !onStop : !canSend}
                        onClick={event => {
                            if (!hasContent && active) onStop?.();
                            else handleSend(event.metaKey || event.ctrlKey);
                        }}
                    >
                        {editingQueued ? (
                            <Check className="size-4" />
                        ) : !hasContent && active ? (
                            <Square className="size-3.5" />
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </Button>
                </div>
                {turnEffects.notes.length > 0 && (
                    <div className="text-ink-3 basis-full text-[11px]" role="status">
                        {turnAgent?.displayName ?? "This agent"}: {turnEffects.notes.join("; ")}.
                    </div>
                )}
            </div>
            {editingQueued && (
                <div className="text-ink-3 mt-2 flex items-center justify-between text-xs">
                    <span>Editing queued message · your unsent draft will return afterwards.</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={onCancelQueueEdit}
                    >
                        Cancel edit
                    </Button>
                </div>
            )}
            {editingQueued && queuedEditUnavailable && (
                <div className="border-line mt-2 flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
                    <span role="status" className="text-ink-2">
                        Queued message already sent or removed. Your edits are still here.
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={detachQueuedEdit}
                    >
                        Use edits in a new message
                    </Button>
                    <span className="text-ink-3">
                        Your earlier unsent draft will be saved with your prompts.
                    </span>
                </div>
            )}
            <div id="composer-hint" className="text-ink-3 mt-2 text-[10px]">
                {overLimit ? (
                    <span role="alert" className="text-danger">
                        {text.length.toLocaleString()} / {COMPOSER_MAX_CHARACTERS.toLocaleString()}{" "}
                        characters. Shorten this draft or attach it as a text file before sending.
                    </span>
                ) : uploadBlocked ? (
                    "All uploads must finish before sending. Retry or remove failed uploads."
                ) : chatMode === "plan" ? (
                    "Planning mode · asks for an actionable plan before execution."
                ) : text.length > 10_000 ? (
                    `${text.length.toLocaleString()} / ${COMPOSER_MAX_CHARACTERS.toLocaleString()} characters`
                ) : (
                    "Type / for commands · @ for agents and sources"
                )}
                {storageError && (
                    <span className="ml-1" role="alert">
                        Draft storage is unavailable. Keep this page open or copy your draft.
                    </span>
                )}
            </div>
            <Dialog
                open={inspectedThread !== null}
                onOpenChange={open => {
                    if (!open) setInspectedThread(null);
                }}
            >
                <DialogContent className="border-line bg-panel">
                    <DialogTitle>
                        {threadContextOptions.find(thread => thread.id === inspectedThread)
                            ?.title ?? "Referenced conversation"}
                    </DialogTitle>
                    <DialogDescription>
                        This conversation is included as context when you send. Access is checked by
                        the server; the original conversation remains available in your history.
                    </DialogDescription>
                    {onOpenThreadContext && inspectedThread && (
                        <Button
                            variant="outline"
                            onClick={() => {
                                onOpenThreadContext(inspectedThread);
                                setInspectedThread(null);
                            }}
                        >
                            Open conversation
                        </Button>
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={stashOpen} onOpenChange={setStashOpen}>
                <DialogContent className="border-line bg-panel">
                    <DialogTitle>Saved prompts</DialogTitle>
                    <DialogDescription>
                        Restore a prompt and its completed attachments in this conversation.
                    </DialogDescription>
                    <div className="max-h-80 space-y-2 overflow-auto">
                        {stashes.map(stash => (
                            <div
                                key={stash.id}
                                className="border-line flex items-center gap-2 rounded-md border p-2"
                            >
                                <Button
                                    variant="ghost"
                                    className="h-auto min-w-0 flex-1 flex-col items-start gap-1 whitespace-normal text-left text-xs"
                                    onClick={() => restoreStash(stash)}
                                >
                                    <span className="line-clamp-3">
                                        {stash.text || "Attached files"}
                                    </span>
                                    <span className="text-ink-3">
                                        {new Date(stash.savedAt).toLocaleString()} ·{" "}
                                        {stash.attachments.length} attachment(s)
                                    </span>
                                    {stash.attachments.some(
                                        attachment => attachment.kind === "image"
                                    ) && (
                                        <span className="flex flex-wrap gap-1">
                                            {stash.attachments
                                                .filter(attachment => attachment.kind === "image")
                                                .slice(0, 4)
                                                .map(attachment => {
                                                    const url = safeChatUri(attachment.url, true);
                                                    return url ? (
                                                        // Uploaded images use their original storage URLs.
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            key={attachment.id}
                                                            src={url}
                                                            alt={`${attachment.name} thumbnail`}
                                                            width={36}
                                                            height={36}
                                                            loading="lazy"
                                                            className="border-line size-9 rounded-md border object-cover"
                                                        />
                                                    ) : (
                                                        <span
                                                            key={attachment.id}
                                                            className="text-ink-3 text-xs"
                                                        >
                                                            {attachment.name} unavailable
                                                        </span>
                                                    );
                                                })}
                                        </span>
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Delete saved prompt ${stash.text.slice(0, 30)}`}
                                    onClick={() =>
                                        saveStashes(stashes.filter(item => item.id !== stash.id))
                                    }
                                >
                                    <X className="size-3" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ToolbarPill({
    label,
    title,
    icon,
    active,
    disabled,
    onClick,
    badge,
}: {
    label: string;
    title: string;
    icon: React.ReactNode;
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
    badge?: string;
}) {
    return (
        <Button
            variant={active ? "default" : "outline"}
            size="sm"
            onClick={onClick}
            title={title}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            className="@max-sm:px-2 h-8 gap-1.5 text-xs"
        >
            {icon}
            <span className="@max-sm:sr-only">{label}</span>
            {badge && <span className="text-[10px]">{badge}</span>}
        </Button>
    );
}

function AgentPicker({
    agents,
    agent,
    mentioned,
    onChange,
}: {
    agents: ChatAgentOption[];
    agent: ChatAgentOption | null;
    mentioned: ChatAgentOption | null;
    onChange: (key: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const shown = mentioned ?? agent;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    aria-label="Agent"
                    className="text-ink-2 h-8 max-w-[180px] text-xs"
                >
                    {shown ? (
                        <>
                            <AgentAvatar agent={shown} size={18} />
                            <span className="truncate">{shown.displayName}</span>
                            {mentioned && <span className="text-ink-3 text-[10px]">this turn</span>}
                        </>
                    ) : (
                        <>
                            <Bot className="size-3" />
                            <span className="@max-sm:sr-only">Agent</span>
                        </>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(320px,calc(100vw-2rem))] p-1.5">
                <p className="text-ink-3 px-2 pb-1.5 pt-1 text-[11px]">
                    Who holds this chat. Type @handle to bring another agent in for one turn.
                </p>
                <div role="listbox" aria-label="Chat agent">
                    <Button
                        role="option"
                        aria-selected={!agent}
                        variant="ghost"
                        className="h-auto w-full justify-start px-2 py-2 text-xs"
                        onClick={() => {
                            onChange(null);
                            setOpen(false);
                        }}
                    >
                        <Bot className="size-4" />
                        <span className="flex-1 text-left">Launchstack</span>
                        {!agent && <Check className="size-3" />}
                    </Button>
                    {agents.filter(usableAsPrimary).map(option => (
                        <Button
                            key={option.id}
                            role="option"
                            aria-selected={agent?.id === option.id}
                            variant="ghost"
                            className="h-auto w-full justify-start px-2 py-2 text-xs"
                            onClick={() => {
                                onChange(option.id);
                                setOpen(false);
                            }}
                        >
                            <AgentAvatar agent={option} size={24} />
                            <span className="min-w-0 flex-1 text-left">
                                <span className="block font-medium">
                                    {option.displayName}{" "}
                                    <span className="mono text-ink-3 text-[10px]">
                                        @{option.id}
                                    </span>
                                </span>
                                <span className="text-ink-3 block truncate font-normal">
                                    {option.description || option.role}
                                </span>
                            </span>
                            {agent?.id === option.id && <Check className="size-3" />}
                        </Button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
