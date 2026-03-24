import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type {
  CompanyDNA,
  CompetitorAnalysis,
  MessagingStrategy,
} from "~/lib/tools/marketing-pipeline/types";
import { MessagingStrategySchema } from "~/lib/tools/marketing-pipeline/types";

/**
 * Build a single MessagingStrategy from company DNA, competitor analysis, and optional trend summary.
 */
export async function buildMessagingStrategy(args: {
  dna: CompanyDNA;
  competitors: CompetitorAnalysis;
  trendsSummary?: string;
  userPrompt?: string;
}): Promise<MessagingStrategy> {
  const { dna, competitors, trendsSummary = "", userPrompt = "" } = args;

  const MAX_COMPETITORS = 3;
  const MAX_WEAKNESSES = 2;
  const MAX_TRENDS_CHARS = 800;

  const topCompetitors = competitors.competitors.slice(0, MAX_COMPETITORS);

  const contextParts: string[] = [
    "## Company DNA",
    `Mission: ${dna.coreMission}`,
    `Differentiators: ${dna.keyDifferentiators.join("; ")}`,
    `Proven results: ${dna.provenResults.join("; ")}`,
    `Human story: ${dna.humanStory}`,
    `Technical edge: ${dna.technicalEdge}`,
    "",
    "## Competitor landscape",
    ...topCompetitors.map(
      (c) =>
        `- ${c.name}: ${c.positioning}. Weaknesses: ${c.weaknesses.slice(0, MAX_WEAKNESSES).join(", ")}`,
    ),
    `Our advantages: ${competitors.ourAdvantages.join("; ")}`,
    `Market gaps: ${competitors.marketGaps.join("; ")}`,
    `Messaging to avoid: ${competitors.messagingAntiPatterns.join("; ")}`,
  ];
  if (trendsSummary.trim()) {
    const trimmed = trendsSummary.trim().slice(0, MAX_TRENDS_CHARS);
    contextParts.push("", "## Platform / trend context", trimmed);
  }
  if (userPrompt.trim()) {
    contextParts.push("", "## User request", userPrompt.trim());
  }

  const systemPrompt = `You are a messaging strategist. Given company DNA, competitor analysis, and optional trend context, produce a single MessagingStrategy.

Rules:
- angle: one clear positioning angle (1–2 sentences) that differentiates us from competitors and fits our DNA.
- keyProof: 2–4 concrete proof points (metrics, outcomes, differentiators) to support the angle.
- humanHook: one human story or emotional hook to open or close the message.
- avoidList: 3–5 phrases or themes we must avoid (clichés, competitor overlap, weak claims).

Use only information from the provided context. Return valid JSON matching the schema.`;

  const chat = getChatModel(MARKETING_MODELS.strategyBuilding);
  const model = chat.withStructuredOutput(MessagingStrategySchema, {
    name: "messaging_strategy",
  });
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(contextParts.join("\n")),
  ]);

  return MessagingStrategySchema.parse(response);
}
