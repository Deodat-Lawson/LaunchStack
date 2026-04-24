import { NextResponse } from "next/server";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { db } from "~/server/db/index";
import { and, eq, inArray } from "drizzle-orm";
import ANNOptimizer from "~/app/api/agents/predictive-document-analysis/services/annOptimizer";
import {
    companyEnsembleSearch,
    createDocumentVectorRetriever,
    documentEnsembleSearch,
    multiDocEnsembleSearch,
    type CompanySearchOptions,
    type DocumentSearchOptions,
    type MultiDocSearchOptions,
    type SearchResult
} from "~/lib/tools/rag";
import { resolveEmbeddingIndex, isLegacyEmbeddingIndex } from "@launchstack/core/embeddings";
import { getCompanyEmbeddingConfig } from "@launchstack/core/embeddings";
import { validateRequestBody, QuestionSchema } from "~/lib/validation";
import { auth } from "@clerk/nextjs/server";
import { qaRequestCounter, qaRequestDuration } from "~/server/metrics/registry";
import { users, document, ChatHistory } from "@launchstack/core/db/schema";
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
    getEmbeddings,
    buildReferences,
    extractRecommendedPages,
    type AIModelType,
} from "../../services";
import { supportsVision } from "@launchstack/core/llm/types";
import type { AttachmentPayload } from "~/lib/validation";
import { debitTokens, llmChatTokens } from "~/lib/credits";
import { isCloudMode } from "@launchstack/core/providers/registry";
import type { SYSTEM_PROMPTS } from "../../services/prompts";
import { validateQAResponse } from "~/lib/agents/supervisor";

export const runtime = 'nodejs';
export const maxDuration = 300;

const qaAnnOptimizer = new ANNOptimizer({ 
    strategy: 'hnsw',
    efSearch: 200
});

const COMPANY_SCOPE_ROLES = new Set(["employer", "owner"]);

/**
 * Cap on total plaintext pulled from text attachments across a single turn.
 * Chosen to leave room for the retrieved RAG context and web results while
 * still accommodating a multi-page text file. Anything past this is truncated
 * with a visible marker so the model knows content was cut.
 */
const ATTACHMENT_TEXT_CAP_BYTES = 40_000;
const ATTACHMENT_PER_FILE_CAP_BYTES = 30_000;
const ATTACHMENT_PDF_MAX_PAGES = 40;

function guessAttachmentKind(name: string, mime: string): "pdf" | "docx" | "plaintext" {
    const lower = name.toLowerCase();
    if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
    if (
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mime === "application/msword" ||
        lower.endsWith(".docx") ||
        lower.endsWith(".doc")
    ) {
        return "docx";
    }
    return "plaintext";
}

