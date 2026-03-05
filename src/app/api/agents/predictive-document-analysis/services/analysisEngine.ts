import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";
import type { 
    PdfChunk, 
    AnalysisSpecification, 
    PredictiveAnalysisResult, 
    MissingDocumentPrediction,
    DocumentInsight,
    SearchResult
} from "~/app/api/agents/predictive-document-analysis/types";
import { ANALYSIS_TYPES } from "~/app/api/agents/predictive-document-analysis/types";
import { groupContentFromChunks } from "~/app/api/agents/predictive-document-analysis/utils/content";
import { createChunkBatches } from "~/app/api/agents/predictive-document-analysis/utils/batching";
import { extractReferences, deduplicateReferences } from "~/app/api/agents/predictive-document-analysis/services/referenceExtractor";
import { findSuggestedCompanyDocuments } from "~/app/api/agents/predictive-document-analysis/services/documentMatcher";
import { extractDeterministicInsights } from "~/app/api/agents/predictive-document-analysis/utils/insightExtractors";
import { sanitizeErrorMessage } from "~/app/api/agents/predictive-document-analysis/utils/logging";
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
                console.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`, sanitizeErrorMessage(lastError));
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

const InsightSchema = z.object({
    category: z.enum(['deadline', 'resource', 'action-item', 'caveat']).describe(
        'deadline = due dates/exams/submissions; resource = suggested videos/readings/tools; action-item = tasks/follow-ups; caveat = policies/restrictions/conditions'
    ),
    severity: z.enum(['note', 'warning']).describe('warning for time-sensitive or critical items, note for informational'),
    title: z.string().describe('Short scannable label, e.g. "Homework 3 due Feb 20" or "Watch: Design Sprint video"'),
    detail: z.string().describe('Full context sentence from the document'),
    page: z.number().describe('Page number where this insight appears'),
    sourceQuote: z.string().optional().describe('Exact quote from the document'),
    url: z.string().optional().describe('URL if this insight references an external resource'),
    date: z.string().optional().describe('Raw date text for deadline-type insights'),
});

const AnalysisResultSchema = z.object({
    missingDocuments: z.array(MissingDocumentSchema).describe('The missing documents found in the document'),
    recommendations: z.array(z.string()).describe('The recommendations for handling the missing documents'),
    insights: z.array(InsightSchema).describe('Notable items found IN the document that deserve attention: deadlines, suggested resources, action items, or important caveats. Max 5 per batch.'),
});

function createAnalysisPrompt(
    content: string,
    specification: AnalysisSpecification
): string {
    let existingDocsStr = '';
    if (specification.existingDocuments && specification.existingDocuments.length > 0) {
        existingDocsStr = `\nExisting documents (do not suggest these as missing): ${specification.existingDocuments.join(', ')}.`;
    }

    const guidanceByType: Record<string, string> = {
        contract: `Focus on contractual references like exhibits, schedules, addendums, and supporting agreements that are mentioned but not present.`,
        financial: `Focus on financial references like balance sheets, income statements, audit reports, and supporting financial documentation that are mentioned but not present.`,
        technical: `Focus on technical references like specifications, manuals, diagrams, and project deliverables that are mentioned but not present.`,
        compliance: `Focus on compliance references like regulatory filings, policy documents, certifications, and legal requirements that are mentioned but not present.`,
        educational: `Focus on referenced course materials, syllabi, handouts, assignment templates, readings, and linked resources (URLs, videos) that are mentioned but not included.`,
        hr: `Focus on referenced policies, forms, benefits documents, org charts, employee handbooks, and compliance materials that are mentioned but not included.`,
        research: `Focus on cited papers, datasets, supplementary materials, methodology documents, and referenced figures or tables that are mentioned but not included.`,
        general: `Focus on any document references, attachments, or supporting materials that are mentioned but not present in the current document.`
    };
 
    const analysisInstructions = `
        IMPORTANT: Base your analysis ONLY on what is explicitly mentioned in the document content. 
        Do not assume or infer missing documents that aren't clearly referenced.
        
        Reference indicators to look for:
        • Direct mentions of specific documents by name (e.g., "syllabus", "handbook", "Exhibit A")
        • References to attachments, exhibits, schedules, or appendices
        • Cross-references to other sections or documents
        • Mentions of supporting documentation, forms, or templates
        • Directives like "please see", "refer to", "posted on", "available at"
        
        For each potential missing document, verify:
        ✓ Is it explicitly mentioned in the text?
        ✓ Is the reference clear and specific?
        ✓ Is it actually missing (not just referenced)?
        ✓ What is its importance to understanding this document?

        TONE REQUIREMENT:
        Recommendations must be direct and actionable. Do NOT use conditional language like "If you need...", "If this is meant to...", or "If this content is expected to...".
        State findings as facts. Example: "The syllabus is referenced on page 1 but not included in this document." NOT "If you need the syllabus, consider looking for it."
    `;

    return `
        ${ANALYSIS_TYPES[specification.type]}

        Analyze the document content step-by-step to find missing referenced documents${specification.includeRelatedDocs ? ' considering broader related document context and potential online searches for templates' : ''}.

        Chain of Thought:
        1. Scan the content for explicit references to other documents (e.g., "see Exhibit A", "please see syllabus", "refer to the handbook", "as per Schedule 3", "posted on Canvas").
        2. For each reference, check if it's likely missing (not included in this content or existing documents).
        3. Classify: Name, type, reason (concise), page where referenced, priority (high if critical, medium if supportive, low if optional).
        4. Generate 1-2 actionable recommendations ONLY for the missing items you actually found. If you found no missing items, return an empty recommendations array.
        5. Avoid duplicates or suggestions for existing documents.
        6. Focus on explicit references; be concise and accurate.

        CRITICAL RULES:
        - If no missing documents are found, return EMPTY arrays for both missingDocuments and recommendations. Do NOT generate entries that say "no missing documents were identified" — that is not a finding.
        - Do NOT generate recommendations about "maintaining" the status quo or generic document management advice. Only recommend concrete actions for concrete findings.
        - Each recommendation must reference a specific missing document by name. Generic advice like "run a final pass" or "preserve page numbers" is not useful.

        INSIGHTS EXTRACTION (separate from missing documents):
        In addition to missing documents, extract up to 5 notable items found IN the content that deserve the reader's attention.

        Categories:
        - deadline: Upcoming homework due dates, exam dates, submission deadlines, project milestones
        - resource: Suggested videos, readings, tools, or papers the author recommends reviewing — include the URL if present
        - action-item: Tasks the reader should complete, follow-ups, things to prepare, even if no explicit date is given
        - caveat: Important policies, restrictions, conditions, or warnings stated in the content

        For educational content, actively look for:
        - Assignments, activities, entrance tickets, or quizzes mentioned as upcoming work
        - Videos or readings the instructor recommends (especially URLs to YouTube, Vimeo, or other platforms)
        - Policy statements about academic integrity, AI usage, attendance, or late work
        - Platform-specific tasks like "post on Courselore" or "submit via Canvas"

        EXAMPLES of good insights:
        {"category":"resource","severity":"note","title":"Watch: Design Sprint Overview","detail":"The instructor recommends watching the Design Sprint methodology video before next class.","page":5,"url":"https://youtu.be/x-DLQp9xb20"}
        {"category":"action-item","severity":"warning","title":"Post self-introduction on Courselore","detail":"Students must post a self-introduction on Courselore by end of the first week.","page":3}
        {"category":"caveat","severity":"warning","title":"Academic Integrity Code applies","detail":"All work must comply with the university's academic integrity code. Violations result in a failing grade.","page":2,"url":"https://cs.jhu.edu/academic-integrity-code"}

        ANTI-PATTERNS — do NOT produce these:
        - Section headings or topic names as insights (e.g., "Heuristic Evaluation", "Common Violations")
        - Table-of-contents entries or slide titles
        - Generic observations like "The document discusses design principles"
        - Items already covered in missingDocuments

        If there are no notable insights, return an empty insights array.

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
        console.error("Web search error:", sanitizeErrorMessage(error));
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
        console.error("AI Analysis Error:", sanitizeErrorMessage(error));
        return {
            missingDocuments: [],
            recommendations: [],
            insights: [],
        };
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}


