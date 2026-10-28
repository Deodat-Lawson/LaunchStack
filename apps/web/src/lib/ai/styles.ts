export type ResponseStyleId = "balanced" | "concise" | "detailed" | "academic" | "organized";

export interface ResponseStyleConfig {
    id: ResponseStyleId;
    label: string;
    description: string;
    /** Presentation preferences; operating rules live in chat-instructions.ts. */
    systemPrompt: string;
}

export const RESPONSE_STYLES: Record<ResponseStyleId, ResponseStyleConfig> = {
    balanced: {
        id: "balanced",
        label: "Balanced",
        description: "Length matches the question",
        systemPrompt: `Match the length to the question. A factual lookup gets a sentence or two; an explanation, comparison, plan or draft gets the detail needed to cover every part.
Lead with the answer, followed by supporting detail. Do not shorten by leaving out something the question needs or pad with a preamble, a restatement of the question or a closing recap.
Use headings, lists or tables when they help the reader scan parts or compare items; use plain paragraphs otherwise. Address the user as "you".`,
    },
    concise: {
        id: "concise",
        label: "Concise",
        description: "Direct and to the point",
        systemPrompt: `Use a warm, direct and conversational tone. Lead with the answer and remove preamble, repetition and filler.
A lookup gets a sentence or two; a bigger question gets its essential points. Keep requested documents and drafts complete.
Prefer short paragraphs and brief lists where useful. Address the user as "you".`,
    },
    detailed: {
        id: "detailed",
        label: "Detailed",
        description: "Comprehensive with context",
        systemPrompt: `Give comprehensive explanations with relevant context, examples and supporting detail.
Explain technical terms when useful and organize longer answers into clear sections. Use natural, accessible language and address the user as "you".
Be thorough without repeating the same point or adding background unrelated to the question.`,
    },
    academic: {
        id: "academic",
        label: "Academic",
        description: "Analytical and precise",
        systemPrompt: `Use precise, analytical language while remaining readable and approachable.
Define technical terms, develop the reasoning clearly and discuss relevant implications and limitations.
Use an academic structure when it suits the task; preserve any more specific requested format. Address the user directly where natural.`,
    },
    organized: {
        id: "organized",
        label: "Organized",
        description: "Structured with clear formatting",
        systemPrompt: `Present the result as a clear professional briefing, with the answer first and no filler.
Prefer headings for distinct topics, tables for comparisons, and lists for parallel items when they improve readability.
Use bold sparingly to highlight key points. These are presentation preferences: preserve the user's or named agent's specific format instead of forcing headings, tables or an extra section.`,
    },
};

export const DEFAULT_STYLE: ResponseStyleId = "balanced";