/**
 * Extract text from a PDF via pdfjs-dist legacy build. No OCR — scanned PDFs
 * will produce empty output. For OCR, the user should add the file as a
 * Source and let the ingestion pipeline handle it.
 */
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
        getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfDoc> };
    };
    interface PdfDoc {
        numPages: number;
        getPage: (n: number) => Promise<PdfPage>;
    }
    interface PdfPage {
        getTextContent: () => Promise<{ items: { str?: string }[] }>;
    }
    const data = new Uint8Array(buffer);
    const doc = await pdfjs.getDocument({ data }).promise;
    const pages: string[] = [];
    const max = Math.min(doc.numPages, ATTACHMENT_PDF_MAX_PAGES);
    for (let i = 1; i <= max; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
            .map((it) => (typeof it.str === "string" ? it.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        if (text) pages.push(`--- Page ${i} ---\n${text}`);
    }
    if (doc.numPages > max) {
        pages.push(`[…${doc.numPages - max} more page(s) not extracted]`);
    }
    return pages.join("\n\n");
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
    const mammoth = (await import("mammoth")) as unknown as {
        extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({
        buffer: Buffer.from(buffer),
    });
    return result.value ?? "";
}

async function extractAttachmentText(att: AttachmentPayload): Promise<string> {
    const res = await fetch(att.url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const kind = guessAttachmentKind(att.name, att.mimeType);
    if (kind === "pdf") {
        return await extractPdfText(await res.arrayBuffer());
    }
    if (kind === "docx") {
        return await extractDocxText(await res.arrayBuffer());
    }
    return await res.text();
}

async function buildAttachmentTextBlock(
    textAttachments: AttachmentPayload[],
): Promise<string> {
    if (textAttachments.length === 0) return "";

    let remainingBudget = ATTACHMENT_TEXT_CAP_BYTES;
    const blocks: string[] = [];

    for (const att of textAttachments) {
        if (remainingBudget <= 0) {
            blocks.push(
                `=== User Attachment: ${att.name} ===\n[omitted — prior attachments filled the context budget]`,
            );
            continue;
        }

        try {
            const raw = await extractAttachmentText(att);
            if (!raw.trim()) {
                blocks.push(
                    `=== User Attachment: ${att.name} ===\n[no extractable text — if this is a scanned PDF or image-only doc, add it as a Source to run OCR]`,
                );
                continue;
            }
            const perFile = raw.slice(0, ATTACHMENT_PER_FILE_CAP_BYTES);
            const trimmed = perFile.slice(0, remainingBudget);
            const suffix =
                trimmed.length < raw.length ? "\n[…attachment truncated]" : "";
            remainingBudget -= trimmed.length;
            blocks.push(
                `=== User Attachment: ${att.name} (${att.mimeType}) ===\n${trimmed}${suffix}`,
            );
        } catch (err) {
            console.warn(
                `[AIChat] Failed to read attachment "${att.name}":`,
                err,
            );
            blocks.push(
                `=== User Attachment: ${att.name} ===\n[could not read attachment content]`,
            );
        }
    }

    return `\n\n${blocks.join("\n\n")}`;
}

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
                archiveName,
                selectedDocumentIds,
                enableWebSearch,
                aiPersona,
                aiModel,
                provider,
                conversationHistory,
                embeddingIndexKey,
                thinkingMode,
                attachments,
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

            if (searchScope === "archive" && !archiveName) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "archiveName is required for archive search"
                }, { status: 400 });
            }

            if (searchScope === "selected" && (!selectedDocumentIds || selectedDocumentIds.length === 0)) {
                recordResult("error");
                return NextResponse.json({
                    success: false,
                    message: "selectedDocumentIds is required for selected-documents search"
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

            // Validate company/archive search permissions
            if (searchScope === "company" || searchScope === "archive") {
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

            const companyConfig = await getCompanyEmbeddingConfig(numericCompanyId);

            // Resolve archive document IDs if archive scope
            let archiveDocumentIds: number[] | undefined;
            if (searchScope === "archive" && archiveName) {
                const archiveDocs = await db
                    .select({ id: document.id })
                    .from(document)
                    .where(and(
                        eq(document.sourceArchiveName, archiveName),
                        eq(document.companyId, BigInt(numericCompanyId))
                    ));

                archiveDocumentIds = archiveDocs.map(d => d.id);
                if (archiveDocumentIds.length === 0) {
                    recordResult("empty");
                    return NextResponse.json({
                        success: false,
                        message: `No documents found in archive "${archiveName}".`
                    }, { status: 404 });
                }
            }

            // For the "selected" scope, verify every supplied document ID belongs
            // to the caller's company before retrieval. A mismatch means the
            // client passed a stale or cross-company ID — reject rather than
            // silently drop, so the user sees an explicit error.
            let verifiedSelectedIds: number[] | undefined;
            if (searchScope === "selected" && selectedDocumentIds?.length) {
                const uniqueIds = Array.from(new Set(selectedDocumentIds));
                const rows = await db
                    .select({ id: document.id, companyId: document.companyId })
                    .from(document)
                    .where(inArray(document.id, uniqueIds));

                const allowed = rows
                    .filter((r) => r.companyId === userCompanyId)
                    .map((r) => r.id);

                if (allowed.length !== uniqueIds.length) {
                    recordResult("error");
                    return NextResponse.json({
                        success: false,
                        message: "One or more selected documents are not accessible."
                    }, { status: 403 });
                }

                verifiedSelectedIds = allowed;
            }

            // Perform comprehensive search
            const resolvedEmbeddingIndex = resolveEmbeddingIndex(
                embeddingIndexKey,
                companyConfig ?? undefined,
            );
            const embeddings = getEmbeddings(
                resolvedEmbeddingIndex.indexKey,
                companyConfig ?? undefined,
            );
            let documents: SearchResult[] = [];
            retrievalMethod = searchScope === "company"
                ? 'company_ensemble_rrf'
                : searchScope === "archive"
                    ? 'archive_ensemble_rrf'
                    : searchScope === "selected"
                        ? 'selected_ensemble_rrf'
                        : 'document_ensemble_rrf';

            try {
                if (searchScope === "company") {
                    const companyOptions: CompanySearchOptions = {
                        weights: [0.4, 0.6],
                        topK: 10,
                        companyId: numericCompanyId,
                        embeddingIndexKey: resolvedEmbeddingIndex.indexKey,
                    };

                    documents = await companyEnsembleSearch(
                        question,
                        companyOptions,
                        embeddings
                    );
                } else if (searchScope === "archive" && archiveDocumentIds?.length) {
                    const archiveOptions: MultiDocSearchOptions = {
                        weights: [0.4, 0.6],
                        topK: 10,
                        documentIds: archiveDocumentIds,
                        embeddingIndexKey: resolvedEmbeddingIndex.indexKey,
                    };

                    documents = await multiDocEnsembleSearch(
                        question,
                        archiveOptions,
                        embeddings
                    );
                } else if (searchScope === "selected" && verifiedSelectedIds?.length) {
                    // Reuse the archive scope's multi-doc path; from the retriever's
                    // perspective a user-picked set and an archive-resolved set are
                    // identical (both narrow to `document_id = ANY(...)`).
                    const selectedOptions: MultiDocSearchOptions = {
                        weights: [0.4, 0.6],
                        topK: 10,
                        documentIds: verifiedSelectedIds,
                        embeddingIndexKey: resolvedEmbeddingIndex.indexKey,
                    };

                    documents = await multiDocEnsembleSearch(
                        question,
                        selectedOptions,
                        embeddings
                    );
                } else if (searchScope === "document" && documentId) {
                    const documentOptions: DocumentSearchOptions = {
                        topK: 5,
                        documentId,
                        companyId: numericCompanyId,
                        embeddingIndexKey: resolvedEmbeddingIndex.indexKey,
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
                    if (isLegacyEmbeddingIndex(resolvedEmbeddingIndex)) {
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
                        }
                    } else {
                        retrievalMethod = 'vector_fallback';
                    }

                    if (documents.length === 0) {
                        const retriever = createDocumentVectorRetriever(
                            documentId,
                            embeddings,
                            resolvedEmbeddingIndex,
                            3,
                        );
                        const vectorDocs = await retriever.getRelevantDocuments(question);
                        documents = vectorDocs.map((doc) => ({
                            retrievalMethod: 'vector_fallback',
                            source: typeof doc.metadata?.source === "string" ? doc.metadata.source : undefined,
                            pageNumber: typeof doc.metadata?.page === "number" ? doc.metadata.page : undefined,
                            title: typeof doc.metadata?.documentTitle === "string" ? doc.metadata.documentTitle : undefined,
                            documentId: typeof doc.metadata?.documentId === "number" ? doc.metadata.documentId : undefined,
                            pageContent: doc.pageContent,
                            metadata: {
                                ...doc.metadata,
                                searchScope: 'document' as const,
                                retrievalMethod: 'vector_fallback' as const,
                                timestamp: new Date().toISOString()
                            }
                        })) as unknown as SearchResult[];
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
            const resolvedProvider = provider ?? "openai";
            const selectedAiModel = (aiModel ?? getProviderDefaultModel(resolvedProvider)) as AIModelType;

            // Ephemeral attachment handling. Images require a vision-capable
            // model; fail fast with a clear error before the LLM call.
            const imageAttachments = (attachments ?? []).filter(
                (a) => a.kind === "image",
            );
            const textAttachments = (attachments ?? []).filter(
                (a) => a.kind === "text",
            );
            if (imageAttachments.length > 0 && !supportsVision(selectedAiModel)) {
                recordResult("error");
                return NextResponse.json(
                    {
                        success: false,
                        message: `Image attachments require a vision-capable model. "${selectedAiModel}" cannot read images — pick GPT-5, Claude Sonnet 4, or Gemini.`,
                    },
                    { status: 400 },
                );
            }

            const attachmentTextBlock = await buildAttachmentTextBlock(textAttachments);

            const chat = getChatModelForProvider({
                provider: resolvedProvider,
                model: selectedAiModel,
                thinking: thinkingMode,
            });
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

            const userPrompt = `User's question: "${question}"${conversationContext}\n\nRelevant document content:\n${combinedContent}${webSearch.content}${attachmentTextBlock}${webSearchInstruction}\n\nProvide a natural, conversational answer based primarily on the provided content. When using information from web sources, cite them using [Source X] format. Address the user directly and maintain continuity with any previous conversation.`;

            // When images are attached, send a multimodal HumanMessage so the
            // vision model sees the text prompt and the image URLs in one turn.
            // Text-only: keep the single-string form for backward compatibility
            // with existing LangChain adapters.
            const humanMessage =
                imageAttachments.length > 0
                    ? new HumanMessage({
                          content: [
                              { type: "text", text: userPrompt },
                              ...imageAttachments.map((img) => ({
                                  type: "image_url" as const,
                                  image_url: { url: img.url },
                              })),
                          ],
                      })
                    : new HumanMessage(userPrompt);

            let response;
            try {
                response = await chat.call([
                    new SystemMessage(systemPrompt),
                    humanMessage,
                ]);
            } catch (modelError) {
                const friendly = describeProviderError(resolvedProvider, modelError, selectedAiModel);
                if (friendly) {
                    recordResult("error");
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

            let summarizedAnswer = normalizeModelContent(response.content);
            const totalTime = Date.now() - startTime;

            // Log + meter LLM token usage
            {
                const usage = response.response_metadata?.tokenUsage as
                    | { promptTokens?: number; completionTokens?: number }
                    | undefined;
                const promptTokens = usage?.promptTokens ?? 0;
                const completionTokens = usage?.completionTokens ?? 0;
                console.log(
                    `[AIChat] Token usage: ${promptTokens} prompt + ${completionTokens} completion = ${promptTokens + completionTokens} tokens (model=${selectedAiModel}, ${totalTime}ms)`
                );
            }
            if (isCloudMode() && userCompanyId) {
                const usage = response.response_metadata?.tokenUsage as
                    | { promptTokens?: number; completionTokens?: number }
                    | undefined;
                const promptTokens = usage?.promptTokens ?? 0;
                const completionTokens = usage?.completionTokens ?? 0;
                if (promptTokens + completionTokens > 0) {
                    const tokenCost = llmChatTokens(promptTokens, completionTokens);
                    debitTokens({
                        companyId: userCompanyId,
                        amount: tokenCost,
                        service: "llm_chat",
                        description: `Chat query via ${resolvedProvider}/${selectedAiModel}`,
                        metadata: { promptTokens, completionTokens, provider: resolvedProvider, model: selectedAiModel },
                    }).catch((err) => console.warn("[AIChat] Token debit failed:", err));
                }
            }

            const sourceTexts = documents.map(d => d.pageContent);
            const supervision = validateQAResponse(summarizedAnswer, sourceTexts, aiPersona);
            if (supervision.adjustedOutput) {
                summarizedAnswer = supervision.adjustedOutput;
            }

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
                } : undefined,
                disclaimer: supervision.disclaimer,
                guardrails: !supervision.approved ? {
                    warnings: supervision.issues,
                } : undefined,
            });

        } catch (error) {
            console.error("❌ [AIChat] Error in query processing:", error);
            recordResult("error");
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

