import { createServer, type ServerResponse } from "node:http";
import {
    createChatModelsConfig,
    resolveChatModel,
    type ResolveChatModelOptions,
} from "@launchstack/llm";
import {
    enrichmentReadyCall,
    northstarPricingReviewCall,
    pausedCall,
    redactedCall,
} from "~/app/calls/_fixtures/callSnapshots";

const mockRequireWorkspacePermission = jest.fn();
const mockGetCall = jest.fn();
const mockStream = jest.fn();
const mockResolveModel = jest.fn<unknown, [ResolveChatModelOptions]>();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: (permission: string) => mockRequireWorkspacePermission(permission),
}));
jest.mock("~/lib/active-workspace", () => ({ getActiveCompanyId: async () => 42n }));
jest.mock("~/lib/rate-limiter", () => ({ RateLimitPresets: { strict: {} } }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _preset: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/server/call-notes/application", () => ({
    getWebCallNotesApplication: () => ({ getCall: mockGetCall }),
    callNotesErrorResponse: () =>
        new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));
jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: (options: ResolveChatModelOptions) => mockResolveModel(options),
    describeChatResolutionFailure: () => ({ status: 503, message: "Unavailable" }),
}));
jest.mock("~/app/api/agents/documentQ&A/services", () => ({
    normalizeModelContent: (content: string) => content,
    describeChatError: () => null,
}));

import { POST } from "~/app/api/call-notes/[callId]/chat/route";

beforeEach(() => {
    jest.clearAllMocks();
    mockResolveModel.mockImplementation(() => ({
        chat: { stream: mockStream },
        prepareMessages: (messages: unknown[]) => messages,
        modelId: "test-model",
    }));
    mockRequireWorkspacePermission.mockResolvedValue({
        success: true,
        data: { authUserId: "viewer", companyId: 42n },
    });
    mockGetCall.mockResolvedValue(northstarPricingReviewCall);
    mockStream.mockImplementation(async function* () {
        yield { content: "The pricing deadline is Friday." };
    });
});

describe("Call chat access boundaries", () => {
    it("does not load call evidence or invoke AI without authentication", async () => {
        mockRequireWorkspacePermission.mockResolvedValue({
            success: false,
            response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });
        const response = await POST(
            new Request("http://localhost/api/call-notes/call-1/chat", {
                method: "POST",
                body: JSON.stringify({ question: "What was decided?" }),
            }),
            { params: Promise.resolve({ callId: "call-1" }) }
        );
        expect(response.status).toBe(401);
        expect(mockGetCall).not.toHaveBeenCalled();
        expect(mockStream).not.toHaveBeenCalled();
    });

    it("does not invoke AI when call access is denied", async () => {
        mockGetCall.mockRejectedValue(new Error("Forbidden"));
        const response = await POST(
            new Request("http://localhost/api/call-notes/call-1/chat", {
                method: "POST",
                body: JSON.stringify({ question: "What was decided?" }),
            }),
            { params: Promise.resolve({ callId: "call-1" }) }
        );
        expect(response.status).toBe(403);
        expect(mockStream).not.toHaveBeenCalled();
    });

    it("uses authorized transcript evidence without restoring a redacted note from the client", async () => {
        mockGetCall.mockResolvedValue(redactedCall);
        const response = await POST(
            new Request("http://localhost/api/call-notes/call-1/chat", {
                method: "POST",
                body: JSON.stringify({
                    question: "What deadline is in the transcript?",
                    note: "FORGED_PRIVATE_NOTE_CONTENT",
                    companyId: "999",
                    actorUserId: "attacker",
                }),
            }),
            { params: Promise.resolve({ callId: "call-1" }) }
        );
        expect(response.status).toBe(200);
        const suppliedEvidence = JSON.stringify(mockStream.mock.calls[0]);
        expect(suppliedEvidence).toContain("finalize the pricing tiers before Friday");
        expect(suppliedEvidence).not.toContain("FORGED_PRIVATE_NOTE_CONTENT");
        expect(suppliedEvidence).not.toContain("Enterprise tier draft in progress");
        expect(mockGetCall).toHaveBeenCalledWith({
            companyId: "42",
            actorUserId: "viewer",
            callId: "call-1",
        });
    });

    it("rejects oversized call evidence rather than silently dropping transcript content", async () => {
        mockGetCall.mockResolvedValue({
            ...northstarPricingReviewCall,
            transcript: [
                { ...northstarPricingReviewCall.transcript[0], text: "evidence ".repeat(8_000) },
            ],
        });
        const response = await POST(
            new Request("http://localhost/api/call-notes/call-1/chat", {
                method: "POST",
                body: JSON.stringify({ question: "What was decided?" }),
            }),
            { params: Promise.resolve({ callId: "call-1" }) }
        );
        expect(response.status).toBe(413);
        expect(mockStream).not.toHaveBeenCalled();
    });
});

