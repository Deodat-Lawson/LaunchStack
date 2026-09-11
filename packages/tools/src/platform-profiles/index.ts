/**
 * platform-profiles — one registry of what each social platform expects.
 *
 * Consolidates the platform knowledge that previously lived in four places
 * (unification PR-5): posting guidelines (marketing run.ts), structure
 * templates and few-shot examples (generator.ts), hashtag caps (generator.ts
 * prompt assembly), hard character limits (publish.ts truncation), and the
 * judge's reference posts (benchmark/references/*.md, now ./references.ts).
 * All values are frozen as they were at extraction time.
 */

import { z } from "zod";

import { REFERENCE_POSTS } from "./references";

export { REFERENCE_POSTS } from "./references";
export type { ReferencePlatform } from "./references";

export const MarketingPlatformEnum = z.enum(["x", "linkedin", "reddit", "bluesky"]);
export type MarketingPlatform = z.infer<typeof MarketingPlatformEnum>;

export interface PlatformMeta {
    subreddit?: string;
    hashtags?: string[];
}

export interface PlatformProfile {
    id: MarketingPlatform;
    /** Campaign-level posting guidance (formerly run.ts buildPlatformGuidelines). */
    guidelines(meta?: PlatformMeta): string;
    /** Post-structure directives for the generation prompt. */
    structureTemplate: string;
    /** Few-shot style examples for the generation prompt. */
    examples: string;
    /** Hashtag cap enforced in the generation prompt. */
    maxHashtags: number;
    /** Hard character limit applied at publish time; null = no hard limit. */
    hardCharLimit: number | null;
    /** Judge calibration examples, when curated for this platform. */
    referencePosts: string | null;
}

const DEFAULT_GUIDELINES =
    "- Write a clear, concise, value-focused message tailored to this platform.";

const DEFAULT_STRUCTURE = [
    "Platform: General social",
    "Structure:",
    "- Lead with an insight or observation, not a product announcement.",
    "- Deliver value in the body — a takeaway, a lesson, a useful framing.",
    "- Close with a question or reflection that invites engagement.",
    "Tone: Clear, conversational, value-first. Write like a person, not a brand.",
].join("\n");

export const PLATFORM_PROFILES: Record<MarketingPlatform, PlatformProfile> = {
    x: {
        id: "x",
        guidelines: () =>
            [
                "- Keep posts tight and high-signal; front-load the hook in the first line.",
                "- Use 1–2 sharp talking points instead of long paragraphs.",
                "- Sprinkle in 1–2 relevant hashtags, but avoid hashtag spam.",
                "- When appropriate, reference current trends or conversations in the space.",
                "- Make the call-to-action explicit and easy to understand.",
            ].join("\n"),
        structureTemplate: [
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
        ].join("\n"),
        examples: `Example of a strong X post (for style reference only — do NOT copy content):
"""
Your marketing team's bottleneck isn't creative talent — it's manual processes eating 60% of their week.

We automated research + targeting and freed our team to actually think strategically.

What's the one workflow you'd automate first?
"""`,
        maxHashtags: 2,
        hardCharLimit: 280,
        referencePosts: REFERENCE_POSTS.x,
    },
    linkedin: {
        id: "linkedin",
        guidelines: () =>
            [
                "- Use a strong first line that clearly states the outcome or insight.",
                "- Write in short paragraphs or bullet points for easy scanning.",
                "- Frame the message around business impact, transformation, or a concrete case.",
                "- Keep the tone professional but human—less hype, more signal.",
                "- Close with a takeaway or a soft call-to-action tailored to professionals.",
            ].join("\n"),
        structureTemplate: [
            "Platform: LinkedIn",
            "Structure:",
            "- Line 1 (the hook): Use contrast, a counterintuitive claim, or a specific result.",
            '  Good hooks: "Most teams do X. The ones winning do Y." / "We stopped doing X. Here\'s what happened."',
            '  Bad hooks: "Excited to announce…" / "Introducing our new…"',
            "- Body: Pick the format that best serves the content:",
            "  Option A (Narrative): 3–6 short paragraphs telling a mini-story or walking through a shift in thinking.",
            "  Option B (Educational breakdown): Structured sections with clear labels and bullet points to explain a concept, compare approaches, or present a framework.",
            "  Either way, each section must deliver one clear insight. Weave in business impact naturally (time saved, risk reduced, clarity gained).",
            "- Closing: End with a specific question that invites perspectives, or a takeaway the reader can act on.",
            '  Good CTAs: "Where is your team on this?" / "What\'s working in your stack?"',
            '  Bad CTAs: "Let\'s connect!" / "DM me for more info"',
            "Tone: Professional but human. Think operator sharing a playbook, not company posting an ad.",
        ].join("\n"),
        examples: `Two examples of strong LinkedIn posts (for style reference only — do NOT copy content):

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
        maxHashtags: 3,
        hardCharLimit: null,
        referencePosts: REFERENCE_POSTS.linkedin,
    },
    reddit: {
        id: "reddit",
        guidelines: meta => {
            const lines = [
                "- Speak like a real community member, not a brand account.",
                "- Lead with a specific pain point or story that matches the subreddit.",
                "- Avoid pure self-promotion: focus on value, insight, or behind-the-scenes context.",
                "- Use clear, descriptive titles; body can be longer and conversational.",
                "- Invite discussion with an authentic question at the end.",
            ];
            if (meta?.subreddit) {
                lines.push(
                    "",
                    `Target subreddit: ${meta.subreddit}`,
                    "Tailor your tone, vocabulary, and content depth to match this subreddit's norms and audience expectations."
                );
            }
            return lines.join("\n");
        },
        structureTemplate: [
            "Platform: Reddit",
            "Structure:",
            "- Open with a relatable pain point, a story, or a specific problem you encountered.",
            "- Share what you learned, tried, or built — give real value (steps, a framework, a checklist).",
            "- Keep the company mention minimal and natural. Never lead with it.",
            "- Close with an honest, open-ended question that invites the community to share their experience.",
            "Tone: Speak like a real person in the community, not a brand account.",
            "Never use marketing-speak, CTAs, or promotional language. Redditors will call it out instantly.",
        ].join("\n"),
        examples: `Example of a strong Reddit post (for style reference only — do NOT copy content):
"""
We were spending more time on campaign logistics than actual strategy. Trend research, audience segmentation, copy variations — all manual, all slow.

So we built an internal pipeline that automates the repetitive parts. Not the creative decisions, just the grunt work: pulling trend data, matching it to our ICP, generating first drafts we can edit.

Early results: campaigns go live in ~2 days instead of ~2 weeks. Quality is about the same (sometimes better, because we actually have time to think now).

Curious if anyone else has tried automating parts of their marketing workflow. What worked, what didn't?
"""`,
        maxHashtags: 0,
        hardCharLimit: null,
        referencePosts: REFERENCE_POSTS.reddit,
    },
    bluesky: {
        id: "bluesky",
        guidelines: () => DEFAULT_GUIDELINES,
        structureTemplate: DEFAULT_STRUCTURE,
        examples: `Example of a strong Bluesky post (for style reference only — do NOT copy content):
"""
Hot take: the biggest AI opportunity in marketing isn't content generation — it's killing the busywork that keeps your team from doing actual strategy.

We rebuilt our pipeline around that idea. Early results are promising.
"""`,
        maxHashtags: 0,
        hardCharLimit: 300,
        referencePosts: null,
    },
};

export function getPlatformProfile(platform: MarketingPlatform): PlatformProfile {
    return PLATFORM_PROFILES[platform];
}
