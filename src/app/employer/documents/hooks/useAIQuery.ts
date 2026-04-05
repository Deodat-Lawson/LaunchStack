import { useState, useCallback } from 'react';
import type { AIModelType, LLMProvider } from '~/app/api/agents/documentQ&A/services/types';

export interface AIQueryRequest {
  documentId: number;
  question: string;
  aiModel?: AIModelType;
  provider?: LLMProvider;
  style?: 'concise' | 'detailed' | 'academic' | 'bullet-points';
  enableWebSearch?: boolean;
  conversationHistory?: string;
  aiPersona?: 'general' | 'learning-coach' | 'financial-expert' | 'legal-expert' | 'math-reasoning';
}

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchInfo {
  refinedQuery?: string;
  reasoning?: string;
  resultsCount?: number;
}

export interface AIQueryResponse {
  success: boolean;
  summarizedAnswer?: string;
  recommendedPages?: number[];
  retrievalMethod?: string;
  processingTimeMs?: number;
  chunksAnalyzed?: number;
  fusionWeights?: number[];
  searchScope?: 'document';
  aiModel?: string;
  webSources?: WebSource[];
  webSearch?: WebSearchInfo;
  message?: string;
  error?: string;
  details?: string;
}

export function useAIQuery() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Send an AI query
  const sendQuery = useCallback(async (params: AIQueryRequest): Promise<AIQueryResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      
      const response = await fetch('/api/agents/documentQ&A/AIQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: params.documentId,
          question: params.question,
          aiModel: params.aiModel,
          provider: params.provider,
          style: params.style,
          enableWebSearch: params.enableWebSearch,
          conversationHistory: params.conversationHistory,
          aiPersona: params.aiPersona,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(errorData.message ?? errorData.error ?? `Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as AIQueryResponse;
      if (!data.success) {
        throw new Error(data.message ?? data.error ?? 'Failed to get AI response');
      }
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send query';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    sendQuery,
  };
}

