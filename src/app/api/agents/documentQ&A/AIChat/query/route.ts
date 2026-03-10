import { NextResponse } from "next/server";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { db, toRows } from "~/server/db/index";
import { eq, sql } from "drizzle-orm";
import ANNOptimizer from "~/app/api/agents/predictive-document-analysis/services/annOptimizer";
import {
    companyEnsembleSearch,
    documentEnsembleSearch,
    type CompanySearchOptions,
    type DocumentSearchOptions,
    type SearchResult
} from "~/lib/tools/rag";
import { validateRequestBody, QuestionSchema } from "~/lib/validation";
import { auth } from "@clerk/nextjs/server";
import { qaRequestCounter, qaRequestDuration } from "~/server/metrics/registry";
import { users, document, ChatHistory } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import {
    normalizeModelContent,
    performWebSearch,
    getSystemPrompt,
    getWebSearchInstruction,
    getChatModel,
    getEmbeddings,
    buildReferences,
    extractRecommendedPages,
} from "../../services";
import type { AIModelType } from "../../services";
import type { SYSTEM_PROMPTS } from "../../services/prompts";

export const runtime = 'nodejs';
export const maxDuration = 300;

type PdfChunkRow = Record<string, unknown> & {
    id: number;
    content: string;
    page: number;
    distance: number;
};

const qaAnnOptimizer = new ANNOptimizer({ 
    strategy: 'hnsw',
    efSearch: 200
});

const COMPANY_SCOPE_ROLES = new Set(["employer", "owner"]);

