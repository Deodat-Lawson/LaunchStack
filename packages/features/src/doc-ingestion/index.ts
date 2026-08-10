/**
 * Moved to the engine: packages/adapters/src/ingestion/doc-ingestion/
 * (ADR-002 — ingestion orchestration lives in the adapters layer).
 *
 * Kept as a re-export so existing `@launchstack/features/doc-ingestion`
 * consumers keep working. New code should import from
 * `@launchstack/adapters` directly.
 */
export {
    runDocIngestionTool,
    runExtractionStage,
    runIndexingStage,
    type ExtractionStageSummary,
    type IndexingStageCounts,
    type DocIngestionToolInput,
    type DocIngestionToolResult,
    type DocIngestionToolRuntimeOptions,
} from "@launchstack/adapters/ingestion/doc-ingestion";
