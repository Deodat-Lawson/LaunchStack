import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type {
  MarketingPlatform,
  MarketingResearchResult,
  MessagingStrategy,
  BrandVoice,
  TargetPersona,
  ContentType,
  StrategyVariant,
  ContentVariant,
  RefinementResult,
} from "~/lib/tools/marketing-pipeline/types";
import { MarketingPipelineOutputSchema } from "~/lib/tools/marketing-pipeline/types";

const SYSTEM_PROMPT_BASE = `You are a sharp B2B copywriter who writes like an operator sharing hard-won lessons—not a brand broadcasting announcements.

Voice & craft:
- Write as a knowledgeable peer, not a marketing department. First person ("we", "our team") is fine.
- Lead every post with tension, contrast, or a surprising insight. The first line must stop the scroll.
- Every sentence must earn its place. Cut filler, qualifiers, and throat-clearing ("Introducing…", "We're excited to…").
- Match format to content: use narrative paragraphs for stories and lessons learned; use structured bullets/lists for educational breakdowns, comparisons, or frameworks. Pick whichever serves the message best.
- End with a SINGLE question or soft CTA that invites genuine conversation, not a generic "Let's connect!" Only one question — never two in a row.
- Use trend references to frame the narrative or set up a tension, but never quote or attribute them directly.

Staying honest (CRITICAL — violations make the content unusable):
- Company context is your SINGLE SOURCE OF TRUTH for product claims, features, metrics, and results.
- NEVER invent capabilities, partnerships, customers, numbers, or people/names not in the company context.
- NEVER fabricate case studies, testimonials, or anecdotes with made-up names (e.g. "Sarah, a CTO..."). If a human hook is needed, use "we" or "our team" — NEVER a fictional character.
- NEVER reference or attribute specific facts to external companies (e.g. "Snowflake's feature", "Company X's approach") from trend references. Trends are for framing only.
- If a detail isn't in the context, reframe it as a general industry observation or an open question.
- If the company context is sparse, write about the INDUSTRY PROBLEM and the company's general approach — do NOT fill gaps with invented specifics.
- Skip hype words ("revolutionary", "game-changing", "best-in-class") unless the context explicitly supports them.

STRICT anti-patterns — NEVER do any of these:
- NEVER list product features as bullet points (e.g. "Here's how X empowers you: - Feature A… - Feature B…"). Weave capabilities into a narrative instead.
- NEVER acknowledge product shortcomings, roadmap gaps, or areas "we're still working on." Marketing copy should project confidence.
- NEVER open with generic statements like "Many teams find themselves…" or "In today's fast-paced world…". These are the same as "Excited to announce" — instant scroll-past.
- NEVER use more than 3 hashtags on LinkedIn, 2 on X, or 0 on Reddit. Fewer is always better.
- NEVER end with two questions. Pick one focused question.
- NEVER write in a way that reads like a product page, press release, or ad copy.

Media selection:
- Pick "image" for static visuals (diagrams, workflows, checklists, data snapshots).
- Pick "video" for demos, explainers, or anything that benefits from motion.

Output:
- Return JSON matching the schema exactly. No extra keys.`;

const STRATEGY_RULES = `
When a Messaging Strategy is provided:
- Lead with the recommended angle and human hook when it fits the platform; balance human story with technical depth.
- Back claims with the key proof points given; do not add proof not in company context.
- If the human hook mentions a named person, replace them with "we", "our team", "one of our engineers", etc. NEVER use fabricated character names.
- Do NOT use any phrase or theme in the strategy's avoid list.
- Do NOT reference external companies or products from trend references as if they are your own features or proof points.
- Keep the post aligned with the positioning angle while staying platform-native.`;

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

