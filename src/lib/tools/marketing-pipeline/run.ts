import { buildCompanyKnowledgeContext, extractCompanyDNA } from "~/lib/tools/marketing-pipeline/context";
import { generateCampaignOutput, generateVariants } from "~/lib/tools/marketing-pipeline/generator";
import { analyzeCompetitors } from "~/lib/tools/marketing-pipeline/competitor";
import { buildMessagingStrategy, buildMultiStrategy } from "~/lib/tools/marketing-pipeline/positioning";
import { extractBrandVoice } from "~/lib/tools/marketing-pipeline/voice";
import { extractTargetPersona } from "~/lib/tools/marketing-pipeline/persona";
import { verifyClaimSources } from "~/lib/tools/marketing-pipeline/claim-verifier";
import { getPerformanceHistory, buildPerformanceInsights, saveGeneratedContent } from "~/lib/tools/marketing-pipeline/performance";
import type {
  MarketingPipelineInput,
  MarketingPipelineResult,
  MarketingResearchResult,
  OnPipelineProgress,
  PipelineStepId,
  BrandVoice,
  TargetPersona,
  StrategyVariant,
  ContentVariant,
  ClaimSource,
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
        toneOverride: input.toneOverride,
        targetAudience: input.targetAudience,
        contentType: input.contentType,
        documentIds: input.documentIds,
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

  function emitStart(step: PipelineStepId, parallelGroup?: number) {
    onProgress?.({ type: "step_start", step, label: stepLabel(step), parallelGroup });
  }
  function emitComplete(
    step: PipelineStepId,
    startTime: number,
    detail?: string,
    status: "completed" | "skipped" | "failed" = "completed",
  ) {
    const durationMs = Date.now() - startTime;
    console.log(
      "[marketing-pipeline] %s %s in %dms%s",
      step, status, durationMs, detail ? ` – ${detail}` : "",
    );
    onProgress?.({ type: "step_complete", step, durationMs, detail, status });
  }
  function emitData(step: PipelineStepId, data: Record<string, unknown>) {
    onProgress?.({ type: "step_data", step, data });
  }
  function emitThinking(step: PipelineStepId, text: string) {
    onProgress?.({ type: "step_thinking", step, text });
  }

  const normalizedInput = normalizeInput(args.input);
  const userPrompt = normalizedInput.prompt ?? DEFAULT_PROMPT;
  const scopedDocIds = normalizedInput.documentIds?.length ? normalizedInput.documentIds : undefined;

  console.log(
    `[marketing-pipeline] ▶ RUN companyId=${args.companyId} scopedDocIds=${JSON.stringify(scopedDocIds ?? "ALL")} rawInput.documentIds=${JSON.stringify(args.input.documentIds ?? "undefined")}`,
  );

  // 1) Fetch company name, description, industry + categories (fast DB query)
  const [companyRow] = await db
    .select({
      name: company.name,
      description: company.description,
      industry: company.industry,
    })
    .from(company)
    .where(eq(company.id, args.companyId))
    .limit(1);
  const companyName = companyRow?.name ?? "Unknown Company";
  const companyDescription = companyRow?.description ?? "";
  const companyIndustry = companyRow?.industry ?? "";

  const categoryRows = await db
    .select({ name: category.name })
    .from(category)
    .where(eq(category.companyId, BigInt(args.companyId)))
    .limit(8);
  const categories = categoryRows.map((r) => r.name).filter(Boolean);

  const companyIdentity = [
    `Company: ${companyName}.`,
    companyDescription ? `Description: ${companyDescription}` : "",
    companyIndustry ? `Industry: ${companyIndustry}` : "",
    categories.length > 0 ? `Categories: ${categories.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  // 2) Run KB context, DNA, competitors, trends, brand voice, persona, performance ALL in parallel
  let research: MarketingResearchResult[] = [];
  let brandVoice: BrandVoice | undefined;
  let targetPersona: TargetPersona | undefined;
  let performanceInsights: string[] = [];

  // All steps in group 1 run concurrently
  const PG_GATHER = 1;

  const t0 = Date.now();
  emitStart("loading-context", PG_GATHER);

  const [companyContextBase, dnaResult, competitors] = await Promise.all([
    (async () => {
      const ctx = await buildCompanyKnowledgeContext({
        companyId: args.companyId,
        prompt: userPrompt,
        documentIds: scopedDocIds,
      });
      emitComplete("loading-context", t0, `Loaded knowledge for ${companyName}`);
      const snippetCount = ctx.split("\n").length;
      emitData("loading-context", { companyName, categories, snippetCount });
      emitThinking("loading-context",
        `Searching knowledge base for ${companyName}... Found ${snippetCount} document snippets covering their products, services, and market position.`,
      );
      return ctx;
    })(),

    (async () => {
      const t1 = Date.now();
      emitStart("extracting-dna", PG_GATHER);
      const result = await extractCompanyDNA({ companyId: args.companyId, prompt: userPrompt, documentIds: scopedDocIds });
      const diffCount = result.dna.keyDifferentiators.length;
      emitComplete("extracting-dna", t1,
        `Found ${diffCount} differentiator${diffCount !== 1 ? "s" : ""} (source: ${result.debug.source})`,
      );
      emitData("extracting-dna", {
        source: result.debug.source,
        coreMission: result.dna.coreMission,
        keyDifferentiators: result.dna.keyDifferentiators,
        provenResults: result.dna.provenResults,
        technicalEdge: result.dna.technicalEdge,
      });
      const diffs = result.dna.keyDifferentiators;
      emitThinking("extracting-dna",
        `Analyzing company DNA... Core mission: "${result.dna.coreMission}". Identified ${diffs.length} key differentiator${diffs.length !== 1 ? "s" : ""}: ${diffs.join("; ")}. Technical edge: "${result.dna.technicalEdge}".`,
      );
      return result;
    })(),

    (async () => {
      const t2 = Date.now();
      emitStart("analyzing-competitors", PG_GATHER);
      const result = await analyzeCompetitors({
        companyName,
        categories,
        companyContext: companyIdentity,
      });
      const compCount = result.competitors.length;
      emitComplete("analyzing-competitors", t2,
        `Identified ${compCount} competitor${compCount !== 1 ? "s" : ""}`,
      );
      emitData("analyzing-competitors", {
        competitors: result.competitors.map((c) => ({ name: c.name, positioning: c.positioning })),
        ourAdvantages: result.ourAdvantages,
        marketGaps: result.marketGaps,
      });
      const compNames = result.competitors.map((c) => c.name).join(", ");
      emitThinking("analyzing-competitors",
        `Scanning the competitive landscape... Found ${result.competitors.length} competitor${result.competitors.length !== 1 ? "s" : ""}: ${compNames || "none identified"}. Key advantages we have: ${result.ourAdvantages.join("; ") || "none yet"}. Market gaps to exploit: ${result.marketGaps.join("; ") || "none identified"}.`,
      );
      return result;
    })(),

    (async () => {
      const t3 = Date.now();
      emitStart("researching-trends", PG_GATHER);
      try {
        const platformGuidelines = buildPlatformGuidelines(normalizedInput.platform, normalizedInput.platformMeta);
        const basicContext = [
          companyIdentity,
          "",
          "Platform best practices:",
          platformGuidelines,
        ].join("\n");
        const raw = await researchPlatformTrends({
          platform: normalizedInput.platform,
          prompt: userPrompt,
          companyName,
          companyContext: basicContext,
          companyIndustry,
          maxResults: normalizedInput.maxResearchResults ?? 6,
        });
        const normalized = normalizeResearch(raw);
        emitComplete("researching-trends", t3,
          `Discovered ${normalized.length} trending topic${normalized.length !== 1 ? "s" : ""}`,
        );
        emitData("researching-trends", {
          topics: normalized.slice(0, 4).map((r) => ({ title: r.title, url: r.url })),
        });
        const topicTitles = normalized.slice(0, 4).map((r) => r.title).join("; ");
        emitThinking("researching-trends",
          `Researching what's trending on ${normalizedInput.platform}... Found ${normalized.length} relevant topic${normalized.length !== 1 ? "s" : ""}: ${topicTitles || "none"}. These will frame the narrative hooks.`,
        );
        return normalized;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[marketing-pipeline] trend research failed:", message);
        emitComplete("researching-trends", t3, "Trend search unavailable — continuing without trends", "failed");
        emitThinking("researching-trends", "Trend search unavailable — continuing without trends. The content will rely on company DNA and competitor insights instead.");
        return [] as MarketingResearchResult[];
      }
    })(),

    (async () => {
      const tv = Date.now();
      emitStart("extracting-voice", PG_GATHER);
      try {
        brandVoice = await extractBrandVoice({
          companyId: args.companyId,
          toneOverride: normalizedInput.toneOverride,
          documentIds: scopedDocIds,
        });
        emitComplete("extracting-voice", tv, `Tone: ${brandVoice.toneDescriptor}`);
        emitData("extracting-voice", {
          tone: brandVoice.toneDescriptor,
          formality: brandVoice.formalityLevel,
          style: brandVoice.sentenceStyle,
          vocabulary: brandVoice.vocabularyExamples,
        });
        emitThinking("extracting-voice",
          `Detecting brand voice from existing content... Tone: ${brandVoice.toneDescriptor}. Formality: ${brandVoice.formalityLevel}. Writing style: ${brandVoice.sentenceStyle}.`,
        );
      } catch (err) {
        console.warn("[marketing-pipeline] brand voice extraction failed:", err);
        emitComplete("extracting-voice", tv, "Using default voice", "failed");
        emitThinking("extracting-voice", "Brand voice extraction failed — using a balanced default voice for content generation.");
      }
    })(),

    (async () => {
      const tp = Date.now();
      emitStart("extracting-persona", PG_GATHER);
      try {
        if (normalizedInput.targetAudience) {
          targetPersona = await extractTargetPersona({
            companyId: args.companyId,
            targetAudience: normalizedInput.targetAudience,
            documentIds: scopedDocIds,
          });
          emitComplete("extracting-persona", tp, `Role: ${targetPersona.role}`);
          emitData("extracting-persona", {
            role: targetPersona.role,
            painPoints: targetPersona.painPoints,
            priorities: targetPersona.priorities,
            languageStyle: targetPersona.languageStyle,
          });
          emitThinking("extracting-persona",
            `Building target persona for "${normalizedInput.targetAudience}"... Role: ${targetPersona.role}. Their top pain points: ${targetPersona.painPoints.join("; ")}. They want: ${targetPersona.priorities.join("; ")}.`,
          );
        } else {
          emitComplete("extracting-persona", tp, "No target audience specified", "skipped");
          emitThinking("extracting-persona", "Skipping persona — no target audience specified. Content will be written for a general professional audience.");
        }
      } catch (err) {
        console.warn("[marketing-pipeline] persona extraction failed:", err);
        emitComplete("extracting-persona", tp, "Persona unavailable", "failed");
        emitThinking("extracting-persona", "Persona extraction failed — content will target a general audience.");
      }
    })(),

    (async () => {
      const tperf = Date.now();
      emitStart("checking-performance", PG_GATHER);
      try {
        const history = await getPerformanceHistory({
          companyId: args.companyId,
          platform: normalizedInput.platform,
        });
        performanceInsights = buildPerformanceInsights(history);
        if (performanceInsights.length > 0) {
          emitComplete("checking-performance", tperf,
            `${performanceInsights.length} insight${performanceInsights.length !== 1 ? "s" : ""}`,
          );
          emitData("checking-performance", { insights: performanceInsights });
          emitThinking("checking-performance",
            `Reviewing past campaign performance... Found ${performanceInsights.length} insight${performanceInsights.length !== 1 ? "s" : ""}: ${performanceInsights.slice(0, 3).join("; ")}. These will inform the strategy.`,
          );
        } else {
          emitComplete("checking-performance", tperf, "No history yet", "skipped");
          emitThinking("checking-performance", "No past performance history yet — this is the first campaign for this platform. Will use general best practices.");
        }
      } catch (err) {
        console.warn("[marketing-pipeline] performance check failed:", err);
        emitComplete("checking-performance", tperf, "No performance data", "failed");
        emitThinking("checking-performance", "Could not retrieve performance data — proceeding without historical context.");
      }
    })(),
  ]).then(([ctx, dna, comp, res]) => {
    research = res;
    return [ctx, dna, comp] as const;
  });

  const { dna, debug: dnaDebug } = dnaResult;

  // 3) Build 3 messaging strategy variants from DNA + competitors + trends + voice + persona
  const t4 = Date.now();
  emitStart("building-strategy");

  const trendsSummary = formatTrendsSummary(research);
  const strategies = await buildMultiStrategy({
    dna,
    competitors,
    trendsSummary,
    userPrompt,
    brandVoice,
    targetPersona,
    performanceInsights,
  });
  const primaryStrategy = strategies[0];
  emitComplete("building-strategy", t4,
    `Built ${strategies.length} strategy variants`,
  );
  emitData("building-strategy", {
    strategies: strategies.map((s) => ({
      variantId: s.variantId,
      angle: s.angle,
      angleRationale: s.angleRationale,
      keyProof: s.keyProof,
    })),
  });
  const strategyLines = strategies
    .map((s, i) => `  ${i + 1}. ${s.angle} — ${s.angleRationale}`)
    .join("\n");
  emitThinking("building-strategy",
    `Crafting ${strategies.length} positioning strateg${strategies.length !== 1 ? "ies" : "y"}...\n${strategyLines}`,
  );

  // 4) Generate content variants (one per strategy) in parallel
  const t5 = Date.now();
  emitStart("generating-content");

  const platformGuidelines = buildPlatformGuidelines(normalizedInput.platform, normalizedInput.platformMeta);
  const companyContext = `${companyContextBase}\n\nPlatform best practices:\n${platformGuidelines}`;

  const variants: ContentVariant[] = await generateVariants({
    platform: normalizedInput.platform,
    prompt: userPrompt,
    companyContext,
    research,
    strategies,
    enableQualityGate: false,
    platformMeta: normalizedInput.platformMeta ?? undefined,
    brandVoice,
    targetPersona,
    contentType: normalizedInput.contentType,
    sourceDocumentIds: scopedDocIds,
  });
  emitComplete("generating-content", t5,
    `Generated ${variants.length} variant${variants.length !== 1 ? "s" : ""}: ${variants.map((v) => v.variantId).join(", ")}`,
  );
  emitData("generating-content", {
    variants: variants.map((v) => ({
      variantId: v.variantId,
      angleRationale: v.angleRationale,
      charCount: v.message.length,
      mediaType: v.mediaType,
    })),
  });
  const variantSummary = variants
    .map((v) => `${v.variantId} (${v.message.length} chars, ${v.mediaType})`)
    .join("; ");
  emitThinking("generating-content",
    `Writing ${variants.length} content variant${variants.length !== 1 ? "s" : ""} in parallel, one per strategy angle — each tailored to ${normalizedInput.platform} conventions. Results: ${variantSummary}.`,
  );

  // Pick best variant as the primary message
  const bestVariant = variants[0] ?? { message: "", mediaType: "image" as const };

  // 5) Verify claim sources for the best variant
  let claimSources: ClaimSource[] = [];
  const t6 = Date.now();
  emitStart("verifying-claims");
  try {
    claimSources = await verifyClaimSources({
      companyId: args.companyId,
      message: bestVariant.message,
      documentIds: scopedDocIds,
    });
    const verified = claimSources.filter((c) => c.confidence > 0.5).length;
    emitComplete("verifying-claims", t6,
      `${claimSources.length} claim${claimSources.length !== 1 ? "s" : ""}, ${verified} verified`,
    );
    emitData("verifying-claims", {
      claims: claimSources.map((c) => ({
        claim: c.claim.slice(0, 100),
        sourceDoc: c.sourceDoc,
        confidence: Math.round(c.confidence * 100),
      })),
    });
    emitThinking("verifying-claims",
      `Cross-referencing claims against the knowledge base... ${verified}/${claimSources.length} claim${claimSources.length !== 1 ? "s" : ""} have direct source backing. ${verified === claimSources.length ? "All claims verified." : "Some claims lack strong sources — review recommended."}`,
    );
  } catch (err) {
    console.warn("[marketing-pipeline] claim verification failed:", err);
    emitComplete("verifying-claims", t6, "Claim verification unavailable", "failed");
    emitThinking("verifying-claims", "Claim verification unavailable — could not cross-reference claims with the knowledge base. Manual review recommended.");
  }

  // 6) Save to performance history (fire & forget)
  void saveGeneratedContent({
    companyId: args.companyId,
    platform: normalizedInput.platform,
    message: bestVariant.message,
    angle: primaryStrategy?.angle,
    contentType: normalizedInput.contentType ?? "post",
    sourceDocumentIds: scopedDocIds,
  }).catch((err) => console.warn("[marketing-pipeline] save history failed:", err));

  const totalMs = Date.now() - pipelineStart;
  console.log("[marketing-pipeline] total pipeline completed in %dms", totalMs);

  return {
    platform: normalizedInput.platform,
    message: bestVariant.message,
    "image/video": bestVariant.mediaType,
    research,
    normalizedInput: {
      platform: normalizedInput.platform,
      prompt: userPrompt,
    },
    sourceDocumentIds: scopedDocIds,
    competitiveAngle: primaryStrategy?.angle,
    strategyUsed: primaryStrategy
      ? { angle: primaryStrategy.angle, keyProof: primaryStrategy.keyProof, humanHook: primaryStrategy.humanHook, avoidList: primaryStrategy.avoidList }
      : undefined,
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
