"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AskPanel } from "~/app/employer/documents/_workspace/AskPanel";
import type {
    ComposerSend,
    ThreadMessage,
    WorkspaceSource,
} from "~/app/employer/documents/_workspace/types";
import { useChatRuntime } from "~/app/employer/documents/_workspace/useChatRuntime";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { StoredSession } from "~/app/employer/documents/_workspace/sessionApi";
import type { AskStartersPayload } from "~/lib/ask-starters/contract";
import { previewScript, type PreviewMode, type PreviewRequest } from "./script";

/**
 * Local harness for the chat's streaming and thinking trace. Mounts the real
 * AskPanel on the real chat runtime and transport; only the network is
 * stubbed. The chat route answers with a scripted stream of sample text, and
 * the session routes keep the chat in this tab's sessionStorage, so a reload
 * restores it from what the runtime saved.
 *
 * Query flags: `?mode=hidden|visible|fast|fail` picks the answer script (also
 * switchable on the page), `?slow=1` stretches every delay 3×. Gated by the page.
 */

const SOURCES: WorkspaceSource[] = [
    {
        id: "d17",
        documentId: 17,
        title: "Globex MSA 2026.pdf",
        type: "doc",
        size: "",
        added: "2 days ago",
        folder: "Contracts",
        tags: [],
        domain: "Contract",
    },
    {
        id: "d16",
        documentId: 16,
        title: "PickBot v3 field spec.docx",
        type: "doc",
        size: "",
        added: "last week",
        folder: "Engineering",
        tags: [],
        domain: "Technical",
    },
    {
        id: "d12",
        documentId: 12,
        title: "Q3 customer interviews.m4a",
        type: "audio",
        size: "",
        added: "3 weeks ago",
        folder: "Research",
        tags: [],
        domain: "Research",
    },
];

const STARTERS: AskStartersPayload = {
    starters: [
        {
            id: "s1",
            question: "What are the renewal and termination terms in the Globex MSA?",
            hint: "from the Globex MSA 2026",
            documentIds: [17],
        },
        {
            id: "s2",
            question: "What is a SAFE note?",
            hint: "general knowledge",
            documentIds: [],
        },
    ],
    basis: {
        companyName: "Acme Robotics",
        sourceCount: 3,
        hasProfile: true,
        mode: "generated",
        generatedAt: new Date().toISOString(),
    },
};

const ROUTES = {
    routes: {
        default: { available: true, reasoning: { mode: "effort", controllable: false } },
        fast: { available: true },
        reasoning: { available: false },
        vision: { available: false },
    },
};

const STORE_KEY = "ask-chat-preview.sessions";
const MODES: { id: PreviewMode; label: string }[] = [
    { id: "hidden", label: "Hidden reasoning (production)" },
    { id: "visible", label: "Visible reasoning" },
    { id: "fast", label: "Fast reply" },
    { id: "fail", label: "Fails midway" },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function readStore(): Record<string, StoredSession> {
    try {
        return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}") as Record<
            string,
            StoredSession
        >;
    } catch {
        return {};
    }
}

function writeStore(store: Record<string, StoredSession>) {
    try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
        /* A preview without storage just can't restore on reload. */
    }
}

function streamScript(
    request: PreviewRequest,
    mode: PreviewMode,
    stretch: number,
    signal: AbortSignal | null | undefined
): Response {
    const encoder = new TextEncoder();
    const script = previewScript(request, mode);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            for (const { delayMs, event } of script) {
                if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs * stretch));
                if (cancelled || signal?.aborted) return;
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            }
            controller.close();
        },
        cancel() {
            cancelled = true;
        },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}

