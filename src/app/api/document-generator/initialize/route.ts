/**
 * Document Generator - Initialize Document with Research API
 * 
 * Generates initial document content with AI, automatically integrating
 * research from arXiv (for research papers) and other sources.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getChatModel, normalizeModelContent } from "~/app/api/agents/documentQ&A/services";
import type { AIModelType } from "~/app/api/agents/documentQ&A/services";

export const runtime = "nodejs";
export const maxDuration = 120; // Allow more time for research + generation

// Validation schema
const InitializeSchema = z.object({
    templateId: z.string(),
    title: z.string().min(1).max(500),
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    options: z.object({
        tone: z.enum(["professional", "casual", "formal", "technical", "creative", "persuasive"]).optional(),
        length: z.enum(["brief", "medium", "detailed", "comprehensive"]).optional(),
        audience: z.enum(["general", "technical", "executives", "students", "customers", "team"]).optional(),
        includeResearch: z.boolean().optional(),
        arxivCategory: z.string().optional(),
    }).optional(),
});

// arXiv result type
interface ArxivPaper {
    title: string;
    authors: string[];
    summary: string;
    arxivId: string;
    url: string;
    published: string;
    categories: string[];
}

// Citation type
interface Citation {
    id: string;
    sourceType: "arxiv" | "website" | "document" | "book" | "journal";
    title: string;
    authors?: string[];
    url?: string;
    year?: string;
    arxivId?: string;
    accessDate?: string;
}

/**
 * Search arXiv papers
 */
