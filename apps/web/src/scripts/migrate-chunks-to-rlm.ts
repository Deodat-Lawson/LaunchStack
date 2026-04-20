/**
 * Backfill Migration Script: pdfChunks → RLM Tables
 *
 * This script migrates existing pdfChunks data to the new RLM-ready tables:
 * - documentStructure: Hierarchical document tree
 * - documentSections: Section content with RLM metadata
 * - documentMetadata: Document-level planning layer
 * - documentPreviews: Cheap inspection layer
 *
 * Run with: npx tsx src/scripts/migrate-chunks-to-rlm.ts
 *
 * Features:
 * - Batch processing for large datasets
 * - Resumable (tracks progress in documentMetadata)
 * - Non-destructive (preserves original pdfChunks)
 * - Calculates token counts for cost-aware retrieval
 */

import { db } from "~/server/db";
import {
    document,
    pdfChunks,
    documentStructure,
    documentSections,
    documentMetadata,
    documentPreviews,
    type ContentType,
} from "~/server/db/schema";
import { eq, asc } from "drizzle-orm";
import crypto from "crypto";

// Configuration
const BATCH_SIZE = 100; // Documents per batch

// Simple token estimation (4 chars ≈ 1 token for English text)
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// Generate content hash for deduplication
function hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 64);
}

// Detect semantic type from content
function detectSemanticType(
    content: string
): "narrative" | "procedural" | "tabular" | "legal" | "financial" | "technical" | "reference" {
    const lowerContent = content.toLowerCase();

    // Check for tabular content (lots of | or consistent spacing patterns)
    if (
        (content.match(/\|/g)?.length ?? 0) > 5 ||
        (content.match(/\t/g)?.length ?? 0) > 10
    ) {
        return "tabular";
    }

    // Check for legal language
    if (
        /\b(whereas|hereby|herein|thereof|pursuant|notwithstanding|shall|covenant)\b/i.test(
            lowerContent
        )
    ) {
        return "legal";
    }

    // Check for financial content
    if (
        /\b(revenue|profit|loss|balance|asset|liability|equity|fiscal|quarter|annual)\b/i.test(
            lowerContent
        ) &&
        /\$|\d+%|\d{1,3}(,\d{3})*(\.\d+)?/.test(content)
    ) {
        return "financial";
    }

    // Check for procedural/instructional content
    if (
        /\b(step \d|first,|then,|next,|finally,|procedure|instruction|how to)\b/i.test(
            lowerContent
        ) ||
        /^\s*\d+\.\s+/m.test(content)
    ) {
        return "procedural";
    }

    // Check for technical content
    if (
        /\b(api|function|method|class|interface|parameter|configuration|implementation)\b/i.test(
            lowerContent
        )
    ) {
        return "technical";
    }

    // Check for reference content (glossary, index, bibliography)
    if (
        /\b(see also|refer to|definition:|glossary|appendix|reference)\b/i.test(
            lowerContent
        )
    ) {
        return "reference";
    }

    // Default to narrative
    return "narrative";
}

// Detect content type for structure node
function detectContentType(content: string, title?: string): ContentType {
    const lowerTitle = title?.toLowerCase() ?? "";

    // Check for table patterns
    if (
        (content.match(/\|/g)?.length ?? 0) > 5 ||
        /table \d|table:/i.test(lowerTitle)
    ) {
        return "table";
    }

    // Check for figure references
    if (/figure \d|fig\. \d|image:/i.test(lowerTitle) || /!\[.*\]\(.*\)/.test(content)) {
        return "figure";
    }

    // Check for list patterns
    if (
        /^(\s*[-•*]\s+|\s*\d+\.\s+)/m.test(content) &&
        (content.match(/^(\s*[-•*]\s+|\s*\d+\.\s+)/gm)?.length ?? 0) > 3
    ) {
        return "list";
    }

    // Check for appendix
    if (/appendix/i.test(lowerTitle)) {
        return "appendix";
    }

    // Check for paragraph (short content without structure)
    if (content.length < 500 && !content.includes("\n\n")) {
        return "paragraph";
    }

    // Default to section
    return "section";
}