const PLATFORM_EXAMPLES: Record<MarketingPlatform, string> = {
    linkedin: `Two examples of strong LinkedIn posts (for style reference only — do NOT copy content):

Example A — Narrative style (GOOD):
"""
Most marketing teams are still building campaigns the same way they did in 2019. The ones pulling ahead aren't just adopting AI — they're rethinking the entire pipeline.

We spent the last quarter rebuilding how we go from insight to published content. The biggest shift wasn't the tools. It was accepting that manual review cycles were the bottleneck, not creative quality.

Automated research cut our trend analysis from days to hours. Predictive targeting replaced our "spray and hope" approach with data-backed audience selection. And templated personalization let us run 4x the campaigns without scaling the team.

The result isn't just speed — it's focus. Our team now spends time on strategy instead of spreadsheets.

What's the biggest bottleneck in your marketing workflow right now?
"""

Example B — Educational breakdown style (GOOD):
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
"""

Example C — BAD post (DO NOT write like this):
"""
Many teams find themselves buried under a mountain of documents, but those who succeed transform this challenge into an advantage.

Here's how ProductX empowers you:
- Feature A: It analyzes your documents, turning them into actionable insights.
- Feature B: Our open-source platform benefits from a vibrant community.
- Feature C: While enhancing customizability remains a priority, our workflows already support quick decision-making.

This isn't just about speed—it's about clarity and focus.

How does your team handle document overload? Where do you see the biggest opportunity to streamline?

#Marketing #AI #Efficiency #Automation #Tech #ProductX
"""
Why this is bad: Generic opener, feature bullet list reads like a product page, acknowledges a weakness ("remains a priority"), two questions at the end, 6 hashtags is excessive, hollow claims without specific proof.`,
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

interface PlatformMeta {
  subreddit?: string;
  hashtags?: string[];
}

function buildPrompt(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
    platformMeta?: PlatformMeta;
    /** When the user pinned specific docs, we must honor explicit KB requests (names, codewords) over generic hooks. */
    sourceDocumentIds?: number[];
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

  if (args.sourceDocumentIds?.length) {
    parts.push(
      "",
      "── Selected knowledge sources (user pinned specific documents) ──",
      "The company context is grounded in those uploads (plus directory fields). This is NOT generic web research.",
      "- If the user prompt asks you to name, quote, or explicitly mention a concrete fact, phrase, codeword, or 'secret word' that appears in the company context, you MUST state it clearly in the post. Do not substitute a metaphor, unrelated anecdote, or 'Wordle-style' story when a literal answer exists in the context.",
      "- If the user asks for something that does not appear in the company context, say so honestly in one short phrase or sentence, then write a reasonable post from what IS available.",
      "- The user’s explicit instructions and verbatim KB facts outrank a clever hook: satisfy the explicit ask first, then deliver the narrative.",
    );
  }

  if (args.platformMeta?.subreddit) {
    parts.push(
      "",
      `Target subreddit: ${args.platformMeta.subreddit}`,
      "Tailor your tone and content to match this subreddit's norms and audience.",
    );
  }
  if (args.platformMeta?.hashtags?.length) {
    parts.push(
      "",
      `Preferred hashtags (incorporate naturally if relevant): ${args.platformMeta.hashtags.join(", ")}`,
    );
  }

  parts.push(
    "",
    platformTemplate(args.platform),
    "",
    (PLATFORM_EXAMPLES[args.platform] ?? ""),
    "",
    "Task:",
    args.strategy
      ? "- Write ONE post using the messaging strategy angle and proof; respect the avoid list."
      : "- Pick ONE angle — a tension, trend, or insight — and commit to it.",
    args.sourceDocumentIds?.length
      ? "- If the user asked you to state a specific fact, phrase, codeword, or quote from the materials first, put that in the opening lines (that can be your hook), then transition into the broader story."
      : "",
    args.sourceDocumentIds?.length
      ? "- If the user prompt has multiple parts (e.g. answer a factual question, then discuss the company), cover them in that order."
      : "",
    args.sourceDocumentIds?.length
      ? "- If you did not open with a required verbatim fact from the user prompt, open with a hook that creates curiosity or contrast (never a hollow announcement)."
      : "- Open with a hook that creates curiosity or contrast. Never open with an announcement or generic statement.",
    "- Build a short narrative arc: hook → insight/story → takeaway → CTA/question.",
    "- Write as a person sharing what they've learned, not a brand listing features.",
    "- NEVER list features as bullet points. Weave capabilities into the narrative naturally.",
    "- NEVER acknowledge product weaknesses or areas under development.",
    "- Ground all product claims in the company context. Reframe anything unsupported as an industry observation.",
    "- End with exactly ONE question or CTA, not two.",
    `- Use at most ${args.platform === "linkedin" ? 3 : args.platform === "x" ? 2 : 0} hashtags. Fewer is better.`,
    args.platformMeta?.hashtags?.length
      ? "- Prefer the user's preferred hashtags over generic ones."
      : "",
    "- Return JSON matching the schema exactly.",
  );
  return parts.join("\n");
}

/* ──────────────────────────────────────────────────────────────
 * Quality gate — optional post-generation validation
 * ────────────────────────────────────────────────────────────── */

const QualityScoreSchema = z.object({
  score: z.number().min(1).max(10),
  issues: z.array(z.string()),
  rewrite: z.string().nullable(),
});

const QUALITY_THRESHOLD = 6;

async function validatePostQuality(
  post: string,
  platform: MarketingPlatform,
): Promise<{ score: number; issues: string[]; rewrite: string | null }> {
  const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
  const model = chat.withStructuredOutput(QualityScoreSchema, { name: "quality_check" });

  const response = await model.invoke([
    new SystemMessage(
      `You are a social media copy editor. Score this ${platform} post 1-10 on these criteria:
1. Hook strength (does the first line stop the scroll?)
2. Authenticity (does it sound like a person, not a brand?)
3. Platform fit (does it match ${platform} conventions?)
4. Specificity (are claims backed by concrete details, not vague hype?)
5. Structure (is it narrative-driven rather than a feature list?)

If score < ${QUALITY_THRESHOLD}, provide a "rewrite" field with an improved version that fixes the issues.
Flag specific issues in "issues" array.`,
    ),
    new HumanMessage(post),
  ]);

  return QualityScoreSchema.parse(response);
}

/* ──────────────────────────────────────────────────────────────
 * Main generation
 * ────────────────────────────────────────────────────────────── */

export async function generateCampaignOutput(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
    enableQualityGate?: boolean;
    platformMeta?: PlatformMeta;
    sourceDocumentIds?: number[];
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
    new HumanMessage(buildPrompt({
      platform: args.platform,
      prompt: args.prompt,
      companyContext: args.companyContext,
      research: args.research,
      strategy: args.strategy,
      platformMeta: args.platformMeta,
      sourceDocumentIds: args.sourceDocumentIds,
    })),
  ]);

  let parsed = MarketingPipelineOutputSchema.parse(response);

  if (args.enableQualityGate) {
    try {
      const quality = await validatePostQuality(parsed.message, args.platform);
      console.log(
        "[marketing-pipeline] quality gate: score=%d issues=%d",
        quality.score, quality.issues.length,
      );
      if (quality.score < QUALITY_THRESHOLD && quality.rewrite) {
        parsed = { ...parsed, message: quality.rewrite };
        console.log("[marketing-pipeline] quality gate rewrote post (score was %d)", quality.score);
      }
    } catch (err) {
      console.warn("[marketing-pipeline] quality gate failed, using original:", err);
    }
  }

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

