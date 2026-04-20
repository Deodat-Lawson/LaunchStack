/**
 * RAG Search Tool
 * Role: LangChain tool that runs BM25+vector ensemble search on user documents.
 * Purpose: validate access, fetch relevant chunks, and format context for prompts.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  multiDocEnsembleSearch,
  validateDocumentAccess,
  formatResultsForPrompt,
} from "../index";
import type { RAGSearchResult, RAGSearchInput } from "../types";

const RAGSearchSchema = z.object({
  query: z.string().describe("The search query to find relevant document content"),
  documentIds: z.array(z.string()).describe("Array of document IDs to search within"),
  topK: z.number().optional().default(6).describe("Number of top results to return"),
});

/**
 * Execute RAG search against selected documents
 */
export async function executeRAGSearch(
  input: RAGSearchInput,
  userId: string
): Promise<{
  results: RAGSearchResult[];
  formattedContext: string;
  documentTitles: Map<string, string>;
}> {
  const startTime = Date.now();

  try {
    // Validate document access
    const { validDocIds, documentTitles } = await validateDocumentAccess(
      userId,
      input.documentIds
    );

    if (validDocIds.length === 0) {
      return {
        results: [],
        formattedContext: "",
        documentTitles: new Map(),
      };
    }

    // Execute ensemble search (BM25 + Vector)
    const ragResults = await multiDocEnsembleSearch(input.query, {
      documentIds: validDocIds,
      topK: input.topK ?? 6,
      weights: [0.4, 0.6], // BM25 weight, Vector weight
    });

    // Transform results to our format
    const results: RAGSearchResult[] = ragResults.map((result) => {
      const docId = String(result.metadata?.documentId ?? "");
      const metadata = result.metadata as unknown as Record<string, unknown> | undefined;
      return {
        content: result.pageContent,
        page: typeof result.metadata?.page === "number" ? result.metadata.page : 0,
        documentId: docId,
        documentTitle: documentTitles.get(docId as unknown as number) ?? "Unknown",
        relevanceScore: typeof metadata?.score === "number" ? metadata.score : 0,
      };
    });

    // Format for prompt injection
    const formattedContext = formatResultsForPrompt(ragResults, documentTitles);

    console.log(
      `📚 [RAG Search] Found ${results.length} relevant chunks in ${Date.now() - startTime}ms`
    );

    // Convert documentTitles Map<number, string> to Map<string, string>
    const stringDocTitles = new Map<string, string>();
    documentTitles.forEach((value, key) => {
      stringDocTitles.set(String(key), value);
    });

    return {
      results,
      formattedContext,
      documentTitles: stringDocTitles,
    };
  } catch (error) {
    console.error("❌ [RAG Search] Error:", error);
    throw error;
  }
}

/**
 * RAG Search Tool for LangChain
 */
export const ragSearchTool = tool(
  async (input, config): Promise<string> => {
    const userId = (config?.configurable as { userId?: string } | undefined)?.userId;

    if (!userId) {
      return JSON.stringify({
        success: false,
        error: "User ID not provided",
        results: [],
      });
    }

    try {
      const { results, formattedContext } = await executeRAGSearch(
        {
          query: input.query,
          documentIds: input.documentIds,
          topK: input.topK,
        },
        userId
      );

      return JSON.stringify({
        success: true,
        resultCount: results.length,
        results: results.slice(0, 5).map((r) => ({
          content: r.content.substring(0, 500),
          page: r.page,
          documentTitle: r.documentTitle,
          relevanceScore: r.relevanceScore,
        })),
        formattedContext: formattedContext.substring(0, 4000),
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        results: [],
      });
    }
  },
  {
    name: "rag_search",
    description:
      "Search through uploaded study documents to find relevant content for answering questions or generating study materials. Use this when you need information from the user's documents.",
    schema: RAGSearchSchema,
  }
);
