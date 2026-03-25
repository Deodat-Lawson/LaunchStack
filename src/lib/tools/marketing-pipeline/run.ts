import { buildCompanyKnowledgeContext, extractCompanyDNA } from "~/lib/tools/marketing-pipeline/context";
import { generateCampaignOutput, generateVariants } from "~/lib/tools/marketing-pipeline/generator";
import { analyzeCompetitors } from "~/lib/tools/marketing-pipeline/competitor";
import { buildMultiStrategy } from "~/lib/tools/marketing-pipeline/positioning";
import { extractBrandVoice } from "~/lib/tools/marketing-pipeline/voice";
import { extractTargetPersona } from "~/lib/tools/marketing-pipeline/persona";
import { verifyClaimSources } from "~/lib/tools/marketing-pipeline/claim-verifier";
import { getPerformanceHistory, buildPerformanceInsights } from "~/lib/tools/marketing-pipeline/performance";
import type {
  MarketingPipelineInput,
  MarketingPipelineResult,
  MarketingResearchResult,
  ContentVariant,
  BrandVoice,
  TargetPersona,
} from "~/lib/tools/marketing-pipeline/types";

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
        toneOverride: input.toneOverride,
        targetAudience: input.targetAudience,
        contentType: input.contentType ?? "post",
        platforms: input.platforms,
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

export type PipelineStageId =
  | "context"
  | "dna"
  | "competitors"
  | "trends"
  | "brand_voice"
  | "persona"
  | "performance"
  | "strategies"
  | "variants"
  | "claims"
  | "done";

export interface PipelineStageEvent {
  stage: PipelineStageId;
  label: string;
  status: "running" | "completed" | "skipped" | "failed";
  durationMs?: number;
}

export type OnStageUpdate = (event: PipelineStageEvent) => void;

function emitStage(
  onStage: OnStageUpdate | undefined,
  stage: PipelineStageId,
  label: string,
  status: PipelineStageEvent["status"],
  durationMs?: number,
) {
  onStage?.({ stage, label, status, durationMs });
}