function installFetchStub(mode: { current: PreviewMode }, stretch: number): () => void {
    const original = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = url.replace(/^https?:\/\/[^/]+/, "");
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;

        if (path.startsWith("/api/config/ai-models")) return json(ROUTES);
        if (path.startsWith("/api/ask/starters")) return json({ success: true, data: STARTERS });
        if (path.startsWith("/api/workspace/history"))
            return json({ entries: [], degraded: [], archivedCount: 0 });
        if (path.startsWith("/api/agents/documentQ&A/AIChat/query"))
            return streamScript(body as PreviewRequest, mode.current, stretch, init?.signal);

        const sessionMatch = /^\/api\/workspace\/sessions(?:\/([^/?]+))?(\/[a-z]+)?/.exec(path);
        if (sessionMatch) {
            const store = readStore();
            const id = sessionMatch[1] ? decodeURIComponent(sessionMatch[1]) : null;
            const tail = sessionMatch[2] ?? "";
            const now = new Date().toISOString();
            const stamp = (messages: StoredSession["messages"], from: number) =>
                (messages ?? []).map((m, i) => ({
                    ...m,
                    seq: from + i,
                    createdAt: m.createdAt ?? now,
                }));
            if (!id && method === "POST") {
                const input = body as { messages: StoredSession["messages"]; title?: string };
                const created: StoredSession = {
                    id: `preview-${Date.now().toString(36)}`,
                    title: input.title ?? "Preview chat",
                    messageCount: input.messages?.length ?? 0,
                    contextSourceIds: [],
                    lastMessageAt: now,
                    createdAt: now,
                    messages: stamp(input.messages, 0),
                    access: { level: "owner", ownerAuthUserId: "preview", sharedAt: null },
                };
                writeStore({ ...store, [created.id]: created });
                return json({ session: created });
            }
            const session = id ? store[id] : undefined;
            if (!session) return json({ message: "Not found" }, 404);
            if (tail === "/messages" && method === "POST") {
                const input = body as { messages: StoredSession["messages"] };
                const messages = [
                    ...(session.messages ?? []),
                    ...stamp(input.messages, session.messages?.length ?? 0),
                ];
                const next = {
                    ...session,
                    messages,
                    messageCount: messages.length,
                    lastMessageAt: now,
                };
                writeStore({ ...store, [session.id]: next });
                return json({ session: next });
            }
            if (tail === "/queue") return json({ items: [], revision: 0 });
            if (tail === "/state")
                return json({ pinned: false, pinRank: null, archived: false, lastSeenAt: null });
            if (!tail && method === "GET") return json({ session });
            return json({ session });
        }
        return original(input, init);
    }) as typeof window.fetch;
    return () => {
        window.fetch = original;
    };
}

function sessionParam(): string | null {
    return new URLSearchParams(window.location.search).get("session");
}

function ChatHarness() {
    const [thread, setThread] = useState<ThreadMessage[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const sessionIdRef = useRef<string | null>(null);
    const hydratedSession = useRef<string | null>(null);
    const setSessionParam = useCallback((id: string | null) => {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set("session", id);
        else url.searchParams.delete("session");
        window.history.replaceState(null, "", url);
    }, []);
    const runtime = useChatRuntime({
        scopeKey: "ask-chat-preview",
        thread,
        setThread,
        sessionIdRef,
        hydratedSession,
        setSessionParam,
        continuation: null,
        sources: SOURCES,
        agents: [],
        companyId: 1,
        refreshHistory: () => undefined,
    });
    const { open } = runtime;

    useEffect(() => {
        const id = sessionParam();
        if (!id) return;
        void fetch(`/api/workspace/sessions/${encodeURIComponent(id)}`)
            .then(async res => (res.ok ? ((await res.json()) as { session: StoredSession }) : null))
            .then(found => {
                if (found) open(id, found.session);
            });
    }, [open]);

    const sendMessage = (send: ComposerSend) => runtime.submit(send);

    return (
        <AskPanel
            sources={SOURCES}
            selected={selected}
            setSelected={setSelected}
            thread={thread}
            sendMessage={sendMessage}
            isSending={runtime.busy}
            onStop={runtime.stop}
            onRetryMessage={index => {
                const question = thread[index - 1];
                if (question?.send) void runtime.retry(index - 1, question.send);
            }}
            onOpenAdd={() => undefined}
            onNewChat={() => {
                runtime.newChat();
                setSessionParam(null);
            }}
            openPalette={() => undefined}
            onStudioNavigate={() => undefined}
            draftKey={`ask-chat-preview:${runtime.key}`}
        />
    );
}

export function AskChatPreview() {
    const [ready, setReady] = useState(false);
    const [mode, setMode] = useState<PreviewMode>("hidden");
    const modeRef = useRef<PreviewMode>("hidden");

    useEffect(() => {
        const flags = new URLSearchParams(window.location.search);
        const initial = flags.get("mode");
        if (MODES.some(option => option.id === initial)) {
            modeRef.current = initial as PreviewMode;
            setMode(initial as PreviewMode);
        }
        const restore = installFetchStub(modeRef, flags.get("slow") === "1" ? 3 : 1);
        setReady(true);
        return restore;
    }, []);

    if (!ready) return null;
    return (
        <div className="bg-surface text-ink flex h-screen flex-col">
            <div className="border-line bg-panel flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[12px]">
                <span className="text-ink-3">Sample answer:</span>
                <ToggleGroup
                    type="single"
                    size="sm"
                    aria-label="Sample answer"
                    data-testid="preview-modes"
                    value={mode}
                    onValueChange={value => {
                        if (!value) return;
                        modeRef.current = value as PreviewMode;
                        setMode(value as PreviewMode);
                    }}
                    className="flex-wrap justify-start"
                >
                    {MODES.map(option => (
                        <ToggleGroupItem
                            key={option.id}
                            value={option.id}
                            className="h-7 px-2.5 text-[12px] font-normal"
                        >
                            {option.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>
            <div className="flex min-h-0 flex-1">
                <ChatHarness />
            </div>
        </div>
    );
}
