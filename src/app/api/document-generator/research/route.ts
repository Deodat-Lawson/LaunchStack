/**
 * Document Generator - Research API
 * 
 * Unified research endpoint combining:
 * - Document Research (RAG): Search uploaded company documents
 * - Web Research: Search the web using Tavily
 * - arXiv Research: Search academic papers from arXiv.org
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "~/server/db/index";
import { eq } from "drizzle-orm";
import { users } from "~/server/db/schema";
import { 
    companyEnsembleSearch,
    type CompanySearchOptions,
    type SearchResult
} from "~/lib/tools/rag";
import { performTavilySearch } from "~/app/api/agents/documentQ&A/services/tavilySearch";
import { getEmbeddings } from "~/app/api/agents/documentQ&A/services";

export const runtime = "nodejs";
export const maxDuration = 60;

// Research result types
interface DocumentResult {
    id: string;
    content: string;
    page?: number;
    documentTitle?: string;
    documentId?: number;
    relevanceScore: number;
    source: "document";
}

interface WebResult {
    id: string;
    title: string;
    url: string;
    snippet: string;
    relevanceScore: number;
    source: "web";
}

interface ArxivResult {
    id: string;
    title: string;
    url: string;
    arxivId: string;
    authors: string[];
    summary: string;
    published: string;
    updated: string;
    categories: string[];
    pdfUrl: string;
    relevanceScore: number;
    source: "arxiv";
}

type ResearchResult = DocumentResult | WebResult | ArxivResult;

// Validation schema
const ResearchSchema = z.object({
    query: z.string().min(1).max(1000),
    sources: z.array(z.enum(["documents", "web", "arxiv"])).min(1).default(["documents", "web"]),
    options: z.object({
        maxResults: z.number().min(1).max(20).optional(),
        searchType: z.enum(["general", "academic", "news"]).optional(),
        documentIds: z.array(z.number()).optional(), // Filter to specific documents
        arxivCategory: z.string().optional(), // e.g., "cs.AI", "cs.LG", "physics"
        sortBy: z.enum(["relevance", "lastUpdatedDate", "submittedDate"]).optional(),
    }).optional(),
});

/**
 * Search arXiv papers using their API
 * API Documentation: https://info.arxiv.org/help/api/basics.html
 */
async function searchArxiv(
    query: string, 
    maxResults = 5,
    options?: { category?: string; sortBy?: string }
): Promise<ArxivResult[]> {
    try {
        // Build the arXiv API query
        // Encode the query properly for URL
        let searchQuery = encodeURIComponent(query);
        
        // If a category is specified, add it to the query
        if (options?.category) {
            searchQuery = `all:${searchQuery}+AND+cat:${options.category}`;
        } else {
            searchQuery = `all:${searchQuery}`;
        }

        // Determine sort order
        const sortBy = options?.sortBy ?? "relevance";
        const sortOrder = sortBy === "relevance" ? "relevance" : 
                          sortBy === "lastUpdatedDate" ? "lastUpdatedDate" : "submittedDate";

        const arxivUrl = `https://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=${sortOrder}&sortOrder=descending`;

        console.log(`📚 [arXiv] Searching: ${arxivUrl}`);

        const response = await fetch(arxivUrl, {
            headers: {
                "User-Agent": "Launchstack-Research/1.0 (Document Generator)",
            },
        });

        if (!response.ok) {
            console.error(`❌ [arXiv] API error: ${response.status}`);
            return [];
        }

        const xmlText = await response.text();
        
        // Parse the Atom XML response
        const results = parseArxivXml(xmlText);
        
        console.log(`✅ [arXiv] Found ${results.length} papers`);
        return results;

    } catch (error) {
        console.error("❌ [arXiv] Search error:", error);
        return [];
    }
}

/**
 * Parse arXiv Atom XML response
 */
function parseArxivXml(xml: string): ArxivResult[] {
    const results: ArxivResult[] = [];
    
    // Extract entries using regex (simpler than full XML parsing)
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let entryMatch;
    let index = 0;

    while ((entryMatch = entryRegex.exec(xml)) !== null) {
        const entry = entryMatch[1];
        if (!entry) continue;

        // Extract fields
        const id = extractXmlValue(entry, "id") ?? "";
        const title = extractXmlValue(entry, "title")?.replace(/\s+/g, " ").trim() ?? "";
        const summary = extractXmlValue(entry, "summary")?.replace(/\s+/g, " ").trim() ?? "";
        const published = extractXmlValue(entry, "published") ?? "";
        const updated = extractXmlValue(entry, "updated") ?? "";

        // Extract arXiv ID from the URL
        const arxivIdRegex = /abs\/(.+?)(?:v\d+)?$/;
        const arxivIdMatch = arxivIdRegex.exec(id);
        const arxivId = arxivIdMatch?.[1] ?? "";

        // Extract authors
        const authors: string[] = [];
        const authorRegex = /<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g;
        let authorMatch;
        while ((authorMatch = authorRegex.exec(entry)) !== null) {
            if (authorMatch[1]) {
                authors.push(authorMatch[1].trim());
            }
        }

        // Extract categories
        const categories: string[] = [];
        const categoryRegex = /<category[^>]*term="([^"]+)"/g;
        let categoryMatch;
        while ((categoryMatch = categoryRegex.exec(entry)) !== null) {
            if (categoryMatch[1]) {
                categories.push(categoryMatch[1]);
            }
        }

        // Extract PDF link
        const pdfRegex = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/;
        const pdfMatch = pdfRegex.exec(entry);
        const pdfUrl = pdfMatch?.[1] ?? id.replace("/abs/", "/pdf/") + ".pdf";

        if (title && summary) {
            results.push({
                id: `arxiv-${index}-${Date.now()}`,
                title,
                url: id,
                arxivId,
                authors,
                summary,
                published,
                updated,
                categories,
                pdfUrl,
                relevanceScore: Math.round((1 - index * 0.05) * 100) / 100, // Decay by position
                source: "arxiv",
            });
            index++;
        }
    }

    return results;
}

