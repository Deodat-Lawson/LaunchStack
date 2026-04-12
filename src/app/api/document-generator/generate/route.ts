/**
 * Document Generator - AI Content Generation API
 * 
 * Actions:
 * - generate_section: Generate a new section based on topic
 * - expand: Expand selected text with more detail
 * - rewrite: Rewrite selected text with different style/tone
 * - summarize: Summarize selected text
 * - change_tone: Adjust tone of selected text
 * - continue: Continue writing from current position
 */

import { NextResponse } from "next/server";
import { auth } from "~/lib/auth-server";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getChatModel, normalizeModelContent } from "~/app/api/agents/documentQ&A/services";

/** Strip wrapper quotes from rewrite output for fluid in-place insertion. */
function stripRewriteQuotes(text: string): string {
    let s = text.trim();
    const quotePairs: [string, string][] = [['"', '"'], ['"', '"'], ["'", "'"], ["'", "'"]];
    for (const [open, close] of quotePairs) {
        if (open && close && s.length >= open.length + close.length && s.startsWith(open) && s.endsWith(close)) {
            s = s.slice(open.length, -close.length).trim();
            break;
        }
    }
    return s;
}
import type { AIModelType } from "~/app/api/agents/documentQ&A/services";

export const runtime = "nodejs";
export const maxDuration = 60;

// Action types
type GenerateAction = 
    | "generate_section"
    | "expand"
    | "rewrite"
    | "summarize"
    | "change_tone"
    | "continue";

// Validation schema
const GenerateSchema = z.object({
    action: z.enum(["generate_section", "expand", "rewrite", "summarize", "change_tone", "continue"]),
    content: z.string().optional(), // Selected text or current content
    prompt: z.string().optional(), // User's instruction
    context: z.object({
        documentTitle: z.string().optional(),
        documentDescription: z.string().optional(),
        fullContent: z.string().optional(), // Full document for context
        cursorPosition: z.number().optional(),
    }).optional(),
    options: z.object({
        tone: z.enum(["professional", "casual", "formal", "technical", "creative", "persuasive"]).optional(),
        length: z.enum(["brief", "medium", "detailed", "comprehensive"]).optional(),
        audience: z.enum(["general", "technical", "executives", "students", "customers", "team"]).optional(),
        model: z.string().optional(),
    }).optional(),
});

// System prompts for different actions
const ACTION_PROMPTS: Record<GenerateAction, string> = {
    generate_section: `You are an expert document writer. Your task is to generate a well-structured section for a document.

Guidelines:
- Write clear, professional content
- Use appropriate headings and subheadings (in Markdown format)
- Include relevant details and examples where appropriate
- Maintain consistency with the document's tone and style
- Use bullet points or numbered lists when listing items
- Keep the content focused and relevant to the topic`,

    expand: `You are an expert editor specializing in expanding content. Your task is to expand the given text with more detail, context, and depth.

Guidelines:
- Maintain the original meaning and intent
- Add relevant examples, explanations, or supporting details
- Keep the same tone and style as the original
- Expand to approximately 2-3x the original length
- Do NOT add headers or change the structure, just enrich the content`,

    rewrite: `You are an expert editor specializing in rewriting content. Your task is to rewrite the given text to improve clarity, flow, and impact.

Guidelines:
- Preserve the core meaning and key points
- Improve sentence structure and word choice
- Enhance readability and engagement
- Apply the requested tone if specified
- Keep similar length to the original unless otherwise specified
- Output ONLY the rewritten text: no quotation marks, no "Here is the rewrite:", no wrapper text
- Use Markdown for formatting: **bold**, *italic*, __underline__. Do NOT use raw HTML tags.`,

    summarize: `You are an expert editor specializing in summarization. Your task is to create a concise summary of the given text.

Guidelines:
- Capture the key points and main ideas
- Reduce to approximately 25-30% of the original length
- Maintain accuracy and avoid adding new information
- Use clear, direct language
- Preserve the most important details`,

    change_tone: `You are an expert editor specializing in tone adjustment. Your task is to rewrite the text in the specified tone while preserving the content.

Guidelines:
- Maintain all factual information
- Adjust vocabulary, sentence structure, and style to match the target tone
- Keep similar length to the original
- Ensure the content remains appropriate for the audience`,

    continue: `You are an expert document writer. Your task is to continue writing from where the current content ends.

Guidelines:
- Maintain consistency with the existing content's style and tone
- Follow the logical flow of ideas
- Add value with new relevant information
- Use appropriate formatting (headers, lists) if needed
- Write approximately 150-300 words unless otherwise specified`,
};