/* ──────────────────────────────────────────────────────────────
 * Voice & persona directives
 * ────────────────────────────────────────────────────────────── */

function buildVoiceDirective(voice: BrandVoice): string {
  return [
    "\n## Brand Voice Directive",
    `Tone: ${voice.toneDescriptor}`,
    `Formality: ${voice.formalityLevel}`,
    `Style: ${voice.sentenceStyle}`,
    `Use these characteristic phrases when natural: ${voice.vocabularyExamples.join(", ")}`,
    "Match this voice throughout the post.",
  ].join("\n");
}

function buildPersonaDirective(persona: TargetPersona): string {
  return [
    "\n## Audience Persona Directive",
    `Writing for: ${persona.role}`,
    `Their pain points: ${persona.painPoints.join("; ")}`,
    `They prioritize: ${persona.priorities.join("; ")}`,
    `Speak to them: ${persona.languageStyle}`,
    "Address their specific concerns. Make it feel written for them.",
  ].join("\n");
}

/* ──────────────────────────────────────────────────────────────
 * Content type templates
 * ────────────────────────────────────────────────────────────── */

function contentTypeTemplate(type: ContentType | undefined): string {
  switch (type) {
    case "thread":
      return "\nFORMAT: Write as a numbered thread (Tweet 1/N format). Each part should be self-contained but build a narrative. 3-6 parts max.";
    case "ad_copy":
      return "\nFORMAT: Write concise ad copy with a headline, sub-headline, body (2-3 lines), and CTA. Optimize for conversion.";
    case "email":
      return "\nFORMAT: Write as a marketing email with subject line, preview text, body, and CTA button text. Keep it scannable.";
    case "multi_platform":
      return "\nFORMAT: Provide versions for LinkedIn (long), X (short), and Reddit (community-style) in a single response. Separate with platform headers.";
    default:
      return "";
  }
}

