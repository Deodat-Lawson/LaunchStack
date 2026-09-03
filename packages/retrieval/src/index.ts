/**
 * @launchstack/retrieval — question in, cited answer out.
 *
 * The root exports the RagPort, its slot, and the citation builder. The
 * algorithms live under ./algorithms (one folder per algorithm, each with
 * its own README), the agent- and pipeline-facing tools under ./tools.
 */
export type {
    RagPort,
    CompanySearchOptions,
    RagSearchFilters,
    RagSearchResult,
    RagSearchMetadata,
} from "./types";
export { configureRag, getRag, getRagOrNull, ragCompanySearchSafe } from "./slot";
export {
    buildCitations,
    type RetrievedEvidence,
    type SourceVersionInfo,
    type Citation,
} from "./tools/citation-builder";
