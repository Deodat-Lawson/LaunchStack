import { buildCompanyKnowledgeContext } from "~/lib/tools/marketing-pipeline/context";
import { generateCampaignOutput } from "~/lib/tools/marketing-pipeline/generator";
import type {
  MarketingPipelineInput,
  MarketingPipelineResult,
  MarketingResearchResult,
} from "~/lib/tools/marketing-pipeline/types";

// additional imports for query building and for fetching trend information
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { company } from "~/server/db/schema";
import { researchPlatformTrends } from "~/lib/tools/marketing-pipeline/research";

function normalizeInput(input: MarketingPipelineInput): MarketingPipelineInput {
    return {
        platform: input.platform,
        prompt: input.prompt.trim().replace(/\s+/g, " "),
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

export async function runMarketingPipeline(args: {
  companyId: number;
  input: MarketingPipelineInput;
}): Promise<MarketingPipelineResult> {
  const normalizedInput = normalizeInput(args.input);

  // 1) Fetch company name (used for logs / future features)
  const [companyRow] = await db
    .select({ name: company.name })
    .from(company)
    .where(eq(company.id, args.companyId))
    .limit(1);

  const companyName = companyRow?.name ?? "Unknown Company";

  // 2) Build KB context from all company documents
  const companyContext = await buildCompanyKnowledgeContext({
    companyId: args.companyId,
    prompt: normalizedInput.prompt,
  });

  // 3) Fetch trend references (non-fatal)
  let research: MarketingResearchResult[] = [];
  try {
    research = await researchPlatformTrends({
      platform: normalizedInput.platform,
      prompt: normalizedInput.prompt,
      companyName,
      companyContext,
      maxResults: normalizedInput.maxResearchResults ?? 6,
    });
    research = normalizeResearch(research);
  } catch (error) {
    console.warn("[marketing-pipeline] trend research failed:", error);
    research = [];
  }

  // 5) Generate campaign output using KB + trends
  const generated = await generateCampaignOutput({
    platform: normalizedInput.platform,
    prompt: normalizedInput.prompt,
    companyContext,
    research,
  });

  // 6) Return final result
  return {
    ...generated,
    research,
    normalizedInput: {
      platform: normalizedInput.platform,
      prompt: normalizedInput.prompt,
    },
  };
}