describe("Call chat current context", () => {
    const ask = (history: { role: "user" | "assistant"; content: string }[] = []) =>
        POST(
            new Request("http://localhost/api/call-notes/call-1/chat", {
                method: "POST",
                body: JSON.stringify({ question: "What is the latest plan?", history }),
            }),
            { params: Promise.resolve({ callId: "call-1" }) }
        );
    const currentContext = () => {
        const calls = mockStream.mock.calls as [{ content: string }[]][];
        return calls.at(-1)![0].at(-1)!.content;
    };

    it("refreshes the full transcript on follow-ups and picks up post-call notes when ready", async () => {
        mockGetCall.mockResolvedValueOnce(pausedCall);
        expect((await ask()).status).toBe(200);
        expect(currentContext()).not.toContain("The launch has moved to Monday.");

        const latestTranscript = [
            ...pausedCall.transcript,
            {
                ...pausedCall.transcript[1]!,
                id: "segment-3",
                receiveOrder: 2,
                text: "The launch has moved to Monday.",
            },
        ];
        mockGetCall.mockResolvedValueOnce({ ...pausedCall, transcript: latestTranscript });
        const history = [
            { role: "user" as const, content: "When is the launch?" },
            { role: "assistant" as const, content: "The launch is Friday." },
        ];
        expect((await ask(history)).status).toBe(200);
        expect(currentContext()).toContain("finalize the pricing tiers before Friday");
        expect(currentContext()).toContain("The launch has moved to Monday.");
        expect(currentContext()).not.toContain("The launch is Friday.");

        mockGetCall.mockResolvedValueOnce({
            ...enrichmentReadyCall,
            transcript: latestTranscript,
            enrichment: {
                ...enrichmentReadyCall.enrichment!,
                status: "generating",
                proposal: null,
            },
        });
        expect((await ask(history)).status).toBe(200);
        expect(currentContext()).toContain("The launch has moved to Monday.");
        expect(currentContext()).not.toContain("August 28");

        mockGetCall.mockResolvedValueOnce({ ...enrichmentReadyCall, transcript: latestTranscript });
        expect((await ask(history)).status).toBe(200);
        expect(currentContext()).toContain("The launch has moved to Monday.");
        expect(currentContext()).toContain("Enterprise tier draft in progress");
        expect(currentContext()).toContain("August 28");
    });

    it.each(["rejected", "accepted", "stale", "private", "live"] as const)(
        "does not resurrect an enhanced proposal that is %s",
        async state => {
            const snapshot = structuredClone(enrichmentReadyCall);
            if (state === "rejected" || state === "accepted") snapshot.enrichment!.status = state;
            if (state === "stale") snapshot.note!.revision += 1;
            if (state === "private") {
                snapshot.note = null;
                snapshot.enrichment = null;
            }
            if (state === "live") {
                snapshot.status = "active";
                snapshot.capture = pausedCall.capture;
            }
            if (state === "accepted") {
                snapshot.note!.contentMarkdown = "The final edited deadline is September 1.";
            }
            mockGetCall.mockResolvedValueOnce(snapshot);
            expect((await ask()).status).toBe(200);
            expect(currentContext()).not.toContain("August 28");
            if (state === "accepted") {
                expect(currentContext()).toContain("The final edited deadline is September 1.");
            }
        }
    );

    it("counts enhanced notes toward the context limit rather than silently omitting them", async () => {
        const snapshot = structuredClone(enrichmentReadyCall);
        snapshot.enrichment!.proposal!.chronologicalSections = Array.from({ length: 4 }, () => ({
            heading: "Discussion",
            markdown: "evidence ".repeat(2_000),
            ownerContextLabels: [],
        }));
        mockGetCall.mockResolvedValueOnce(snapshot);
        expect((await ask()).status).toBe(413);
        expect(mockStream).not.toHaveBeenCalled();
    });
});

