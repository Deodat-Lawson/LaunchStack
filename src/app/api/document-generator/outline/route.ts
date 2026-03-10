/**
 * Document Generator - Outline Generation API
 * 
 * Actions:
 * - generate: Generate an outline from topic/description
 * - restructure: Suggest improvements to existing structure
 * - extract: Extract outline from existing content
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getChatModel, normalizeModelContent } from "~/app/api/agents/documentQ&A/services";
import type { AIModelType } from "~/app/api/agents/documentQ&A/services";

export const runtime = "nodejs";
export const maxDuration = 60;

// Outline item structure
interface OutlineItem {
    id: string;
    title: string;
    level: number;
    description?: string;
    children?: OutlineItem[];
}

// Validation schema
const OutlineSchema = z.object({
    action: z.enum(["generate", "restructure", "extract"]),
    topic: z.string().optional(),
    description: z.string().optional(),
    content: z.string().optional(), // Existing content for restructure/extract
    templateId: z.string().optional(),
    options: z.object({
        depth: z.number().min(1).max(4).optional(), // Max heading depth
        sections: z.number().min(2).max(20).optional(), // Target number of sections
        audience: z.string().optional(),
        tone: z.string().optional(),
        model: z.string().optional(),
    }).optional(),
});

const OUTLINE_SYSTEM_PROMPT = `You are an expert document structure architect. Your task is to create well-organized, logical document outlines.

Guidelines:
- Create clear, hierarchical structures
- Use descriptive section titles
- Ensure logical flow between sections
- Include brief descriptions for each section
- Consider the target audience and purpose

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
    "outline": [
        {
            "id": "1",
            "title": "Section Title",
            "level": 1,
            "description": "Brief description of what this section covers",
            "children": [
                {
                    "id": "1.1",
                    "title": "Subsection Title",
                    "level": 2,
                    "description": "Brief description"
                }
            ]
        }
    ],
    "summary": "Brief summary of the document structure"
}`;

const RESTRUCTURE_SYSTEM_PROMPT = `You are an expert document structure analyst. Your task is to analyze existing content and suggest structural improvements.

Guidelines:
- Identify logical groupings and relationships
- Suggest better section organization
- Recommend additional sections if needed
- Point out redundancies or gaps

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
    "currentStructure": [...outline items...],
    "suggestedStructure": [...improved outline items...],
    "improvements": [
        "Improvement 1",
        "Improvement 2"
    ],
    "gaps": ["Missing topic 1", "Missing topic 2"]
}`;

const EXTRACT_SYSTEM_PROMPT = `You are an expert document analyst. Your task is to extract the existing structure from document content.

Guidelines:
- Identify all headings and sections
- Preserve the hierarchical structure
- Extract key topics from each section

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
    "outline": [
        {
            "id": "1",
            "title": "Extracted Section Title",
            "level": 1,
            "description": "Summary of section content",
            "children": []
        }
    ],
    "wordCount": 1234,
    "sectionCount": 5
}`;

// Template-specific outline hints
const TEMPLATE_HINTS: Record<string, string> = {
    research: "Include: Abstract, Introduction, Literature Review, Methodology, Results, Discussion, Conclusion, References",
    report: "Include: Executive Summary, Background, Analysis, Findings, Recommendations, Conclusion",
    proposal: "Include: Overview, Objectives, Scope, Timeline, Budget, Expected Outcomes, Conclusion",
    technical: "Include: Overview, Architecture, Components, API Reference, Configuration, Troubleshooting",
    meeting: "Include: Agenda, Discussion Points, Decisions, Action Items, Next Steps",
    whitepaper: "Include: Executive Summary, Challenge, Solution, Benefits, Implementation, Case Studies, Conclusion",
    "case-study": "Include: Client Overview, Challenge, Solution, Implementation, Results, Testimonial, Lessons Learned",
    guide: "Include: Introduction, Prerequisites, Step-by-Step Instructions, Tips, Troubleshooting, Conclusion",
    policy: "Include: Purpose, Scope, Policy Statement, Responsibilities, Procedures, Compliance, Review",
    newsletter: "Include: Editor's Note, Highlights, Featured Story, Updates, Upcoming Events, Resources",
    sop: "Include: Purpose, Scope, Responsibilities, Procedure Steps, Safety, Quality Standards, Documentation",
};

function parseOutlineResponse(content: string): { outline: OutlineItem[]; extras?: Record<string, unknown> } {
    try {
        // Try to extract JSON from the response
        const jsonRegex = /\{[\s\S]*\}/;
        const jsonMatch = jsonRegex.exec(content);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { outline?: OutlineItem[]; suggestedStructure?: OutlineItem[]; [key: string]: unknown };
            return {
                outline: parsed.outline ?? parsed.suggestedStructure ?? [],
                extras: parsed,
            };
        }
    } catch {
        console.warn("Failed to parse outline JSON, creating fallback structure");
    }

    // Fallback: Parse markdown-style headings
    const lines = content.split('\n');
    const outline: OutlineItem[] = [];
    let idCounter = 0;
    const headingRegex = /^(#{1,4})\s+(.+)/;

    for (const line of lines) {
        const headingMatch = headingRegex.exec(line);
        if (headingMatch?.[1] && headingMatch[2]) {
            idCounter++;
            const level = headingMatch[1].length;
            outline.push({
                id: idCounter.toString(),
                title: headingMatch[2].trim(),
                level,
            });
        }
    }

    return { outline };
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
        const validation = OutlineSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { action, topic, description, content, templateId, options } = validation.data;
        const startTime = Date.now();

        // Get the AI model
        const modelId = (options?.model ?? "gpt-4o") as AIModelType;
        const chat = getChatModel(modelId);

        let systemPrompt: string;
        let userPrompt: string;

        switch (action) {
            case "generate":
                systemPrompt = OUTLINE_SYSTEM_PROMPT;
                userPrompt = `Create a document outline for: ${topic ?? "the document"}`;
                
                if (description) {
                    userPrompt += `\n\nDocument description: ${description}`;
                }
                
                if (templateId && templateId in TEMPLATE_HINTS) {
                    userPrompt += `\n\nTemplate type: ${templateId}\nSuggested sections to ${TEMPLATE_HINTS[templateId]}`;
                }
                
                if (options?.depth) {
                    userPrompt += `\n\nMaximum heading depth: ${options.depth} levels`;
                }
                
                if (options?.sections) {
                    userPrompt += `\n\nTarget approximately ${options.sections} main sections`;
                }
                
                if (options?.audience) {
                    userPrompt += `\n\nTarget audience: ${options.audience}`;
                }
                break;

            case "restructure":
                systemPrompt = RESTRUCTURE_SYSTEM_PROMPT;
                userPrompt = `Analyze and suggest improvements for this document structure:\n\n${content}`;
                
                if (topic) {
                    userPrompt += `\n\nDocument topic: ${topic}`;
                }
                break;

            case "extract":
                systemPrompt = EXTRACT_SYSTEM_PROMPT;
                userPrompt = `Extract the structure from this document:\n\n${content}`;
                break;

            default:
                return NextResponse.json(
                    { success: false, message: "Invalid action" },
                    { status: 400 }
                );
        }

        // Call the AI model
        const response = await chat.call([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ]);

        const responseContent = normalizeModelContent(response.content);
        const { outline, extras } = parseOutlineResponse(responseContent);
        const processingTimeMs = Date.now() - startTime;

        console.log(`✅ [Document Generator] Outline ${action} completed in ${processingTimeMs}ms`);

        return NextResponse.json({
            success: true,
            action,
            outline,
            ...(action === "restructure" && extras ? {
                currentStructure: extras.currentStructure,
                improvements: extras.improvements,
                gaps: extras.gaps,
            } : {}),
            ...(action === "extract" && extras ? {
                wordCount: extras.wordCount,
                sectionCount: extras.sectionCount,
            } : {}),
            summary: extras?.summary,
            processingTimeMs,
            model: modelId,
        });

    } catch (error) {
        console.error("❌ [Document Generator] Error generating outline:", error);
        return NextResponse.json(
            { 
                success: false, 
                message: "Failed to generate outline",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}
