import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { MarketingPlatform, MarketingResearchResult } from "~/lib/tools/marketing-pipeline/types";
import { MarketingPipelineOutputSchema } from "~/lib/tools/marketing-pipeline/types";

const SYSTEM_PROMPT = `You are a marketing campaign copywriter for B2B products.

You create a platform-ready campaign message using:
- User prompt
- Company knowledge-base context as the source of truth
- trend references (optional, for angles only)
- A "Platform best practices" section appended to that context

Rules:
1. Return JSON that matches the schema exactly. No extra keys
2) Never invent product features, pricing, partnerships, customers, metrics, awards, or results.
   - If something isn't in company context, do NOT state it as fact.
   - You may phrase uncertain details as a question or general industry insight.
3) Use trend references only as inspiration/angles. Do NOT quote or attribute them.
4) Avoid hype and superlatives ("best", "revolutionary") unless directly supported by company context.
5) Keep it practical: concrete benefit > adjectives.
6) Pick "image" when a static visual would help (diagram, workflow, checklist).
   Pick "video" when a demo/explainer makes more sense.`;

function buildPrompt(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
}): string {
    return `Selected platform: ${args.platform}
User prompt: ${args.prompt}

Company context:
${args.companyContext}
Generate one campaign message and recommend whether an image or video is better.`;
}

export async function generateCampaignOutput(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
}) {
    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.3,
    });

    const model = chat.withStructuredOutput(MarketingPipelineOutputSchema, {
        name: "marketing_pipeline_output",
    });

    const response = await model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(buildPrompt(args)),
    ]);

    return MarketingPipelineOutputSchema.parse(response);
}