/* ──────────────────────────────────────────────────────────────
 * Multi-variant generation (one per strategy)
 * ────────────────────────────────────────────────────────────── */

export async function generateVariants(args: {
  platform: MarketingPlatform;
  prompt: string;
  companyContext: string;
  research: MarketingResearchResult[];
  strategies: StrategyVariant[];
  enableQualityGate?: boolean;
  platformMeta?: PlatformMeta;
  brandVoice?: BrandVoice;
  targetPersona?: TargetPersona;
  contentType?: ContentType;
  /** User-pinned docs — enables stricter honoring of verbatim facts in the prompt. */
  sourceDocumentIds?: number[];
}): Promise<ContentVariant[]> {
  const results = await Promise.all(
    args.strategies.map(async (strategy) => {
      const strategyAsMessaging: MessagingStrategy = {
        angle: strategy.angle,
        keyProof: strategy.keyProof,
        humanHook: strategy.humanHook,
        avoidList: strategy.avoidList,
      };

      let systemPrompt = SYSTEM_PROMPT_BASE + STRATEGY_RULES;
      if (args.brandVoice) systemPrompt += buildVoiceDirective(args.brandVoice);
      if (args.targetPersona) systemPrompt += buildPersonaDirective(args.targetPersona);
      systemPrompt += contentTypeTemplate(args.contentType);

      const chat = getChatModel(MARKETING_MODELS.contentGeneration);
      const model = chat.withStructuredOutput(MarketingPipelineOutputSchema, {
        name: "marketing_pipeline_output",
      });

      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(buildPrompt({
          platform: args.platform,
          prompt: args.prompt,
          companyContext: args.companyContext,
          research: args.research,
          strategy: strategyAsMessaging,
          platformMeta: args.platformMeta,
          sourceDocumentIds: args.sourceDocumentIds,
        })),
      ]);

      let parsed = MarketingPipelineOutputSchema.parse(response);

      if (args.enableQualityGate) {
        try {
          const quality = await validatePostQuality(parsed.message, args.platform);
          if (quality.score < QUALITY_THRESHOLD && quality.rewrite) {
            parsed = { ...parsed, message: quality.rewrite };
          }
        } catch {
          // keep original
        }
      }

      return {
        variantId: strategy.variantId,
        angleRationale: strategy.angleRationale,
        message: parsed.message,
        mediaType: parsed["image/video"],
      } satisfies ContentVariant;
    }),
  );

  return results;
}

/* ──────────────────────────────────────────────────────────────
 * Iterative refinement
 * ────────────────────────────────────────────────────────────── */

const RefinementSchema = z.object({
  message: z.string(),
  "image/video": z.enum(["image", "video"]),
  feedbackApplied: z.string(),
});

export async function refineContent(args: {
  platform: MarketingPlatform;
  originalMessage: string;
  feedback: string;
  companyContext: string;
  brandVoice?: BrandVoice;
}): Promise<RefinementResult> {
  let systemPrompt = `You are a marketing copywriter refining an existing post. Apply the user's feedback while maintaining the platform style and all original brand voice guidelines.

Rules:
- Apply the specific feedback the user gave.
- Keep the same general structure and angle unless the feedback asks to change it.
- Never invent product capabilities not in the company context.
- feedbackApplied: one sentence summarizing what you changed.
- Return JSON matching the schema.`;

  if (args.brandVoice) systemPrompt += buildVoiceDirective(args.brandVoice);

  const chat = getChatModel(MARKETING_MODELS.refinement);
  const model = chat.withStructuredOutput(RefinementSchema, { name: "refined_content" });

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage([
      `Platform: ${args.platform}`,
      `Original post:\n${args.originalMessage}`,
      `\nUser feedback: ${args.feedback}`,
      `\nCompany context:\n${args.companyContext}`,
    ].join("\n")),
  ]);

  const parsed = RefinementSchema.parse(response);
  return {
    variantId: "refined",
    message: parsed.message,
    mediaType: parsed["image/video"],
    feedbackApplied: parsed.feedbackApplied,
  };
}

