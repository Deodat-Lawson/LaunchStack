/**
 * Per-document centroid clusters backing the IVF and prefiltered strategies.
 * A cluster summarizes one document's chunk embeddings (centroid + member
 * chunk ids); comparing the query against centroids is how those strategies
 * decide which documents deserve a full scan. Cached in-process for an hour.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { document, documentSections } from "@launchstack/store/schema";
import type { DocumentCluster } from "../../../search-types";
import { cosineSimilarity, euclideanDistance } from "../similarity";

const CLUSTER_TTL_MS = 3600000;

const documentClustersCache = new Map<number, DocumentCluster>();

export async function buildDocumentCluster(documentId: number): Promise<DocumentCluster> {
    const chunks = await getDb()
        .select({
            id: documentSections.id,
            embedding: documentSections.embedding,
        })
        .from(documentSections)
        .innerJoin(document, eq(documentSections.documentId, document.id))
        .where(
            and(
                eq(documentSections.documentId, BigInt(documentId)),
                eq(documentSections.versionId, document.currentVersionId)
            )
        );

    if (chunks.length === 0) {
        return {
            documentId,
            centroid: [],
            chunkIds: [],
            avgDistance: 1,
            lastUpdated: new Date(),
        };
    }

    const dimension = chunks[0]?.embedding?.length ?? 1536;
    const centroid = new Array<number>(dimension).fill(0);

    for (const chunk of chunks) {
        if (chunk.embedding) {
            for (let i = 0; i < dimension; i++) {
                centroid[i] = (centroid[i] ?? 0) + (chunk.embedding[i] ?? 0);
            }
        }
    }

    for (let i = 0; i < dimension; i++) {
        centroid[i] = (centroid[i] ?? 0) / chunks.length;
    }

    let totalDistance = 0;
    let comparisons = 0;

    for (let i = 0; i < chunks.length && comparisons < 100; i++) {
        for (let j = i + 1; j < chunks.length && comparisons < 100; j++) {
            if (chunks[i]?.embedding && chunks[j]?.embedding) {
                totalDistance += euclideanDistance(chunks[i]!.embedding!, chunks[j]!.embedding!);
                comparisons++;
            }
        }
    }

    const avgDistance = comparisons > 0 ? totalDistance / comparisons : 1;

    return {
        documentId,
        centroid,
        chunkIds: chunks.map(c => c.id),
        avgDistance,
        lastUpdated: new Date(),
    };
}

export async function calculateDocumentRelevanceScores(
    queryEmbedding: number[],
    documentIds: number[]
): Promise<{ documentId: number; score: number }[]> {
    const scores: { documentId: number; score: number }[] = [];

    for (const docId of documentIds) {
        let cluster = documentClustersCache.get(docId);

        if (!cluster || Date.now() - cluster.lastUpdated.getTime() > CLUSTER_TTL_MS) {
            cluster = await buildDocumentCluster(docId);
            documentClustersCache.set(docId, cluster);
        }

        const similarity = cosineSimilarity(queryEmbedding, cluster.centroid);
        scores.push({ documentId: docId, score: similarity });
    }

    return scores;
}

export async function findRelevantDocumentClusters(
    queryEmbedding: number[],
    documentIds: number[],
    topK = 3
): Promise<DocumentCluster[]> {
    const clusters: Array<{ cluster: DocumentCluster; similarity: number }> = [];

    for (const docId of documentIds) {
        let cluster = documentClustersCache.get(docId);

        if (!cluster) {
            cluster = await buildDocumentCluster(docId);
            documentClustersCache.set(docId, cluster);
        }

        if (cluster.centroid.length > 0) {
            const similarity = cosineSimilarity(queryEmbedding, cluster.centroid);
            clusters.push({ cluster, similarity });
        }
    }

    return clusters
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK)
        .map(c => c.cluster);
}

export function clearClusterCache(): void {
    documentClustersCache.clear();
}

export function getClusterCacheStats(): { size: number; oldestEntry: Date | null } {
    const entries = Array.from(documentClustersCache.values());
    return {
        size: entries.length,
        oldestEntry:
            entries.length > 0
                ? new Date(Math.min(...entries.map(e => e.lastUpdated.getTime())))
                : null,
    };
}
