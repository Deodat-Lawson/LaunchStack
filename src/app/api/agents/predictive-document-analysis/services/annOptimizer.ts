import { db } from "~/server/db/index";
import { and, eq, inArray, sql } from "drizzle-orm";
import { documentSections, pdfChunks } from "~/server/db/schema";

interface ANNConfig {
    strategy: 'hnsw' | 'ivf' | 'hybrid' | 'prefiltered';
    probeCount?: number;
    efSearch?: number;
    maxCandidates?: number;
    prefilterThreshold?: number;
}

interface ANNResult {
    id: number;
    content: string;
    page: number;
    documentId: number;
    distance: number;
    confidence: number;
}

type ANNRow = { id: number; content: string; page: number; documentId: number; distance: number };

const documentClustersCache = new Map<number, DocumentCluster>();

interface DocumentCluster {
    documentId: number;
    centroid: number[];
    chunkIds: number[];
    avgDistance: number;
    lastUpdated: Date;
}

export class ANNOptimizer {
    private config: ANNConfig;
    
    constructor(config: ANNConfig = { strategy: 'hybrid' }) {
        this.config = config;
    }

    async searchSimilarChunks(
        queryEmbedding: number[],
        documentIds: number[],
        limit = 10,
        distanceThreshold = 0.7
    ): Promise<ANNResult[]> {
        if (!documentIds || documentIds.length === 0) {
            return [];
        }
        
        switch (this.config.strategy) {
            case 'hnsw':
                return this.hnswSearch(queryEmbedding, documentIds, limit, distanceThreshold);
            
            case 'ivf':
                return this.ivfSearch(queryEmbedding, documentIds, limit, distanceThreshold);
            
            case 'prefiltered':
                return this.prefilteredSearch(queryEmbedding, documentIds, limit, distanceThreshold);
            
            case 'hybrid':
            default:
                return this.hybridSearch(queryEmbedding, documentIds, limit, distanceThreshold);
        }
    }

    private async hnswSearch(
        queryEmbedding: number[],
        documentIds: number[],
        limit: number,
        threshold: number
    ): Promise<ANNResult[]> {
        
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        
        const approximateLimit = Math.min(limit * 5, 100);
        
        const results = await db.select({
            id: documentSections.id,
            content: documentSections.content,
            page: documentSections.pageNumber,
            documentId: documentSections.documentId,
            distance: sql<number>`${documentSections.embedding} <=> ${embeddingStr}::vector`,
        })
        .from(documentSections)
        .where(inArray(documentSections.documentId, documentIds.map(id => BigInt(id))))
        .orderBy(sql`${documentSections.embedding} <=> ${embeddingStr}::vector`)
        .limit(approximateLimit);

        let rows: ANNRow[] = results.map(r => ({
            id: r.id,
            content: r.content,
            page: r.page ?? 0,
            documentId: Number(r.documentId),
            distance: Number(r.distance ?? 1),
        }));

        // Fallback to legacy table
        if (rows.length === 0 && documentIds.length === 1) {
            const legacyResults = await db.select({
                id: pdfChunks.id,
                content: pdfChunks.content,
                page: pdfChunks.page,
                documentId: pdfChunks.documentId,
                distance: sql<number>`${pdfChunks.embedding} <=> ${embeddingStr}::vector`,
            })
            .from(pdfChunks)
            .where(eq(pdfChunks.documentId, BigInt(documentIds[0]!)))
            .orderBy(sql`${pdfChunks.embedding} <=> ${embeddingStr}::vector`)
            .limit(approximateLimit);

            rows = legacyResults.map(r => ({
                id: r.id,
                content: r.content,
                page: r.page,
                documentId: Number(r.documentId),
                distance: Number(r.distance ?? 1),
            }));
        }

        const refinedResults = rows
            .map(row => ({
                ...row,
                confidence: Math.max(0, 1 - row.distance)
            }))
            .filter(r => r.distance <= threshold)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);

