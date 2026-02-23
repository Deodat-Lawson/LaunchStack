import { NextResponse } from "next/server";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { db } from "~/server/db/index";
import { eq, sql } from "drizzle-orm";
import ANNOptimizer from "~/app/api/agents/predictive-document-analysis/services/annOptimizer";
import {
    documentEnsembleSearch,
    type RetrievalMethod,
    type DocumentSearchOptions,
    type SearchResult
} from "~/lib/tools/rag";
import { validateRequestBody, QuestionSchema } from "~/lib/validation";
import { auth } from "@clerk/nextjs/server";
import { qaRequestCounter, qaRequestDuration } from "~/server/metrics/registry";
import { users, document, documentSections } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    normalizeModelContent,
    performWebSearch,
    getSystemPrompt,
    getWebSearchInstruction,
    getChatModel,
    getEmbeddings,
    extractRecommendedPages,
} from "../services";
import type { AIModelType } from "../services";
import type { SYSTEM_PROMPTS } from "../services/prompts";

export const runtime = 'nodejs';
export const maxDuration = 300;

const qaAnnOptimizer = new ANNOptimizer({ 
    strategy: 'hnsw',
    efSearch: 200
});

/**
 * AIQuery - Fast, efficient query search on one document
 * 
 * This endpoint is optimized for quick single-document queries:
 * - Focuses on document-level search only (no company-wide search)
 * - Uses efficient retrieval methods with fallbacks
 * - Minimal processing overhead
 * - Fast response times
 */
