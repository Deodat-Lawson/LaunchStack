import { useState, useCallback } from "react";
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
    searchScope: "document" | "company" | "archive" | "selected";
    style?: string;
    enableWebSearch?: boolean;
    conversationHistory?: string;
    aiPersona?:
        | "general"
        | "learning-coach"
        | "financial-expert"
        | "legal-expert"
        | "math-reasoning";
    thinkingMode?: boolean;
    attachments?: AIChatAttachmentPayload[];
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
    summarizedAnswer?: string;
    recommendedPages?: number[];
    references?: SourceReference[];
    retrievalMethod?: string;
    processingTimeMs?: number;
    chunksAnalyzed?: number;
    fusionWeights?: number[];
    searchScope?: "document" | "company" | "archive" | "selected";
    aiModel?: string;
    webSources?: WebSource[];
    webSearch?: WebSearchInfo;
    message?: string;
    error?: string;
    details?: string;
}

export function useAIChat() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Send an AI chat query (supports both document and company-wide search)
    const sendQuery = useCallback(async (params: AIChatRequest): Promise<AIChatResponse> => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/agents/documentQ&A/AIChat/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
                    attachments: params.attachments,
                }),
            });

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

            const data = (await response.json()) as AIChatResponse;
            if (!data.success) {
                throw new Error(data.message ?? data.error ?? "Failed to get AI response");
            }
            return data;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to send query";
            setError(errorMessage);
            return {
                success: false,
                message: errorMessage,
            };
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        loading,
        error,
        sendQuery,
    };
}
