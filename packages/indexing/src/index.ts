/**
 * @launchstack/indexing — takes conversion's output and makes it searchable:
 * chunking, embeddings under named indexes, entity extraction, graph sync,
 * and the two-stage doc-ingestion pipeline the worker drives.
 */
export { extractAndStoreEntities } from "./entity-extraction";
export {
    configureEntityExtraction,
    isEntityExtractionEnabled,
    resetEntityExtractionConfig,
    type EntityExtractionConfig,
} from "./entity-extraction-config";
export {
    runDocIngestionTool,
    runExtractionStage,
    runIndexingStage,
    type DocIngestionToolInput,
    type DocIngestionToolResult,
    type DocIngestionToolRuntimeOptions,
    type ExtractionStageSummary,
    type IndexingStageCounts,
} from "./doc-ingestion";
export { DocIngestionPipeline } from "./pipeline-port";
