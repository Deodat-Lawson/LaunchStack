// Q&A History types

export interface QAHistoryEntry {
  id: string;
  question: string;
  response: string;
  documentId: number;
  documentTitle: string;
  createdAt: string;
  pages: number[];
}

export interface QAHistoryProps {
  history: QAHistoryEntry[];
  onQuestionSelect: (question: string) => void;
  setPdfPageNumber: (page: number) => void;
  selectedDoc?: { id: number; title: string } | null;
  documentTitle?: string;
}

