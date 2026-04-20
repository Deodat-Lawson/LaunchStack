/**
 * AIQueryRLM - Hierarchical, Cost-Aware Document Query
 *
 * This endpoint uses RLM (Recursive Language Model) style retrieval for:
 * - Large documents where token budget matters
 * - Complex analysis requiring structured navigation
 * - Cost-aware retrieval with explicit token limits
 *
 * For simple, fast queries use AIQuery instead (ensemble BM25 + Vector search).
 *
 * Key differences from AIQuery:
 * - Token budget-aware retrieval
 * - Document overview included in context
 * - Semantic type filtering support
 * - Hierarchical document navigation
 */

import { NextResponse } from "next/server";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { db } from "~/server/db/index";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { users, document } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    normalizeModelContent,
    performWebSearch,
    getSystemPrompt,
    getWebSearchInstruction,
    getChatModelForProvider,
    getProviderDefaultModel,
    describeProviderError,
} from "../services";
import { performRLMSearch, type RLMSearchOptions } from "../services/rlmSearch";
import type { AIModelType, LLMProvider } from "../services";
import { LLMProviders, isModelAllowedForProvider } from "../services/types";
import type { SYSTEM_PROMPTS } from "../services/prompts";
import type { SemanticType } from "~/server/db/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Request body schema for RLM queries
 */
interface RLMQueryRequest {
    documentId: number;
    question: string;
    // Standard options
    style?: keyof typeof SYSTEM_PROMPTS;
    aiModel?: AIModelType;
    provider: LLMProvider;
    enableWebSearch?: boolean;
    aiPersona?: string;
    conversationHistory?: string | undefined;
    // RLM-specific options
    maxTokens?: number;
    includeOverview?: boolean;
    includePreviews?: boolean;
    semanticTypes?: SemanticType[];
    prioritize?: "start" | "end" | "relevance";
    pageRange?: { start: number; end: number };
}

/**
 * Validate request body
 */
function validateRequest(body: unknown): { success: true; data: RLMQueryRequest } | { success: false; error: string } {
    if (!body || typeof body !== "object") {
        return { success: false, error: "Request body is required" };
    }

    const req = body as Record<string, unknown>;

    if (typeof req.documentId !== "number") {
        return { success: false, error: "documentId must be a number" };
    }

    if (typeof req.question !== "string" || req.question.trim().length === 0) {
        return { success: false, error: "question is required and must be a non-empty string" };
    }

    // Normalize provider
    const providerInput = typeof req.provider === "string" ? (req.provider.trim() || undefined) : undefined;
    const providerCandidate = (providerInput ?? "openai") as string;
    if (!LLMProviders.includes(providerCandidate as LLMProvider)) {
        return { success: false, error: `provider must be one of: ${LLMProviders.join(", ")}` };
    }
    const providerValue = providerCandidate as LLMProvider;

    if (req.aiModel && !isModelAllowedForProvider(providerValue, req.aiModel as string)) {
        return { success: false, error: `Model ${req.aiModel as string} is not available for provider ${providerValue}` };
    }

    // Validate maxTokens if provided
    if (req.maxTokens !== undefined) {
        if (typeof req.maxTokens !== "number" || req.maxTokens < 500 || req.maxTokens > 100000) {
            return { success: false, error: "maxTokens must be a number between 500 and 100000" };
        }
    }

    // Validate prioritize if provided
    if (req.prioritize !== undefined) {
        if (!["start", "end", "relevance"].includes(req.prioritize as string)) {
            return { success: false, error: "prioritize must be 'start', 'end', or 'relevance'" };
        }
    }

    // Validate pageRange if provided
    if (req.pageRange !== undefined) {
        const pr = req.pageRange as Record<string, unknown>;
        if (typeof pr.start !== "number" || typeof pr.end !== "number" || pr.start < 0 || pr.end < pr.start) {
            return { success: false, error: "pageRange must have valid start and end numbers" };
        }
    }

    return {
        success: true,
        data: {
            documentId: req.documentId,
            question: req.question,
            style: req.style as keyof typeof SYSTEM_PROMPTS | undefined,
            aiModel: req.aiModel as AIModelType | undefined,
            provider: providerValue,
            enableWebSearch: req.enableWebSearch as boolean | undefined,
            aiPersona: req.aiPersona as string | undefined,
            conversationHistory: req.conversationHistory as string | undefined,
            maxTokens: req.maxTokens,
            includeOverview: req.includeOverview as boolean | undefined,
            includePreviews: req.includePreviews as boolean | undefined,
            semanticTypes: req.semanticTypes as SemanticType[] | undefined,
            prioritize: req.prioritize as "start" | "end" | "relevance" | undefined,
            pageRange: req.pageRange as { start: number; end: number } | undefined,
        },
    };
}

