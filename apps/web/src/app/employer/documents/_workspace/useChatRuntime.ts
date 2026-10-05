"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { toast } from "sonner";
import { conversationContext } from "~/lib/chat-turns";
import { MAX_SESSION_APPEND } from "~/lib/workspace-history";
import { useAIChat } from "../hooks/useAIChat";
import type { AIChatResponse, AIChatStreamEvent } from "../hooks/useAIChat";
import type { ComposerSend, ThreadMessage, WorkspaceSource } from "./types";
import type { ChatAgentOption } from "./collab/types";
import * as sessions from "./sessionApi";

interface RuntimeIdentity {
    activeNew?: string | null;
    sessions: Record<string, string>;
}
function identityStorageKey(scope: string) {
    return `launchstack.chat-identity.${scope}`;
}
function readIdentity(scope: string): RuntimeIdentity {
    try {
        const parsed = JSON.parse(
            localStorage.getItem(identityStorageKey(scope)) ?? "null"
        ) as RuntimeIdentity | null;
        return parsed && typeof parsed.sessions === "object" ? parsed : { sessions: {} };
    } catch {
        return { sessions: {} };
    }
}
function saveIdentity(scope: string, value: RuntimeIdentity) {
    try {
        localStorage.setItem(identityStorageKey(scope), JSON.stringify(value));
    } catch {
        /* Composer reports unavailable draft storage. */
    }
}
function initialDraftKey(scope: string) {
    const identity = readIdentity(scope);
    if (identity.activeNew) return identity.activeNew;
    const key = `new-${crypto.randomUUID()}`;
    saveIdentity(scope, { ...identity, activeNew: key });
    return key;
}

interface Conversation {
    key: string;
    sessionId: string | null;
    messages: ThreadMessage[];
    queue: sessions.QueueState;
    busy: boolean;
    held: boolean;
    controller?: AbortController;
    pending?: Promise<boolean>;
    writes: Promise<unknown>;
    draining?: boolean;
    continuation: { title: string; context: string } | null;
}

export interface ChatRuntimeView {
    key: string;
    busy: boolean;
    held: boolean;
    queue: sessions.QueueState;
}

function storedMessage(message: ThreadMessage): sessions.SessionMessagePayload {
    return {
        role: message.role,
        text: message.text,
        refs: message.refs,
        citations: message.citations,
        attachments: message.attachments,
        model: message.model,
        tokens: message.tokens,
        agentKey: message.agent?.key ?? null,
        metadata: {
            forkedFromSessionId: message.forkedFromSessionId,
            intent: message.intent,
            id: message.id,
            status: message.status === "streaming" ? undefined : message.status,
            reasoning: message.reasoning,
            elapsedMs: message.elapsedMs,
            send: message.send,
            tokenBreakdown: message.tokenBreakdown,
            chunksAnalyzed: message.chunksAnalyzed,
        },
    };
}

