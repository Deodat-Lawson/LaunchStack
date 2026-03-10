/**
 * Document Generator - Grammar & Style Checking API
 * 
 * Actions:
 * - check: Check grammar and spelling
 * - improve_clarity: Improve readability and clarity
 * - adjust_formality: Adjust formality level
 * - consistency: Check for consistency issues
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getChatModel, normalizeModelContent } from "~/app/api/agents/documentQ&A/services";
import type { AIModelType } from "~/app/api/agents/documentQ&A/services";

export const runtime = "nodejs";
export const maxDuration = 60;

// Suggestion types
interface GrammarSuggestion {
    id: string;
    type: "grammar" | "spelling" | "punctuation" | "style" | "clarity" | "formality" | "consistency";
    severity: "error" | "warning" | "suggestion";
    original: string;
    suggestion: string;
    explanation: string;
    position?: {
        start: number;
        end: number;
    };
}

// Validation schema
const GrammarSchema = z.object({
    action: z.enum(["check", "improve_clarity", "adjust_formality", "consistency"]),
    content: z.string().min(1).max(50000),
    options: z.object({
        formalityLevel: z.enum(["very_formal", "formal", "neutral", "casual", "very_casual"]).optional(),
        focus: z.array(z.enum(["grammar", "spelling", "punctuation", "style", "clarity"])).optional(),
        model: z.string().optional(),
    }).optional(),
});

const GRAMMAR_CHECK_PROMPT = `You are an expert editor specializing in grammar, spelling, and punctuation. Analyze the text and identify all issues.

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
    "suggestions": [
        {
            "id": "1",
            "type": "grammar|spelling|punctuation|style|clarity",
            "severity": "error|warning|suggestion",
            "original": "the problematic text",
            "suggestion": "the corrected text",
            "explanation": "Brief explanation of the issue"
        }
    ],
    "overallScore": 85,
    "summary": "Brief summary of the text quality"
}

Focus on:
- Grammar errors (subject-verb agreement, tense consistency, etc.)
- Spelling mistakes
- Punctuation issues
- Style problems
- Clarity issues

Be thorough but practical. Only flag genuine issues.`;

const CLARITY_PROMPT = `You are an expert editor specializing in readability and clarity. Analyze the text and suggest improvements for clearer communication.

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
    "suggestions": [
        {
            "id": "1",
            "type": "clarity",
            "severity": "warning|suggestion",
            "original": "the unclear text",
            "suggestion": "clearer alternative",
            "explanation": "Why this is clearer"
        }
    ],
    "readabilityScore": 75,
    "avgSentenceLength": 18,
    "summary": "Brief summary of clarity issues"
}

Focus on:
- Overly complex sentences
- Passive voice overuse
- Unclear antecedents
- Jargon and unnecessarily complex vocabulary
- Wordy phrases that can be simplified
- Ambiguous statements`;

const FORMALITY_PROMPT = `You are an expert editor specializing in tone and formality adjustment. Analyze the text and suggest changes to match the target formality level.

Target formality level: {{FORMALITY_LEVEL}}

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
    "suggestions": [
        {
            "id": "1",
            "type": "formality",
            "severity": "suggestion",
            "original": "the text with wrong formality",
            "suggestion": "appropriately formal version",
            "explanation": "Why this change adjusts formality"
        }
    ],
    "currentFormality": "neutral",
    "targetFormality": "formal",
    "summary": "Brief summary of formality adjustments needed"
}

Formality indicators:
- Very Formal: Academic language, passive voice, no contractions, full phrases
- Formal: Professional language, limited contractions, complete sentences
- Neutral: Clear professional language, some personality allowed
- Casual: Conversational, contractions okay, shorter sentences
- Very Casual: Friendly, informal, personal tone`;

const CONSISTENCY_PROMPT = `You are an expert editor specializing in document consistency. Analyze the text for consistency issues.

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
    "suggestions": [
        {
            "id": "1",
            "type": "consistency",
            "severity": "warning",
            "original": "the inconsistent usage",
            "suggestion": "consistent version",
            "explanation": "What inconsistency this fixes"
        }
    ],
    "issues": {
        "terminology": ["term1 vs term2"],
        "formatting": ["issue description"],
        "tone": ["tone shift description"]
    },
    "summary": "Brief summary of consistency issues"
}

Check for:
- Inconsistent terminology (using different terms for the same thing)
- Inconsistent capitalization
- Inconsistent formatting (headers, lists, etc.)
- Tone shifts within the document
- Inconsistent number formatting (1 vs one)
- Date/time format inconsistencies`;

function parseGrammarResponse(content: string): { suggestions: GrammarSuggestion[]; extras?: Record<string, unknown> } {
    try {
        const jsonRegex = /\{[\s\S]*\}/;
        const jsonMatch = jsonRegex.exec(content);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { suggestions?: Array<{ id?: string | number; type?: string; severity?: string; original?: string; suggestion?: string; explanation?: string }>; [key: string]: unknown };
            return {
                suggestions: (parsed.suggestions ?? []).map((s, index: number) => ({
                    id: String(s.id ?? String(index + 1)),
                    type: (s.type as GrammarSuggestion["type"]) ?? "grammar",
                    severity: (s.severity as GrammarSuggestion["severity"]) ?? "suggestion",
                    original: s.original ?? "",
                    suggestion: s.suggestion ?? "",
                    explanation: s.explanation ?? "",
                })),
                extras: parsed,
            };
        }
    } catch {
        console.warn("Failed to parse grammar JSON response");
    }

    return { suggestions: [] };
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
        const validation = GrammarSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { action, content, options } = validation.data;
        const startTime = Date.now();

        // Get the AI model
        const modelId = (options?.model ?? "gpt-4o") as AIModelType;
        const chat = getChatModel(modelId);

        let systemPrompt: string;
        let userPrompt = `Analyze the following text:\n\n"${content}"`;

        switch (action) {
            case "check":
                systemPrompt = GRAMMAR_CHECK_PROMPT;
                if (options?.focus && options.focus.length > 0) {
                    userPrompt += `\n\nFocus especially on: ${options.focus.join(", ")}`;
                }
                break;

            case "improve_clarity":
                systemPrompt = CLARITY_PROMPT;
                break;

            case "adjust_formality":
                const formalityLevel = options?.formalityLevel ?? "formal";
                systemPrompt = FORMALITY_PROMPT.replace("{{FORMALITY_LEVEL}}", formalityLevel.replace("_", " "));
                userPrompt += `\n\nAdjust to: ${formalityLevel.replace("_", " ")} tone`;
                break;

            case "consistency":
                systemPrompt = CONSISTENCY_PROMPT;
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
        const { suggestions, extras } = parseGrammarResponse(responseContent);
        const processingTimeMs = Date.now() - startTime;

        console.log(`✅ [Grammar] ${action} completed in ${processingTimeMs}ms with ${suggestions.length} suggestions`);

        return NextResponse.json({
            success: true,
            action,
            suggestions,
            stats: {
                total: suggestions.length,
                errors: suggestions.filter(s => s.severity === "error").length,
                warnings: suggestions.filter(s => s.severity === "warning").length,
                suggestions: suggestions.filter(s => s.severity === "suggestion").length,
            },
            ...(extras?.overallScore !== undefined ? { overallScore: extras.overallScore } : {}),
            ...(extras?.readabilityScore !== undefined ? { readabilityScore: extras.readabilityScore } : {}),
            ...(extras?.summary ? { summary: extras.summary } : {}),
            ...(extras?.issues ? { issues: extras.issues } : {}),
            processingTimeMs,
            model: modelId,
        });

    } catch (error) {
        console.error("❌ [Grammar] Error:", error);
        return NextResponse.json(
            { 
                success: false, 
                message: "Failed to check grammar",
                error: error instanceof Error ? error.message : "Unknown error"
            },
            { status: 500 }
        );
    }
}
