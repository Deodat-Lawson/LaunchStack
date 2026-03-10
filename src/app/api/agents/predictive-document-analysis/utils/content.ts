import type { PdfChunk } from "~/app/api/agents/predictive-document-analysis/types";

export function groupContentFromChunks(chunks: PdfChunk[]): string {
    return chunks
        .map((chunk) => `=== Page ${chunk.page} ===\n${chunk.content}`)
        .join("\n\n");
}

export function cleanText(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

export function extractKeywords(text: string, minLength = 2): string[] {
    const commonWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'a', 'an']);
    
    return text.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > minLength && !commonWords.has(word))
        .map(word => word.replace(/[^a-z0-9]/g, ''))
        .filter(word => word.length > 0);
}

export function hasReferencePattern(content: string, documentName: string): boolean {
    const docName = documentName.toLowerCase();
    const text = content.toLowerCase();
    
    const patterns = [
        `see ${docName}`,
        `refer to ${docName}`,
        `as per ${docName}`,
        `according to ${docName}`,
        `${docName} attached`,
        `${docName} shows`,
        `in ${docName}`,
        `per ${docName}`
    ];
    
    return patterns.some(pattern => text.includes(pattern));
}

export function calculateTextSimilarity(text1: string, text2: string): number {
    const clean1 = cleanText(text1);
    const clean2 = cleanText(text2);
    
    if (clean1 === clean2) return 1.0;
    if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.8;
    
    const words1 = new Set(clean1.split(/\s+/));
    const words2 = new Set(clean2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

export function truncateText(text: string, maxLength = 200): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
}

export function hasSpecificIdentifier(documentName: string): boolean {
    const identifierPatterns = [
        /^(exhibit|schedule|attachment|addendum|appendix)\s+[a-z0-9]+$/i,
        /^[a-z]+\s+(exhibit|schedule|attachment|addendum|appendix)$/i,
        /^(section|clause|article)\s+[0-9]+(\.[0-9]+)*$/i
    ];
    
    return identifierPatterns.some(pattern => pattern.test(documentName.trim()));
} 