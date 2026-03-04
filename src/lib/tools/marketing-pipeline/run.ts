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
  const companyContextBase = await buildCompanyKnowledgeContext({
    companyId: args.companyId,
    prompt: normalizedInput.prompt,
  });

  // 3) Add platform best practices
  const platformGuidelines = buildPlatformGuidelines(normalizedInput.platform);
  const companyContext = `${companyContextBase}

Platform best practices:
${platformGuidelines}`;

  // 4) Fetch trend references (non-fatal)
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

