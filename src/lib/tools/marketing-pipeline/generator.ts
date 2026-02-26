import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { MarketingPlatform, MarketingResearchResult } from "~/lib/tools/marketing-pipeline/types";
import { MarketingPipelineOutputSchema } from "~/lib/tools/marketing-pipeline/types";

const SYSTEM_PROMPT = `You are a marketing campaign copywriter.

You create a platform-ready campaign message using:
- User prompt
- Company knowledge-base context
- A "Platform best practices" section appended to that context

Rules:
1. Return JSON that matches the schema exactly.
2. Keep message concise and practical for posting.
3. Adapt message style and structure to the selected platform.
4. Respect any "Platform best practices" text inside the provided context.
5. Do not invent product claims not supported by the provided context.
6. Select "image" when visual storytelling fits best, otherwise choose "video" for demos/explainers.`;

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