async function searchArxiv(query: string, maxResults = 5, category?: string): Promise<ArxivPaper[]> {
    try {
        let searchQuery = encodeURIComponent(query);
        if (category) {
            searchQuery = `all:${searchQuery}+AND+cat:${category}`;
        } else {
            searchQuery = `all:${searchQuery}`;
        }

        const arxivUrl = `https://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

        console.log(`📚 [Initialize] Searching arXiv: ${query}`);

        const response = await fetch(arxivUrl, {
            headers: { "User-Agent": "PDR-AI-Research/1.0" },
        });

        if (!response.ok) {
            console.error(`❌ [Initialize] arXiv API error: ${response.status}`);
            return [];
        }

        const xmlText = await response.text();
        return parseArxivXml(xmlText);
    } catch (error) {
        console.error("❌ [Initialize] arXiv search error:", error);
        return [];
    }
}

/**
 * Parse arXiv XML response
 */
function parseArxivXml(xml: string): ArxivPaper[] {
    const results: ArxivPaper[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let entryMatch;

    while ((entryMatch = entryRegex.exec(xml)) !== null) {
        const entry = entryMatch[1];
        if (!entry) continue;

        const id = extractXmlValue(entry, "id") ?? "";
        const title = extractXmlValue(entry, "title")?.replace(/\s+/g, " ").trim() ?? "";
        const summary = extractXmlValue(entry, "summary")?.replace(/\s+/g, " ").trim() ?? "";
        const published = extractXmlValue(entry, "published") ?? "";

        const arxivIdRegex = /abs\/(.+?)(?:v\d+)?$/;
        const arxivIdMatch = arxivIdRegex.exec(id);
        const arxivId = arxivIdMatch?.[1] ?? "";

        const authors: string[] = [];
        const authorRegex = /<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g;
        let authorMatch;
        while ((authorMatch = authorRegex.exec(entry)) !== null) {
            if (authorMatch[1]) authors.push(authorMatch[1].trim());
        }

        const categories: string[] = [];
        const categoryRegex = /<category[^>]*term="([^"]+)"/g;
        let categoryMatch;
        while ((categoryMatch = categoryRegex.exec(entry)) !== null) {
            if (categoryMatch[1]) categories.push(categoryMatch[1]);
        }

        if (title && summary) {
            results.push({ title, authors, summary, arxivId, url: id, published, categories });
        }
    }

    return results;
}

function extractXmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = xml.match(regex);
    return match?.[1] ?? null;
}

/**
 * Build citations from arXiv papers
 */
function buildCitations(papers: ArxivPaper[]): Citation[] {
    return papers.map((paper, index) => ({
        id: `arxiv-${index + 1}`,
        sourceType: "arxiv" as const,
        title: paper.title,
        authors: paper.authors,
        url: paper.url,
        year: paper.published ? new Date(paper.published).getFullYear().toString() : undefined,
        arxivId: paper.arxivId,
        accessDate: new Date().toISOString().split("T")[0],
    }));
}

/**
 * Get template-specific system prompts
 */
function getTemplateSystemPrompt(templateId: string): string {
    const prompts: Record<string, string> = {
        research: `You are an expert academic writer creating a research paper. You MUST:
- Write actual substantive content, NOT placeholder text like "Write your abstract here..."
- Use the provided research papers to inform and support your writing
- Include proper in-text citations in the format [1], [2], etc.
- Write in formal academic style
- Create well-reasoned arguments supported by evidence
- Structure the paper logically with clear sections`,

        report: `You are an expert business analyst creating a professional report. You MUST:
- Write actual substantive content, NOT placeholder text
- Include real analysis and insights
- Use data and evidence to support findings
- Write in clear, professional business language
- Provide actionable recommendations`,

        whitepaper: `You are an expert thought leader creating a whitepaper. You MUST:
- Write actual substantive content, NOT placeholder text
- Present innovative ideas and solutions
- Include research and evidence to support claims
- Write in authoritative but accessible language
- Provide clear value propositions`,

        proposal: `You are an expert proposal writer. You MUST:
- Write actual substantive content, NOT placeholder text
- Clearly articulate objectives and methodology
- Provide realistic timelines and deliverables
- Write persuasively while being factual
- Address potential concerns proactively`,

        technical: `You are an expert technical writer. You MUST:
- Write actual substantive content, NOT placeholder text
- Explain complex concepts clearly
- Include relevant technical details
- Use appropriate terminology for the audience
- Provide practical examples and code samples where relevant`,

        default: `You are an expert document writer. You MUST:
- Write actual substantive content, NOT placeholder text like "Write here..."
- Create engaging, well-structured content
- Use appropriate tone and language for the document type
- Include relevant details and examples`,
    };

    return prompts[templateId] ?? prompts.default ?? "";
}

/**
 * Get template-specific structure
 */
function getTemplateStructure(templateId: string): string {
    const structures: Record<string, string> = {
        research: `Structure the research paper with these sections:
1. Abstract (150-250 words summarizing the entire paper)
2. Introduction (establish context, state the problem, outline approach)
3. Literature Review (synthesize relevant research from the provided papers)
4. Methodology (describe approach and methods)
5. Results/Findings (present key findings)
6. Discussion (interpret results, compare with existing research)
7. Conclusion (summarize contributions and implications)
8. References (will be added from citations)`,

        report: `Structure the report with these sections:
1. Executive Summary
2. Background/Context
3. Analysis
4. Key Findings
5. Recommendations
6. Conclusion
7. Appendix (if needed)`,

        whitepaper: `Structure the whitepaper with these sections:
1. Executive Summary
2. The Challenge/Problem
3. The Solution
4. Key Benefits
5. How It Works
6. Case Studies/Evidence
7. Implementation Guide
8. Conclusion`,

        proposal: `Structure the proposal with these sections:
1. Executive Summary
2. Project Overview
3. Objectives
4. Scope of Work
5. Methodology
6. Timeline
7. Budget
8. Expected Outcomes
9. About Us/Qualifications`,

        default: `Create a well-organized document with:
1. Introduction
2. Main content sections (3-5 sections as appropriate)
3. Conclusion`,
    };

    return structures[templateId] ?? structures.default ?? "";
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
        const validation = InitializeSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { templateId, title, description, keywords, options } = validation.data;
        const startTime = Date.now();
        
        // Determine if we should include research
        const includeResearch = options?.includeResearch ??
            ["research", "whitepaper", "technical"].includes(templateId);

        let arxivPapers: ArxivPaper[] = [];
        let citations: Citation[] = [];

        // Fetch research from arXiv for research-oriented templates
        if (includeResearch) {
            const searchQuery = keywords?.join(" ") ?? description ?? title;
            arxivPapers = await searchArxiv(
                searchQuery, 
                5, 
                options?.arxivCategory
            );
            citations = buildCitations(arxivPapers);
            console.log(`📚 [Initialize] Found ${arxivPapers.length} arXiv papers`);
        }

        // Get the AI model
        const modelId = "gpt-4o" as AIModelType;
        const chat = getChatModel(modelId);

        // Build system prompt
        let systemPrompt = getTemplateSystemPrompt(templateId);
        systemPrompt += `\n\n${getTemplateStructure(templateId)}`;

        // Add tone and audience guidance
        if (options?.tone) {
            systemPrompt += `\n\nWrite in a ${options.tone} tone.`;
        }
        if (options?.audience) {
            systemPrompt += `\n\nTarget audience: ${options.audience}. Adjust complexity accordingly.`;
        }
        if (options?.length) {
            const lengthGuide: Record<string, string> = {
                brief: "Keep the document concise, around 500-800 words total.",
                medium: "Aim for a moderate length, around 1000-1500 words total.",
                detailed: "Provide detailed content, around 2000-3000 words total.",
                comprehensive: "Be thorough and comprehensive, 3000+ words.",
            };
            systemPrompt += `\n\n${lengthGuide[options.length]}`;
        }

        // Build user prompt
        let userPrompt = `Create a ${templateId} document with the following details:

**Title:** ${title}`;

        if (description) {
            userPrompt += `\n\n**Description/Topic:** ${description}`;
        }

        if (keywords && keywords.length > 0) {
            userPrompt += `\n\n**Keywords:** ${keywords.join(", ")}`;
        }

        // Include arXiv research in the prompt
        if (arxivPapers.length > 0) {
            userPrompt += `\n\n---\n\n**RESEARCH SOURCES TO INCORPORATE:**\n\nYou MUST incorporate insights from these research papers and cite them using [1], [2], etc.:\n`;
            
            arxivPapers.forEach((paper, index) => {
                userPrompt += `\n[${index + 1}] **${paper.title}**\n`;
                userPrompt += `Authors: ${paper.authors.slice(0, 3).join(", ")}${paper.authors.length > 3 ? " et al." : ""}\n`;
                userPrompt += `Summary: ${paper.summary.slice(0, 500)}...\n`;
                userPrompt += `arXiv ID: ${paper.arxivId}\n`;
            });

            userPrompt += `\n---\n\nNow write the complete document, incorporating insights from these papers with proper citations.`;
        } else {
            userPrompt += `\n\nNow write the complete document with substantive, well-researched content. Do NOT use placeholder text.`;
        }

        console.log(`🤖 [Initialize] Generating document content...`);

        // Call the AI model
        const response = await chat.call([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ]);

        let generatedContent = normalizeModelContent(response.content);

        // Add references section if we have citations
        if (citations.length > 0) {
            generatedContent += `\n\n## References\n\n`;
            citations.forEach((citation, index) => {
                const authors = citation.authors?.slice(0, 3).join(", ") ?? "Unknown";
                const year = citation.year ?? "n.d.";
                generatedContent += `[${index + 1}] ${authors}${citation.authors && citation.authors.length > 3 ? " et al." : ""}. (${year}). *${citation.title}*. arXiv:${citation.arxivId}. ${citation.url}\n\n`;
            });
        }

        const processingTimeMs = Date.now() - startTime;

        console.log(`✅ [Initialize] Document generated in ${processingTimeMs}ms with ${citations.length} citations`);

        return NextResponse.json({
            success: true,
            content: generatedContent,
            citations,
            researchPapers: arxivPapers.map(p => ({
                title: p.title,
                authors: p.authors,
                arxivId: p.arxivId,
                url: p.url,
            })),
            processingTimeMs,
        });

    } catch (error) {
        console.error("❌ [Initialize] Error:", error);
        return NextResponse.json(
            { 
                success: false, 
                message: "Failed to initialize document",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}
