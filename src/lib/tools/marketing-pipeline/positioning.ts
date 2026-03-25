import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type {
  CompanyDNA,
  CompetitorAnalysis,
  MessagingStrategy,
  StrategyVariant,
  BrandVoice,
  TargetPersona,
} from "~/lib/tools/marketing-pipeline/types";
import { MessagingStrategySchema, MultiStrategySchema } from "~/lib/tools/marketing-pipeline/types";

function buildContextBlock(args: {
  dna: CompanyDNA;
  competitors: CompetitorAnalysis;
  trendsSummary?: string;
  userPrompt?: string;
  brandVoice?: BrandVoice;
  targetPersona?: TargetPersona;
  performanceInsights?: string[];
}): string {
  const { dna, competitors, trendsSummary = "", userPrompt = "", brandVoice, targetPersona, performanceInsights } = args;

  const contextParts: string[] = [
    "## Company DNA",
    `Mission: ${dna.coreMission}`,
    `Differentiators: ${dna.keyDifferentiators.join("; ")}`,
    `Proven results: ${dna.provenResults.join("; ")}`,
    `Human story: ${dna.humanStory}`,
    `Technical edge: ${dna.technicalEdge}`,
    "",
    "## Competitor landscape",
    ...competitors.competitors.map(
      (c) =>
        `- ${c.name}: ${c.positioning}. Weaknesses: ${c.weaknesses.join(", ")}`,
    ),
    `Our advantages: ${competitors.ourAdvantages.join("; ")}`,
    `Market gaps: ${competitors.marketGaps.join("; ")}`,
    `Messaging to avoid: ${competitors.messagingAntiPatterns.join("; ")}`,
  ];

  if (brandVoice) {
    contextParts.push(
      "",
      "## Brand voice",
      `Tone: ${brandVoice.toneDescriptor}`,
      `Style: ${brandVoice.sentenceStyle}`,
      `Formality: ${brandVoice.formalityLevel}`,
      brandVoice.vocabularyExamples.length > 0
        ? `Characteristic phrases: ${brandVoice.vocabularyExamples.join(", ")}`
        : "",
    );
  }

  if (targetPersona) {
    contextParts.push(
      "",
      "## Target audience",
      `Role: ${targetPersona.role}`,
      `Pain points: ${targetPersona.painPoints.join("; ")}`,
      `Priorities: ${targetPersona.priorities.join("; ")}`,
      `Language style: ${targetPersona.languageStyle}`,
    );
  }

  if (trendsSummary.trim()) {
    contextParts.push("", "## Platform / trend context", trendsSummary.trim());
  }

  if (performanceInsights && performanceInsights.length > 0) {
    contextParts.push("", "## Past performance insights", ...performanceInsights);
  }

  if (userPrompt.trim()) {
    contextParts.push("", "## User request", userPrompt.trim());
  }

  return contextParts.join("\n");
}

/**
 * Build a single MessagingStrategy (legacy compatibility).
 */
export async function buildMessagingStrategy(args: {
  dna: CompanyDNA;
  competitors: CompetitorAnalysis;
  trendsSummary?: string;
  userPrompt?: string;
  brandVoice?: BrandVoice;
  targetPersona?: TargetPersona;
  performanceInsights?: string[];
}): Promise<MessagingStrategy> {
  const systemPrompt = `You are a messaging strategist. Given company DNA, competitor analysis, and optional trend context, produce a single MessagingStrategy.

Rules:
- angle: one clear positioning angle (1–2 sentences) that differentiates us from competitors and fits our DNA.
- keyProof: 2–4 concrete proof points (metrics, outcomes, differentiators) to support the angle.
- humanHook: one human story or emotional hook to open or close the message.
- avoidList: 3–5 phrases or themes we must avoid (clichés, competitor overlap, weak claims).

Use only information from the provided context. Return valid JSON matching the schema.`;

  const chat = getChatModel(MARKETING_MODELS.contentGeneration);
  const model = chat.withStructuredOutput(MessagingStrategySchema, {
    name: "messaging_strategy",
  });
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(buildContextBlock(args)),
  ]);

  return MessagingStrategySchema.parse(response);
}

/**
 * Build 3 strategy variants from different positioning angles (Area 2).
 */
export async function buildMultiStrategy(args: {
  dna: CompanyDNA;
  competitors: CompetitorAnalysis;
  trendsSummary?: string;
  userPrompt?: string;
  brandVoice?: BrandVoice;
  targetPersona?: TargetPersona;
  performanceInsights?: string[];
}): Promise<StrategyVariant[]> {
  const systemPrompt = `You are a messaging strategist. Given company DNA, competitor analysis, and optional context, produce EXACTLY 3 distinct MessagingStrategy variants.

Each variant must take a DIFFERENT positioning angle:
- Variant 1 ("thought-leadership"): Lead with an industry insight or contrarian take that positions the company as a thought leader.
- Variant 2 ("pain-point"): Lead with a specific pain point the target audience faces, then show how the company solves it.
- Variant 3 ("proof-driven"): Lead with concrete metrics, outcomes, or case results that demonstrate value.

For EACH variant provide:
- variantId: one of "thought-leadership", "pain-point", "proof-driven"
- angleRationale: 1–2 sentences explaining WHY this angle was chosen based on the company's specific DNA and competitive landscape.
- angle: the positioning angle (1–2 sentences).
- keyProof: 2–4 proof points.
- humanHook: one human story or emotional hook.
- avoidList: 3–5 themes to avoid.

Use only information from the provided context. Return valid JSON with a "variants" array of exactly 3 objects.`;

  const chat = getChatModel(MARKETING_MODELS.contentGeneration);
  const model = chat.withStructuredOutput(MultiStrategySchema, {
    name: "multi_strategy",
  });
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(buildContextBlock(args)),
  ]);

  const parsed = MultiStrategySchema.parse(response);
  return parsed.variants;
}
