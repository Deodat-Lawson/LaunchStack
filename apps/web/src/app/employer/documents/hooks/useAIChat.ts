import { useState, useCallback, useEffect, useRef } from "react";
import { readChatStream, throwIfChatAborted, type ChatStreamEvent } from "~/lib/chat-stream";
import type { SourceReference } from "~/app/api/agents/documentQ&A/services";

export type { SourceReference };

export interface AIChatAttachmentPayload {
    url: string;
    name: string;
    mimeType: string;
    kind: "image" | "text";
}

export interface AIChatRequest {
    documentId?: number;
    companyId?: number;
    archiveName?: string;
    /**
     * User-picked subset of documents for the "selected" scope. Passed to the
     * backend which verifies company ownership and runs a multi-doc ensemble
     * search over exactly those IDs. Required when searchScope === 'selected'.
     */
    selectedDocumentIds?: number[];
    question: string;
    searchScope: "document" | "company" | "archive" | "selected" | "none";
    style?: string;
    enableWebSearch?: boolean;
    conversationHistory?: string;
    aiPersona?:
        | "general"
        | "learning-coach"
        | "financial-expert"
        | "legal-expert"
        | "math-reasoning";
    /** Auto enables reasoning only when the selected model and agent allow it. */
    thinkingMode?: boolean | "auto";
    modelRoute?: "default" | "fast" | "reasoning" | "vision";
    reasoningEffort?: string;
    chatMode?: "default" | "plan";
    attachments?: AIChatAttachmentPayload[];
    /** Handle of the workspace agent answering this turn; null = the default assistant. */
    agentKey?: string | null;
}

/** The agent that answered, echoed back so the transcript can attribute the turn. */
export interface AIChatAgentInfo {
    key: string;
    displayName: string;
    role: string;
    accent: string | null;
    avatarUrl?: string | null;
    /** What the agent's tool policy changed about this turn, for the UI. */
    notes: string[];
}

export interface WebSource {
    title: string;
    url: string;
    snippet: string;
}

export interface WebSearchInfo {
    refinedQuery?: string;
    reasoning?: string;
    resultsCount?: number;
}

export interface AIChatResponse {
    success: boolean;
    cancelled?: boolean;
    summarizedAnswer?: string;
    recommendedPages?: number[];
    references?: SourceReference[];
    retrievalMethod?: string;
    processingTimeMs?: number;
    chunksAnalyzed?: number;
    /** Real LLM usage for the turn — what metering debits against. */
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    fusionWeights?: number[];
    searchScope?: "document" | "company" | "archive" | "selected" | "none";
    aiModel?: string;
    webSources?: WebSource[];
    webSearch?: WebSearchInfo;
    agent?: AIChatAgentInfo | null;
    message?: string;
    error?: string;
    details?: string;
}

export type AIChatStreamEvent = ChatStreamEvent<AIChatResponse>;

export interface AIChatSendOptions {
    stream?: boolean;
    signal?: AbortSignal;
    independent?: boolean;
    onEvent?: (event: AIChatStreamEvent) => void;
}

export function useAIChat() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const activeRequest = useRef<{ id: number; controller: AbortController } | null>(null);
    const nextRequestId = useRef(0);
    const controllers = useRef(new Map<number, AbortController>());

    const cancelQuery = useCallback(() => {
        const active = activeRequest.current;
        activeRequest.current = null;
        active?.controller.abort();
        setLoading(false);
        setError(null);
    }, []);

    useEffect(
        () => () => {
            for (const controller of controllers.current.values()) controller.abort();
            controllers.current.clear();
            activeRequest.current = null;
        },
        []
    );

    // Identity checks protect a newer turn when a stopped transport resolves late.
    const sendQuery = useCallback(
        async (params: AIChatRequest, options: AIChatSendOptions = {}): Promise<AIChatResponse> => {
            if (!options.independent) activeRequest.current?.controller.abort();
            const controller = new AbortController();
            const id = ++nextRequestId.current;
            activeRequest.current = { id, controller };
            controllers.current.set(id, controller);
            const abortFromCaller = () => controller.abort();
            options.signal?.addEventListener("abort", abortFromCaller, { once: true });
            if (options.signal?.aborted) controller.abort();
            const isCurrent = () => activeRequest.current?.id === id;
            setLoading(true);
            setError(null);
            try {
                throwIfChatAborted(controller.signal);
                const response = await fetch("/api/agents/documentQ&A/AIChat/query", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(options.stream ? { Accept: "application/x-ndjson" } : {}),
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        documentId: params.documentId,
                        companyId: params.companyId,
                        archiveName: params.archiveName,
                        selectedDocumentIds: params.selectedDocumentIds,
                        question: params.question,
                        searchScope: params.searchScope,
                        style: params.style,
                        enableWebSearch: params.enableWebSearch,
                        conversationHistory: params.conversationHistory,
                        aiPersona: params.aiPersona,
                        thinkingMode: params.thinkingMode,
                        modelRoute: params.modelRoute,
                        reasoningEffort: params.reasoningEffort,
                        chatMode: params.chatMode,
                        stream: options.stream ? true : undefined,
                        attachments: params.attachments,
                        agentKey: params.agentKey ?? undefined,
                    }),
                });
                throwIfChatAborted(controller.signal);
                if (!response.ok) {
                    const errorData = (await response.json().catch(() => ({}))) as {
                        message?: string;
                        error?: string;
                    };
                    throw new Error(
                        errorData.message ??
                            errorData.error ??
                            `Request failed with status ${response.status}`
                    );
                }

                const data = response.headers?.get("content-type")?.includes("application/x-ndjson")
                    ? await readChatStream<AIChatResponse>(response, controller.signal, event => {
                          if ((options.independent || isCurrent()) && !controller.signal.aborted)
                              options.onEvent?.(event);
                      })
                    : ((await response.json()) as AIChatResponse);
                throwIfChatAborted(controller.signal);
                if (!options.independent && !isCurrent())
                    throw new DOMException("Response stopped", "AbortError");
                if (!data.success)
                    throw new Error(data.message ?? data.error ?? "Failed to get AI response");
                return data;
            } catch (err) {
                if (
                    controller.signal.aborted ||
                    (!options.independent && !isCurrent()) ||
                    (err instanceof Error && err.name === "AbortError")
                ) {
                    return { success: false, cancelled: true, message: "Response stopped" };
                }
                const errorMessage = err instanceof Error ? err.message : "Failed to send query";
                if (isCurrent()) setError(errorMessage);
                return { success: false, message: errorMessage };
            } finally {
                options.signal?.removeEventListener("abort", abortFromCaller);
                controllers.current.delete(id);
                if (isCurrent()) {
                    activeRequest.current = null;
                    setLoading(false);
                }
            }
        },
        []
    );

    return { loading, error, sendQuery, cancelQuery, stop: cancelQuery };
}
