import { useState, useCallback } from 'react';
import type { SourceReference } from '~/app/api/agents/documentQ&A/services';
import type { AIModelType, LLMProvider } from '~/app/api/agents/documentQ&A/services/types';

export type { SourceReference };

export interface AIChatRequest {
  documentId?: number;
  companyId?: number;
  archiveName?: string;
  question: string;
  searchScope: 'document' | 'company';
  aiModel?: AIModelType;
  provider?: LLMProvider;
  style?: string;
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

export interface AIChatResponse {
  success: boolean;
  summarizedAnswer?: string;
  recommendedPages?: number[];
  references?: SourceReference[];
  retrievalMethod?: string;
  processingTimeMs?: number;
  chunksAnalyzed?: number;
  fusionWeights?: number[];
  searchScope?: 'document' | 'company' | 'archive';
  aiModel?: string;
  webSources?: WebSource[];
  webSearch?: WebSearchInfo;
  message?: string;
  error?: string;
  details?: string;
}

/**
 * Maps legacy model names to new model names for backward compatibility
 */
function mapLegacyModelName(model?: string): string | undefined {
  if (!model) return undefined;
  
  const legacyMap: Record<string, string> = {
    'gpt4': 'gpt-4o',
    'claude': 'claude-sonnet-4',
    'gemini': 'gemini-2.5-flash',
  };
  
  return legacyMap[model] ?? model;
}

export function useAIChat() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Send an AI chat query (supports both document and company-wide search)
  const sendQuery = useCallback(async (params: AIChatRequest): Promise<AIChatResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      // Map legacy model names to new format
      const mappedModel = mapLegacyModelName(params.aiModel);
      
      const response = await fetch('/api/agents/documentQ&A/AIChat/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: params.documentId,
          companyId: params.companyId,
          question: params.question,
          searchScope: params.searchScope,
          aiModel: mappedModel,
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

      const data = (await response.json()) as AIChatResponse;
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