// ---------------------------------------------------------------------------
// Chain-of-Verification: verify high-priority predictions against source text
// ---------------------------------------------------------------------------

const VerificationResultSchema = z.object({
    verified: z.boolean().describe('Whether the reference truly exists in the source text'),
    exactQuote: z.string().describe('The exact sentence or phrase from the source that references this document, or empty if not found'),
    correctedName: z.string().optional().describe('Corrected document name if the original was slightly wrong'),
    adjustedPriority: z.enum(['high', 'medium', 'low']).optional().describe('Adjusted priority if the original was wrong'),
});

async function verifyPredictions(
    predictions: MissingDocumentPrediction[],
    allChunks: PdfChunk[],
    timeoutMs: number,
): Promise<MissingDocumentPrediction[]> {
    const highPriority = predictions.filter(p => p.priority === 'high');
    if (highPriority.length === 0) return predictions;

    const fullContent = groupContentFromChunks(allChunks);
    const contentWindow = fullContent.slice(0, 30000);

    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5.2",
        temperature: 0.0,
    });

    const structuredModel = chat.withStructuredOutput(VerificationResultSchema, {
        name: "verification_result"
    });

    const limit = pLimit(5);
    const verifiedSet = new Set<string>();
    const removedSet = new Set<string>();

    await Promise.all(
        highPriority.map(prediction =>
            limit(async () => {
                try {
                    const verificationPrompt = `You are a fact-checking assistant. A previous analysis claimed that the following document is referenced but missing.

Claimed missing document: "${prediction.documentName}" (type: ${prediction.documentType})
Claimed reference location: Page ${prediction.page}
Claimed reason: ${prediction.reason}

Your task: Search the source text below and determine if this document is actually referenced.
- If you find the reference, quote the EXACT sentence.
- If the name is slightly wrong, provide the corrected name.
- If you cannot find any reference to this document, mark verified as false.

SOURCE TEXT:
${contentWindow}`;

                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => reject(new Error('Verification timed out')), Math.min(timeoutMs, 15000));
                    });

                    const result = await Promise.race([
                        structuredModel.invoke([
                            new SystemMessage("Verify document references with exact quotes. Be strict: only mark verified if you find a clear reference."),
                            new HumanMessage(verificationPrompt)
                        ]),
                        timeoutPromise,
                    ]);

                    const key = prediction.documentName.toLowerCase().trim();
                    if (result.verified) {
                        verifiedSet.add(key);
                        if (result.correctedName) {
                            prediction.documentName = result.correctedName;
                        }
                        if (result.adjustedPriority) {
                            prediction.priority = result.adjustedPriority;
                        }
                    } else {
                        removedSet.add(key);
                    }
                } catch {
                    // On timeout/error, keep the prediction (conservative)
                }
            })
        )
    );

    if (removedSet.size > 0) {
        console.log(`[PDA Verification] Removed ${removedSet.size} unverified high-priority predictions`);
    }

    return predictions.filter(p => {
        const key = p.documentName.toLowerCase().trim();
        return !removedSet.has(key);
    });
}

