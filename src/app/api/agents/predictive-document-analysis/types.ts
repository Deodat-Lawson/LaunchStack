export type PdfChunk = {
    id: number;
    content: string;
    page: number;
};

export type AnalysisSpecification = {
    type: keyof typeof ANALYSIS_TYPES;
    includeRelatedDocs?: boolean;
    existingDocuments?: string[];
    title: string;
    category: string;
    companyId: number;
    documentId: number;
};

export type SearchResult = {
    title: string;
    url: string;
    snippet: string;
};

export type MissingDocumentPrediction = {
    documentName: string;
    documentType: string;
    reason: string;
    page: number;
    priority: 'high' | 'medium' | 'low';
    suggestedLinks?: SearchResult[];
    suggestedCompanyDocuments?: {
        documentId: number;
        documentTitle: string;
        similarity: number;
        page: number;
        snippet: string;
    }[];
    resolvedIn?: {
        documentId: number;
        page: number;
        documentTitle?: string;
    };
};

export type ResolvedReference = {
    documentName: string;
    documentType: string;
    reason: string;
    originalPage: number;
    resolvedDocumentId: number;
    resolvedPage: number;
    resolvedDocumentTitle?: string;
    priority: 'high' | 'medium' | 'low';
};

export type PredictiveAnalysisResult = {
    missingDocuments: MissingDocumentPrediction[];
    recommendations: string[];
    suggestedRelatedDocuments?: SearchResult[];
    resolvedDocuments?: ResolvedReference[];
};

export type DocumentReference = {
    documentName: string;
    documentType: string;
    page: number;
    contextSnippet: string;
};

export type CompanyDocument = {
    id: number;
    title: string;
};

export type DocumentMatch = {
    documentId: number;
    page: number;
    snippet: string;
    similarity: number;
    content?: string;
};

export type ValidationResult = {
    isValid: boolean;
    confidence: number;
    reasons: string[];
};

export const ANALYSIS_TYPES = {
    contract: `You are an expert in analyzing contracts to identify missing referenced documents like exhibits, schedules, and addendums.`,
    financial: `You are an expert in analyzing financial documents to identify missing reports, statements, and supporting documentation.`,
    technical: `You are an expert in analyzing technical documents to identify missing specifications, manuals, and project deliverables.`,
    compliance: `You are an expert in analyzing compliance documents to identify missing regulatory filings and policy documents.`,
    general: `You are an expert in analyzing documents to identify any missing referenced or implied documents.`
} as const; 