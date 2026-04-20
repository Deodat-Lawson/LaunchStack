import { performTavilySearch } from "./tavilySearch";
import { executeWebSearchAgent } from "./webSearchAgent";
import type { WebSearchResult } from "./types";

/**
 * Shared web search service that can be used by both AIQuery and AIChat
 */
/**
 * Result from performWebSearch function
 */
export interface PerformWebSearchResult {
  /** Array of web search results */
  results: WebSearchResult[];
  /** The refined search query used */
  refinedQuery: string;
  /** Optional reasoning for the search refinement */
  reasoning?: string;
  /** Formatted content string for inclusion in prompts */
  content: string;
}

export async function performWebSearch(
  question: string,
  documentContext?: string,
  enableWebSearch = false,
  maxResults = 5
): Promise<PerformWebSearchResult> {
  if (!enableWebSearch) {
    return {
      results: [],
      refinedQuery: question,
      content: '',
    };
  }

  try {
    console.log('🌐 Web Search Feature: ENABLED');
    console.log('📝 Original Search Query:', question);
    
    const documentContextForAgent = documentContext 
      ? documentContext.substring(0, 1000)
      : undefined;
    
    const agentResult = await executeWebSearchAgent({
      userQuestion: question,
      documentContext: documentContextForAgent,
      maxResults,
      searchDepth: "advanced"
    });
    
    if (agentResult.results.length > 0) {
      console.log(`✅ Web Search Agent: Found ${agentResult.results.length} high-quality sources`);
      
      const webSearchContent = `\n\n=== Web Search Results (Intelligently Curated) ===\n${agentResult.results.map((result, idx) => {
        const relevanceNote = result.relevanceScore ? ` [Relevance Score: ${result.relevanceScore}/10]` : '';
        return `[Source ${idx + 1}]${relevanceNote}\nTitle: ${result.title}\nURL: ${result.url}\nContent: ${result.snippet}`;
      }).join('\n\n')}\n\n`;
      
      return {
        results: agentResult.results,
        refinedQuery: agentResult.refinedQuery,
        reasoning: agentResult.reasoning,
        content: webSearchContent,
      };
    } else {
      console.warn('⚠️ Web Search Agent: No relevant results found');
      return {
        results: [],
        refinedQuery: agentResult.refinedQuery,
        reasoning: agentResult.reasoning,
        content: '',
      };
    }
  } catch (webSearchError: unknown) {
    console.error("❌ Web search agent error:", webSearchError);
    // Fallback to direct Tavily search
    try {
      console.log('🔄 Falling back to direct Tavily search...');
      const fallbackResults = await performTavilySearch(question, maxResults);
      if (fallbackResults.length > 0) {
        const webSearchContent = `\n\n=== Web Search Results ===\n${fallbackResults.map((result, idx) => 
          `[Source ${idx + 1}] ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
        ).join('\n\n')}\n\n`;
        
        return {
          results: fallbackResults,
          refinedQuery: question,
          content: webSearchContent,
        };
      }
    } catch (fallbackError) {
      console.error("❌ Fallback search also failed:", fallbackError);
    }
    
    return {
      results: [],
      refinedQuery: question,
      content: '',
    };
  }
}

