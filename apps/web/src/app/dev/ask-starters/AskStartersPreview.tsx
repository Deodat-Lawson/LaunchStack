"use client";

import { useEffect, useState } from "react";
import { AskPanel } from "~/app/employer/documents/_workspace/AskPanel";
import type {
    ComposerSend,
    ThreadMessage,
    WorkspaceSource,
} from "~/app/employer/documents/_workspace/types";
import type { AskStartersPayload } from "~/lib/ask-starters/contract";

/**
 * Local harness for the Ask panel's starter questions. Mounts the real
 * AskPanel with the session-guarded routes stubbed, so the whole click path —
 * fetch, render, send, pinned source, reply — runs without a backend.
 *
 * Query flags: `?slow=1` keeps the skeleton up for 4s, `?fail=1` makes the
 * route 503 (offline set), `?fallback=1` returns the deterministic set,
 * `?noprofile=1` shows the "Add company profile" nudge. Gated by the page.
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

const GENERATED: AskStartersPayload = {
    starters: [
        {
            id: "g1",
            question: "What are the renewal and termination terms in the Globex MSA?",
            hint: "from the Globex MSA 2026",
            documentIds: [17],
        },
        {
            id: "g2",
            question: "What does Acme Robotics sell, and to whom?",
            hint: "from your company profile",
            documentIds: [],
        },
        {
            id: "g3",
            question: "Which customer complaints from Q3 does the PickBot v3 spec address?",
            hint: "interviews + field spec",
            documentIds: [12, 16],
        },
        {
            id: "g4",
            question: "Which contracts, certifications, or policies expire this quarter?",
            hint: "across 3 sources",
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

const SHUFFLED: AskStartersPayload = {
    ...GENERATED,
    starters: [
        {
            id: "g1",
            question: "Compare the PickBot v3 spec with what customers asked for in Q3",
            hint: "field spec + interviews",
            documentIds: [16, 12],
        },
        {
            id: "g2",
            question: "Who are Acme's named customers and partners?",
            hint: "profile + contracts",
            documentIds: [],
        },
        {
            id: "g3",
            question: "What are Globex's payment terms and SLAs?",
            hint: "from the Globex MSA 2026",
            documentIds: [17],
        },
        {
            id: "g4",
            question: "Which documents contradict each other on pricing?",
            hint: "across 3 sources",
            documentIds: [],
        },
    ],
};

const FALLBACK: AskStartersPayload = {
    starters: [
        {
            id: "f1",
            question: 'Summarize "Globex MSA 2026"',
            hint: "added 2 days ago",
            documentIds: [17],
        },
        {
            id: "f2",
            question: "What does Acme Robotics do, according to these sources?",
            hint: "across 3 sources",
            documentIds: [],
        },
        {
            id: "f3",
            question: 'What are the main points of "PickBot v3 field spec"?',
            hint: "Engineering · last week",
            documentIds: [16],
        },
        {
            id: "f4",
            question: "Which decisions, risks, or open questions come up most often?",
            hint: "themes across every source",
            documentIds: [],
        },
    ],
    basis: { ...GENERATED.basis, hasProfile: false, mode: "fallback" },
};

const CLOSED_ROUTES = {
    routes: {
        default: { available: true, model: "preview" },
        fast: { available: true, model: "preview" },
        reasoning: { available: false },
        vision: { available: false },
    },
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function installFetchStub(flags: URLSearchParams): () => void {
    const original = window.fetch.bind(window);
    const delayMs = flags.get("slow") === "1" ? 4000 : 600;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        if (url.startsWith("/api/config/ai-models")) return jsonResponse(CLOSED_ROUTES);

        if (url.startsWith("/api/ask/starters")) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            if (flags.get("fail") === "1") return jsonResponse({ success: false }, 503);
            const refresh = url.includes("refresh=1");
            let payload = refresh ? SHUFFLED : GENERATED;
            if (flags.get("fallback") === "1") payload = FALLBACK;
            if (flags.get("noprofile") === "1") {
                payload = { ...payload, basis: { ...payload.basis, hasProfile: false } };
            }
            return jsonResponse({ success: true, data: payload });
        }

        return original(input, init);
    }) as typeof window.fetch;

    return () => {
        window.fetch = original;
    };
}

export function AskStartersPreview() {
    const [ready, setReady] = useState(false);
    const [thread, setThread] = useState<ThreadMessage[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [lastNavigation, setLastNavigation] = useState<string | null>(null);

    useEffect(() => {
        const restore = installFetchStub(new URLSearchParams(window.location.search));
        setReady(true);
        return restore;
    }, []);

    const sendMessage = (send: ComposerSend) => {
        setThread(prev => [...prev, { role: "user", text: send.text, refs: send.refs }]);
        setIsSending(true);
        window.setTimeout(() => {
            const cited = send.refs[0] ?? SOURCES[0]!.id;
            setThread(prev => [
                ...prev,
                {
                    role: "assistant",
                    text: `**Preview reply.** In the real workspace this answer is retrieved from your sources and cited. You asked: ${send.text}`,
                    refs: [cited],
                    citations: [
                        {
                            sourceId: cited,
                            snippet:
                                "Either party may terminate for convenience on ninety (90) days' written notice.",
                            page: 4,
                            matchText: "ninety (90) days",
                        },
                    ],
                    model: "preview",
                },
            ]);
            setIsSending(false);
        }, 900);
    };

    if (!ready) return null;

    return (
        <div
            style={{
                height: "100vh",
                display: "flex",
                background: "var(--bg)",
                color: "var(--ink)",
            }}
        >
            <AskPanel
                sources={SOURCES}
                selected={selected}
                setSelected={setSelected}
                thread={thread}
                sendMessage={sendMessage}
                isSending={isSending}
                onOpenAdd={() => setLastNavigation("add-source")}
                onNewChat={() => setThread([])}
                openPalette={() => setLastNavigation("palette")}
                onStudioNavigate={href => setLastNavigation(href)}
                userInitials="TL"
                userName="Preview User"
                userEmail="preview@example.com"
                webSearch={false}
                onToggleWebSearch={() => undefined}
                thinking={false}
                onToggleThinking={() => undefined}
            />
            {lastNavigation && (
                <div
                    data-testid="preview-last-action"
                    className="bg-panel border-line fixed bottom-4 right-4 rounded-lg border px-3 py-2 text-xs"
                >
                    {lastNavigation}
                </div>
            )}
        </div>
    );
}
