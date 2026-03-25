import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type {
  MarketingPlatform,
  MarketingResearchResult,
  MessagingStrategy,
  BrandVoice,
  TargetPersona,
  StrategyVariant,
  ContentVariant,
  ContentType,
  RefinementResult,
} from "~/lib/tools/marketing-pipeline/types";
import { MarketingPipelineOutputSchema } from "~/lib/tools/marketing-pipeline/types";

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_BASE = `You are a sharp B2B copywriter who writes like an operator sharing hard-won lessons—not a brand broadcasting announcements.

Voice & craft:
- Write as a knowledgeable peer, not a marketing department. First person ("we", "our team") is fine.
- Lead every post with tension, contrast, or a surprising insight. The first line must stop the scroll.
- Every sentence must earn its place. Cut filler, qualifiers, and throat-clearing ("Introducing…", "We're excited to…").
- Match format to content: use narrative paragraphs for stories and lessons learned; use structured bullets/lists for educational breakdowns, comparisons, or frameworks. Pick whichever serves the message best.
- End with a question or soft CTA that invites genuine conversation, not a generic "Let's connect!"
- Use trend references to frame the narrative or set up a tension, but never quote or attribute them directly.

Staying honest:
- Company context is your single source of truth for product claims, features, metrics, and results.
- Never invent capabilities, partnerships, customers, or numbers not in the company context.
- If a detail isn't in the context, reframe it as a general industry observation or an open question.
- Skip hype words ("revolutionary", "game-changing", "best-in-class") unless the context explicitly supports them.

Media selection:
- Pick "image" for static visuals (diagrams, workflows, checklists, data snapshots).
- Pick "video" for demos, explainers, or anything that benefits from motion.

Output:
- Return JSON matching the schema exactly. No extra keys.`;

const STRATEGY_RULES = `
When a Messaging Strategy is provided:
- Lead with the recommended angle and human hook when it fits the platform; balance human story with technical depth.
- Back claims with the key proof points given; do not add proof not in company context.
- Do NOT use any phrase or theme in the strategy's avoid list.
- Keep the post aligned with the positioning angle while staying platform-native.`;

// ---------------------------------------------------------------------------
// Brand voice injection
// ---------------------------------------------------------------------------

