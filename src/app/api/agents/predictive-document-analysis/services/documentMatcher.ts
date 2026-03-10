import { db } from "~/server/db/index";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { documentSections, document } from "~/server/db/schema";
import type { 
    MissingDocumentPrediction, 
    CompanyDocument, 
    DocumentMatch, 
    ValidationResult 
} from "~/app/api/agents/predictive-document-analysis/types";
import { getEmbeddings } from "~/app/api/agents/predictive-document-analysis/utils/embeddings";
import { cleanText, truncateText } from "~/app/api/agents/predictive-document-analysis/utils/content";
import ANNOptimizer from "~/app/api/agents/predictive-document-analysis/services/annOptimizer";

type MatchCandidate = {
    documentId: number;
    confidence: number;
    page: number;
    snippet: string;
    reasons: string[];
    matchTypes: string[];
    finalScore: number;
};

const annOptimizer = new ANNOptimizer({ 
    strategy: 'hybrid',
    probeCount: 3,
    prefilterThreshold: 0.3 
});

export async function findSuggestedCompanyDocuments(
    missingDoc: MissingDocumentPrediction,
    companyId: number,
    currentDocumentId: number,
    docTitleMap: Map<number, string>
): Promise<{ documentId: number, documentTitle: string, similarity: number, page: number, snippet: string }[]> {
    try {
        
        const otherDocsQuery = await db.select({ 
            id: document.id, 
            title: document.title 
        }).from(document).where(and(
            eq(document.companyId, BigInt(companyId)),
            ne(document.id, currentDocumentId)
        ));
        
        const otherDocIds = otherDocsQuery.map(doc => doc.id);
        if (otherDocIds.length === 0) return [];

        const matchCandidates = new Map<number, MatchCandidate>();

        // Strategy 1: Exact reference matching (highest priority) - no ANN needed
        const exactMatches = await findExactReferenceMatches(missingDoc, otherDocIds);
        for (const match of exactMatches) {
            matchCandidates.set(match.documentId, {
                ...match,
                matchTypes: ['exact-reference'],
                finalScore: match.confidence * 1.2 // Boost exact matches
            });
        }

        // Strategy 2: Smart title analysis - no ANN needed
        const titleMatches = await findSmartTitleMatches(missingDoc, otherDocsQuery);
        for (const match of titleMatches) {
            const existing = matchCandidates.get(match.documentId);
            if (!existing || match.confidence > existing.confidence) {
                matchCandidates.set(match.documentId, {
                    documentId: match.documentId,
                    confidence: match.confidence,
                    page: 1,
                    snippet: match.snippet,
                    reasons: match.reasons,
                    matchTypes: existing ? [...(existing.matchTypes || []), 'title'] : ['title'],
                    finalScore: match.confidence
                });
            }
        }

        const highConfidenceMatches = Array.from(matchCandidates.values()).filter(m => m.confidence > 0.7);
        if (highConfidenceMatches.length < 2) {
            const contextMatches = await findOptimizedContextualMatches(missingDoc, otherDocIds);
            
            for (const match of contextMatches) {
                const existing = matchCandidates.get(match.documentId);
                if (!existing || (match.similarity > existing.confidence && match.similarity > 0.5)) {
                    const validatedMatch = await validateContextualMatch(missingDoc, match);
                    if (validatedMatch.isValid && validatedMatch.confidence > 0.5) {
                        matchCandidates.set(match.documentId, {
                            documentId: match.documentId,
                            confidence: validatedMatch.confidence,
                            page: match.page,
                            snippet: validatedMatch.snippet,
                            reasons: validatedMatch.reasons,
                            matchTypes: existing ? [...(existing.matchTypes ?? []), 'contextual-ann'] : ['contextual-ann'],
                            finalScore: validatedMatch.confidence * 0.9
                        });
                    }
                }
            }
        }

        const finalSuggestions = Array.from(matchCandidates.values())
            .map(candidate => {
                const multiMatchBonus = candidate.matchTypes.length > 1 ? 0.1 : 0;
                const annBonus = candidate.matchTypes.includes('contextual-ann') ? 0.05 : 0; // Small bonus for ANN optimization
                const adjustedScore = Math.min(0.98, candidate.finalScore + multiMatchBonus + annBonus);
                
                return {
                    documentId: candidate.documentId,
                    documentTitle: docTitleMap.get(candidate.documentId) ?? `Document ${candidate.documentId}`,
                    similarity: Math.round(adjustedScore * 100) / 100,
                    page: candidate.page,
                    snippet: `${candidate.snippet} (${candidate.reasons.join(', ')})`
                };
            })
            .filter(s => s.similarity >= 0.4) // Higher threshold for better accuracy
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 2); // Fewer but more accurate suggestions

        return finalSuggestions;
    } catch (error) {
        console.error("Error finding suggested company documents:", error);
        return [];
    }
}

