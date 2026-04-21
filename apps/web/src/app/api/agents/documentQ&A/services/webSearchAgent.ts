import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { performTavilySearch } from "./tavilySearch";
import { env } from "~/env";
import type { WebSearchResult, WebSearchAgentInput, WebSearchAgentResult } from "./types";

/**
 * Web Search Agent using LangChain and LangSmith
 * 
 * This agent performs intelligent web searches by:
 * 1. Refining search queries based on context
 * 2. Executing optimized searches
 * 3. Synthesizing and filtering results for relevance
 * 4. Providing high-quality, contextualized information
 * 
 * LangSmith tracing is automatically enabled if LANGCHAIN_TRACING_V2=true
 */

const QUERY_REFINEMENT_PROMPT = 
    `You are an expert search query optimizer. Your task is to refine user questions into highly effective web search queries.

    Guidelines:
    1. Extract the core intent and key concepts from the user's question
    2. Remove redundant words and focus on essential search terms
    3. Add relevant context terms if document context is provided
    4. Use specific, searchable keywords rather than conversational language
    5. Keep queries concise (5-10 words ideal) while maintaining clarity
    6. If the question references specific document content, incorporate relevant terms from that context
    7. Prioritize terms that are likely to appear in authoritative sources

    Examples:
    - "What is the warranty period for this product?" → "product warranty period terms"
    - "How do I calculate depreciation?" → "depreciation calculation methods accounting"
    - "What are the safety requirements?" → "safety requirements regulations compliance"

    Return ONLY the refined search query, nothing else.`;

const RESULT_SYNTHESIS_PROMPT = 
    `You are an expert information analyst specializing in evaluating and synthesizing web search results.

    Your task is to:
    1. Analyze search results for relevance to the user's question
    2. Identify the most authoritative and informative sources
    3. Filter out low-quality, irrelevant, or redundant results
    4. Rank results by relevance and quality
    5. Provide reasoning for your selections

    Evaluation Criteria:
    - Relevance: How well does the result address the user's question?
    - Authority: Is the source credible and trustworthy?
    - Recency: Is the information current (if timeliness matters)?
    - Completeness: Does the result provide substantial information?
    - Uniqueness: Does it add value not covered by other results?

    Document Context (if provided):
    {documentContext}

    User Question: {userQuestion}

    Search Results:
    {searchResults}

    Analyze these results and return:
    1. A JSON array of the most relevant results (up to {maxResults} items)
    2. For each result, include: title, url, snippet, and a relevance score (1-10)
    3. A brief reasoning statement explaining why these results were selected

    Format your response as JSON:
    {
    "selectedResults": [
        {
        "title": "...",
        "url": "...",
        "snippet": "...",
        "relevanceScore": 8
        }
    ],
    "reasoning": "Brief explanation of selection criteria"
    }`;

/**
 * Refines the user's question into an optimized search query
 */