// ---------------------------------------------------------------------------
// URL extraction: find linked external resources without an LLM call
// ---------------------------------------------------------------------------

const URL_REGEX = /https?:\/\/[^\s<>"')\]},]+/gi;

function extractURLReferences(allChunks: PdfChunk[]): MissingDocumentPrediction[] {
    const seen = new Set<string>();
    const results: MissingDocumentPrediction[] = [];

    for (const chunk of allChunks) {
        const urls = chunk.content?.match(URL_REGEX);
        if (!urls) continue;

        for (const rawUrl of urls) {
            const url = rawUrl.replace(/[.,;:!?)]+$/, '');
            if (seen.has(url)) continue;
            seen.add(url);

            let domain: string;
            let displayPath = '';
            try {
                const parsed = new URL(url);
                domain = parsed.hostname.replace(/^www\./, '');
                const path = parsed.pathname.replace(/\/+$/, '');
                if (path && path !== '/') {
                    displayPath = path.length > 40 ? path.slice(0, 37) + '…' : path;
                }
            } catch {
                domain = url.slice(0, 40);
            }

            const displayName = displayPath ? `${domain}${displayPath}` : domain;

            results.push({
                documentName: `External: ${displayName}`,
                documentType: 'external-resource',
                reason: `External resource linked on page ${chunk.page}`,
                page: chunk.page,
                priority: 'low',
                suggestedLinks: [{ title: displayName, url, snippet: url }],
            });
        }
    }

    return results;
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
        const [chunkResults, deterministicInsights] = await Promise.all([
            Promise.all(chunkPromises),
            Promise.resolve(extractDeterministicInsights(allChunks)),
        ]);

        const llmInsights: DocumentInsight[] = chunkResults.flatMap(
            result => (result.insights ?? []) as DocumentInsight[],
        );

        const combinedResult: PredictiveAnalysisResult = {
            missingDocuments: chunkResults.flatMap(result => result.missingDocuments || []),
            recommendations: chunkResults.flatMap(result => result.recommendations || []),
        };

        combinedResult.missingDocuments = filterNonFindingDocuments(combinedResult.missingDocuments);
        combinedResult.missingDocuments = deduplicateMissingDocuments(combinedResult.missingDocuments);

        combinedResult.recommendations = filterBoilerplateRecommendations(combinedResult.recommendations);
        combinedResult.recommendations = deduplicateRecommendations(combinedResult.recommendations);

        const urlRefs = extractURLReferences(allChunks);
        combinedResult.missingDocuments.push(...urlRefs);

        combinedResult.missingDocuments = promoteStrongRecommendations(
            combinedResult.missingDocuments,
            combinedResult.recommendations,
        );

        const MAX_RECOMMENDATIONS = 5;
        if (combinedResult.recommendations.length > MAX_RECOMMENDATIONS) {
            combinedResult.recommendations = combinedResult.recommendations.slice(0, MAX_RECOMMENDATIONS);
        }

        if (combinedResult.missingDocuments.some(d => d.priority === 'high')) {
            combinedResult.missingDocuments = await verifyPredictions(
                combinedResult.missingDocuments,
                allChunks,
                timeoutMs,
            );
        }

        if (specification.includeRelatedDocs && combinedResult.missingDocuments.length > 0) {
            await enhanceWithCompanyDocuments(combinedResult, allChunks, specification, timeoutMs);
            await enhanceWithWebSearch(combinedResult, specification);
        }

        combinedResult.insights = mergeAndDeduplicateInsights(
            deterministicInsights,
            llmInsights,
        );

        combinedResult.missingDocuments = fuseInsightsWithExternalLinks(
            combinedResult.insights,
            combinedResult.missingDocuments,
        );

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
        console.error("Batch analysis error:", sanitizeErrorMessage(error));
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
            console.error(`Error finding suggestions for ${missing.documentName}:`, sanitizeErrorMessage(error));
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

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

const NON_FINDING_PATTERNS = [
    /no\s+(?:missing|explicitly\s+referenced|referenced)\s+(?:external\s+)?documents?\s+(?:were|was|are)\s+(?:identified|found|detected)/i,
    /no\s+explicit(?:ly)?\s+referenced/i,
    /there\s+are\s+no\s+missing/i,
    /does\s+not\s+(?:explicitly\s+)?reference\s+any/i,
    /no\s+exhibits?,?\s+appendix|appendices/i,
    /content\s+does\s+not\s+(?:explicitly\s+)?reference/i,
];

const BOILERPLATE_PATTERNS = [
    /maintain\s+this\s+(?:status|section|approach)/i,
    /continue\s+(?:monitoring|the\s+same\s+scan)/i,
    /keep\s+(?:external\s+links|the\s+full|this\s+section)/i,
    /run\s+a\s+final\s+pass/i,
    /preserve\s+page\s+(?:numbers|headers)/i,
    /when\s+exporting\s+(?:or\s+compiling|future)/i,
    /when\s+adding\s+future\s+references/i,
    /no\s+(?:missing|explicitly)\s+referenced/i,
];

const GARBAGE_DOC_NAMES = new Set([
    'content', 'document', 'text', 'page', 'file', 'section', 'material',
    'information', 'data', 'n/a', 'none', 'unknown', 'the document',
]);

function filterNonFindingDocuments(docs: MissingDocumentPrediction[]): MissingDocumentPrediction[] {
    return docs.filter(doc => {
        const name = doc.documentName.toLowerCase().trim();
        if (GARBAGE_DOC_NAMES.has(name) || name.length < 3) return false;

        const reason = doc.reason.toLowerCase();
        if (NON_FINDING_PATTERNS.some(p => p.test(reason))) return false;
        if (NON_FINDING_PATTERNS.some(p => p.test(name))) return false;

        return true;
    });
}

function filterBoilerplateRecommendations(recs: string[]): string[] {
    return recs.filter(rec => {
        if (NON_FINDING_PATTERNS.some(p => p.test(rec))) return false;
        if (BOILERPLATE_PATTERNS.some(p => p.test(rec))) return false;
        return true;
    });
}

function deduplicateMissingDocuments(docs: MissingDocumentPrediction[], threshold = 0.75): MissingDocumentPrediction[] {
    const unique: MissingDocumentPrediction[] = [];

    for (const doc of docs) {
        const docName = doc.documentName.toLowerCase().trim();
        let mergedInto: MissingDocumentPrediction | null = null;

        for (const existing of unique) {
            const existingName = existing.documentName.toLowerCase().trim();
            if (
                existingName === docName ||
                existingName.includes(docName) ||
                docName.includes(existingName) ||
                stringSimilarity(docName, existingName) > threshold
            ) {
                mergedInto = existing;
                break;
            }
        }

        if (mergedInto) {
            if ((PRIORITY_RANK[doc.priority] ?? 0) > (PRIORITY_RANK[mergedInto.priority] ?? 0)) {
                mergedInto.priority = doc.priority;
                mergedInto.reason = doc.reason;
            }
        } else {
            unique.push({ ...doc });
        }
    }

    return unique;
} 

function deduplicateRecommendations(recommendations: string[], threshold = 0.6): string[] {
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

// ---------------------------------------------------------------------------
// Insight merge / dedup / sort / cap
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = { warning: 2, note: 1 };
const MAX_INSIGHTS = 10;

function mergeAndDeduplicateInsights(
    deterministic: DocumentInsight[],
    llmGenerated: DocumentInsight[],
    threshold = 0.6,
): DocumentInsight[] {
    const all = [...deterministic, ...llmGenerated];
    const unique: DocumentInsight[] = [];

    for (const insight of all) {
        const titleLower = insight.title.toLowerCase();
        let isDuplicate = false;
        for (const existing of unique) {
            if (stringSimilarity(titleLower, existing.title.toLowerCase()) > threshold) {
                isDuplicate = true;
                if ((SEVERITY_RANK[insight.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
                    existing.severity = insight.severity;
                }
                break;
            }
        }
        if (!isDuplicate) {
            unique.push({ ...insight });
        }
    }

    unique.sort((a, b) => {
        const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
        if (sevDiff !== 0) return sevDiff;
        return a.page - b.page;
    });

    return unique.slice(0, MAX_INSIGHTS);
}

// ---------------------------------------------------------------------------
// Insight-Link Fusion: remove external-resource entries from missingDocuments
// when the same URL has already been promoted to a richer resource insight.
// ---------------------------------------------------------------------------

function fuseInsightsWithExternalLinks(
    insights: DocumentInsight[],
    missingDocs: MissingDocumentPrediction[],
): MissingDocumentPrediction[] {
    const insightUrls = new Set<string>();
    for (const insight of insights) {
        if (insight.url) {
            try {
                insightUrls.add(new URL(insight.url).href.replace(/\/+$/, ''));
            } catch {
                insightUrls.add(insight.url);
            }
        }
    }

    if (insightUrls.size === 0) return missingDocs;

    return missingDocs.filter(doc => {
        if (doc.documentType !== 'external-resource') return true;
        const docUrl = doc.suggestedLinks?.[0]?.url;
        if (!docUrl) return true;

        let normalized: string;
        try {
            normalized = new URL(docUrl).href.replace(/\/+$/, '');
        } catch {
            normalized = docUrl;
        }

        return !insightUrls.has(normalized);
    });
}

// ---------------------------------------------------------------------------
// Promotion: upgrade recommendations that describe missing references into
// structured missingDocument entries so they appear in the "Missing References"
// panel rather than buried in free-text suggestions.
// ---------------------------------------------------------------------------

const PROMOTION_PHRASES = [
    'referenced but not included',
    'referenced but not attached',
    'referenced but not provided',
    'not included in this document',
    'not attached',
    'not provided',
    'is missing',
    'should be attached',
    'should be included',
    'was not found',
    'does not appear',
];

const NAMED_DOC_PATTERN = /["']([^"']+)["']|(?:the|a)\s+([\w\s]+?)\s+(?:is|was|should|does)/i;
const PAGE_PATTERN = /page\s+(\d+)/i;

function promoteStrongRecommendations(
    existingDocs: MissingDocumentPrediction[],
    recommendations: string[],
): MissingDocumentPrediction[] {
    const promoted = [...existingDocs];
    const existingNames = new Set(
        existingDocs.map(d => d.documentName.toLowerCase().trim()),
    );

    for (const rec of recommendations) {
        const lower = rec.toLowerCase();
        const matchesPhrase = PROMOTION_PHRASES.some(p => lower.includes(p));
        if (!matchesPhrase) continue;

        const nameMatch = rec.match(NAMED_DOC_PATTERN);
        const docName = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
        if (!docName || docName.length < 3) continue;

        if (existingNames.has(docName.toLowerCase())) continue;

        const pageMatch = rec.match(PAGE_PATTERN);
        const page = pageMatch ? parseInt(pageMatch[1]!, 10) : 1;

        promoted.push({
            documentName: docName,
            documentType: 'other',
            reason: rec,
            page,
            priority: 'medium',
        });
        existingNames.add(docName.toLowerCase());
    }

    return promoted;
}