describe("Call chat answer streaming", () => {
    const ask = (signal?: AbortSignal) =>
        POST(
            new Request("http://localhost/api/call-notes/call-1/chat", {
                method: "POST",
                body: JSON.stringify({ question: "What was decided?" }),
                signal,
            }),
            { params: Promise.resolve({ callId: "call-1" }) }
        );

    it("streams through the real model adapter before the upstream completion finishes", async () => {
        let upstream: ServerResponse | undefined;
        let upstreamFinished = false;
        const server = createServer((request, response) => {
            let body = "";
            request.setEncoding("utf8");
            request.on("data", (chunk: string) => {
                body += chunk;
            });
            request.on("end", () => {
                const input = JSON.parse(body) as { stream?: boolean };
                if (!input.stream) {
                    upstreamFinished = true;
                    response.setHeader("Content-Type", "application/json");
                    response.end(
                        JSON.stringify({
                            id: "answer",
                            object: "chat.completion",
                            model: "test-model",
                            choices: [
                                {
                                    index: 0,
                                    message: {
                                        role: "assistant",
                                        content: "First part. Final part.",
                                    },
                                    finish_reason: "stop",
                                },
                            ],
                        })
                    );
                    return;
                }
                upstream = response;
                response.setHeader("Content-Type", "text/event-stream");
                response.write(
                    `data: ${JSON.stringify({
                        id: "answer",
                        object: "chat.completion.chunk",
                        model: "test-model",
                        choices: [
                            {
                                index: 0,
                                delta: { role: "assistant", content: "First part. " },
                                finish_reason: null,
                            },
                        ],
                    })}\n\n`
                );
            });
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing test server port");
        const config = createChatModelsConfig({
            endpoint: { baseUrl: `http://127.0.0.1:${address.port}/v1` },
            yaml: "version: 1\nmodels:\n  primary:\n    id: test-model\n    preset: google/gemini-2.5-flash\nroutes:\n  default: primary\n",
        });
        mockResolveModel.mockImplementationOnce((options: ResolveChatModelOptions) =>
            resolveChatModel({ ...options, config })
        );
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            reader = (await ask()).body!.getReader();
            const first = await reader.read();
            expect(new TextDecoder().decode(first.value)).toBe(
                'data: {"type":"delta","text":"First part. "}\n\n'
            );
            expect(upstreamFinished).toBe(false);
            upstreamFinished = true;
            upstream!.end(
                `data: ${JSON.stringify({
                    id: "answer",
                    object: "chat.completion.chunk",
                    model: "test-model",
                    choices: [
                        { index: 0, delta: { content: "Final part." }, finish_reason: "stop" },
                    ],
                })}\n\ndata: [DONE]\n\n`
            );
            let remaining = "";
            while (true) {
                const next = await reader.read();
                if (next.done) break;
                remaining += new TextDecoder().decode(next.value);
            }
            expect(remaining).toContain('"type":"done","text":"First part. Final part."');
        } finally {
            await reader?.cancel();
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close(error => (error ? reject(error) : resolve()))
            );
        }
    });

    it("delivers answer text before generation finishes and excludes reasoning blocks", async () => {
        let finish!: () => void;
        const pending = new Promise<void>(resolve => {
            finish = resolve;
        });
        mockStream.mockImplementationOnce(async function* () {
            yield { content: [{ type: "reasoning", text: "Hidden reasoning" }] };
            yield { content: [{ type: "text", text: "The deadline " }] };
            await pending;
            yield { content: "is Friday." };
        });
        const response = await ask();
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        try {
            const first = await reader.read();
            expect(decoder.decode(first.value)).toBe(
                'data: {"type":"delta","text":"The deadline "}\n\n'
            );
        } finally {
            finish();
        }
        let remainder = "";
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            remainder += decoder.decode(chunk.value);
        }
        expect(remainder).toContain('"type":"done","text":"The deadline is Friday."');
        expect(remainder).not.toContain("Hidden reasoning");
    });

    it("marks a mid-stream provider failure as an error, never a completed answer", async () => {
        mockStream.mockImplementationOnce(async function* () {
            yield { content: "The deadline " };
            throw new Error("provider connection lost");
        });
        const body = await (await ask()).text();
        expect(body).toContain('"type":"delta"');
        expect(body).toContain('"type":"error"');
        expect(body).not.toContain('"type":"done"');
    });

    it("rejects an empty answer stream", async () => {
        mockStream.mockImplementationOnce(async function* () {
            yield { content: "" };
        });
        const body = await (await ask()).text();
        expect(body).toContain('"type":"error"');
        expect(body).not.toContain('"type":"done"');
    });

    it("aborts generation when the response reader is cancelled", async () => {
        let generationSignal!: AbortSignal;
        let closed = false;
        mockStream.mockImplementationOnce(async function* (
            _messages: unknown,
            options: { signal: AbortSignal }
        ) {
            generationSignal = options.signal;
            try {
                yield { content: "First part" };
                await new Promise<void>(resolve => {
                    if (generationSignal.aborted) resolve();
                    else
                        generationSignal.addEventListener("abort", () => resolve(), { once: true });
                });
            } finally {
                closed = true;
            }
        });
        const reader = (await ask()).body!.getReader();
        await reader.read();
        await reader.cancel();
        expect(generationSignal.aborted).toBe(true);
        expect(closed).toBe(true);
    });
});
