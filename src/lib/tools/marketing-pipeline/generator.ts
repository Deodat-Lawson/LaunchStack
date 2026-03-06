import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type {
  MarketingPlatform,
  MarketingResearchResult,
  MessagingStrategy,
} from "~/lib/tools/marketing-pipeline/types";
import { MarketingPipelineOutputSchema } from "~/lib/tools/marketing-pipeline/types";

const SYSTEM_PROMPT_BASE = `You are a marketing campaign copywriter for B2B products.

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

const STRATEGY_RULES = `
When a Messaging Strategy is provided:
- Lead with the recommended angle and human hook when it fits the platform; balance human story with technical depth.
- Back claims with the key proof points given; do not add proof not in company context.
- Do NOT use any phrase or theme in the strategy's avoid list.
- Keep the post aligned with the positioning angle while staying platform-native.`;

function platformTemplate(platform: MarketingPlatform): string {
switch (platform) {
    case "x":
        return [
            "Format requirements for X:",
            "- 1 strong hook line first.",
            "- 1–2 tight value lines (high signal).",
            "- Optional: 1 clear CTA line.",
            "- 0–2 relevant hashtags max (no spam).",
            "- Keep it concise (aim ~280 chars; stay tight).",
        ].join("\n");
    case "linkedin":
        return [
            "Format requirements for LinkedIn:",
            "- First line: clear insight/outcome (scroll-stopper).",
            "- 3–6 short lines or bullets for easy scanning.",
            "- Frame around business impact (time saved, clarity, reduced risk).",
            "- End with a thoughtful question OR a soft CTA for professionals.",
            "- Avoid sounding like an ad; write like an operator sharing a playbook.",
        ].join("\n");
    case "reddit":
        return [
            "Format requirements for Reddit:",
            "- Speak like a real person, not a brand account.",
            "- Lead with a specific pain point + what you learned.",
            "- Give value (steps, checklist, insight).",
            "- Minimal self-promo; no aggressive CTA.",
            "- End with an honest question to invite discussion.",
        ].join("\n");
    default:
        return "Write a clear, platform-appropriate post.";
}
}

// helper to convert MarketingResearchResult[] into a compact text block
function formatTrendReferences(research: MarketingResearchResult[]): string {
if (!research.length) return "None available.";

return research
    .slice(0, 6)
    .map((r, i) => {
        const title = (r.title ?? "Untitled").trim().slice(0, 140);
        const snippet = (r.snippet ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 260);
        const url = (r.url ?? "").trim();
        return `${i + 1}) ${title}\n   ${snippet}${url ? `\n   ${url}` : ""}`;
    })
    .join("\n");
}


function formatStrategyBlock(strategy: MessagingStrategy): string {
  return [
    `Positioning angle: ${strategy.angle}`,
    `Key proof: ${strategy.keyProof.join("; ")}`,
    `Human hook: ${strategy.humanHook}`,
    `Avoid: ${strategy.avoidList.join("; ")}`,
  ].join("\n");
}

function buildPrompt(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
}): string {
  const parts = [
    `Selected platform: ${args.platform}`,
    `User prompt: ${args.prompt}`,
    "",
    "Company context (source of truth):",
    args.companyContext,
    "",
    "Trend references (optional angles, do not quote, do not claim facts from them):",
    formatTrendReferences(args.research),
  ];
  if (args.strategy) {
    parts.push("", "Messaging strategy (use this angle and proof; respect avoid list):", formatStrategyBlock(args.strategy));
  }
  parts.push(
    "",
    platformTemplate(args.platform),
    "",
    "Task:",
    args.strategy
      ? "- Write ONE post using the messaging strategy angle and proof; respect the avoid list."
      : "- Pick ONE angle (either from trend references or company context).",
    "- Write ONE post that fits the platform format above.",
    "- Do NOT add facts not supported by company context.",
    "- Return JSON only matching the schema.",
  );
  return parts.join("\n");
}

export async function generateCampaignOutput(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
}): Promise<{
  platform: MarketingPlatform;
  message: string;
  "image/video": "image" | "video";
  competitiveAngle?: string;
  strategyUsed?: MessagingStrategy;
}> {
  const systemPrompt = args.strategy
    ? SYSTEM_PROMPT_BASE + STRATEGY_RULES
    : SYSTEM_PROMPT_BASE;

  const chat = getChatModel(MARKETING_MODELS.contentGeneration);
  const model = chat.withStructuredOutput(MarketingPipelineOutputSchema, {
    name: "marketing_pipeline_output",
  });

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(buildPrompt(args)),
  ]);

  const parsed = MarketingPipelineOutputSchema.parse(response);
  const out: {
    platform: MarketingPlatform;
    message: string;
    "image/video": "image" | "video";
    competitiveAngle?: string;
    strategyUsed?: MessagingStrategy;
  } = { ...parsed };
  if (args.strategy) {
    out.competitiveAngle = args.strategy.angle;
    out.strategyUsed = args.strategy;
  }
  return out;
}