async function findExactReferenceMatches(
    missingDoc: MissingDocumentPrediction,
    docIds: number[],
): Promise<MatchCandidate[]> {
    const matches: MatchCandidate[] = [];
    const searchTerms = [
        missingDoc.documentName.toLowerCase(),
        `"${missingDoc.documentName.toLowerCase()}"`,
        `${missingDoc.documentType.toLowerCase()} ${missingDoc.documentName.split(' ').pop()?.toLowerCase() ?? ''}`
    ];

    for (const term of searchTerms) {
        if (term.length < 3) continue;

        const results = await db.select({
            id: documentSections.id,
            content: documentSections.content,
            page: documentSections.pageNumber,
            documentId: documentSections.documentId,
        }).from(documentSections).where(and(
            inArray(documentSections.documentId, docIds.map(id => BigInt(id))),
            sql`LOWER(${documentSections.content}) LIKE ${`%${term.replace(/"/g, '')}%`}`
        )).limit(3);

        for (const result of results) {
            const content = result.content.toLowerCase();
            const exactMatch = content.includes(missingDoc.documentName.toLowerCase());
            const hasQuotes = content.includes(`"${missingDoc.documentName.toLowerCase()}"`);
            
            if (exactMatch || hasQuotes) {
                const confidence = hasQuotes ? 0.95 : exactMatch ? 0.85 : 0.7;
                const snippet = truncateText(result.content, 120);

                matches.push({
                    documentId: Number(result.documentId),
                    confidence,
                    page: result.page ?? 1,
                    snippet,
                    reasons: [hasQuotes ? 'Exact quoted reference' : 'Exact name match'],
                    matchTypes: ['exact'],
                    finalScore: confidence
                });
            }
        }
    }

    return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 2);
}

async function findSmartTitleMatches(
    missingDoc: MissingDocumentPrediction,
    allDocs: CompanyDocument[]
): Promise<MatchCandidate[]> {
    const matches: MatchCandidate[] = [];
    const cleanDocName = cleanText(missingDoc.documentName);
    const cleanDocType = cleanText(missingDoc.documentType);
    
    const identifierMatch = /\b([a-z]\d*|\d+[a-z]*)\b/i.exec(missingDoc.documentName);
    const identifier = identifierMatch ? identifierMatch[1]?.toLowerCase() : null;
    
    for (const doc of allDocs) {
        const cleanTitle = cleanText(doc.title);
        let confidence = 0;
        const reasons: string[] = [];
        
        if (identifier && cleanTitle.includes(identifier) && cleanTitle.includes(cleanDocType)) {
            confidence = 0.92;
            reasons.push(`Perfect identifier match: "${identifier}" + type`);
        }
        else if (cleanTitle.includes(cleanDocName)) {
            confidence = 0.88;
            reasons.push(`Document name in title`);
        }
        else if (cleanTitle.includes(cleanDocType) && identifier && cleanTitle.includes(identifier)) {
            confidence = 0.75;
            reasons.push(`Type + identifier match`);
        }
        else if (cleanTitle.includes(cleanDocType)) {
            confidence = 0.45;
            reasons.push(`Document type match only`);
        }
        
        if (confidence > 0.4) {
            matches.push({
                documentId: doc.id,
                confidence,
                page: 1,
                snippet: `Title: "${doc.title}"`,
                reasons,
                matchTypes: ['title'],
                finalScore: confidence
            });
        }
    }
    
    return matches.sort((a, b) => b.confidence - a.confidence);
}

async function findOptimizedContextualMatches(
    missingDoc: MissingDocumentPrediction,
    docIds: number[]
): Promise<DocumentMatch[]> {
    const contextQueries = [
        `${missingDoc.documentType} containing ${missingDoc.documentName.split(' ').pop()}`,
        `document attachment ${missingDoc.documentName}`,
        `referenced ${missingDoc.documentName}`
    ];

    const allMatches: DocumentMatch[] = [];
    
    for (const query of contextQueries) {
        const queryEmbedding = await getEmbeddings(query);
        if (!queryEmbedding.length) continue;

        try {
            const annResults = await annOptimizer.searchSimilarChunks(
                queryEmbedding,
                docIds,
                8, 
                0.35 
            );

            for (const result of annResults) {
                allMatches.push({
                    documentId: Number(result.documentId),
                    page: result.page,
                    snippet: truncateText(result.content, 150),
                    similarity: result.confidence,
                    content: result.content
                });
            }
        } catch (error) {
            console.warn(`ANN search failed for query "${query}", falling back to traditional search:`, error);
            
            const fallbackMatches = await findTraditionalContextualMatches(query, queryEmbedding, docIds);
            allMatches.push(...fallbackMatches);
        }
    }
    
    const bestMatches = new Map<number, DocumentMatch>();
    
    for (const match of allMatches) {
        const existing = bestMatches.get(match.documentId);
        if (!existing || match.similarity > existing.similarity) {
            bestMatches.set(match.documentId, match);
        }
    }
    
    return Array.from(bestMatches.values());
}

async function findTraditionalContextualMatches(
    query: string,
    queryEmbedding: number[],
    docIds: number[]
): Promise<DocumentMatch[]> {
    const distanceSql = sql`embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector`;
    const results = await db.select({
        id: documentSections.id,
        content: documentSections.content,
        page: documentSections.pageNumber,
        documentId: documentSections.documentId,
        distance: distanceSql
    }).from(documentSections).where(and(
        inArray(documentSections.documentId, docIds.map(id => BigInt(id))),
        sql`${distanceSql} < 0.3`
    )).orderBy(distanceSql).limit(5);

    return results.map(result => {
        const distance = Number(result.distance) ?? 1;
        const similarity = Math.max(0, (1 - distance) * 0.7);

        return {
            documentId: Number(result.documentId),
            page: result.page ?? 1,
            snippet: truncateText(result.content, 150),
            similarity,
            content: result.content
        };
    });
}

async function validateContextualMatch(
    missingDoc: MissingDocumentPrediction,
    match: DocumentMatch
): Promise<ValidationResult & { snippet: string }> {
    const content = match.content?.toLowerCase() ?? match.snippet.toLowerCase();
    const docName = missingDoc.documentName.toLowerCase();
    const docType = missingDoc.documentType.toLowerCase();
    
    const reasons: string[] = [];
    let confidence = match.similarity;
    
    const hasDocName = content.includes(docName);
    const hasDocType = content.includes(docType);
    const hasReferenceWords = /\b(exhibit|schedule|attachment|addendum|appendix|refer|see|per)\b/.test(content);
    
    if (hasDocName) {
        confidence += 0.25;
        reasons.push(`Contains document name`);
    }
    
    if (hasDocType && hasReferenceWords) {
        confidence += 0.15;
        reasons.push(`Document type with reference context`);
    }
    
    if (content.length > 500 && !hasDocName) {
        confidence -= 0.1;
    }
    
    const isValid = (hasDocName || (hasDocType && hasReferenceWords)) && confidence > 0.4;
    
    return {
        isValid,
        confidence: Math.min(confidence, 0.85),
        reasons,
        snippet: truncateText(match.snippet, 100)
    };
}

export function clearANNCache(): void {
    ANNOptimizer.clearCache();
}

export function getANNCacheStats() {
    return ANNOptimizer.getCacheStats();
} 