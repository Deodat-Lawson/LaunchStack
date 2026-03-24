import { buildCompanyKnowledgeContext, extractCompanyDNA } from "~/lib/tools/marketing-pipeline/context";
import { generateCampaignOutput } from "~/lib/tools/marketing-pipeline/generator";
import { analyzeCompetitors } from "~/lib/tools/marketing-pipeline/competitor";
import { buildMessagingStrategy } from "~/lib/tools/marketing-pipeline/positioning";
import type {
  MarketingPipelineInput,
  MarketingPipelineResult,
  MarketingResearchResult,
  OnPipelineProgress,
  PipelineStepId,
} from "~/lib/tools/marketing-pipeline/types";
import { PIPELINE_STEPS } from "~/lib/tools/marketing-pipeline/types";

import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { company, category } from "~/server/db/schema";
import { researchPlatformTrends } from "~/lib/tools/marketing-pipeline/research";

const DEFAULT_PROMPT = "Generate a compelling campaign post for this platform.";

function normalizeInput(input: MarketingPipelineInput): MarketingPipelineInput {
    const prompt = input.prompt?.trim().replace(/\s+/g, " ") ?? DEFAULT_PROMPT;
    return {
        platform: input.platform,
        prompt: prompt || DEFAULT_PROMPT,
        maxResearchResults: input.maxResearchResults ?? 6,
        platformMeta: input.platformMeta,
    };
}

function normalizeResearch(research: MarketingResearchResult[]): MarketingResearchResult[] {
    return research
        .filter((r) => Boolean(r.url))
        .slice(0, 12)
        .map((r) => ({
            ...r,
            title: r.title.trim().replace(/\s+/g, " ").slice(0, 180),
            snippet: r.snippet.trim().replace(/\s+/g, " ").slice(0, 500),
            url: r.url.trim(),
        }));
}

function formatTrendsSummary(research: MarketingResearchResult[]): string {
  if (!research.length) return "";
  return research
    .slice(0, 6)
    .map((r) => `${r.title}: ${r.snippet.slice(0, 180)}`)
    .join("\n");
}

function stepLabel(step: PipelineStepId): string {
  return PIPELINE_STEPS.find((s) => s.id === step)?.label ?? step;
}