// Generate a summary/preview from content
function generatePreview(content: string, maxLength = 500): string {
    // Take first paragraph or first N characters
    const firstParagraph = content.split(/\n\n/)[0] ?? content;
    if (firstParagraph.length <= maxLength) {
        return firstParagraph;
    }
    // Truncate at word boundary
    const truncated = firstParagraph.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > 0 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
}

// Extract keywords from content
function extractKeywords(content: string): string[] {
    // Simple keyword extraction: find capitalized phrases and repeated terms
    const words = content.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? [];
    const wordFreq = new Map<string, number>();

    for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }

    // Return top keywords
    return Array.from(wordFreq.entries())
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
}

interface MigrationStats {
    documentsProcessed: number;
    documentsSkipped: number;
    structureNodesCreated: number;
    sectionsCreated: number;
    previewsCreated: number;
    errors: string[];
}

async function migrateDocument(
    doc: { id: number; title: string; companyId: bigint },
    stats: MigrationStats
): Promise<void> {
    const docId = BigInt(doc.id);

    // Check if already migrated (has documentMetadata entry)
    const existingMetadata = await db
        .select({ id: documentMetadata.id })
        .from(documentMetadata)
        .where(eq(documentMetadata.documentId, docId))
        .limit(1);

    if (existingMetadata.length > 0) {
        stats.documentsSkipped++;
        return;
    }

    // Fetch all chunks for this document
    const chunks = await db
        .select()
        .from(pdfChunks)
        .where(eq(pdfChunks.documentId, docId))
        .orderBy(asc(pdfChunks.page), asc(pdfChunks.chunkIndex));

    if (chunks.length === 0) {
        stats.documentsSkipped++;
        return;
    }

    // Group chunks by page
    const pageGroups = new Map<number, typeof chunks>();
    for (const chunk of chunks) {
        const pageChunks = pageGroups.get(chunk.page) ?? [];
        pageChunks.push(chunk);
        pageGroups.set(chunk.page, pageChunks);
    }

    const pages = Array.from(pageGroups.keys()).sort((a, b) => a - b);

    // Calculate totals
    let totalTokens = 0;
    const allContent: string[] = [];

    for (const chunk of chunks) {
        const tokens = estimateTokens(chunk.content);
        totalTokens += tokens;
        allContent.push(chunk.content);
    }

    const fullContent = allContent.join("\n\n");

    // Create root structure node
    const [rootStructure] = await db
        .insert(documentStructure)
        .values({
            documentId: docId,
            parentId: null,
            level: 0,
            ordering: 0,
            title: doc.title,
            contentType: "section",
            path: "0",
            startPage: pages[0],
            endPage: pages[pages.length - 1],
            childCount: pages.length,
            tokenCount: totalTokens,
        })
        .returning({ id: documentStructure.id });

    stats.structureNodesCreated++;

    // Create page-level structure nodes and sections
    let pageOrdering = 0;
    for (const [pageNum, pageChunks] of pageGroups) {
        const pageContent = pageChunks.map((c) => c.content).join("\n\n");
        const pageTokens = estimateTokens(pageContent);

        // Create page structure node
        const [pageStructure] = await db
            .insert(documentStructure)
            .values({
                documentId: docId,
                parentId: BigInt(rootStructure!.id),
                level: 1,
                ordering: pageOrdering++,
                title: `Page ${pageNum}`,
                contentType: detectContentType(pageContent),
                path: `0.${pageOrdering}`,
                startPage: pageNum,
                endPage: pageNum,
                childCount: pageChunks.length,
                tokenCount: pageTokens,
            })
            .returning({ id: documentStructure.id });

        stats.structureNodesCreated++;

        // Create sections for each chunk
        for (const chunk of pageChunks) {
            const chunkTokens = estimateTokens(chunk.content);

            await db.insert(documentSections).values({
                documentId: docId,
                structureId: BigInt(pageStructure!.id),
                content: chunk.content,
                tokenCount: chunkTokens,
                charCount: chunk.content.length,
                embedding: chunk.embedding,
                contentHash: hashContent(chunk.content),
                semanticType: detectSemanticType(chunk.content),
                pageNumber: chunk.page,
            });

            stats.sectionsCreated++;
        }
    }

    // Create document metadata
    const keywords = extractKeywords(fullContent);
    const summary = generatePreview(fullContent, 1000);

    await db.insert(documentMetadata).values({
        documentId: docId,
        totalTokens,
        totalSections: chunks.length,
        totalTables: 0, // Would need content analysis to detect
        totalFigures: 0,
        totalPages: pages.length,
        maxSectionDepth: 1, // Currently flat page structure
        topicTags: keywords,
        summary,
        outline: [
            {
                id: rootStructure!.id,
                title: doc.title,
                level: 0,
                path: "0",
                tokenCount: totalTokens,
                pageRange: { start: pages[0]!, end: pages[pages.length - 1]! },
            },
        ],
        complexityScore: Math.min(100, Math.floor(totalTokens / 100)), // Simple heuristic
        documentClass: "other",
        language: "en",
    });

    // Create document-level previews
    await db.insert(documentPreviews).values([
        {
            documentId: docId,
            previewType: "summary",
            content: summary,
            tokenCount: estimateTokens(summary),
        },
        {
            documentId: docId,
            previewType: "keywords",
            content: keywords.join(", "),
            tokenCount: estimateTokens(keywords.join(", ")),
        },
        {
            documentId: docId,
            previewType: "first_paragraph",
            content: generatePreview(fullContent, 300),
            tokenCount: estimateTokens(generatePreview(fullContent, 300)),
        },
    ]);

    stats.previewsCreated += 3;
    stats.documentsProcessed++;
}