async function refineSearchQuery(
    userQuestion: string,
    documentContext?: string
): Promise<{ refinedQuery: string; reasoning: string }> {
    const chat = new ChatOpenAI({
        openAIApiKey: env.server.OPENAI_API_KEY,
        modelName: "gpt-5-mini",
        temperature: 0.3,
    });

    const contextPrompt = documentContext
        ? `\n\nDocument Context (use relevant terms from this):\n${documentContext.substring(0, 500)}`
        : "";

    const messages = [
        new SystemMessage(QUERY_REFINEMENT_PROMPT),
        new HumanMessage(
            `User Question: "${userQuestion}"${contextPrompt}\n\nRefined Search Query:`
        ),
    ];

    try {
        const response = await chat.invoke(messages);
        let content: string;
        if (typeof response.content === "string") {
            content = response.content;
        } else if (Array.isArray(response.content)) {
            content = response.content
                .map((item) => typeof item === "string" ? item : JSON.stringify(item))
                .join("");
        } else {
            content = JSON.stringify(response.content);
        }
        const refinedQuery = content
            .trim()
            .replace(/^["']|["']$/g, "");

        console.log(`🔍 [WebSearchAgent] Query refined: "${userQuestion}" → "${refinedQuery}"`);

        return {
            refinedQuery,
            reasoning: `Refined query to focus on: ${refinedQuery}`,
        };
    } catch (error) {
        console.error("Query refinement error:", error);
        // Fallback to original question
        return {
            refinedQuery: userQuestion,
            reasoning: "Used original query due to refinement error",
        };
    }
}

/**
 * Performs the actual web search using Tavily
 */
async function executeSearch(
    query: string,
    maxResults: number
): Promise<WebSearchResult[]> {
    try {
        console.log(`🌐 [WebSearchAgent] Executing search: "${query}"`);
        
        const results = await performTavilySearch(
            query,
            maxResults * 2 // Get more results for filtering
        );

        console.log(`✅ [WebSearchAgent] Found ${results.length} raw results`);

        return results;
    } catch (error) {
        console.error("Search execution error:", error);
        return [];
    }
}

/**
 * Synthesizes and filters search results for relevance
 */
async function synthesizeResults(
    rawResults: WebSearchResult[],
    userQuestion: string,
    documentContext: string | undefined,
    maxResults: number
): Promise<{ results: WebSearchResult[]; reasoning: string }> {
    if (!rawResults || rawResults.length === 0) {
        return {
            results: [],
            reasoning: "No search results to synthesize",
        };
    }

    const chat = new ChatOpenAI({
        openAIApiKey: env.server.OPENAI_API_KEY,
        modelName: "gpt-5-mini",
        temperature: 0.2,
    });

    const searchResultsText = rawResults
        .map(
            (result, idx) =>
                `Result ${idx + 1}:\nTitle: ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}\n`
        )
        .join("\n---\n\n");

    const prompt = RESULT_SYNTHESIS_PROMPT
        .replace("{documentContext}", documentContext ?? "None provided")
        .replace("{userQuestion}", userQuestion)
        .replace("{searchResults}", searchResultsText)
        .replace("{maxResults}", maxResults.toString());

    try {
        const response = await chat.invoke([
            new SystemMessage("You are a helpful assistant that returns only valid JSON."),
            new HumanMessage(prompt),
        ]);

        let responseText: string;
        if (typeof response.content === "string") {
            responseText = response.content;
        } else if (Array.isArray(response.content)) {
            responseText = response.content
                .map((item) => typeof item === "string" ? item : JSON.stringify(item))
                .join("");
        } else {
            responseText = JSON.stringify(response.content);
        }
        
        // Extract JSON from response (handle markdown code blocks)
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const jsonObjectRegex = /\{[\s\S]*\}/;
        
        let jsonText = responseText;
        const jsonBlockMatch = jsonBlockRegex.exec(responseText);
        if (jsonBlockMatch) {
            jsonText = jsonBlockMatch[1] ?? jsonText;
        } else {
            const jsonObjectMatch = jsonObjectRegex.exec(responseText);
            if (jsonObjectMatch) {
                jsonText = jsonObjectMatch[0] ?? jsonText;
            }
        }
        
        interface ParsedSynthesisResult {
            selectedResults: Array<{
                title: string;
                url: string;
                snippet: string;
                relevanceScore?: number;
            }>;
            reasoning?: string;
        }
        
        const parsed = JSON.parse(jsonText) as ParsedSynthesisResult;
        
        // Map back to WebSearchResult format
        const synthesizedResults: WebSearchResult[] = parsed.selectedResults.map(
            (result) => ({
                title: result.title,
                url: result.url,
                snippet: result.snippet,
                relevanceScore: result.relevanceScore,
            })
        );

        console.log(`✨ [WebSearchAgent] Synthesized ${synthesizedResults.length} high-quality results`);
        console.log(`📊 [WebSearchAgent] Reasoning: ${parsed.reasoning ?? "N/A"}`);

        return {
            results: synthesizedResults,
            reasoning: parsed.reasoning ?? "Results filtered for relevance",
        };
    } catch (error) {
        console.error("Result synthesis error:", error);
        // Fallback to raw results (limited)
        return {
            results: rawResults.slice(0, maxResults),
            reasoning: "Used raw results due to synthesis error",
        };
    }
}

/**
 * Main function to execute web search using the intelligent agent
 * 
 * This function orchestrates the three-step process:
 * 1. Query refinement
 * 2. Search execution
 * 3. Result synthesis
 * 
 * LangSmith tracing is automatically enabled if configured in environment variables
 */
export async function executeWebSearchAgent(
    input: WebSearchAgentInput
): Promise<WebSearchAgentResult> {
    const maxResults = input.maxResults ?? 5;

    try {
        // Step 1: Refine the search query
        const { refinedQuery, reasoning: refinementReasoning } = await refineSearchQuery(
            input.userQuestion,
            input.documentContext
        );

        // Step 2: Execute the search
        const rawResults = await executeSearch(refinedQuery, maxResults);

        if (rawResults.length === 0) {
            return {
                results: [],
                refinedQuery,
                reasoning: refinementReasoning + " No results found.",
            };
        }

        // Step 3: Synthesize and filter results
        const { results, reasoning: synthesisReasoning } = await synthesizeResults(
            rawResults,
            input.userQuestion,
            input.documentContext,
            maxResults
        );

        return {
            results,
            refinedQuery,
            reasoning: `${refinementReasoning} ${synthesisReasoning}`,
        };
    } catch (error) {
        console.error("Web search agent error:", error);
        // Fallback to direct search
        const fallbackResults = await performTavilySearch(
            input.userQuestion,
            maxResults
        );
        return {
            results: fallbackResults,
            refinedQuery: input.userQuestion,
            reasoning: "Used fallback search due to agent error",
        };
    }
}