/**
 * POST /api/agents/documentQ&A/AIQueryRLM
 *
 * Perform RLM-style hierarchical document query with cost-aware retrieval
 */
export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const startTime = Date.now();

        try {
            // Parse and validate request
            const body = await request.json() as RLMQueryRequest;
            const validation = validateRequest(body);

            if (!validation.success) {
                return NextResponse.json(
                    { success: false, message: validation.error },
                    { status: 400 }
                );
            }

            const {
                documentId,
                question,
                style,
                aiModel,
                provider,
                enableWebSearch,
                aiPersona,
                conversationHistory,
                maxTokens,
                includeOverview,
                includePreviews,
                semanticTypes,
                prioritize,
                pageRange,
            } = validation.data;

            // Authenticate user
            const { userId } = await auth();
            if (!userId) {
                return NextResponse.json(
                    { success: false, message: "Unauthorized" },
                    { status: 401 }
                );
            }

            // Verify user and document access
            const [requestingUser] = await db
                .select()
                .from(users)
                .where(eq(users.userId, userId))
                .limit(1);

            if (!requestingUser) {
                return NextResponse.json(
                    { success: false, message: "Invalid user." },
                    { status: 401 }
                );
            }

            const [targetDocument] = await db
                .select({
                    id: document.id,
                    companyId: document.companyId,
                    title: document.title,
                })
                .from(document)
                .where(eq(document.id, documentId))
                .limit(1);

            if (!targetDocument) {
                return NextResponse.json(
                    { success: false, message: "Document not found." },
                    { status: 404 }
                );
            }

            if (targetDocument.companyId !== requestingUser.companyId) {
                return NextResponse.json(
                    { success: false, message: "You do not have access to this document." },
                    { status: 403 }
                );
            }

            // Perform RLM search
            const searchOptions: RLMSearchOptions = {
                maxTokens: maxTokens ?? 4000,
                includeOverview: includeOverview ?? true,
                includePreviews: includePreviews ?? false,
                semanticTypes,
                prioritize: prioritize ?? "relevance",
                pageRange,
            };

            console.log(`🔍 [AIQueryRLM] Processing query for document ${documentId}`);

            const searchResult = await performRLMSearch(documentId, question, searchOptions);

            if (searchResult.sections.length === 0) {
                return NextResponse.json({
                    success: false,
                    message: "No relevant content found. The document may not have been processed with RLM indexing yet.",
                });
            }

            // Perform web search if enabled
            const webSearch = await performWebSearch(
                question,
                searchResult.combinedContent,
                enableWebSearch,
                5
            );

            // Get AI model and generate response
            const resolvedProvider = provider;
            const selectedAiModel = (aiModel ?? getProviderDefaultModel(resolvedProvider)) as AIModelType;
            const chat = getChatModelForProvider({
                provider: resolvedProvider,
                model: selectedAiModel,
            });
            const selectedStyle = (style ?? "concise") satisfies keyof typeof SYSTEM_PROMPTS;

            // Build conversation context
            let conversationContext = "";
            if (conversationHistory) {
                conversationContext = `\n\nPrevious conversation context:\n${conversationHistory}\n\nPlease continue the conversation naturally, referencing previous exchanges when relevant.`;
            }

            // Build prompts with RLM-specific context
            const systemPrompt = getSystemPrompt(selectedStyle, aiPersona);
            const webSearchInstruction = getWebSearchInstruction(
                enableWebSearch ?? false,
                webSearch.results,
                webSearch.refinedQuery,
                webSearch.reasoning
            );

            // Enhanced user prompt with document overview
            let overviewContext = "";
            if (searchResult.overview) {
                overviewContext = `\n\nDocument Overview:\n- Title: ${searchResult.overview.title}\n- Total Pages: ${searchResult.overview.totalPages}\n- Document Type: ${searchResult.overview.documentClass ?? "Unknown"}\n- Topics: ${searchResult.overview.topicTags.join(", ") || "Not specified"}`;
                if (searchResult.overview.summary) {
                    overviewContext += `\n- Summary: ${searchResult.overview.summary}`;
                }
            }

            const userPrompt = `User's question: "${question}"${conversationContext}${overviewContext}

Relevant document content (${searchResult.totalTokensUsed} tokens from ${searchResult.sections.length} sections):
${searchResult.combinedContent}${webSearch.content}${webSearchInstruction}

Provide a comprehensive answer based on the provided content. When referencing specific sections, mention the page number if available. When using information from web sources, cite them using [Source X] format.`;

            let response;
            try {
                response = await chat.call([
                    new SystemMessage(systemPrompt),
                    new HumanMessage(userPrompt),
                ]);
            } catch (modelError) {
                const friendly = describeProviderError(resolvedProvider, modelError, selectedAiModel);
                if (friendly) {
                    return NextResponse.json(
                        {
                            success: false,
                            message: friendly.message,
                        },
                        { status: friendly.status },
                    );
                }
                throw modelError;
            }

            const summarizedAnswer = normalizeModelContent(response.content);
            const totalTime = Date.now() - startTime;

            // Extract page numbers from sections
            const recommendedPages = [
                ...new Set(
                    searchResult.sections
                        .map((s) => s.pageNumber)
                        .filter((p): p is number => p !== null)
                ),
            ].sort((a, b) => a - b);

            console.log(`✅ [AIQueryRLM] Completed in ${totalTime}ms`);

            return NextResponse.json({
                success: true,
                summarizedAnswer,
                // RLM-specific metadata
                documentOverview: searchResult.overview
                    ? {
                          title: searchResult.overview.title,
                          totalPages: searchResult.overview.totalPages,
                          totalTokens: searchResult.overview.totalTokens,
                          documentClass: searchResult.overview.documentClass,
                          topicTags: searchResult.overview.topicTags,
                          summary: searchResult.overview.summary,
                      }
                    : undefined,
                sectionsUsed: searchResult.sections.length,
                tokensUsed: searchResult.totalTokensUsed,
                tokenBudget: searchResult.tokenBudget,
                usedSemanticSearch: searchResult.usedSemanticSearch,
                // Standard fields
                retrievalMethod: "rlm_hierarchical",
                recommendedPages,
                processingTimeMs: totalTime,
                aiModel: selectedAiModel,
                searchScope: "document",
                webSources: enableWebSearch ? webSearch.results : undefined,
                webSearch: enableWebSearch
                    ? {
                          refinedQuery: webSearch.refinedQuery || question,
                          reasoning: webSearch.reasoning,
                          resultsCount: webSearch.results.length,
                      }
                    : undefined,
            });
        } catch (error) {
            console.error("❌ [AIQueryRLM] Error in query processing:", error);
            return NextResponse.json(
                {
                    success: false,
                    error: "An error occurred while processing your question.",
                },
                { status: 500 }
            );
        }
    });
}
