// Common types used across multiple components

import type React from "react";
import type { DocumentType } from "./document";
import type { PredictiveAnalysisResponse } from "./predictive-analysis";
import type { QAHistoryEntry } from "./qa-history";

export type ViewMode =
  | "document-only"
  | "with-ai-qa"
  | "with-ai-qa-history"
  | "predictive-analysis"
  | "generator"
  | "rewrite";

export type AiPersona =
  | "general"
  | "learning-coach"
  | "financial-expert"
  | "legal-expert"
  | "math-reasoning";

export interface errorType {
  error?: string;
  details?: string;
  message?: string;
}

export interface DocumentContentProps {
  selectedDoc: DocumentType | null;
  viewMode: ViewMode;
  aiQuestion: string;
  setAiQuestion: React.Dispatch<React.SetStateAction<string>>;
  aiAnswer: string;
  aiError: string;
  aiLoading: boolean;
  handleAiSearch: (e: React.FormEvent) => Promise<void>;
  referencePages: number[];
  pdfPageNumber: number;
  setPdfPageNumber: React.Dispatch<React.SetStateAction<number>>;
  qaHistory: QAHistoryEntry[];
  aiStyle: string;
  setAiStyle: React.Dispatch<React.SetStateAction<string>>;
  styleOptions: Record<string, string>;
  predictiveAnalysis: PredictiveAnalysisResponse | null;
  predictiveLoading: boolean;
  predictiveError: string;
  onRefreshAnalysis: () => void;
  onSelectDocument: (docId: number, page: number) => void;
  searchScope: "document" | "company";
  setSearchScope: React.Dispatch<React.SetStateAction<"document" | "company">>;
  companyId: number | null;
  userId: string | null;
  onCollapseMainSidebar: () => void;
}

