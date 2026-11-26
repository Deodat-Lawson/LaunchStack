/**
 * Profiles for the networks the campaign generator writes for and nothing
 * posts to (see `DraftOnlyPlatformEnum`). Each one is the network's own
 * conventions, written for the generation prompt: what the post is made of,
 * how long it can run, how it is found, and what gets it ignored there.
 *
 * Limits are the networks' documented ones as of November 2026. A profile
 * whose post is several labelled parts (a script, a launch page, a forum
 * submission) has no single hard limit; its parts' limits are in the
 * structure template, and `formatRules` tells the generator the parts win
 * over the generic "write one post" rules.
 */

import type { DraftOnlyPlatform, PlatformProfile } from "./index";

/** How a profile made of labelled parts asks for them, so every one reads alike. */
const LABELLED_PARTS =
    "Write every label in bold capitals followed by a colon (for example **TITLE:**), in the order given, with a blank line between parts.";

/**
 * A launch page and a Show HN both have to say what the product is, which is
 * exactly where a thin company context gets filled in with a guess.
 */
const NO_GUESSING =
    "Say what the product is only in the terms the company context uses. If the context does not say what it does, write about what the context does describe (the launch, the change, the problem it names) and do not guess a product category or a feature set.";

export const DRAFT_ONLY_PROFILES: Record<DraftOnlyPlatform, PlatformProfile> = {
    instagram: {
        id: "instagram",
        promptName: "Instagram",
        guidelines: () =>
            [
                "- The image or Reel carries the post; the caption tells the story the visual cannot.",
                "- Put the hook in the first 125 characters: the feed cuts the caption there.",
                "- Write short lines with line breaks, one idea per line.",
                "- Links in a caption are not clickable. Ask for a save, a comment, or point to the link in bio.",
                "- Finish with 3–5 specific hashtags; broad ones like #business find nobody.",
            ].join("\n"),
        structureTemplate: [
            "Platform: Instagram (caption for a feed post or Reel)",
            "Structure:",
            "- Line 1: the hook, complete within 125 characters. The feed shows nothing after that until someone taps “more”.",
            "- Body: 2–5 short lines or mini-paragraphs with the story behind the visual: what happened, what changed, what you learned.",
            "- Close: one ask that works without a link (save this, comment one word, link in bio).",
            "- Last line, after a blank line: 3–5 specific hashtags.",
            "Constraints:",
            "- Hard limit 2,200 characters, hashtags included. Aim for 300–800.",
            "- No URLs in the caption; they are not clickable.",
            "Tone: Warm, personal and concrete. A founder's own account, not a brand's.",
        ].join("\n"),
        examples: `Example of a strong Instagram caption (for style reference only — do NOT copy content):
"""
We deleted our content calendar. Output went up.

For a year we planned posts six weeks out. Every one was stale by the time it shipped.

Now we plan one week, and research and first drafts are automated, so the team spends its time on the part that needs a person: deciding what is worth saying.

Same team. Four times the campaigns.

Save this for your next planning session.

#MarketingOps #StartupMarketing #ContentStrategy #B2BMarketing
"""`,
        maxHashtags: 5,
        hardCharLimit: 2200,
        referencePosts: null,
    },
    threads: {
        id: "threads",
        promptName: "Threads",
        guidelines: () =>
            [
                "- Threads is a conversation: write something people can answer, not an announcement.",
                "- One thought per post, in plain spoken language.",
                "- Opinions and honest observations travel; polished brand copy does not.",
                "- A post carries at most one topic tag, and most carry none.",
                "- Skip the link unless the post is worthless without it.",
            ].join("\n"),
        structureTemplate: [
            "Platform: Threads",
            "Structure:",
            "- Open with the opinion, observation or question itself. No preamble.",
            "- 1–3 short lines that back it with something specific you saw or did.",
            "- End on a question or an unfinished thought people will want to reply to.",
            "Constraints:",
            "- Hard limit 500 characters. Aim for under 300.",
            "- At most one topic tag, and only if it names the community the post is for.",
            "- No hashtag block, no link bait, no “follow for more”.",
            "Tone: Casual and direct, like talking to a room of peers. Lower case energy, full sentences.",
        ].join("\n"),
        examples: `Example of a strong Threads post (for style reference only — do NOT copy content):
"""
Unpopular opinion: most marketing teams don't have a creativity problem. They have a spreadsheet problem.

We automated the research and the first drafts, and the same four people now ship four times the campaigns.

What's the one task you'd hand to a machine tomorrow?
"""`,
        maxHashtags: 1,
        hardCharLimit: 500,
        referencePosts: null,
    },
    facebook: {
        id: "facebook",
        promptName: "Facebook",
        guidelines: () =>
            [
                "- Write for a Page's followers: customers and people who already know the company.",
                "- Keep it short; the first two lines must carry the post before “See more”.",
                "- Plain, friendly language. A question people can answer from their own experience works best.",
                "- A link is fine, after the reason to click it.",
                "- Hashtags do little here: none, or one or two at most.",
            ].join("\n"),
        structureTemplate: [
            "Platform: Facebook (Page post)",
            "Structure:",
            "- First 1–2 lines: the news, story or question, complete on their own. Everything after is behind “See more”.",
            "- 2–4 more short sentences with one concrete detail: a number, a customer moment, what changed.",
            "- Close with one question or one clear next step.",
            "Constraints:",
            "- Aim for 40–120 words. The limit (63,206 characters) is not a target.",
            "- At most 2 hashtags, at the end. None is normal.",
            "Tone: Friendly and plain, like a note to people who already like you. No corporate voice.",
        ].join("\n"),
        examples: `Example of a strong Facebook post (for style reference only — do NOT copy content):
"""
A year ago a campaign took us two weeks to get out the door. Last month it took two days.

Nothing magic happened. We stopped doing the research and first drafts by hand, and gave that time back to the people who know our customers best.

If you run marketing for a small team: what is the one job that eats your week?
"""`,
        maxHashtags: 2,
        hardCharLimit: null,
        referencePosts: null,
    },
    tiktok: {
        id: "tiktok",
        promptName: "TikTok",
        formatRules: [
            "Write a short video script in the labelled parts of the platform structure, not a text post.",
            "The hook is one spoken line. The single question or call to action is the last script beat.",
            "Numbered script beats are the format here, not a feature list: each beat is one thing said and one thing shown.",
            'Set "image/video" to "video".',
        ],
        guidelines: () =>
            [
                "- The post is a short vertical video; the words are a script, then a caption.",
                "- The first three seconds decide everything: open on the result, the mistake or the question.",
                "- One person talking to camera beats anything that looks like an ad.",
                "- Show the thing: screen recordings and real work, not stock footage.",
                "- The caption adds context and 3–5 hashtags; only the first five count.",
            ].join("\n"),
        structureTemplate: [
            "Platform: TikTok (short vertical video: script and caption)",
            "Write the post as these labelled parts:",
            "- HOOK (0–3s): one spoken line that stops the scroll: a result, a mistake or a question. No greeting, no “hey guys”, no introduction.",
            "- SCRIPT: 3–5 numbered beats. Each beat is one spoken line, then what is on screen in [square brackets]. 20–40 seconds in all, about 60–100 spoken words.",
            "- ON-SCREEN TEXT: the 3–6 word overlay on the first frame.",
            "- CAPTION: one or two lines under 150 characters that add context, then 3–5 hashtags.",
            LABELLED_PARTS,
            "Constraints:",
            "- The caption's limit is 2,200 characters; a short one is read.",
            "- Plain spoken words. If it would sound odd said aloud, rewrite it.",
            "Tone: A person talking to camera: fast, specific, a little informal. Never an advert.",
        ].join("\n"),
        examples: `Example of a strong TikTok script (for style reference only — do NOT copy content):
"""
**HOOK (0–3s):** We cut campaign prep from two weeks to two days. Here's the boring reason.

**SCRIPT:**

1. Most of those two weeks was research nobody enjoyed. [Screen recording: a spreadsheet with forty tabs]
2. So we automated the trend research and the first drafts. [Screen recording: a draft appearing]
3. The team only edits and decides what's worth saying. [Two people reviewing a draft at a desk]
4. Same four people, four times the campaigns. What would you automate first? [Back to camera]

**ON-SCREEN TEXT:** 2 weeks → 2 days

**CAPTION:** The part of marketing nobody posts about. #MarketingOps #StartupTok #B2BMarketing
"""`,
        maxHashtags: 5,
        hardCharLimit: null,
        referencePosts: null,
    },
    youtube: {
        id: "youtube",
        promptName: "YouTube",
        formatRules: [
            "Write the video's title, opening, outline and description in the labelled parts of the platform structure, not a text post.",
            "The title says what the viewer gets; it is not a teaser. The single question or call to action is the description's last sentence before the hashtags.",
            "A numbered outline is the format here, not a feature list: each line is one section of the video.",
            'Set "image/video" to "video".',
        ],
        guidelines: () =>
            [
                "- People find YouTube videos by searching: the title and the first two lines of the description do the work.",
                "- Say what the viewer will be able to do after watching.",
                "- The first fifteen seconds must name the problem and promise the answer.",
                "- Teach something complete; a video that only teases the product is not watched.",
                "- At most three hashtags, at the end of the description. They show above the title.",
            ].join("\n"),
        structureTemplate: [
            "Platform: YouTube (video title, opening, outline and description)",
            "Write the post as these labelled parts:",
            "- TITLE: under 70 characters (the limit is 100, and search cuts longer ones). Specific and searchable: what the viewer gets. No clickbait, no ALL CAPS, no emoji.",
            "- HOOK (first 15s): the one or two sentences spoken first: the problem, and what this video shows.",
            "- OUTLINE: 3–5 numbered sections, one line each, in the order the video covers them.",
            "- DESCRIPTION: two lines that summarise the video (they show before “more” and in search), then 2–4 short lines of detail, then up to 3 hashtags on the last line.",
            LABELLED_PARTS,
            "Constraints:",
            "- The description's limit is 5,000 characters; aim for under 600.",
            "- Do not promise anything in the title that the outline does not deliver.",
            "Tone: A clear teacher who has done the thing. Useful first; the product appears as how you did it.",
        ].join("\n"),
        examples: `Example of strong YouTube copy (for style reference only — do NOT copy content):
"""
**TITLE:** How a 4-person team ships a marketing campaign in 2 days

**HOOK (first 15s):** Our campaigns used to take two weeks, and most of that was research. In this video I'll walk through the exact pipeline that got it down to two days.

**OUTLINE:**

1. Where the two weeks actually went
2. Automating trend research
3. First drafts the team edits instead of writes
4. What we still do by hand, and why

**DESCRIPTION:** A walkthrough of how a four-person marketing team cut campaign prep from two weeks to two days by automating research and first drafts.

We cover where the time went, what we automated first, and the review step we kept on purpose.

What would you automate first? Tell us in the comments.

#MarketingOps #B2BMarketing #Startups
"""`,
        maxHashtags: 3,
        hardCharLimit: null,
        referencePosts: null,
    },
    mastodon: {
        id: "mastodon",
        promptName: "Mastodon",
        guidelines: () =>
            [
                "- There is no algorithm: a post is found through hashtags and boosts, so hashtags matter here.",
                "- Write hashtags in CamelCase (#OpenSource) so screen readers can read them.",
                "- Say plainly that it is your project; undisclosed promotion is unwelcome.",
                "- People here value openness, privacy and craft over growth and hype.",
                "- No engagement bait. A real question to the community is welcome.",
            ].join("\n"),
        structureTemplate: [
            "Platform: Mastodon",
            "Structure:",
            "- Open by saying what you made or learned, as yourself (“we build…”, “I spent the week…”).",
            "- 1–3 sentences with the specific, useful part: how it works, what surprised you, what is open.",
            "- Optionally one honest question to the community.",
            "- Last line: 2–4 CamelCase hashtags that name the topic.",
            "Constraints:",
            "- Hard limit 500 characters, hashtags included.",
            "- No marketing words, no urgency, no “link in bio”.",
            "Tone: A person in a community of peers: modest, specific, a bit technical.",
        ].join("\n"),
        examples: `Example of a strong Mastodon post (for style reference only — do NOT copy content):
"""
We build tools for small marketing teams, and this month we stopped doing trend research by hand.

A pipeline pulls the sources, drafts a first version, and a person decides what is worth saying. Campaign prep went from two weeks to two days.

Has anyone else kept a human review step on purpose? Curious how you draw the line.

#Marketing #Automation #SmallTeams
"""`,
        maxHashtags: 4,
        hardCharLimit: 500,
        referencePosts: null,
    },
    hackernews: {
        id: "hackernews",
        promptName: "Hacker News",
        formatRules: [
            "Write a Show HN submission in the labelled parts of the platform structure: a title and a text.",
            "No hook, no scroll-stopping first line and no call to action: the first sentence states what it is, and the only ask is for feedback.",
            "The title and the text are plain text: no Markdown inside them, no bullets, no emoji, no hashtags, no exclamation marks.",
            "Technical detail must come from the company context. If the context has none, describe the approach in general terms rather than inventing a stack.",
            "Say who you are only as far as the company context does. “We” is enough: never invent a team size, a role (“solo developer”) or a backstory.",
            NO_GUESSING,
        ],
        guidelines: () =>
            [
                "- Readers are engineers and founders who flag anything that reads as marketing.",
                "- Say what it is in plain words; superlatives and adjectives cost credibility.",
                "- Technical substance earns attention: how it works, what was hard, the trade-offs.",
                "- Use “Show HN” only for something people can try now.",
                "- Ask for feedback and mean it; the maker is expected to answer in the thread.",
            ].join("\n"),
        structureTemplate: [
            "Platform: Hacker News (Show HN submission: title and text)",
            "Write the post as these labelled parts:",
            "- TITLE: under 80 characters (the hard limit). Start with “Show HN: ” then the product's name, a dash, and plainly what it is. No superlatives, no marketing words.",
            "- TEXT: 100–250 words in plain paragraphs, in this order: who you are (“we” is enough) and what you built; the problem that led to it and how it works, with real technical detail; how it differs from existing tools, stated factually; what you would like feedback on.",
            LABELLED_PARTS,
            "Constraints:",
            "- Plain text inside each part: blank lines between paragraphs and nothing else.",
            "- Never “excited”, “game-changing”, “revolutionary”, “check out” or “sign up today”.",
            "Tone: An engineer explaining their own work to other engineers: modest, specific, factual.",
        ].join("\n"),
        examples: `Example of a strong Hacker News submission (for style reference only — do NOT copy content):
"""
**TITLE:** Show HN: Campaignkit – a pipeline that drafts marketing posts from your own docs

**TEXT:** Hi HN, we're a team of four and we built Campaignkit because campaign prep was taking us two weeks, most of it research.

It reads the documents a company already has, pulls current sources on the topic, and writes first drafts a person then edits. Every factual claim in a draft is checked against the documents and shown with the passage it came from, so nothing ships that the company can't back.

The part that took longest was the claim check: retrieval alone was not enough, so a second pass decides whether a passage actually states the claim.

It differs from general writing tools in that it will not write a claim it can't find a source for.

We'd like feedback on the claim check in particular, and on where the drafts still read as generated.
"""`,
        maxHashtags: 0,
        hardCharLimit: null,
        referencePosts: null,
    },
    producthunt: {
        id: "producthunt",
        promptName: "Product Hunt",
        formatRules: [
            "Write launch-page copy in the labelled parts of the platform structure: a tagline, a description and the maker's first comment.",
            "The tagline and description state what the product does; they are not hooks. The single question goes at the end of the first comment.",
            "The first comment is first person and tells why it was built, from the company context. Never invent a founder's name or backstory.",
            NO_GUESSING,
        ],
        guidelines: () =>
            [
                "- A launch is three pieces of copy: a tagline, a short description and the maker's first comment.",
                "- The tagline says what it does for whom; clever ones lose to clear ones.",
                "- The first comment is the story: why you built it, in the maker's own voice.",
                "- The community is makers; talk to them as one, and ask for feedback.",
                "- Never ask for upvotes.",
            ].join("\n"),
        structureTemplate: [
            "Platform: Product Hunt (launch page copy)",
            "Write the post as these labelled parts:",
            "- TAGLINE: under 60 characters (the hard limit). What the product does for whom. No product name (it sits beside it), no emoji, no “the best”, no gimmicks.",
            "- DESCRIPTION: under 260 characters (the hard limit). Two or three plain sentences: what it is, who it is for, the main thing it lets them do.",
            "- FIRST COMMENT: the maker's comment, 120–200 words in the first person: a one-line hello and who you are; the problem you kept running into and why you built this; the two or three things it does, as sentences; what you would like feedback on, ending with one question.",
            LABELLED_PARTS,
            "Constraints:",
            "- Never ask for upvotes or support.",
            "- No hashtags.",
            "Tone: A maker talking to other makers: personal, direct, grateful without gushing.",
        ].join("\n"),
        examples: `Example of strong Product Hunt copy (for style reference only — do NOT copy content):
"""
**TAGLINE:** Campaign drafts grounded in your own company docs

**DESCRIPTION:** Campaignkit writes first drafts of marketing posts from the documents your company already has, and checks every claim against them. Built for small teams that ship campaigns without a research department.

**FIRST COMMENT:** Hi Product Hunt, we're the team behind Campaignkit.

Campaign prep used to take us two weeks, and most of that was research. We kept thinking the writing was the hard part. It wasn't.

So we built a pipeline that reads our own documents, pulls current sources, and writes first drafts we edit. It also checks each factual claim against the documents and shows where it came from, so we never publish something we can't back.

It has taken our prep from two weeks to two days with the same four people.

We'd love to hear where the drafts still feel generated. What would make you trust a first draft enough to edit it instead of rewriting it?
"""`,
        maxHashtags: 0,
        hardCharLimit: null,
        referencePosts: null,
    },
    discord: {
        id: "discord",
        promptName: "Discord",
        formatRules: [
            "Write an announcement for the company's own community server, to people who already use the product.",
            "Discord renders Markdown: a bold headline and a short list of what members can now do are the format here, and are allowed.",
            "Never write @everyone or @here; whoever posts it decides whether to ping.",
        ],
        guidelines: () =>
            [
                "- The readers are already members: skip the pitch and say what is new for them.",
                "- Lead with one bold line; most people read only that.",
                "- Say where to try it and which channel takes feedback.",
                "- Keep it short enough to read without scrolling the channel.",
                "- No hashtags; one or two emoji at most.",
            ].join("\n"),
        structureTemplate: [
            "Platform: Discord (announcement in a community server)",
            "Structure:",
            "- First line: a bold one-line headline that says what is new.",
            "- 1–2 sentences on why it matters to the people in this server.",
            "- 2–4 short list lines on what members can now do.",
            "- One next step: where to try it, or which channel to post feedback in.",
            "Constraints:",
            "- Hard limit 2,000 characters. Aim for under 800.",
            "- No hashtags, and name a channel in words (“the feedback channel”), not as #channel. Never @everyone or @here.",
            "- At most two emoji.",
            "Tone: Talking to people who already know you: informal, direct, a little in-group warmth.",
        ].join("\n"),
        examples: `Example of a strong Discord announcement (for style reference only — do NOT copy content):
"""
**Claim checking is live for every workspace**

A lot of you asked for a way to see where a draft's facts come from before you post it. That's in today.

- Every factual claim in a draft now shows the passage it came from
- Claims with no source are flagged before you copy the post
- It works on drafts you wrote before today too

Try it on your next campaign and tell us what it gets wrong in the feedback channel.
"""`,
        maxHashtags: 0,
        hardCharLimit: 2000,
        referencePosts: null,
    },
};
