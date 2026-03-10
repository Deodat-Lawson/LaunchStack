
export { analyzeDocumentChunks } from "~/app/api/agents/predictive-document-analysis/services/analysisEngine";
export { groupContentFromChunks } from "~/app/api/agents/predictive-document-analysis/utils/content";

// Re-export types for compatibility
export type {
    PdfChunk,
    AnalysisSpecification,
    PredictiveAnalysisResult,
    MissingDocumentPrediction,
    ResolvedReference,
    SearchResult
} from "~/app/api/agents/predictive-document-analysis/types";