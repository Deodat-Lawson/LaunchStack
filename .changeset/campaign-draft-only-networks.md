---
"@launchstack/tools": minor
"@launchstack/pipelines": minor
---

The campaign generator writes for nine more networks: Instagram, Threads,
Facebook, TikTok, YouTube, Mastodon, Hacker News, Product Hunt and Discord.
They are draft-only: `platform-profiles` gains `DraftOnlyPlatformEnum` and
`CampaignPlatformEnum` (the four Brand posts to, then these), a profile for
each with the network's own structure, limits and hashtag cap, and
`isPublishPlatform`. `MarketingPlatformEnum` is unchanged and is still the
only vocabulary the publish adapters, `brand_posts` and channels accept.

A profile can now carry `promptName` (what prompts and trend searches call
the network) and `formatRules` (for a post that is labelled parts: a video
script, a launch page, a Show HN submission). The pipeline's input, the
generator, refinement, the quality gate and trend research take
`CampaignPlatform`; the judge scores a draft-only network against its
profile's norms (`platformNormsReference`) instead of the X rubric.

Hacker News and Product Hunt drafts leave a blank in square brackets (for
example `[one line: what the product is]`) where the company context does not
say what the product is, how it works, why it was built or how it differs,
instead of a guess. Their structure templates tell the gate, refinement and
the judge to keep a blank.
