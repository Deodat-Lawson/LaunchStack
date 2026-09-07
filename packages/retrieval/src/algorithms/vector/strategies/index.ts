/**
 * Named ANN strategies behind the vector retriever, plus ANNOptimizer — the
 * config-driven dispatcher consumers hold on to. "hybrid" is the adaptive
 * strategy: exact scan for small scopes (≤5 docs), prefiltered for medium
 * (≤20), matryoshka coarse-to-fine for large ones.
 */

import type { ANNConfig, ANNResult } from "../../../search-types";
import { exactScanSearch } from "./exact";
import { ivfSearch } from "./ivf";
import { prefilteredSearch } from "./prefiltered";
import { matryoshkaSearch } from "./matryoshka";
import { clearClusterCache, getClusterCacheStats } from "./clusters";

export { exactScanSearch } from "./exact";
export { ivfSearch } from "./ivf";
export { prefilteredSearch } from "./prefiltered";
export { matryoshkaSearch } from "./matryoshka";
export {
    buildDocumentCluster,
    calculateDocumentRelevanceScores,
    findRelevantDocumentClusters,
} from "./clusters";

export class ANNOptimizer {
    private config: ANNConfig;

    constructor(config: ANNConfig = { strategy: "hybrid" }) {
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
            case "hnsw":
                return exactScanSearch(queryEmbedding, documentIds, limit, distanceThreshold);

            case "ivf":
                return ivfSearch(
                    queryEmbedding,
                    documentIds,
                    limit,
                    distanceThreshold,
                    this.config.probeCount ?? 3
                );

            case "prefiltered":
                return prefilteredSearch(
                    queryEmbedding,
                    documentIds,
                    limit,
                    distanceThreshold,
                    this.config.prefilterThreshold ?? 0.3
                );

            case "matryoshka":
                return matryoshkaSearch(queryEmbedding, documentIds, limit, distanceThreshold);

            case "hybrid":
            default:
                return this.adaptiveSearch(queryEmbedding, documentIds, limit, distanceThreshold);
        }
    }

    private async adaptiveSearch(
        queryEmbedding: number[],
        documentIds: number[],
        limit: number,
        threshold: number
    ): Promise<ANNResult[]> {
        if (documentIds.length <= 5) {
            return exactScanSearch(queryEmbedding, documentIds, limit, threshold);
        }

        if (documentIds.length <= 20) {
            return prefilteredSearch(
                queryEmbedding,
                documentIds,
                limit,
                threshold,
                this.config.prefilterThreshold ?? 0.3
            );
        }

        // For large document sets, use Matryoshka coarse-to-fine
        return matryoshkaSearch(queryEmbedding, documentIds, limit, threshold);
    }

    static clearCache(): void {
        clearClusterCache();
    }

    static getCacheStats(): { size: number; oldestEntry: Date | null } {
        return getClusterCacheStats();
    }
}

export default ANNOptimizer;
