import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";
import type { 
    PdfChunk, 
    AnalysisSpecification, 
    PredictiveAnalysisResult, 
    MissingDocumentPrediction,
    SearchResult
} from "~/app/api/agents/predictive-document-analysis/types";
import { ANALYSIS_TYPES } from "~/app/api/agents/predictive-document-analysis/types";
import { groupContentFromChunks } from "~/app/api/agents/predictive-document-analysis/utils/content";
import { createChunkBatches } from "~/app/api/agents/predictive-document-analysis/utils/batching";
import { extractReferences, deduplicateReferences } from "~/app/api/agents/predictive-document-analysis/services/referenceExtractor";
import { findSuggestedCompanyDocuments } from "~/app/api/agents/predictive-document-analysis/services/documentMatcher";
import pLimit from "p-limit";
import { db } from "~/server/db/index";
import { document } from "~/server/db/schema";
import { and, eq, ne } from "drizzle-orm";
import stringSimilarity from 'string-similarity-js';
import { ANALYSIS_BATCH_CONFIG } from "~/lib/constants";

async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1000
): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            
            if (attempt < maxRetries) {
                console.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`, lastError.message);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                delayMs *= 2;
            }
        }
    }
    throw lastError!;
}

const MissingDocumentSchema = z.object({
    documentName: z.string().describe('The name of the missing document'),
    documentType: z.string().describe('The type of the missing document'),
    reason: z.string().describe('The reason the document is missing'),
    page: z.number().describe('The page number where the document is referenced'),
    priority: z.enum(['high', 'medium', 'low']).describe('The priority of the missing document')
});

const AnalysisResultSchema = z.object({
    missingDocuments: z.array(MissingDocumentSchema).describe('The missing documents found in the document'),
    recommendations: z.array(z.string()).describe('The recommendations for handling the missing documents')
});

function createAnalysisPrompt(
    content: string,
    specification: AnalysisSpecification
): string {
    let existingDocsStr = '';
    if (specification.existingDocuments && specification.existingDocuments.length > 0) {
        existingDocsStr = `\nExisting documents (do not suggest these as missing): ${specification.existingDocuments.join(', ')}.`;
    }

    const guidanceByType = {
        contract: `Focus on contractual references like exhibits, schedules, addendums, and supporting agreements that are mentioned but not present.`,
        financial: `Focus on financial references like balance sheets, income statements, audit reports, and supporting financial documentation that are mentioned but not present.`,
        technical: `Focus on technical references like specifications, manuals, diagrams, and project deliverables that are mentioned but not present.`,
        compliance: `Focus on compliance references like regulatory filings, policy documents, certifications, and legal requirements that are mentioned but not present.`,
        general: `Focus on any document references, attachments, or supporting materials that are mentioned but not present in the current document.`
    };
 
    // Prevent hallucinations
    const analysisInstructions = `
        IMPORTANT: Base your analysis ONLY on what is explicitly mentioned in the document content. 
        Do not assume or infer missing documents that aren't clearly referenced.
        
        Reference indicators to look for:
        • Direct mentions of specific documents by name
        • References to attachments, exhibits, schedules, or appendices
        • Cross-references to other sections or documents
        • Mentions of supporting documentation
        • References to external files or resources
        
        For each potential missing document, verify:
        ✓ Is it explicitly mentioned in the text?
        ✓ Is the reference clear and specific?
        ✓ Is it actually missing (not just referenced)?
        ✓ What is its importance to understanding this document?
    `;

    return `
        ${ANALYSIS_TYPES[specification.type]}

        Analyze the document content step-by-step to find missing referenced documents${specification.includeRelatedDocs ? ' considering broader related document context and potential online searches for templates' : ''}.

        Chain of Thought:
        1. Scan the content for explicit references to other documents (e.g., "see Exhibit A", "as per Schedule 3").
        2. For each reference, check if it's likely missing (not included in this content or existing documents).
        3. Classify: Name, type, reason (concise), page where referenced, priority (high if critical, medium if supportive, low if optional).
        4. Generate 2-3 recommendations for handling missing items, including searching online for templates.
        5. Avoid duplicates or suggestions for existing documents.
        6. Focus on explicit references; be concise and accurate.

        ${guidanceByType[specification.type] || guidanceByType.general}

        ${analysisInstructions}

        Existing Documents: ${existingDocsStr}

        CONTENT:
        ${content}
`;
}

async function performWebSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
    try {
        const searchTool = new DuckDuckGoSearch({ maxResults });
        const result = await searchTool.invoke(query) as SearchResult[];
        
        let parsed: SearchResult[];
        if (typeof result === 'string') {
            parsed = JSON.parse(result) as SearchResult[];
        } else if (Array.isArray(result)) {
            parsed = result;
        } else {
            console.warn("Unexpected search result format:", typeof result);
            return [];
        }
        
        return parsed;
    } catch (error) {
        console.error("Web search error:", error);
        return [];
    }
}

export async function callAIAnalysis(
    chunks: PdfChunk[],
    specification: AnalysisSpecification,
    timeoutMs = 30000
): Promise<PredictiveAnalysisResult> {
    const content = groupContentFromChunks(chunks);
    const prompt = createAnalysisPrompt(content, specification);

    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5.2",
        temperature: 0.3,
    });

    const structuredModel = chat.withStructuredOutput(AnalysisResultSchema, {
        name: "analysis_result"
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`AI analysis timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    const aiCallPromise = structuredModel.invoke([
        new SystemMessage(ANALYSIS_TYPES[specification.type]),
        new HumanMessage(prompt)
    ]);

    try {
        const response = await Promise.race([aiCallPromise, timeoutPromise]);
        const analysisResult: PredictiveAnalysisResult = response as PredictiveAnalysisResult;

        return analysisResult;
    } catch (error) {
        console.error("AI Analysis Error:", error);
        return {
            missingDocuments: [],
            recommendations: []
        };
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}


export type AnalysisRunStats = {
    aiCalls: number;
    batches: number;
    averageBatchSize: number;
    averageChunkLength: number;
    totalChunks: number;
};

export type AnalyzeDocumentChunksResponse = {
    result: PredictiveAnalysisResult;
    stats: AnalysisRunStats;
};

export async function analyzeDocumentChunks(
    allChunks: PdfChunk[],
    specification: AnalysisSpecification,
    timeoutMs = 30000,
    maxConcurrency = ANALYSIS_BATCH_CONFIG.MAX_CONCURRENCY
): Promise<AnalyzeDocumentChunksResponse> {
    const batches = createChunkBatches(allChunks, {
        maxChunksPerCall: ANALYSIS_BATCH_CONFIG.MAX_CHUNKS_PER_CALL,
        maxCharactersPerCall: ANALYSIS_BATCH_CONFIG.MAX_CHARACTERS_PER_CALL
    });

    const safeConcurrency = Math.max(
        1,
        Math.min(maxConcurrency, ANALYSIS_BATCH_CONFIG.MAX_CONCURRENCY)
    );
    const limit = pLimit(safeConcurrency);

    const chunkPromises = batches.map(batch =>
        limit(() => callAIAnalysis(batch, specification, timeoutMs))
    );

    try {
        const chunkResults = await Promise.all(chunkPromises);

        const combinedResult: PredictiveAnalysisResult = {
            missingDocuments: chunkResults.flatMap(result => result.missingDocuments || []),
            recommendations: chunkResults.flatMap(result => result.recommendations || []),
        };

        combinedResult.missingDocuments = deduplicateMissingDocuments(combinedResult.missingDocuments);
        combinedResult.recommendations = deduplicateRecommendations(combinedResult.recommendations);

        if (specification.includeRelatedDocs && combinedResult.missingDocuments.length > 0) {
            await enhanceWithCompanyDocuments(combinedResult, allChunks, specification, timeoutMs);
            await enhanceWithWebSearch(combinedResult, specification);
        }

        const totalCharacters = allChunks.reduce((sum, chunk) => sum + (chunk.content?.length ?? 0), 0);
        const stats: AnalysisRunStats = {
            aiCalls: batches.length,
            batches: batches.length,
            averageBatchSize: batches.length > 0 ? allChunks.length / batches.length : allChunks.length,
            averageChunkLength: allChunks.length > 0 ? totalCharacters / allChunks.length : 0,
            totalChunks: allChunks.length
        };

        return {
            result: combinedResult,
            stats
        };
    } catch (error) {
        console.error("Batch analysis error:", error);
        throw error;
    }
}

async function enhanceWithCompanyDocuments(
    result: PredictiveAnalysisResult,
    allChunks: PdfChunk[],
    specification: AnalysisSpecification,
    timeoutMs: number
): Promise<void> {

    const references = await extractReferences(allChunks, timeoutMs);
    deduplicateReferences(references);

    const otherDocsQuery = await withRetry(() => db.select({ 
        id: document.id, 
        title: document.title 
    }).from(document).where(and(
        eq(document.companyId, BigInt(specification.companyId)),
        ne(document.id, specification.documentId)
    )));
    
    const docTitleMap = new Map(otherDocsQuery.map(doc => [doc.id, doc.title]));

    for (const missing of result.missingDocuments) {
        try {
            const suggestions = await findSuggestedCompanyDocuments(
                missing,
                specification.companyId,
                specification.documentId,
                docTitleMap
            );
            
            if (suggestions.length > 0) {
                missing.suggestedCompanyDocuments = suggestions;
            }
        } catch (error) {
            console.error(`Error finding suggestions for ${missing.documentName}:`, error);
        }
    }
}

async function enhanceWithWebSearch(
    result: PredictiveAnalysisResult,
    specification: AnalysisSpecification
): Promise<void> {
    const relatedQuery = `standard related documents for ${specification.type} ${specification.category} titled ${specification.title}`;
    result.suggestedRelatedDocuments = await withRetry(() => performWebSearch(relatedQuery, 5));

    const highPriorityMissing = result.missingDocuments.filter(doc => doc.priority === 'high');
    
    const limit = pLimit(3);
    await Promise.all(
        highPriorityMissing.map(missing =>
        limit(async () => {
            const missingQuery = `"${missing.documentName}" "${missing.documentType}" (template OR sample OR example) filetype:pdf "free download" site:gov OR site:edu OR site:org`;
            missing.suggestedLinks = await performWebSearch(missingQuery, 3);
        })
        )
    );
    
}

function deduplicateMissingDocuments(docs: MissingDocumentPrediction[]): MissingDocumentPrediction[] {
    const seen = new Set<string>();
    return docs.filter(doc => {
        const key = doc.documentName.toLowerCase().trim();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
} 

function deduplicateRecommendations(recommendations: string[], threshold = 0.8): string[] {
    const unique = [];
  
    for (const rec of recommendations) {
      let isDuplicate = false;
      for (const existing of unique) {
        if (stringSimilarity(rec.toLowerCase(), existing.toLowerCase()) > threshold) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        unique.push(rec);
      }
    }
    return unique;
}