/**
 * Extract value from XML tag
 */
function extractXmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = regex.exec(xml);
    return match?.[1] ?? null;
}

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json() as unknown;
        const validation = ResearchSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { query, sources, options } = validation.data;
        const startTime = Date.now();
        const maxResults = options?.maxResults ?? 10;

        // Get user's company for document search
        const [requestingUser] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (!requestingUser) {
            return NextResponse.json(
                { success: false, message: "User not found" },
                { status: 404 }
            );
        }

        const results: ResearchResult[] = [];
        const searchPromises: Promise<void>[] = [];

        // Document search
        if (sources.includes("documents")) {
            const documentSearchPromise = (async () => {
                try {
                    const embeddings = getEmbeddings();
                    const companyId = Number(requestingUser.companyId);
                    
                    if (Number.isNaN(companyId)) {
                        console.warn("Invalid company ID for document search");
                        return;
                    }

                    const searchOptions: CompanySearchOptions = {
                        weights: [0.4, 0.6],
                        topK: Math.min(maxResults, 10),
                        companyId,
                    };

                    const searchResults: SearchResult[] = await companyEnsembleSearch(
                        query,
                        searchOptions,
                        embeddings
                    );

                    for (let i = 0; i < searchResults.length; i++) {
                        const result = searchResults[i];
                        if (!result) continue;
                        
                        const distance = Number(result.metadata?.distance ?? 0);
                        const metadata = result.metadata as unknown as Record<string, unknown> | undefined;
                        results.push({
                            id: `doc-${i}-${Date.now()}`,
                            content: result.pageContent,
                            page: metadata?.page as number | undefined,
                            documentTitle: metadata?.documentTitle as string | undefined,
                            documentId: metadata?.documentId as number | undefined,
                            relevanceScore: Math.round((1 - distance) * 100) / 100,
                            source: "document" as const,
                        });
                    }

                    console.log(`📚 [Research] Found ${searchResults.length} document results`);
                } catch (error) {
                    console.error("❌ [Research] Document search error:", error);
                }
            })();
            searchPromises.push(documentSearchPromise);
        }

        // Web search
        if (sources.includes("web")) {
            const webSearchPromise = (async () => {
                try {
                    // Adjust query based on search type
                    let adjustedQuery = query;
                    const searchType = options?.searchType ?? "general";
                    
                    if (searchType === "academic") {
                        adjustedQuery = `academic research: ${query}`;
                    } else if (searchType === "news") {
                        adjustedQuery = `latest news: ${query}`;
                    }

                    const webResults = await performTavilySearch(
                        adjustedQuery, 
                        Math.min(maxResults, 5)
                    );

                    for (let i = 0; i < webResults.length; i++) {
                        const result = webResults[i];
                        if (!result) continue;
                        
                        results.push({
                            id: `web-${i}-${Date.now()}`,
                            title: result.title,
                            url: result.url,
                            snippet: result.snippet,
                            relevanceScore: Math.round((1 - i * 0.1) * 100) / 100, // Decay by position
                            source: "web" as const,
                        });
                    }

                    console.log(`🌐 [Research] Found ${webResults.length} web results`);
                } catch (error) {
                    console.error("❌ [Research] Web search error:", error);
                }
            })();
            searchPromises.push(webSearchPromise);
        }

        // arXiv search
        if (sources.includes("arxiv")) {
            const arxivSearchPromise = (async () => {
                try {
                    const arxivResults = await searchArxiv(
                        query,
                        Math.min(maxResults, 10),
                        {
                            category: options?.arxivCategory,
                            sortBy: options?.sortBy,
                        }
                    );

                    results.push(...arxivResults);
                    console.log(`📄 [Research] Found ${arxivResults.length} arXiv papers`);
                } catch (error) {
                    console.error("❌ [Research] arXiv search error:", error);
                }
            })();
            searchPromises.push(arxivSearchPromise);
        }

        // Wait for all searches to complete
        await Promise.all(searchPromises);

        // Sort results by relevance score
        results.sort((a, b) => (b.relevanceScore) - (a.relevanceScore));

        // Limit total results
        const limitedResults = results.slice(0, maxResults);

        const processingTimeMs = Date.now() - startTime;

        console.log(`✅ [Research] Completed in ${processingTimeMs}ms with ${limitedResults.length} total results`);

        return NextResponse.json({
            success: true,
            query,
            results: limitedResults,
            stats: {
                documentResults: limitedResults.filter(r => r.source === "document").length,
                webResults: limitedResults.filter(r => r.source === "web").length,
                arxivResults: limitedResults.filter(r => r.source === "arxiv").length,
                totalResults: limitedResults.length,
            },
            processingTimeMs,
        });

    } catch (error) {
        console.error("❌ [Research] Error:", error);
        return NextResponse.json(
            { 
                success: false, 
                message: "Failed to perform research",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}