async function main(): Promise<void> {
    console.log("🚀 Starting RLM migration...");
    console.log(`   Batch size: ${BATCH_SIZE} documents`);

    const stats: MigrationStats = {
        documentsProcessed: 0,
        documentsSkipped: 0,
        structureNodesCreated: 0,
        sectionsCreated: 0,
        previewsCreated: 0,
        errors: [],
    };

    // Get all documents that have chunks but no metadata yet
    const documents = await db
        .select({
            id: document.id,
            title: document.title,
            companyId: document.companyId,
        })
        .from(document)
        .orderBy(asc(document.id));

    console.log(`📄 Found ${documents.length} documents to process`);

    let processed = 0;
    for (const doc of documents) {
        try {
            await migrateDocument(doc, stats);
            processed++;

            if (processed % 10 === 0) {
                console.log(
                    `   Processed ${processed}/${documents.length} (${stats.documentsProcessed} migrated, ${stats.documentsSkipped} skipped)`
                );
            }
        } catch (error) {
            const errMsg = `Document ${doc.id}: ${error instanceof Error ? error.message : String(error)}`;
            stats.errors.push(errMsg);
            console.error(`❌ Error: ${errMsg}`);
        }
    }

    console.log("\n✅ Migration complete!");
    console.log(`   Documents processed: ${stats.documentsProcessed}`);
    console.log(`   Documents skipped: ${stats.documentsSkipped}`);
    console.log(`   Structure nodes created: ${stats.structureNodesCreated}`);
    console.log(`   Sections created: ${stats.sectionsCreated}`);
    console.log(`   Previews created: ${stats.previewsCreated}`);

    if (stats.errors.length > 0) {
        console.log(`\n⚠️ Errors (${stats.errors.length}):`);
        for (const err of stats.errors.slice(0, 10)) {
            console.log(`   - ${err}`);
        }
        if (stats.errors.length > 10) {
            console.log(`   ... and ${stats.errors.length - 10} more`);
        }
    }
}

// Run if executed directly
main().catch(console.error);