export async function runMarketingPipeline(args: {
  companyId: number;
  input: MarketingPipelineInput;
  debug?: boolean;
  onProgress?: OnPipelineProgress;
}): Promise<MarketingPipelineResult> {
  const { onProgress } = args;
  const pipelineStart = Date.now();

  function emitStart(step: PipelineStepId) {
    onProgress?.({ type: "step_start", step, label: stepLabel(step) });
  }
  function emitComplete(step: PipelineStepId, startTime: number, detail?: string) {
    const durationMs = Date.now() - startTime;
    console.log(
      "[marketing-pipeline] %s completed in %dms%s",
      step, durationMs, detail ? ` – ${detail}` : "",
    );
    onProgress?.({ type: "step_complete", step, durationMs, detail });
  }

  const normalizedInput = normalizeInput(args.input);
  const userPrompt = normalizedInput.prompt ?? DEFAULT_PROMPT;

  // 1) Fetch company name + categories (fast DB query)
  const [companyRow] = await db
    .select({ name: company.name })
    .from(company)
    .where(eq(company.id, args.companyId))
    .limit(1);
  const companyName = companyRow?.name ?? "Unknown Company";

  const categoryRows = await db
    .select({ name: category.name })
    .from(category)
    .where(eq(category.companyId, BigInt(args.companyId)))
    .limit(8);
  const categories = categoryRows.map((r) => r.name).filter(Boolean);

  // 2) Run KB context, DNA, competitors, and trends ALL in parallel.
  //    KB context was previously sequential; moving it here saves 1-3s.
  let research: MarketingResearchResult[] = [];

  const t0 = Date.now();
  emitStart("loading-context");

  const [companyContextBase, dnaResult, competitors] = await Promise.all([
    (async () => {
      const ctx = await buildCompanyKnowledgeContext({
        companyId: args.companyId,
        prompt: userPrompt,
      });
      emitComplete("loading-context", t0, `Loaded knowledge for ${companyName}`);
      return ctx;
    })(),

    (async () => {
      const t1 = Date.now();
      emitStart("extracting-dna");
      const result = await extractCompanyDNA({ companyId: args.companyId, prompt: userPrompt });
      const diffCount = result.dna.keyDifferentiators.length;
      emitComplete("extracting-dna", t1,
        `Found ${diffCount} differentiator${diffCount !== 1 ? "s" : ""}`,
      );
      return result;
    })(),

    (async () => {
      const t2 = Date.now();
      emitStart("analyzing-competitors");
      const result = await analyzeCompetitors({
        companyName,
        categories,
        companyContext: "",
      });
      const compCount = result.competitors.length;
      emitComplete("analyzing-competitors", t2,
        `Identified ${compCount} competitor${compCount !== 1 ? "s" : ""}`,
      );
      return result;
    })(),

    (async () => {
      const t3 = Date.now();
      emitStart("researching-trends");
      try {
        const platformGuidelines = buildPlatformGuidelines(normalizedInput.platform, normalizedInput.platformMeta);
        const basicContext = [
          `Company: ${companyName}.`,
          `Categories: ${categories.join(", ") || "None"}.`,
          "",
          "Platform best practices:",
          platformGuidelines,
        ].join("\n");
        const raw = await researchPlatformTrends({
          platform: normalizedInput.platform,
          prompt: userPrompt,
          companyName,
          companyContext: basicContext,
          maxResults: normalizedInput.maxResearchResults ?? 6,
        });
        const normalized = normalizeResearch(raw);
        emitComplete("researching-trends", t3,
          `Discovered ${normalized.length} trending topic${normalized.length !== 1 ? "s" : ""}`,
        );
        return normalized;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[marketing-pipeline] trend research failed:", message);
        emitComplete("researching-trends", t3, "Trend search unavailable");
        return [] as MarketingResearchResult[];
      }
    })(),
  ]).then(([ctx, dna, comp, res]) => {
    research = res;
    return [ctx, dna, comp] as const;
  });

  const { dna, debug: dnaDebug } = dnaResult;

  // 3) Build messaging strategy from DNA + competitors + trends
  const t4 = Date.now();
  emitStart("building-strategy");

  const trendsSummary = formatTrendsSummary(research);
  const strategy = await buildMessagingStrategy({
    dna,
    competitors,
    trendsSummary,
    userPrompt,
  });
  emitComplete("building-strategy", t4, `Angle: ${strategy.angle.slice(0, 80)}`);

  // 4) Generate campaign output with full company context
  const t5 = Date.now();
  emitStart("generating-content");

  const platformGuidelines = buildPlatformGuidelines(normalizedInput.platform, normalizedInput.platformMeta);
  const companyContext = `${companyContextBase}\n\nPlatform best practices:\n${platformGuidelines}`;

  const generated = await generateCampaignOutput({
    platform: normalizedInput.platform,
    prompt: userPrompt,
    companyContext,
    research,
    strategy,
    enableQualityGate: true,
    platformMeta: normalizedInput.platformMeta ?? undefined,
  });
  emitComplete("generating-content", t5,
    `${generated.message.length} chars, ${generated["image/video"]} recommended`,
  );

  const totalMs = Date.now() - pipelineStart;
  console.log("[marketing-pipeline] total pipeline completed in %dms", totalMs);

  return {
    ...generated,
    research,
    normalizedInput: {
      platform: normalizedInput.platform,
      prompt: userPrompt,
    },
    competitiveAngle: generated.competitiveAngle,
    strategyUsed: generated.strategyUsed,
    ...(args.debug ? { dnaDebug } : {}),
  };
}

function buildPlatformGuidelines(
  platform: MarketingPipelineInput["platform"],
  platformMeta?: MarketingPipelineInput["platformMeta"],
): string {
  switch (platform) {
    case "reddit": {
      const lines = [
        "- Speak like a real community member, not a brand account.",
        "- Lead with a specific pain point or story that matches the subreddit.",
        "- Avoid pure self-promotion: focus on value, insight, or behind-the-scenes context.",
        "- Use clear, descriptive titles; body can be longer and conversational.",
        "- Invite discussion with an authentic question at the end.",
      ];
      if (platformMeta?.subreddit) {
        lines.push(
          "",
          `Target subreddit: ${platformMeta.subreddit}`,
          "Tailor your tone, vocabulary, and content depth to match this subreddit's norms and audience expectations.",
        );
      }
      return lines.join("\n");
    }
    case "x":
      return [
        "- Keep posts tight and high-signal; front-load the hook in the first line.",
        "- Use 1–2 sharp talking points instead of long paragraphs.",
        "- Sprinkle in 1–2 relevant hashtags, but avoid hashtag spam.",
        "- When appropriate, reference current trends or conversations in the space.",
        "- Make the call-to-action explicit and easy to understand.",
      ].join("\n");
    case "linkedin":
      return [
        "- Use a strong first line that clearly states the outcome or insight.",
        "- Write in short paragraphs or bullet points for easy scanning.",
        "- Frame the message around business impact, transformation, or a concrete case.",
        "- Keep the tone professional but human—less hype, more signal.",
        "- Close with a takeaway or a soft call-to-action tailored to professionals.",
      ].join("\n");
    default:
      return "- Write a clear, concise, value-focused message tailored to this platform.";
  }
}