/** Each conversation owns its transport, writes and queue; navigation never redirects a late answer. */
export function useChatRuntime(input: {
    scopeKey?: string;
    thread: ThreadMessage[];
    setThread: Dispatch<SetStateAction<ThreadMessage[]>>;
    sessionIdRef: MutableRefObject<string | null>;
    hydratedSession: MutableRefObject<string | null>;
    setSessionParam: (id: string | null) => void;
    continuation: { title: string; context: string } | null;
    sources: WorkspaceSource[];
    agents: ChatAgentOption[];
    companyId: number | null;
    refreshHistory: () => Promise<unknown> | void;
}) {
    const currentInput = useRef(input);
    currentInput.current = input;
    const { sendQuery } = useAIChat();
    const requestRef = useRef(sendQuery);
    requestRef.current = sendQuery;
    const contexts = useRef(new Map<string, Conversation>());
    const scopeKey = input.scopeKey ?? `workspace-${input.companyId ?? "none"}`;
    const [initialKey] = useState(() => initialDraftKey(scopeKey));
    const keyRef = useRef(initialKey);
    const [view, setView] = useState<ChatRuntimeView>({
        key: keyRef.current,
        busy: false,
        held: false,
        queue: { items: [], revision: 0 },
    });

    const lastScope = useRef(scopeKey);
    const skipThreadSync = useRef(false);

    const get = useCallback(() => {
        let context = contexts.current.get(keyRef.current);
        if (!context) {
            context = {
                key: keyRef.current,
                sessionId: currentInput.current.sessionIdRef.current,
                messages: currentInput.current.thread,
                queue: { items: [], revision: 0 },
                busy: false,
                held: false,
                writes: Promise.resolve(),
                continuation: currentInput.current.continuation,
            };
            contexts.current.set(context.key, context);
        }
        return context;
    }, []);

    const emit = useCallback((context: Conversation) => {
        if (keyRef.current !== context.key || contexts.current.get(context.key) !== context) return;
        currentInput.current.setThread([...context.messages]);
        setView({
            key: context.key,
            busy: context.busy,
            held: context.held,
            queue: { ...context.queue },
        });
    }, []);

    useLayoutEffect(() => {
        if (lastScope.current === scopeKey) return;
        lastScope.current = scopeKey;
        skipThreadSync.current = true;
        for (const context of new Set(contexts.current.values())) context.controller?.abort();
        contexts.current.clear();
        keyRef.current = initialDraftKey(scopeKey);
        currentInput.current.sessionIdRef.current = null;
        currentInput.current.hydratedSession.current = null;
        const context = get();
        context.messages = [];
        context.continuation = null;
        emit(context);
    }, [scopeKey, get, emit]);

    useEffect(() => {
        if (skipThreadSync.current) {
            skipThreadSync.current = false;
            return;
        }
        const context = get();
        if (!context.busy) context.messages = input.thread;
        context.continuation = input.continuation;
    }, [input.thread, input.continuation, get]);

    const serial = useCallback(
        async <T>(context: Conversation, work: () => Promise<T>): Promise<T> => {
            const guarded = () => {
                if (contexts.current.get(context.key) !== context)
                    throw new Error(
                        "The original workspace changed. Reopen that conversation to continue."
                    );
                return work();
            };
            const next = context.writes.then(guarded, guarded);
            context.writes = next.catch(() => undefined);
            return next;
        },
        []
    );

    const saveQueue = useCallback(
        async (
            context: Conversation,
            items: sessions.QueueState["items"],
            revision = context.queue.revision
        ) => {
            if (!context.sessionId)
                throw new Error("Wait for this chat to finish saving before queuing a message.");
            const result = await sessions.updateQueue(context.sessionId, revision, items);
            context.queue = result;
            if (result.conflict) context.held = true;
            emit(context);
            if (result.conflict) {
                throw new Error(
                    "The queue changed in another tab. Review the refreshed messages and try again."
                );
            }
        },
        [emit]
    );

    const runRef = useRef<
        (
            context: Conversation,
            send: ComposerSend,
            persistedUser?: sessions.SessionMessagePayload
        ) => Promise<boolean>
    >(async () => false);
    const drainRef = useRef<(context: Conversation) => Promise<void>>(async () => undefined);
    drainRef.current = async context => {
        if (
            contexts.current.get(context.key) !== context ||
            context.busy ||
            context.draining ||
            context.held ||
            !context.queue.items.length ||
            !context.sessionId
        )
            return;
        context.draining = true;
        try {
            const result = await serial(context, () =>
                sessions.claimQueuedMessage(
                    context.sessionId!,
                    context.queue.revision,
                    context.queue.items[0]!.id
                )
            );
            if (contexts.current.get(context.key) !== context) {
                context.draining = false;
                return;
            }
            context.queue = result;
            if (result.conflict) context.held = true;
            emit(context);
            context.draining = false;
            if (result.claimed)
                await runRef.current(context, result.claimed.send, result.claimedMessage);
        } catch (error) {
            context.draining = false;
            context.held = true;
            emit(context);
            toast.error(
                error instanceof Error ? error.message : "Couldn't send the queued message"
            );
        }
    };

    runRef.current = async (context, send, persistedUser) => {
        if (context.busy || contexts.current.get(context.key) !== context) return false;
        send = { ...send, webSearch: true, thinking: true };
        context.busy = true;
        context.controller = new AbortController();
        const signal = context.controller.signal;
        const started = performance.now();
        const sourceList = currentInput.current.sources;
        const companyId = currentInput.current.companyId;
        const askedAgent = currentInput.current.agents.find(a => a.id === send.agentKey);
        const prior = [...context.messages];
        const user: ThreadMessage = {
            id: persistedUser?.metadata?.id ?? crypto.randomUUID(),
            createdAt: persistedUser?.createdAt ?? new Date().toISOString(),
            role: "user",
            text: send.text,
            refs: send.refs,
            attachments: send.attachments,
            send,
            intent: persistedUser?.metadata?.intent,
            agent: askedAgent
                ? {
                      key: askedAgent.id,
                      displayName: askedAgent.displayName,
                      role: askedAgent.role,
                      accent: askedAgent.accent ?? null,
                      avatarUrl: askedAgent.avatarUrl ?? null,
                  }
                : undefined,
        };
        const answer: ThreadMessage = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            role: "assistant",
            text: "",
            status: "streaming",
            stage: "Saving conversation",
            send: { ...send },
        };
        context.messages = [...prior, user, answer];
        emit(context);

        const onEvent = (event: AIChatStreamEvent) => {
            if (signal.aborted) return;
            if (event.type === "text") answer.text += event.delta;
            if (event.type === "reasoning")
                answer.reasoning = (answer.reasoning ?? "") + event.delta;
            if (event.type === "status") answer.stage = event.status;
            answer.elapsedMs = performance.now() - started;
            emit(context);
        };
        let savedUser = Boolean(persistedUser);
        try {
            if (!persistedUser)
                await serial(context, async () => {
                    if (context.sessionId) {
                        await sessions.appendMessages(context.sessionId, {
                            messages: [storedMessage(user)],
                            contextSourceIds: send.refs,
                            agentKey: send.agentKey,
                        });
                    } else {
                        const opening = [...prior, user];
                        const created = await sessions.createSession({
                            messages: opening.slice(0, MAX_SESSION_APPEND).map(storedMessage),
                            contextSourceIds: send.refs,
                            continuation: context.continuation,
                            agentKey: send.agentKey,
                        });
                        context.sessionId = created.id;
                        contexts.current.set(created.id, context);
                        const identity = readIdentity(scopeKey);
                        const entries = Object.entries({
                            ...identity.sessions,
                            [created.id]: context.key,
                        }).slice(-1000);
                        saveIdentity(scopeKey, {
                            activeNew:
                                identity.activeNew === context.key ? null : identity.activeNew,
                            sessions: Object.fromEntries(entries),
                        });
                        for (
                            let offset = MAX_SESSION_APPEND;
                            offset < opening.length;
                            offset += MAX_SESSION_APPEND
                        ) {
                            await sessions.appendMessages(created.id, {
                                messages: opening
                                    .slice(offset, offset + MAX_SESSION_APPEND)
                                    .map(storedMessage),
                            });
                        }
                        if (keyRef.current === context.key) {
                            currentInput.current.sessionIdRef.current = created.id;
                            currentInput.current.hydratedSession.current = created.id;
                            currentInput.current.setSessionParam(created.id);
                        }
                    }
                    savedUser = true;
                });
            if (signal.aborted) throw new DOMException("Stopped", "AbortError");
            answer.stage = "Preparing response";
            emit(context);
            const references: string[] = [];
            for (const id of send.threadRefs ?? []) {
                if (signal.aborted) throw new DOMException("Stopped", "AbortError");
                answer.stage = "Reading referenced conversation";
                emit(context);
                const referenced = await sessions.fetchSession(id);
                if (!referenced)
                    throw new Error(
                        "A referenced chat is unavailable. Remove its context chip and try again."
                    );
                references.push(
                    `Referenced conversation: ${referenced.title}\n${conversationContext(referenced.messages ?? []) ?? "(empty)"}`
                );
            }
            const ids = send.refs
                .map(id => sourceList.find(s => s.id === id)?.documentId)
                .filter((id): id is number => typeof id === "number");
            const scope = ids.length > 1 ? "selected" : ids.length === 1 ? "document" : "none";
            const response = await requestRef.current(
                {
                    question: send.text || "Please examine the attached files.",
                    searchScope: scope,
                    companyId: companyId ?? undefined,
                    documentId: scope === "document" ? ids[0] : undefined,
                    selectedDocumentIds: scope === "selected" ? ids : undefined,
                    // All workspace sends share automatic defaults, including old
                    // persisted drafts, queued prompts, edits and retries.
                    enableWebSearch: true,
                    thinkingMode: "auto",
                    conversationHistory: conversationContext(
                        prior,
                        [context.continuation?.context, ...references].filter(Boolean).join("\n\n")
                    ),
                    agentKey: send.agentKey,
                    modelRoute: send.modelRoute,
                    reasoningEffort: send.reasoningEffort,
                    chatMode: send.chatMode,
                    attachments: send.attachments.map(({ url, name, mimeType, kind }) => ({
                        url,
                        name,
                        mimeType,
                        kind,
                    })),
                },
                { stream: true, onEvent, signal, independent: true }
            );
            if (signal.aborted || response.cancelled)
                throw new DOMException("Stopped", "AbortError");
            applyResponse(answer, response, sourceList);
            if (!response.success) context.held = true;
        } catch (error) {
            const stopped =
                signal.aborted || (error instanceof Error && error.name === "AbortError");
            answer.status = stopped ? "stopped" : "error";
            answer.stage = stopped ? "Stopped" : "Failed";
            if (!stopped)
                answer.text =
                    error instanceof Error ? error.message : "Couldn't send this message.";
            context.held = true;
        } finally {
            answer.elapsedMs = performance.now() - started;
            if (savedUser && context.sessionId) {
                try {
                    await serial(context, () =>
                        sessions.appendMessages(context.sessionId!, {
                            messages: [storedMessage(answer)],
                        })
                    );
                } catch {
                    toast.error(
                        "The response is visible but couldn't be saved. Keep this tab open and copy it before leaving."
                    );
                }
            }
            context.busy = false;
            context.controller = undefined;
            emit(context);
            void currentInput.current.refreshHistory();
        }
        const succeeded = answer.status !== "error";
        await drainRef.current(context);
        return succeeded;
    };

    const submit = useCallback(
        async (send: ComposerSend, originKey?: string) => {
            send = { ...send, webSearch: true, thinking: true };
            const context = originKey ? contexts.current.get(originKey) : get();
            if (!context)
                throw new Error(
                    "The original workspace changed. Reopen that conversation to retry."
                );
            const routes = [...new Set(send.modelRoutes ?? [])];
            if (routes.length > 1 && !context.busy) {
                const prior = [...context.messages];
                const comparisons = routes.slice(1).map(route => {
                    const sibling: Conversation = {
                        key: `comparison-${crypto.randomUUID()}`,
                        sessionId: null,
                        messages: [...prior],
                        queue: { items: [], revision: 0 },
                        busy: false,
                        held: false,
                        writes: Promise.resolve(),
                        continuation: context.continuation,
                    };
                    contexts.current.set(sibling.key, sibling);
                    return runRef.current(sibling, {
                        ...send,
                        modelRoute: route,
                        modelRoutes: undefined,
                        reasoningEffort:
                            route === send.modelRoute ? send.reasoningEffort : undefined,
                    });
                });
                context.pending = runRef.current(context, {
                    ...send,
                    modelRoute: routes[0],
                    modelRoutes: undefined,
                    reasoningEffort:
                        routes[0] === send.modelRoute ? send.reasoningEffort : undefined,
                });
                const results = await Promise.all([context.pending, ...comparisons]);
                return results.every(Boolean)
                    ? true
                    : {
                          success: false,
                          failedModelRoutes: routes.filter((_, index) => !results[index]),
                      };
            }
            if (!context.busy && (originKey || !context.held || !context.queue.items.length)) {
                context.held = false;
                if (!originKey) context.continuation = currentInput.current.continuation;
                context.pending = runRef.current(context, send);
                return await context.pending;
            }
            try {
                await serial(context, () =>
                    saveQueue(context, [...context.queue.items, { id: crypto.randomUUID(), send }])
                );
                if (send.followUp === "interrupt" && context.busy) {
                    context.held = false;
                    context.controller?.abort();
                    await context.pending;
                    context.held = false;
                    await drainRef.current(context);
                }
                await drainRef.current(context);
                return true;
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Couldn't queue this message");
                return false;
            }
        },
        [get, serial, saveQueue]
    );

    const stop = useCallback(() => {
        const context = get();
        context.held = true;
        context.controller?.abort();
        emit(context);
    }, [get, emit]);

    const open = useCallback(
        (id: string, stored?: sessions.StoredSession): boolean => {
            const existing = contexts.current.get(id);
            if (existing) {
                keyRef.current = existing.key;
                currentInput.current.sessionIdRef.current = id;
                emit(existing);
                return true;
            }
            if (!stored) return false;
            const context: Conversation = {
                key: readIdentity(scopeKey).sessions[id] ?? id,
                sessionId: id,
                messages: (stored.messages ?? []).map(message => ({
                    ...message.metadata,
                    createdAt: message.createdAt,
                    role: message.role,
                    text: message.text,
                    refs: message.refs,
                    attachments: message.attachments as ThreadMessage["attachments"],
                    citations: message.citations as ThreadMessage["citations"],
                    model: message.model ?? undefined,
                    tokens: message.tokens ?? undefined,
                    agent: message.agentKey
                        ? { key: message.agentKey, displayName: "", role: "", accent: null }
                        : undefined,
                })),
                queue: { items: stored.queuedMessages ?? [], revision: stored.queueRevision ?? 0 },
                busy: false,
                held: Boolean(stored.queuedMessages?.length),
                writes: Promise.resolve(),
                continuation: stored.continuation ?? null,
            };
            keyRef.current = context.key;
            contexts.current.set(id, context);
            contexts.current.set(context.key, context);
            currentInput.current.sessionIdRef.current = id;
            emit(context);
            return true;
        },
        [emit, scopeKey]
    );

    const newChat = useCallback(
        (messages: ThreadMessage[] = []) => {
            keyRef.current = `new-${crypto.randomUUID()}`;
            saveIdentity(scopeKey, { ...readIdentity(scopeKey), activeNew: keyRef.current });
            const context: Conversation = {
                key: keyRef.current,
                sessionId: null,
                messages,
                queue: { items: [], revision: 0 },
                busy: false,
                held: false,
                writes: Promise.resolve(),
                continuation: null,
            };
            contexts.current.set(context.key, context);
            currentInput.current.sessionIdRef.current = null;
            currentInput.current.hydratedSession.current = null;
            emit(context);
        },
        [emit, scopeKey]
    );

    const fork = useCallback(
        async (messages: ThreadMessage[]): Promise<boolean> => {
            newChat(messages);
            const context = get();
            try {
                await serial(context, async () => {
                    const created = await sessions.createSession({
                        messages: messages.slice(0, MAX_SESSION_APPEND).map(storedMessage),
                        contextSourceIds: [
                            ...new Set(messages.flatMap(message => message.refs ?? [])),
                        ],
                    });
                    context.sessionId = created.id;
                    contexts.current.set(created.id, context);
                    const identity = readIdentity(scopeKey);
                    saveIdentity(scopeKey, {
                        activeNew: identity.activeNew === context.key ? null : identity.activeNew,
                        sessions: Object.fromEntries(
                            Object.entries({
                                ...identity.sessions,
                                [created.id]: context.key,
                            }).slice(-1000)
                        ),
                    });
                    for (
                        let offset = MAX_SESSION_APPEND;
                        offset < messages.length;
                        offset += MAX_SESSION_APPEND
                    )
                        await sessions.appendMessages(created.id, {
                            messages: messages
                                .slice(offset, offset + MAX_SESSION_APPEND)
                                .map(storedMessage),
                        });
                    if (keyRef.current === context.key) {
                        currentInput.current.sessionIdRef.current = created.id;
                        currentInput.current.hydratedSession.current = created.id;
                        currentInput.current.setSessionParam(created.id);
                    }
                });
                emit(context);
                void currentInput.current.refreshHistory();
                return true;
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : "Couldn't save the fork. Keep this tab open and try again."
                );
                return false;
            }
        },
        [newChat, get, serial, emit, scopeKey]
    );

    const modifyQueue = useCallback(
        async (items: sessions.QueueState["items"]) => {
            const context = get();
            const revision = context.queue.revision;
            try {
                await serial(context, () => saveQueue(context, items, revision));
                return true;
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Couldn't update the queue");
                return false;
            }
        },
        [get, serial, saveQueue]
    );

    const resume = useCallback(async () => {
        const context = get();
        context.held = false;
        emit(context);
        await drainRef.current(context);
    }, [get, emit]);
    const sendNow = useCallback(
        async (id: string) => {
            const context = get();
            const index = context.queue.items.findIndex(item => item.id === id);
            if (index < 0) return;
            const items = [...context.queue.items];
            items.unshift(...items.splice(index, 1));
            items[0] = { ...items[0]!, send: { ...items[0]!.send, followUp: "interrupt" } };
            if (!(await modifyQueue(items))) return;
            context.controller?.abort();
            await context.pending;
            context.held = false;
            await drainRef.current(context);
        },
        [get, modifyQueue]
    );

    const rewind = useCallback(
        async (keepCount: number) => {
            const context = get();
            if (context.busy)
                throw new Error("Stop the response before editing an earlier message.");
            context.busy = true;
            context.held = true;
            emit(context);
            try {
                if (context.sessionId)
                    await serial(context, () =>
                        sessions.truncateMessages(
                            context.sessionId!,
                            keepCount,
                            context.messages.length
                        )
                    );
                if (contexts.current.get(context.key) !== context)
                    throw new Error(
                        "The workspace changed while editing. Your original prompt can be restored in its conversation."
                    );
                context.messages = context.messages.slice(0, keepCount);
                void currentInput.current.refreshHistory();
                return context.key;
            } finally {
                context.busy = false;
                emit(context);
            }
        },
        [get, serial, emit]
    );

    const retry = useCallback(
        async (keepCount: number, send: ComposerSend) => {
            const context = get();
            const key = await rewind(keepCount);
            if (contexts.current.get(key) !== context)
                throw new Error(
                    "The original workspace changed. Reopen that conversation to retry."
                );
            return submit(send, key);
        },
        [get, rewind, submit]
    );

    useEffect(
        () => () => {
            for (const context of new Set(contexts.current.values())) context.controller?.abort();
        },
        []
    );
    return {
        ...view,
        submit,
        stop,
        open,
        newChat,
        fork,
        modifyQueue,
        resume,
        sendNow,
        rewind,
        retry,
    };
}

function applyResponse(
    answer: ThreadMessage,
    response: AIChatResponse,
    sources: WorkspaceSource[]
) {
    answer.status = response.success ? "complete" : "error";
    answer.stage = response.success ? "Complete" : "Failed";
    answer.text = response.success
        ? (response.summarizedAnswer ?? answer.text)
        : (response.message ?? response.error ?? "Couldn't get a response.");
    answer.model = response.aiModel;
    answer.tokens = response.tokenUsage?.totalTokens;
    answer.tokenBreakdown = response.tokenUsage
        ? {
              inputTokens: response.tokenUsage.inputTokens,
              outputTokens: response.tokenUsage.outputTokens,
          }
        : undefined;
    answer.chunksAnalyzed = response.chunksAnalyzed;
    answer.citations = (response.references ?? []).flatMap(reference => {
        const source = sources.find(s => s.documentId === Number(reference.documentId));
        return source
            ? [
                  {
                      sourceId: source.id,
                      snippet: reference.snippet ?? "",
                      page: reference.page,
                      matchText: reference.matchText,
                  },
              ]
            : [];
    });
    answer.agent = response.agent
        ? { ...response.agent, avatarUrl: response.agent.avatarUrl ?? null }
        : undefined;
}
