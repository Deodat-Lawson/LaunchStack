/**
 * Reciprocal Rank Fusion: merges ranked lists from different retrieval
 * methods. RRF(d) = sum( 1 / (k + rank_i(d)) ) for each list i containing d.
 * k=60 is standard (from the original Cormack et al. paper). Agreement
 * between lists beats a high rank in any single list.
 */

export interface RankedResult {
    documentId: number;
    page: number;
    content: string;
    /** 1-based rank within its own list. */
    rank: number;
}

export interface FusedResult {
    score: number;
    documentId: number;
    page: number;
    content: string;
}

export function reciprocalRankFusion(lists: RankedResult[][], k = 60): Map<string, FusedResult> {
    const fused = new Map<string, FusedResult>();

    for (const list of lists) {
        for (const item of list) {
            const key = `${item.documentId}:${item.page}`;
            const existing = fused.get(key);
            const rrfScore = 1 / (k + item.rank);

            if (existing) {
                existing.score += rrfScore;
                if (item.content.length > existing.content.length) {
                    existing.content = item.content;
                }
            } else {
                fused.set(key, {
                    score: rrfScore,
                    documentId: item.documentId,
                    page: item.page,
                    content: item.content,
                });
            }
        }
    }

    return fused;
}