// Tone descriptions for change_tone action
const TONE_DESCRIPTIONS: Record<string, string> = {
    professional: "Business-appropriate, clear, and respectful. Uses formal language without being stiff.",
    casual: "Friendly, approachable, and conversational. Uses everyday language and a relaxed style.",
    formal: "Academic or official in nature. Uses precise language, proper grammar, and avoids colloquialisms.",
    technical: "Precise, detailed, and terminology-rich. Appropriate for expert audiences.",
    creative: "Engaging, imaginative, and expressive. Uses vivid language and varied sentence structures.",
    persuasive: "Compelling and convincing. Uses rhetorical techniques to influence the reader.",
};

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        let body: unknown;
        try {
            body = (await request.json()) as unknown;
        } catch {
            return NextResponse.json(
                { success: false, message: "Invalid JSON body", error: "Request body must be valid JSON" },
                { status: 400 },
            );
        }
        const validation = GenerateSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { action, content, prompt, context, options } = validation.data;
        const startTime = Date.now();

        // Get the AI model (gpt-4o is widely available; gpt-5-mini may require newer API access)
        const modelId = (options?.model ?? "gpt-4o") as AIModelType;
        const chat = getChatModel(modelId);

        // Build the system prompt
        let systemPrompt = ACTION_PROMPTS[action];

        // Add tone context for change_tone action
        if (action === "change_tone" && options?.tone) {
            systemPrompt += `\n\nTarget tone: ${options.tone.toUpperCase()}\n${TONE_DESCRIPTIONS[options.tone] ?? ""}`;
        }

        // Add audience context if specified
        if (options?.audience) {
            systemPrompt += `\n\nTarget audience: ${options.audience}. Adjust vocabulary and complexity accordingly.`;
        }

        // Add length guidance if specified
        if (options?.length) {
            const lengthGuide: Record<string, string> = {
                brief: "Keep the response concise, around 50-100 words.",
                medium: "Aim for a moderate length, around 150-250 words.",
                detailed: "Provide detailed content, around 300-500 words.",
                comprehensive: "Be thorough and comprehensive, 500+ words as needed.",
            };
            systemPrompt += `\n\n${lengthGuide[options.length]}`;
        }

        // Build the user prompt based on action
        let userPrompt = "";

        switch (action) {
            case "generate_section":
                userPrompt = `Generate a section about: ${prompt ?? "the topic"}`;
                if (context?.documentTitle) {
                    userPrompt += `\n\nThis is for a document titled: "${context.documentTitle}"`;
                }
                if (context?.documentDescription) {
                    userPrompt += `\n\nDocument description: ${context.documentDescription}`;
                }
                if (context?.fullContent) {
                    userPrompt += `\n\nExisting document content for context:\n${context.fullContent.slice(0, 2000)}...`;
                }
                break;

            case "expand":
                userPrompt = `Expand the following text:\n\n"${content}"`;
                if (prompt) {
                    userPrompt += `\n\nAdditional instructions: ${prompt}`;
                }
                break;

            case "rewrite":
                userPrompt = `Rewrite the following text:\n\n"${content}"`;
                if (prompt) {
                    userPrompt += `\n\nAdditional instructions: ${prompt}`;
                }

                // Writing first pass
                const firstPass = await chat.call([
                    new SystemMessage(systemPrompt),
                    new HumanMessage(userPrompt),
                ]);
                
                // Normalizing
                const firstDraft = normalizeModelContent(firstPass.content);

                // Refining through second pass
                const refinementInstructions = [
                    "Improve sentence flow and rhythm",
                    "Remove any redundancy or filler phrases",
                    "Ensure it reads naturally, not like it was AI-generated",
                    "Preserve all factual information, names, numbers, and technical terms",
                    prompt
                        ? "IMPORTANT: The user requested specific additions or changes. Make sure these are fully incorporated and prioritized: " + prompt
                        : "Do not change the meaning or add new information beyond what was requested",
                    "Output ONLY the refined text: no quotation marks, no wrapper phrases",
                ].join("\n- ");

                const secondPass = await chat.call([
                    new SystemMessage(systemPrompt),
                    new HumanMessage(`Here is a rewritten version of the original text:

"${firstDraft}"

Now refine it further:
- ${refinementInstructions}`),
                ]);

                // Use the refined second pass for rewrite (skip the generic call below)
                const rewriteContent = stripRewriteQuotes(normalizeModelContent(secondPass.content));
                const rewriteProcessingTimeMs = Date.now() - startTime;
                return NextResponse.json({
                    success: true,
                    action: "rewrite",
                    generatedContent: rewriteContent,
                    processingTimeMs: rewriteProcessingTimeMs,
                    model: modelId,
                });

            case "summarize":
                userPrompt = `Summarize the following text:\n\n"${content}"`;
                if (prompt) {
                    userPrompt += `\n\nFocus on: ${prompt}`;
                }
                break;

            case "change_tone":
                userPrompt = `Change the tone of the following text to ${options?.tone ?? "professional"}:\n\n"${content}"`;
                break;

            case "continue":
                userPrompt = `Continue writing from where this content ends:\n\n"${content?.slice(-1500)}"`;
                if (prompt) {
                    userPrompt += `\n\nContinue with: ${prompt}`;
                }
                if (context?.documentTitle) {
                    userPrompt += `\n\nDocument title: "${context.documentTitle}"`;
                }
                break;
        }

        // Call the AI model
        const response = await chat.call([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ]);

        const generatedContent = normalizeModelContent(response.content);
        const processingTimeMs = Date.now() - startTime;

        return NextResponse.json({
            success: true,
            action,
            generatedContent,
            processingTimeMs,
            model: modelId,
        });

    } catch (error) {
        console.error("[document-generator/generate] error:", error);
        return NextResponse.json(
            {
                success: false,
                message: "Failed to generate content",
            },
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
}
