/**
 * Common API types used across the Launchstack application
 */

import type { AnalysisType, PriorityLevel, UrgencyLevel, ErrorType } from "~/lib/constants";

// Base API Response Types
export interface BaseResponse {
  success: boolean;
  timestamp?: string;
}

export interface SuccessResponse<T = unknown> extends BaseResponse {
  success: true;
  data?: T;
  message?: string;
}

export interface ErrorResponse extends BaseResponse {
  success: false;
  error?: string;
  message: string;
  errorType: ErrorType;
}

// Document Analysis Types
export interface DocumentReference {
  type: 'explicit' | 'implicit' | 'contextual';
  reference: string;
  context: string;
  page: number;
  confidence: number;
  urgency: UrgencyLevel;
}

export interface MissingDocument {
  documentName: string;
  documentType: string;
  reason: string;
  references: DocumentReference[];
  likelyLocation: string;
  alternatives: string[];
  businessImpact: string;
  confidence: number;
  priority: PriorityLevel;
}

export interface BrokenReference {
  reference: string;
  expectedDocument: string;
  context: string;
  page: number;
  severity: UrgencyLevel;
}

export interface DocumentGap {
  category: string;
  description: string;
  suggestedDocuments: string[];
  businessJustification: string;
}

export interface Recommendation {
  priority: PriorityLevel;
  action: string;
  description: string;
  expectedDocuments: string[];
}

export interface AnalysisSummary {
  totalMissingDocuments: number;
  highPriorityItems: number;
  totalRecommendations: number;
  totalSuggestedRelated: number;
  analysisTimestamp: string;
  completenessScore?: number;
}

export interface AnalysisMetadata {
  pagesAnalyzed: number;
  existingDocumentsChecked: number;
  existingDocuments?: string[];
}

export interface PredictiveAnalysisResult {
  missingDocuments: MissingDocument[];
  brokenReferences?: BrokenReference[];
  documentGaps?: DocumentGap[];
  recommendations: Recommendation[];
  suggestedRelatedDocuments?: Array<{
    title: string;
    link: string;
    snippet: string;
  }>;
  completenessScore?: number;
}

// API Request/Response Types
export interface PredictiveAnalysisRequest {
  documentId: number;
  analysisType?: AnalysisType;
  includeRelatedDocs?: boolean;
  timeoutMs?: number;
  forceRefresh?: boolean;
}

export type PredictiveAnalysisResponse = SuccessResponse<{
  documentId: number;
  analysisType: string;
  summary: AnalysisSummary;
  analysis: PredictiveAnalysisResult;
  metadata: AnalysisMetadata;
  fromCache?: boolean;
}>;

// Document Types
export interface Document {
  id: number;
  title: string;
  category: string;
  companyId: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PdfChunk {
  id: number;
  content: string;
  page: number;
  documentId: number;
}

// Chat Types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  documentId?: number;
}

export interface ChatRequest {
  message: string;
  documentId?: number;
  style?: 'professional' | 'casual' | 'technical' | 'summary';
}

export type ChatResponse = SuccessResponse<{
  response: string;
  messageId: string;
  documentId?: number;
}>;

// User Types
export interface User {
  id: string;
  email: string;
  role: 'employee' | 'employer';
  companyId?: string;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

// Company Types
export interface Company {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}