import { buildCompanyKnowledgeContext, extractCompanyDNA } from "~/lib/tools/marketing-pipeline/context";
import { generateCampaignOutput } from "~/lib/tools/marketing-pipeline/generator";
import { analyzeCompetitors } from "~/lib/tools/marketing-pipeline/competitor";
import { buildMessagingStrategy } from "~/lib/tools/marketing-pipeline/positioning";
import type {
  MarketingPipelineInput,
  MarketingPipelineResult,
  MarketingResearchResult,
} from "~/lib/tools/marketing-pipeline/types";

// additional imports for query building and for fetching trend information
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

export async function runMarketingPipeline(args: {
  companyId: number;
  input: MarketingPipelineInput;
  debug?: boolean;
}): Promise<MarketingPipelineResult> {
  const normalizedInput = normalizeInput(args.input);

  // 1) Fetch company name and categories
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

  // 2) Build KB context (needed for research and generator)
  const companyContextBase = await buildCompanyKnowledgeContext({
    companyId: args.companyId,
    prompt: normalizedInput.prompt ?? DEFAULT_PROMPT,
  });

  const platformGuidelines = buildPlatformGuidelines(normalizedInput.platform);
  const companyContext = `${companyContextBase}

Platform best practices:
${platformGuidelines}`;

  // 3) Run DNA extraction, competitor analysis, and trend research in parallel
  let research: MarketingResearchResult[] = [];
  const [dnaResult, competitors] = await Promise.all([
    extractCompanyDNA({ companyId: args.companyId, prompt: normalizedInput.prompt ?? DEFAULT_PROMPT }),
    analyzeCompetitors({
      companyName,
      categories,
      companyContext: companyContextBase,
    }),
    (async (): Promise<MarketingResearchResult[]> => {
      try {
        const raw = await researchPlatformTrends({
          platform: normalizedInput.platform,
          prompt: normalizedInput.prompt ?? DEFAULT_PROMPT,
          companyName,
          companyContext,
          maxResults: normalizedInput.maxResearchResults ?? 6,
        });
        return normalizeResearch(raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[marketing-pipeline] trend research failed:", message);
        return [];
      }
    })(),
  ]).then(([d, c, r]) => {
    research = r;
    return [d, c] as const;
  });

  const { dna, debug: dnaDebug } = dnaResult;

  // 4) Build messaging strategy from DNA + competitors + trends
  const trendsSummary = formatTrendsSummary(research);
  const strategy = await buildMessagingStrategy({
    dna,
    competitors,
    trendsSummary,
    userPrompt: normalizedInput.prompt ?? DEFAULT_PROMPT,
  });

  // 5) Generate campaign output with strategy
  const generated = await generateCampaignOutput({
    platform: normalizedInput.platform,
    prompt: normalizedInput.prompt ?? DEFAULT_PROMPT,
    companyContext,
    research,
    strategy,
  });

  // 6) Return result with competitiveAngle and strategyUsed
  return {
    ...generated,
    research,
    normalizedInput: {
      platform: normalizedInput.platform,
      prompt: normalizedInput.prompt ?? DEFAULT_PROMPT,
    },
    competitiveAngle: generated.competitiveAngle,
    strategyUsed: generated.strategyUsed,
    ...(args.debug ? { dnaDebug } : {}),
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