function buildVoiceDirective(voice: BrandVoice): string {
  const parts = [
    "",
    "Brand voice (adapt your writing style to match):",
    `- Tone: ${voice.toneDescriptor}`,
    `- Sentence style: ${voice.sentenceStyle}`,
    `- Formality: ${voice.formalityLevel}`,
  ];
  if (voice.vocabularyExamples.length > 0) {
    parts.push(`- Use phrases like: ${voice.vocabularyExamples.join(", ")}`);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Persona injection
// ---------------------------------------------------------------------------

function buildPersonaDirective(persona: TargetPersona): string {
  return [
    "",
    "Target audience (tailor content for this reader):",
    `- Role: ${persona.role}`,
    `- Their pain points: ${persona.painPoints.join("; ")}`,
    `- Their priorities: ${persona.priorities.join("; ")}`,
    `- Write in: ${persona.languageStyle}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Content type templates (Area 6)
// ---------------------------------------------------------------------------

function contentTypeTemplate(contentType: ContentType): string {
  switch (contentType) {
    case "thread":
      return [
        "Content type: Thread / Carousel",
        "- Write 3–5 connected posts that build on each other.",
        "- First post is the hook — must stand alone and stop the scroll.",
        "- Each subsequent post adds one key insight or proof point.",
        "- Last post has the CTA or takeaway.",
        "- Separate each post with '---' on its own line.",
        "- Each individual post should respect the platform's character limits.",
      ].join("\n");
    case "ad_copy":
      return [
        "Content type: Ad Copy Set",
        "- Write 3 variations of ad copy, each with:",
        "  - Headline (max 40 characters)",
        "  - Body (max 125 characters)",
        "  - CTA text (max 25 characters)",
        "- Separate each variation with '---' on its own line.",
        "- Format each as: HEADLINE: ... / BODY: ... / CTA: ...",
        "- Make each variation take a slightly different angle.",
      ].join("\n");
    case "email":
      return [
        "Content type: Email Draft",
        "- Write a complete email with:",
        "  - Subject line (compelling, under 60 characters)",
        "  - Preview text (under 90 characters)",
        "  - Body (3–5 paragraphs, conversational but professional)",
        "  - CTA button text",
        "- Format as: SUBJECT: ... / PREVIEW: ... / BODY: ... / CTA: ...",
      ].join("\n");
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Platform templates + examples
// ---------------------------------------------------------------------------

function platformTemplate(platform: MarketingPlatform): string {
  switch (platform) {
    case "x":
      return [
        "Platform: X (Twitter)",
        "Structure:",
        "- Hook line first — a bold, concise claim or sharp observation. Front-load the insight.",
        "- 1–2 high-signal follow-up lines that deliver concrete value or a surprising detail.",
        "- Optional: 1 clear CTA or provocative question to drive replies.",
        "- 0–2 relevant hashtags max. Skip them if they feel forced.",
        "Constraints:",
        "- Aim for ~280 characters. Brevity is the craft here—every word must pull weight.",
        "- No thread format. This is a single, self-contained post.",
        "Tone: Punchy, confident, conversational. Think founder tweet, not press release.",
      ].join("\n");
    case "linkedin":
      return [
        "Platform: LinkedIn",
        "Structure:",
        "- Line 1 (the hook): Use contrast, a counterintuitive claim, or a specific result.",
        '  Good hooks: "Most teams do X. The ones winning do Y." / "We stopped doing X. Here\'s what happened."',
        "  Bad hooks: \"Excited to announce…\" / \"Introducing our new…\"",
        "- Body: Pick the format that best serves the content:",
        "  Option A (Narrative): 3–6 short paragraphs telling a mini-story or walking through a shift in thinking.",
        "  Option B (Educational breakdown): Structured sections with clear labels and bullet points to explain a concept, compare approaches, or present a framework.",
        "  Either way, each section must deliver one clear insight. Weave in business impact naturally (time saved, risk reduced, clarity gained).",
        "- Closing: End with a specific question that invites perspectives, or a takeaway the reader can act on.",
        '  Good CTAs: "Where is your team on this?" / "What\'s working in your stack?"',
        '  Bad CTAs: "Let\'s connect!" / "DM me for more info"',
        "Tone: Professional but human. Think operator sharing a playbook, not company posting an ad.",
      ].join("\n");
    case "reddit":
      return [
        "Platform: Reddit",
        "Structure:",
        "- Open with a relatable pain point, a story, or a specific problem you encountered.",
        "- Share what you learned, tried, or built — give real value (steps, a framework, a checklist).",
        "- Keep the company mention minimal and natural. Never lead with it.",
        "- Close with an honest, open-ended question that invites the community to share their experience.",
        "Tone: Speak like a real person in the community, not a brand account.",
        "Never use marketing-speak, CTAs, or promotional language. Redditors will call it out instantly.",
      ].join("\n");
    default:
      return [
        "Platform: General social",
        "Structure:",
        "- Lead with an insight or observation, not a product announcement.",
        "- Deliver value in the body — a takeaway, a lesson, a useful framing.",
        "- Close with a question or reflection that invites engagement.",
        "Tone: Clear, conversational, value-first. Write like a person, not a brand.",
      ].join("\n");
  }
}

function formatTrendReferences(research: MarketingResearchResult[]): string {
  if (!research.length) return "None available.";

  return research
    .slice(0, 6)
    .map((r, i) => {
      const title = (r.title ?? "Untitled").trim().slice(0, 140);
      const snippet = (r.snippet ?? "").trim().replace(/\s+/g, " ").slice(0, 260);
      const url = (r.url ?? "").trim();
      return `${i + 1}) ${title}\n   ${snippet}${url ? `\n   ${url}` : ""}`;
    })
    .join("\n");
}

const PLATFORM_EXAMPLES: Record<MarketingPlatform, string> = {
    linkedin: `Two examples of strong LinkedIn posts (for style reference only — do NOT copy content):

Example A — Narrative style:
"""
Most marketing teams are still building campaigns the same way they did in 2019. The ones pulling ahead aren't just adopting AI — they're rethinking the entire pipeline.

We spent the last quarter rebuilding how we go from insight to published content. The biggest shift wasn't the tools. It was accepting that manual review cycles were the bottleneck, not creative quality.

Automated research cut our trend analysis from days to hours. Predictive targeting replaced our "spray and hope" approach with data-backed audience selection. And templated personalization let us run 4x the campaigns without scaling the team.

The result isn't just speed — it's focus. Our team now spends time on strategy instead of spreadsheets.

What's the biggest bottleneck in your marketing workflow right now?
"""

Example B — Educational breakdown style:
"""
Marketing automation and marketing strategy are not the same thing. But they're increasingly being treated like they are.

Here's the difference that matters:

Marketing automation
• Executes repetitive tasks at scale
• Follows predefined rules and workflows
• Optimizes what already exists

Marketing strategy
• Decides what to build and why
• Adapts to market shifts and customer signals
• Requires human judgment and context

Where it gets interesting: AI is starting to bridge the gap.

Predictive analytics can surface which segments are underserved. Trend analysis can flag shifts before they're obvious. And automated pipelines can test messaging variations faster than any team could manually.

But the risk is real — when automation outpaces strategy, you're scaling the wrong things faster.

Where does your team draw the line between automating and strategizing?
"""`,
    x: `Example of a strong X post (for style reference only — do NOT copy content):
"""
Your marketing team's bottleneck isn't creative talent — it's manual processes eating 60% of their week.

We automated research + targeting and freed our team to actually think strategically.

What's the one workflow you'd automate first?
"""`,
    reddit: `Example of a strong Reddit post (for style reference only — do NOT copy content):
"""
We were spending more time on campaign logistics than actual strategy. Trend research, audience segmentation, copy variations — all manual, all slow.

So we built an internal pipeline that automates the repetitive parts. Not the creative decisions, just the grunt work: pulling trend data, matching it to our ICP, generating first drafts we can edit.

Early results: campaigns go live in ~2 days instead of ~2 weeks. Quality is about the same (sometimes better, because we actually have time to think now).

Curious if anyone else has tried automating parts of their marketing workflow. What worked, what didn't?
"""`,
    bluesky: `Example of a strong Bluesky post (for style reference only — do NOT copy content):
"""
Hot take: the biggest AI opportunity in marketing isn't content generation — it's killing the busywork that keeps your team from doing actual strategy.

We rebuilt our pipeline around that idea. Early results are promising.
"""`,
};

function formatStrategyBlock(strategy: MessagingStrategy): string {
  return [
    `Positioning angle: ${strategy.angle}`,
    `Key proof: ${strategy.keyProof.join("; ")}`,
    `Human hook: ${strategy.humanHook}`,
    `Avoid: ${strategy.avoidList.join("; ")}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildPrompt(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
    contentType?: ContentType;
}): string {
  const parts = [
    `Selected platform: ${args.platform}`,
    `User prompt: ${args.prompt}`,
    "",
    "Company context (source of truth — all product claims must come from here):",
    args.companyContext,
    "",
    "Trend references (use as narrative hooks or framing, never quote or attribute):",
    formatTrendReferences(args.research),
  ];
  if (args.strategy) {
    parts.push("", "Messaging strategy (use this angle and proof; respect avoid list):", formatStrategyBlock(args.strategy));
  }

  const ctTemplate = args.contentType ? contentTypeTemplate(args.contentType) : "";
  if (ctTemplate) {
    parts.push("", ctTemplate);
  }

  parts.push(
    "",
    platformTemplate(args.platform),
    "",
    PLATFORM_EXAMPLES[args.platform] ?? "",
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

// ---------------------------------------------------------------------------
// Single-variant generation (legacy compat)
// ---------------------------------------------------------------------------

export async function generateCampaignOutput(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    contentType?: ContentType;
}): Promise<{
  platform: MarketingPlatform;
  message: string;
  "image/video": "image" | "video";
  competitiveAngle?: string;
  strategyUsed?: MessagingStrategy;
}> {
  let systemPrompt = args.strategy
    ? SYSTEM_PROMPT_BASE + STRATEGY_RULES
    : SYSTEM_PROMPT_BASE;

  if (args.brandVoice) {
    systemPrompt += buildVoiceDirective(args.brandVoice);
  }
  if (args.targetPersona) {
    systemPrompt += buildPersonaDirective(args.targetPersona);
  }

  const chat = getChatModel(MARKETING_MODELS.contentGeneration);
  const model = chat.withStructuredOutput(MarketingPipelineOutputSchema, {
    name: "marketing_pipeline_output",
  });

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(buildPrompt({ ...args })),
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

// ---------------------------------------------------------------------------
// Multi-variant generation (Area 2)
// ---------------------------------------------------------------------------

export async function generateVariants(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategies: StrategyVariant[];
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    contentType?: ContentType;
}): Promise<ContentVariant[]> {
  const results = await Promise.all(
    args.strategies.map(async (strategy) => {
      const output = await generateCampaignOutput({
        platform: args.platform,
        prompt: args.prompt,
        companyContext: args.companyContext,
        research: args.research,
        strategy,
        brandVoice: args.brandVoice,
        targetPersona: args.targetPersona,
        contentType: args.contentType,
      });

      return {
        variantId: strategy.variantId,
        angleRationale: strategy.angleRationale,
        message: output.message,
        mediaType: output["image/video"],
      } satisfies ContentVariant;
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Refinement (Area 7)
// ---------------------------------------------------------------------------

export async function refineContent(args: {
    platform: MarketingPlatform;
    previousMessage: string;
    feedback: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy: MessagingStrategy;
    brandVoice?: BrandVoice;
}): Promise<RefinementResult> {
  let systemPrompt = SYSTEM_PROMPT_BASE + STRATEGY_RULES;
  systemPrompt += `

Refinement mode:
- You are refining an existing draft based on user feedback.
- Keep the same general angle and facts, but apply the requested changes.
- If the feedback asks for something not in the company context, acknowledge the limitation.`;

  if (args.brandVoice) {
    systemPrompt += buildVoiceDirective(args.brandVoice);
  }

  const humanPrompt = [
    "Previous draft:",
    args.previousMessage,
    "",
    "User feedback:",
    args.feedback,
    "",
    "Company context (source of truth):",
    args.companyContext,
    "",
    "Messaging strategy:",
    formatStrategyBlock(args.strategy),
    "",
    platformTemplate(args.platform),
    "",
    "Task:",
    "- Revise the draft according to the user feedback.",
    "- Keep factual claims grounded in company context.",
    "- Return JSON matching the schema.",
  ].join("\n");

  const chat = getChatModel(MARKETING_MODELS.contentGeneration);
  const model = chat.withStructuredOutput(MarketingPipelineOutputSchema, {
    name: "marketing_pipeline_output",
  });

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(humanPrompt),
  ]);

  const parsed = MarketingPipelineOutputSchema.parse(response);

  return {
    variantId: "refined",
    message: parsed.message,
    mediaType: parsed["image/video"],
    feedbackApplied: args.feedback,
  };
}