export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const startTime = Date.now();
        const endTimer = qaRequestDuration.startTimer();
        let retrievalMethod = "not_started";

        const recordResult = (result: "success" | "error" | "empty") => {
            qaRequestCounter.inc({ result, retrieval: retrievalMethod });
            endTimer({ result, retrieval: retrievalMethod });
        };

        try {
            const validation = await validateRequestBody(request, QuestionSchema);
            if (!validation.success) {
                recordResult("error");
                return validation.response;
            }

            const { userId } = await auth();
            if (!userId) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "Unauthorized"
                }, { status: 401 });
            }

            const {
                documentId,
                question,
                style,
                enableWebSearch,
                aiPersona,
                aiModel,
                conversationHistory,
            } = validation.data;

            // AIQuery only supports document-level search
            if (!documentId) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "documentId is required for AIQuery endpoint"
                }, { status: 400 });
            }

            // Verify user and document access
            const [requestingUser] = await db
                .select()
                .from(users)
                .where(eq(users.userId, userId))
                .limit(1);

            if (!requestingUser) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "Invalid user."
                }, { status: 401 });
            }

            const [targetDocument] = await db
                .select({
                    id: document.id,
                    companyId: document.companyId
                })
                .from(document)
                .where(eq(document.id, documentId))
                .limit(1);

            if (!targetDocument) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "Document not found."
                }, { status: 404 });
            }

            if (targetDocument.companyId !== requestingUser.companyId) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "You do not have access to this document."
                }, { status: 403 });
            }

            // Perform document search
            const embeddings = getEmbeddings();
            let documents: SearchResult[] = [];
            retrievalMethod = 'document_ensemble_rrf';

            try {
                const documentOptions: DocumentSearchOptions = {
                    weights: [0.4, 0.6],
                    topK: 5, // Fast query - limit results
                    documentId
                };
                
                documents = await documentEnsembleSearch(
                    question,
                    documentOptions,
                    embeddings
                );
                
                if (documents.length === 0) {
                    throw new Error("No ensemble results");
                }

            } catch (ensembleError) {
                console.warn(`⚠️ [AIQuery] Ensemble search failed, falling back:`, ensembleError);
                retrievalMethod = 'ann_hybrid';
                
                try {
                    const questionEmbedding = await embeddings.embedQuery(question);
                    const annResults = await qaAnnOptimizer.searchSimilarChunks(
                        questionEmbedding,
                        [documentId],
                        5,
                        0.8
                    );

                    documents = annResults.map(result => ({
                        pageContent: result.content,
                        metadata: {
                            chunkId: result.id,
                            page: result.page,
                            documentId: result.documentId,
                            distance: 1 - result.confidence,
                            source: 'ann_hybrid',
                            searchScope: 'document' as const,
                            retrievalMethod: 'ann_hybrid' as const,
                            timestamp: new Date().toISOString()
                        }
                    }));

                } catch (annError) {
                    console.warn(`⚠️ [AIQuery] ANN search failed, using vector search:`, annError);
                    retrievalMethod = 'vector_fallback';
                    
                    const questionEmbedding = await embeddings.embedQuery(question);
                    const bracketedEmbedding = `[${questionEmbedding.join(",")}]`;

                    const rows = await db.select({
                        id: documentSections.id,
                        content: documentSections.content,
                        page: documentSections.pageNumber,
                        distance: sql<number>`${documentSections.embedding} <-> ${bracketedEmbedding}::vector(1536)`,
                    })
                    .from(documentSections)
                    .where(eq(documentSections.documentId, BigInt(documentId)))
                    .orderBy(sql`${documentSections.embedding} <-> ${bracketedEmbedding}::vector(1536)`)
                    .limit(3);

                    documents = rows.map((row) => ({
                        pageContent: row.content,
                        metadata: {
                            chunkId: row.id,
                            page: row.page ?? 1,
                            distance: row.distance,
                            source: 'vector_fallback',
                            searchScope: 'document' as const,
                            retrievalMethod: 'vector_fallback' as RetrievalMethod,
                            timestamp: new Date().toISOString()
                        }
                    }));
                }
            }

            if (documents.length === 0) {
                recordResult("empty");
                return NextResponse.json({
                    success: false,
                    message: "No relevant content found for the given question and document.",
                });
            }

            // Build context from retrieved documents
            const combinedContent = documents
                .map((doc, idx) => {
                    const page = doc.metadata?.page ?? 'Unknown';
                    return `=== Chunk #${idx + 1}, Page ${page} ===\n${doc.pageContent}`;
                })
                .join("\n\n");

            // Perform web search if enabled
            const documentContext = documents.map(doc => doc.pageContent).join('\n\n');
            const webSearch = await performWebSearch(
                question,
                documentContext,
                enableWebSearch,
                5
            );

            // Get AI model and generate response
            const selectedAiModel = (aiModel ?? 'gpt4') as AIModelType;
            const chat = getChatModel(selectedAiModel);
            const selectedStyle = (style ?? 'concise') satisfies keyof typeof SYSTEM_PROMPTS;
            
            // Build conversation context
            let conversationContext = '';
            if (conversationHistory) {
                conversationContext = `\n\nPrevious conversation context:\n${conversationHistory}\n\nPlease continue the conversation naturally, referencing previous exchanges when relevant.`;
            }

            // Build prompts
            const systemPrompt = getSystemPrompt(selectedStyle, aiPersona);
            const webSearchInstruction = getWebSearchInstruction(
                enableWebSearch ?? false,
                webSearch.results,
                webSearch.refinedQuery,
                webSearch.reasoning
            );

            const userPrompt = `User's question: "${question}"${conversationContext}\n\nRelevant document content:\n${combinedContent}${webSearch.content}${webSearchInstruction}\n\nProvide a natural, conversational answer based primarily on the provided content. When using information from web sources, cite them using [Source X] format. Address the user directly and maintain continuity with any previous conversation.`;
            
            const response = await chat.call([
                new SystemMessage(systemPrompt),
                new HumanMessage(userPrompt),
            ]);

            const summarizedAnswer = normalizeModelContent(response.content);
            const totalTime = Date.now() - startTime;

            recordResult("success");

            return NextResponse.json({
                success: true,
                summarizedAnswer,
                recommendedPages: extractRecommendedPages(documents),
                retrievalMethod,
                processingTimeMs: totalTime,
                chunksAnalyzed: documents.length,
                fusionWeights: [0.4, 0.6],
                searchScope: 'document',
                aiModel: selectedAiModel,
                webSources: enableWebSearch ? webSearch.results : undefined,
                webSearch: enableWebSearch ? {
                    refinedQuery: webSearch.refinedQuery || question,
                    reasoning: webSearch.reasoning,
                    resultsCount: webSearch.results.length
                } : undefined
            });

        } catch (error) {
            console.error("❌ [AIQuery] Error in query processing:", error);
            recordResult("error");
            return NextResponse.json(
                {
                    success: false,
                    error: "An error occurred while processing your question.",
                    details: error instanceof Error ? error.message : "Unknown error"
                },
                { status: 500 }
            );
        }
    });
}