        return refinedResults as ANNResult[];
    }

    private async ivfSearch(
        queryEmbedding: number[],
        documentIds: number[],
        limit: number,
        threshold: number
    ): Promise<ANNResult[]> {
        const relevantClusters = await this.findRelevantDocumentClusters(
            queryEmbedding, 
            documentIds, 
            this.config.probeCount ?? 3
        );

        if (relevantClusters.length === 0) {
            return this.hnswSearch(queryEmbedding, documentIds, limit, threshold);
        }

        const clusterChunkIds = relevantClusters.flatMap(c => c.chunkIds);
        
        if (clusterChunkIds.length === 0) {
            return [];
        }
        
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        
        const results = await db.select({
            id: documentSections.id,
            content: documentSections.content,
            page: documentSections.pageNumber,
            documentId: documentSections.documentId,
            distance: sql<number>`${documentSections.embedding} <=> ${embeddingStr}::vector`,
        })
        .from(documentSections)
        .where(and(
            inArray(documentSections.id, clusterChunkIds),
            sql`${documentSections.embedding} <=> ${embeddingStr}::vector <= ${threshold}`,
        ))
        .orderBy(sql`${documentSections.embedding} <=> ${embeddingStr}::vector`)
        .limit(limit);

        return results.map(row => ({
            id: row.id,
            content: row.content,
            page: row.page ?? 0,
            documentId: Number(row.documentId),
            distance: Number(row.distance ?? 1),
            confidence: Math.max(0, 1 - Number(row.distance ?? 1)),
        }));
    }


    private async prefilteredSearch(
        queryEmbedding: number[],
        documentIds: number[],
        limit: number,
        threshold: number
    ): Promise<ANNResult[]> {
        
        const docScores = await this.calculateDocumentRelevanceScores(queryEmbedding, documentIds);
        
        const sortedDocIds = docScores
            .filter(d => d.score > (this.config.prefilterThreshold ?? 0.3))
            .sort((a, b) => b.score - a.score)
            .map(d => d.documentId);

        if (sortedDocIds.length === 0) {
            return this.hnswSearch(queryEmbedding, documentIds, limit, threshold);
        }

        const results: ANNResult[] = [];
        const embeddingStr = `[${queryEmbedding.join(',')}]`;

        for (const docId of sortedDocIds) {
            if (results.length >= limit) break;

            const remaining = limit - results.length;
            const docResults = await db.select({
                id: documentSections.id,
                content: documentSections.content,
                page: documentSections.pageNumber,
                documentId: documentSections.documentId,
                distance: sql<number>`${documentSections.embedding} <=> ${embeddingStr}::vector`,
            })
            .from(documentSections)
            .where(and(
                eq(documentSections.documentId, BigInt(docId)),
                sql`${documentSections.embedding} <=> ${embeddingStr}::vector <= ${threshold}`,
            ))
            .orderBy(sql`${documentSections.embedding} <=> ${embeddingStr}::vector`)
            .limit(remaining * 2);

            const mappedResults: ANNResult[] = docResults.map(row => ({
                id: row.id,
                content: row.content,
                page: row.page ?? 0,
                documentId: Number(row.documentId),
                distance: Number(row.distance ?? 1),
                confidence: Math.max(0, 1 - Number(row.distance ?? 1)),
            }));

            results.push(...mappedResults.slice(0, remaining));
        }

        return results.sort((a, b) => a.distance - b.distance);
    }


    private async hybridSearch(
        queryEmbedding: number[],
        documentIds: number[],
        limit: number,
        threshold: number
    ): Promise<ANNResult[]> {
        
        if (documentIds.length <= 5) {
            return this.hnswSearch(queryEmbedding, documentIds, limit, threshold);
        }

        if (documentIds.length <= 20) {
            return this.prefilteredSearch(queryEmbedding, documentIds, limit, threshold);
        }

        return this.ivfSearch(queryEmbedding, documentIds, limit, threshold);
    }

    private async calculateDocumentRelevanceScores(
        queryEmbedding: number[],
        documentIds: number[]
    ): Promise<{ documentId: number; score: number }[]> {
        
        const scores: { documentId: number; score: number }[] = [];
        
        for (const docId of documentIds) {
            let cluster = documentClustersCache.get(docId);
            
            if (!cluster || Date.now() - cluster.lastUpdated.getTime() > 3600000) {
                cluster = await this.buildDocumentCluster(docId);
                documentClustersCache.set(docId, cluster);
            }

            const similarity = this.cosineSimilarity(queryEmbedding, cluster.centroid);
            scores.push({ documentId: docId, score: similarity });
        }

        return scores;
    }

    private async buildDocumentCluster(documentId: number): Promise<DocumentCluster> {
        const chunks = await db.select({
            id: documentSections.id,
            embedding: documentSections.embedding
        }).from(documentSections).where(eq(documentSections.documentId, BigInt(documentId)));

        if (chunks.length === 0) {
            return {
                documentId,
                centroid: [],
                chunkIds: [],
                avgDistance: 1,
                lastUpdated: new Date()
            };
        }

        const dimension = chunks[0]?.embedding?.length ?? 1536;
        const centroid = new Array(dimension).fill(0);
        
        for (const chunk of chunks) {
            if (chunk.embedding) {
                for (let i = 0; i < dimension; i++) {
                    centroid[i] += chunk.embedding[i];
                }
            }
        }
        
        for (let i = 0; i < dimension; i++) {
            centroid[i] /= chunks.length;
        }

        let totalDistance = 0;
        let comparisons = 0;
        
        for (let i = 0; i < chunks.length && comparisons < 100; i++) {
            for (let j = i + 1; j < chunks.length && comparisons < 100; j++) {
                if (chunks[i]?.embedding && chunks[j]?.embedding) {
                    totalDistance += this.euclideanDistance(chunks[i]!.embedding!, chunks[j]!.embedding!);
                    comparisons++;
                }
            }
        }

        const avgDistance = comparisons > 0 ? totalDistance / comparisons : 1;

        return {
            documentId,
            centroid: centroid as number[],
            chunkIds: chunks.map(c => c.id),
            avgDistance,
            lastUpdated: new Date()
        };
    }

    private async findRelevantDocumentClusters(
        queryEmbedding: number[],
        documentIds: number[],
        topK = 3
    ): Promise<DocumentCluster[]> {
        
        const clusters: Array<{ cluster: DocumentCluster; similarity: number }> = [];

        for (const docId of documentIds) {
            let cluster = documentClustersCache.get(docId);
            
            if (!cluster) {
                cluster = await this.buildDocumentCluster(docId);
                documentClustersCache.set(docId, cluster);
            }

            if (cluster.centroid.length > 0) {
                const similarity = this.cosineSimilarity(queryEmbedding, cluster.centroid);
                clusters.push({ cluster, similarity });
            }
        }

        return clusters
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK)
            .map(c => c.cluster);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i]! * b[i]!;
            normA += a[i]! * a[i]!;
            normB += b[i]! * b[i]!;
        }

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private euclideanDistance(a: number[], b: number[]): number {
        if (a.length !== b.length) return Infinity;

        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            const diff = a[i]! - b[i]!;
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    static clearCache(): void {
        documentClustersCache.clear();
    }

    static getCacheStats(): { size: number; oldestEntry: Date | null } {
        const entries = Array.from(documentClustersCache.values());
        return {
            size: entries.length,
            oldestEntry: entries.length > 0 
                ? new Date(Math.min(...entries.map(e => e.lastUpdated.getTime())))
                : null
        };
    }
}

export default ANNOptimizer; 