/**
 * AIChat Query - Comprehensive search solution
 * 
 * This endpoint provides comprehensive document Q&A capabilities:
 * - Supports both document-level and company-wide searches
 * - Advanced retrieval with multiple fallback strategies
 * - Web search integration
 * - Conversation context support
 * - Rich response metadata
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
                companyId,
                question,
                style,
                searchScope,
                enableWebSearch,
                aiPersona,
                aiModel,
                conversationHistory,
            } = validation.data;

            // Validate search scope requirements
            if (searchScope === "company" && !companyId) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "companyId is required for company-wide search"
                }, { status: 400 });
            }

            if (searchScope === "document" && !documentId) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "documentId is required for document search"
                }, { status: 400 });
            }

            // Verify user and permissions
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

            const userCompanyId = requestingUser.companyId;
            const numericCompanyId = userCompanyId ? Number(userCompanyId) : null;

            if (numericCompanyId === null || Number.isNaN(numericCompanyId)) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "User is not associated with a valid company."
                }, { status: 403 });
            }

            // Validate company-wide search permissions
            if (searchScope === "company") {
                if (!COMPANY_SCOPE_ROLES.has(requestingUser.role)) {
                    recordResult("error");
                    return NextResponse.json({
                        success: false,
                        message: "Only employer accounts can run company-wide searches."
                    }, { status: 403 });
                }

                if (companyId !== undefined && companyId !== numericCompanyId) {
                    recordResult("error");
                    return NextResponse.json({
                        success: false,
                        message: "Company mismatch detected for the current user."
                    }, { status: 403 });
                }
            }

            // Validate document access
            if (searchScope === "document" && documentId) {
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

                if (targetDocument.companyId !== userCompanyId) {
                    recordResult("error");
                    return NextResponse.json({
                        success: false,
                        message: "You do not have access to this document."
                    }, { status: 403 });
                }
            }

            // Perform comprehensive search
            const embeddings = getEmbeddings();
            let documents: SearchResult[] = [];
            retrievalMethod = searchScope === "company" ? 'company_ensemble_rrf' : 'document_ensemble_rrf';

            try {
                if (searchScope === "company") {
                    const companyOptions: CompanySearchOptions = {
                        weights: [0.4, 0.6],
                        topK: 10, // More results for comprehensive search
                        companyId: numericCompanyId
                    };
                    
                    documents = await companyEnsembleSearch(
                        question,
                        companyOptions,
                        embeddings
                    );
                } else if (searchScope === "document" && documentId) {
                    const documentOptions: DocumentSearchOptions = {
                        weights: [0.4, 0.6],
                        topK: 5,
                        documentId
                    };
                    
                    documents = await documentEnsembleSearch(
                        question,
                        documentOptions,
                        embeddings
                    );
                } else {
                    throw new Error("Invalid search parameters");
                }
                
                if (documents.length === 0) {
                    throw new Error("No ensemble results");
                }

            } catch (ensembleError) {
                console.warn(`⚠️ [AIChat] Ensemble search failed, falling back:`, ensembleError);
                
                if (searchScope === "company") {
                    retrievalMethod = 'company_fallback_failed';
                    documents = [];
                } else if (searchScope === "document" && documentId) {
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
                        console.warn(`⚠️ [AIChat] ANN search failed, using vector search:`, annError);
                        retrievalMethod = 'vector_fallback';
                        
                        const questionEmbedding = await embeddings.embedQuery(question);
                        const bracketedEmbedding = `[${questionEmbedding.join(",")}]`;

                        const query = sql`
                          SELECT
                            id,
                            content,
                            page,
                            embedding <-> ${bracketedEmbedding}::vector(1536) AS distance
                          FROM pdr_ai_v2_pdf_chunks
                          WHERE document_id = ${documentId}
                          ORDER BY embedding <-> ${bracketedEmbedding}::vector(1536)
                          LIMIT 3
                        `;

                        const result = await db.execute<PdfChunkRow>(query);
                        const rows = toRows<PdfChunkRow>(result);
                        documents = rows.map((row) => ({
                            pageContent: row.content,
                            metadata: {
                                chunkId: row.id,
                                page: row.page,
                                distance: row.distance,
                                source: 'vector_fallback',
                                searchScope: 'document' as const,
                                timestamp: new Date().toISOString()
                            }
                        }));
                    }
                } else {
                    retrievalMethod = 'invalid_parameters';
                    documents = [];
                }
            }

            if (documents.length === 0) {
                recordResult("empty");
                return NextResponse.json({
                    success: false,
                    message: "No relevant content found for the given question.",
                });
            }

            // Build comprehensive context from retrieved documents
            const combinedContent = documents
                .map((doc, idx) => {
                    const page = doc.metadata?.page ?? 'Unknown';
                    const source = doc.metadata?.source ?? retrievalMethod;
                    const distance = doc.metadata?.distance ?? 0;
                    const relevanceScore = Math.round((1 - Number(distance)) * 100);
                    
                    console.log(`📄 [AIChat] Document ${idx + 1}: page ${page}, source: ${source}, relevance: ${relevanceScore}%`);
                    
                    return `=== Chunk #${idx + 1}, Page ${page} ===\n${doc.pageContent}`;
                })
                .join("\n\n");
            
            console.log(`✅ [AIChat] Built context with pages: ${documents.map(doc => doc.metadata?.page).join(', ')}`);

            // Build references for document highlights and page navigation
            const references = buildReferences(question, documents, 5);

            // Perform comprehensive web search if enabled
            const documentContext = documents.length > 0 
                ? documents.map(doc => doc.pageContent).join('\n\n')
                : undefined;
            
            const enableWebSearchFlag = Boolean(enableWebSearch ?? false);
            const webSearch = await performWebSearch(
                question,
                documentContext,
                enableWebSearchFlag,
                5
            );

            // Get AI model and generate comprehensive response
            const selectedAiModel = (aiModel ?? 'gpt-4o') as AIModelType;
            const chat = getChatModel(selectedAiModel);
            const selectedStyle = (style ?? 'concise') satisfies keyof typeof SYSTEM_PROMPTS;
            
            // Build conversation context
            let conversationContext = '';
            if (conversationHistory) {
                conversationContext = `\n\nPrevious conversation context:\n${conversationHistory}\n\nPlease continue the conversation naturally, referencing previous exchanges when relevant.`;
            }

            // Build comprehensive prompts
            const systemPrompt = getSystemPrompt(selectedStyle, aiPersona);
            const webSearchInstruction = getWebSearchInstruction(
                enableWebSearchFlag,
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

            // Log query to ChatHistory for analytics
            try {
                if (documentId) {
                    const [doc] = await db
                        .select({ title: document.title })
                        .from(document)
                        .where(eq(document.id, documentId));

                    if (doc) {
                        await db.insert(ChatHistory).values({
                            UserId: userId,
                            documentId: BigInt(documentId),
                            documentTitle: doc.title,
                            question: question,
                            response: summarizedAnswer,
                            pages: extractRecommendedPages(documents),
                            queryType: "simple"
                        });
                    }
                }
            } catch (logError) {
                console.error("Failed to log chat history:", logError);
                // Don't fail the request if logging fails
            }

            recordResult("success");

            return NextResponse.json({
                success: true,
                summarizedAnswer,
                recommendedPages: extractRecommendedPages(documents),
                references: references.length > 0 ? references : undefined,
                retrievalMethod,
                processingTimeMs: totalTime,
                chunksAnalyzed: documents.length,
                fusionWeights: [0.4, 0.6],
                searchScope,
                aiModel: selectedAiModel,
                webSources: enableWebSearchFlag ? webSearch.results : undefined,
                webSearch: enableWebSearchFlag ? {
                    refinedQuery: webSearch.refinedQuery || question,
                    reasoning: webSearch.reasoning,
                    resultsCount: webSearch.results.length
                } : undefined
            });

        } catch (error) {
            console.error("❌ [AIChat] Error in query processing:", error);
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