export async function runMarketingPipeline(args: {
  companyId: number;
  input: MarketingPipelineInput;
  debug?: boolean;
  onStageUpdate?: OnStageUpdate;
}): Promise<MarketingPipelineResult> {
  const { onStageUpdate } = args;
  const normalizedInput = normalizeInput(args.input);
  const prompt = normalizedInput.prompt ?? DEFAULT_PROMPT;

  // 1) Fetch company name and categories + build KB context
  emitStage(onStageUpdate, "context", "Building company knowledge context", "running");
  const ctxStart = Date.now();

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

  const companyContextBase = await buildCompanyKnowledgeContext({
    companyId: args.companyId,
    prompt,
  });

  const platformGuidelines = buildPlatformGuidelines(normalizedInput.platform);
  const companyContext = `${companyContextBase}\n\nPlatform best practices:\n${platformGuidelines}`;
  emitStage(onStageUpdate, "context", "Building company knowledge context", "completed", Date.now() - ctxStart);

  // 2) Run DNA, competitors, trends, brand voice, persona, and performance in parallel
  let research: MarketingResearchResult[] = [];
  let brandVoice: BrandVoice | undefined;
  let targetPersona: TargetPersona | undefined;
  let performanceInsights: string[] = [];

  emitStage(onStageUpdate, "dna", "Extracting company DNA", "running");
  emitStage(onStageUpdate, "competitors", "Analyzing competitors", "running");
  emitStage(onStageUpdate, "trends", "Researching platform trends", "running");
  emitStage(onStageUpdate, "brand_voice", "Detecting brand voice", "running");
  if (normalizedInput.targetAudience) {
    emitStage(onStageUpdate, "persona", "Building target persona", "running");
  }
  emitStage(onStageUpdate, "performance", "Checking performance history", "running");

  const [dnaResult, competitors] = await Promise.all([
    (async () => {
      const t = Date.now();
      const r = await extractCompanyDNA({ companyId: args.companyId, prompt });
      emitStage(onStageUpdate, "dna", "Extracting company DNA", "completed", Date.now() - t);
      return r;
    })(),
    (async () => {
      const t = Date.now();
      const r = await analyzeCompetitors({ companyName, categories, companyContext: companyContextBase });
      emitStage(onStageUpdate, "competitors", "Analyzing competitors", "completed", Date.now() - t);
      return r;
    })(),
    (async () => {
      const t = Date.now();
      try {
        const raw = await researchPlatformTrends({
          platform: normalizedInput.platform,
          prompt,
          companyName,
          companyContext,
          maxResults: normalizedInput.maxResearchResults ?? 6,
        });
        research = normalizeResearch(raw);
        emitStage(onStageUpdate, "trends", "Researching platform trends", "completed", Date.now() - t);
      } catch (err) {
        console.warn("[marketing-pipeline] trend research failed:", err instanceof Error ? err.message : err);
        emitStage(onStageUpdate, "trends", "Researching platform trends", "failed", Date.now() - t);
      }
    })(),
    (async () => {
      const t = Date.now();
      try {
        brandVoice = await extractBrandVoice({
          companyId: args.companyId,
          toneOverride: normalizedInput.toneOverride,
        });
        emitStage(onStageUpdate, "brand_voice", "Detecting brand voice", "completed", Date.now() - t);
      } catch (err) {
        console.warn("[marketing-pipeline] brand voice extraction failed:", err);
        emitStage(onStageUpdate, "brand_voice", "Detecting brand voice", "failed", Date.now() - t);
      }
    })(),
    (async () => {
      if (normalizedInput.targetAudience) {
        const t = Date.now();
        try {
          targetPersona = await extractTargetPersona({
            companyId: args.companyId,
            targetAudience: normalizedInput.targetAudience,
          });
          emitStage(onStageUpdate, "persona", "Building target persona", "completed", Date.now() - t);
        } catch (err) {
          console.warn("[marketing-pipeline] persona extraction failed:", err);
          emitStage(onStageUpdate, "persona", "Building target persona", "failed", Date.now() - t);
        }
      } else {
        emitStage(onStageUpdate, "persona", "Building target persona", "skipped");
      }
    })(),
    (async () => {
      const t = Date.now();
      try {
        const history = await getPerformanceHistory({
          companyId: args.companyId,
          platform: normalizedInput.platform,
          limit: 10,
        });
        performanceInsights = buildPerformanceInsights(history);
        emitStage(onStageUpdate, "performance", "Checking performance history", "completed", Date.now() - t);
      } catch (err) {
        console.warn("[marketing-pipeline] performance history failed:", err);
        emitStage(onStageUpdate, "performance", "Checking performance history", "failed", Date.now() - t);
      }
    })(),
  ]).then(([d, c]) => [d, c] as const);

  const { dna, debug: dnaDebug } = dnaResult;

  // 3) Build 3 strategy variants
  emitStage(onStageUpdate, "strategies", "Building 3 messaging strategies", "running");
  const stratStart = Date.now();
  const trendsSummary = formatTrendsSummary(research);
  const strategies = await buildMultiStrategy({
    dna,
    competitors,
    trendsSummary,
    userPrompt: prompt,
    brandVoice,
    targetPersona,
    performanceInsights,
  });
  emitStage(onStageUpdate, "strategies", "Building 3 messaging strategies", "completed", Date.now() - stratStart);

  // 4) Generate 3 content variants in parallel
  emitStage(onStageUpdate, "variants", "Generating 3 content variants", "running");
  const varStart = Date.now();
  const variants: ContentVariant[] = await generateVariants({
    platform: normalizedInput.platform,
    prompt,
    companyContext,
    research,
    strategies,
    brandVoice,
    targetPersona,
    contentType: normalizedInput.contentType,
  });
  emitStage(onStageUpdate, "variants", "Generating 3 content variants", "completed", Date.now() - varStart);

  // 5) Claim verification on the first variant
  emitStage(onStageUpdate, "claims", "Verifying claim sources", "running");
  const claimStart = Date.now();
  let claimSources;
  if (variants.length > 0) {
    try {
      claimSources = await verifyClaimSources({
        companyId: args.companyId,
        message: variants[0]!.message,
      });
      emitStage(onStageUpdate, "claims", "Verifying claim sources", "completed", Date.now() - claimStart);
    } catch (err) {
      console.warn("[marketing-pipeline] claim verification failed:", err);
      emitStage(onStageUpdate, "claims", "Verifying claim sources", "failed", Date.now() - claimStart);
    }
  }

  emitStage(onStageUpdate, "done", "Pipeline complete", "completed");

  // 6) Build transparent result
  const primaryVariant = variants[0];
  const primaryStrategy = strategies[0];

  return {
    platform: normalizedInput.platform,
    message: primaryVariant?.message ?? "",
    "image/video": primaryVariant?.mediaType ?? "image",
    research,
    normalizedInput: { platform: normalizedInput.platform, prompt },
    competitiveAngle: primaryStrategy?.angle,
    strategyUsed: primaryStrategy,
    ...(args.debug ? { dnaDebug } : {}),

    variants,
    pipelineStages: {
      dna,
      competitors,
      trends: research,
      strategies,
      brandVoice,
      targetPersona,
      performanceInsights,
    },
    claimSources,
  };
}

function buildPlatformGuidelines(platform: MarketingPipelineInput["platform"]): string {
  switch (platform) {
    case "reddit":
      return [
        "- Speak like a real community member, not a brand account.",
        "- Lead with a specific pain point or story that matches the subreddit.",
        "- Avoid pure self-promotion: focus on value, insight, or behind-the-scenes context.",
        "- Use clear, descriptive titles; body can be longer and conversational.",
        "- Invite discussion with an authentic question at the end.",
      ].join("\n");
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
