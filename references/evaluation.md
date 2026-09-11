# Reference marketing posts — judge calibration dataset

Real, public marketing posts used to calibrate the Campaign Planner LLM judge.

**These are NOT generation inputs.** Synthetic company fixtures under `fixtures/companies/`
are the controlled generation inputs. The two datasets are deliberately separate — see
`docs/eval-suite.md`.

- **Anchors** are included in the judge prompt as worked examples of good and bad.
- **Held-out** examples are never shown to the judge; they exist to test judge calibration.

## Collection method and integrity

| Platform | Method | Verbatim text? | Dates |
|---|---|---|---|
| Bluesky | `app.bsky.feed.getAuthorFeed` public XRPC API, no auth | Yes — raw JSON `record.text` | Exact ISO from API |
| LinkedIn | Authenticated browser session, DOM extraction from official company pages | Yes — "see more" expanded before capture | Derived from activity URN |
| X | Public logged-out profile preview, DOM extraction | Yes — post text node | Derived from snowflake ID |
| Reddit | Authenticated browser session, subreddit + official-account JSON | n/a — nothing qualified | n/a |

Retrieved **2026-07-31**. Nothing here is reconstructed, paraphrased or inferred. Where a
post's text contains a truncated link (`posthog.com/blog/10k-pr...`) or a platform "Show more"
marker, that is the platform's own rendering, preserved exactly.

**Date derivation.** Neither the LinkedIn DOM nor the logged-out X view exposes absolute
timestamps — both render relative labels ("14h", "Jul 27"). Both platforms encode a creation
timestamp in their post identifier, so dates below are computed arithmetically rather than
guessed:

- X snowflake: `(id >> 22) + 1288834974657` ms
- LinkedIn activity URN: `(id >> 22)` ms

Each derived date was cross-checked against the relative label shown on the page.

**Engagement counts are point-in-time**, read 2026-07-31, and will drift. They are supporting
evidence only. No post is labelled `bad` for low engagement — every `bad` label rests on a
content property. X entries record engagement as unavailable because the logged-out preview
does not attach counts reliably to individual posts.

## Selection rule applied

Included: posts marketing an existing product, capability, use case, service, offer, or a
minor feature update; customer stories; adoption campaigns; educational posts with a clear
product-marketing purpose.

Excluded: new-product launches, founding announcements, launch-day posts, fundraising, and
general corporate news with no marketing objective. Rejections are logged at the bottom.

**Cross-platform de-duplication.** Several companies post the same campaign to two or three
platforms within hours. Each campaign appears **once** in this dataset, on a single platform.
Rejected cross-platform twins are listed in the rejection log.

---

## Anchors

### bsky-good-001

- platform: Bluesky
- company: PostHog
- author: `@posthog.com`
- label: good
- source: https://bsky.app/profile/posthog.com/post/3mrxetq5evw2q
- published: 2026-07-31
- engagement: 2 likes, 1 repost, 0 replies (retrieved 2026-07-31)
- selection_reason: Concrete before/after metric (1,441 → 4,725 PRs/month) as the hook, then
  names the *consequence* rather than claiming a win. Credible because it admits a new
  bottleneck instead of overselling. Clear audience.
- product_or_campaign: Engineering-velocity content marketing driving blog traffic

#### Company context

PostHog is an open-source product analytics platform for engineers and product teams —
analytics, session replay, feature flags, experiments and a data warehouse in one tool, sold
self-serve with a large free tier. Its marketing voice is engineer-to-engineer and leans on
transparency about its own internal practices.

#### Relevant product knowledge

- PostHog publishes engineering-practice content as a top-of-funnel channel.
- The company is unusually public about internal metrics, which is what makes a raw PR count credible.
- Target reader is an engineer or eng leader evaluating developer-productivity tooling.

#### Post

> We've gone from 1,441 to 4,725 PRs/month since January. Great. But, that moved the bottleneck along to review, CI and testing. Not so great.
>
> @pauldambra.dev wrote about the tricks we've used to not go crazy as a result: posthog.com/blog/10k-pr...

---

### bsky-good-002

- platform: Bluesky
- company: PostHog
- author: `@posthog.com`
- label: good
- source: https://bsky.app/profile/posthog.com/post/3mrsd2zzdrc24
- published: 2026-07-29
- engagement: 4 likes, 0 reposts, 2 replies (retrieved 2026-07-31)
- selection_reason: Promotes an existing commercial term with specific, checkable quantities
  rather than adjectives. Every claim is a number a reader can verify on the pricing page.
- product_or_campaign: Free-tier adoption campaign

#### Company context

As bsky-good-001. PostHog's core acquisition motion is a generous free tier that resets
monthly across every product, rather than a time-limited trial.

#### Relevant product knowledge

- Free tier applies to every product on every plan and resets monthly.
- Published allowances: 1M events, 5k session replays, 1M feature-flag requests.
- No cap on monthly tracked users.

#### Post

> You can use PostHog for free.
> As in beer and as in speech.
>
> Also free as in every product, on every plan, resetting every month.
>
> No limit on monthly tracked users. 1M events. 5k session replays. 1M feature flag requests. More than that too: we have a graphic!

---

### bsky-good-003

- platform: Bluesky
- company: Tailscale
- author: `@tailscale.com`
- label: good
- source: https://bsky.app/profile/tailscale.com/post/3mpor42ghsi2w
- published: 2026-07-02
- engagement: 4 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Opens with a qualifying question that segments the audience, names a
  specific gap, then maps one named capability onto it. Tight, no hype, single CTA.
- product_or_campaign: Aperture — existing AI access-auditing capability

#### Company context

Tailscale builds a WireGuard-based mesh VPN and zero-trust networking layer for platform,
infrastructure and security teams. Aperture governs and audits how organisations access AI
models. Voice is plain, technical, low-hype.

#### Relevant product knowledge

- Aperture records administrator access to AI activity, not just prompt/response pairs.
- Aimed at teams running AI agents in production facing audit review.
- Answers "who accessed what, and when" — an investigation workflow.

#### Post

> Running AI agents in production?
>
> Audit trails shouldn't stop at prompts and responses.
>
> Aperture records administrator access to AI activity, making it easier to investigate who accessed what, and when.
>
> Learn more → buff.ly/JuCGfNS

---

### bsky-good-004

- platform: Bluesky
- company: Tailscale
- author: `@tailscale.com`
- label: good
- source: https://bsky.app/profile/tailscale.com/post/3mpyskqkl2o2z
- published: 2026-07-06
- engagement: 7 likes, 1 repost, 0 replies (retrieved 2026-07-31)
- selection_reason: Leads with a named adoption pattern the audience recognises in itself,
  then backs it with a named customer and a named executive. Proof is attributable.
- product_or_campaign: TailscaleUp — customer-story session promotion
- campaign_group: `tailscaleup-2026` (see bsky-good-005 — same campaign, same section by rule)

#### Company context

As bsky-good-003. Tailscale's growth motion is bottom-up: individuals adopt it personally then
introduce it at work. TailscaleUp surfaces enterprise proof points validating that motion.

#### Relevant product knowledge

- Homelab-to-enterprise adoption is Tailscale's documented growth pattern.
- Common enterprise displacement target is a legacy VPN.
- Named proof: GoFundMe CISO John Downey.

#### Post

> Many Tailscale deployments start the same way: someone tries it in a homelab, then brings it to work.
>
> At #TailscaleUp, GoFundMe CISO John Downey shares how they replaced legacy VPNs with Tailscale and what they learned along the way.
>
> Register today → buff.ly/5VuRrlX

---

### bsky-good-005

- platform: Bluesky
- company: Tailscale
- author: `@tailscale.com`
- label: good
- source: https://bsky.app/profile/tailscale.com/post/3mqjwzf6bbm2y
- published: 2026-07-13
- engagement: 10 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Strong practitioner hook naming a real habit, then four concrete
  capabilities instead of adjectives. The tension is the actual buyer problem.
- product_or_campaign: TailscaleUp — hands-on access-control session
- campaign_group: `tailscaleup-2026` (see bsky-good-004 — same campaign, same section by rule)

#### Company context

As bsky-good-003. Access-control policy files are Tailscale's central configuration surface
and a recurring source of user friction.

#### Relevant product knowledge

- Policy file is the primary access-control configuration surface.
- Named capabilities: least-privilege grants, production/staging segmentation, PAM, device posture checks.

#### Post

> Before you add another rule, take a look at your policy file.
>
> Join the Tailscale team at #TailscaleUp26 for a hands-on session on locking things down without locking people out: least-privilege grants, production/staging segmentation, PAM, and device posture checks.
>
> Register → buff.ly/pmjfxhx

---

### bsky-good-006

- platform: Bluesky
- company: Sentry
- author: `@sentry.io`
- label: good
- source: https://bsky.app/profile/sentry.io/post/3mqcphs642u2w
- published: 2026-07-10
- engagement: 0 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Problem→mechanism→benefit in three lines. The differentiator is stated as
  a mechanism, not a superlative, and the benefit is a concrete user action. Labelled good
  despite zero engagement — this dataset measures content, not reach.
- product_or_campaign: Application Metrics — existing capability

#### Company context

Sentry is an error-monitoring and application-performance platform for developers,
differentiated by connecting telemetry back to individual traces rather than aggregate
dashboards.

#### Relevant product knowledge

- Application Metrics are trace-connected, unlike standalone metrics products.
- Enables navigation from an aggregate spike to the causing request.

#### Post

> Metrics tell you something happened, but they don't tell you why.
>
> Sentry's Application Metrics are trace-connected, so you can click from a spike straight into the exact request that caused it 👀
>
> Try for free: https://sentry.io/product/metrics/

---

### li-good-001

- platform: LinkedIn
- company: Datadog
- author: Datadog (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7489024177249726464/
- published: 2026-07-31
- engagement: 25 reactions, 1 repost (retrieved 2026-07-31)
- selection_reason: Names the buyer's actual fear in the first line ("shouldn't mean giving
  up…") rather than leading with the feature. States scope precisely — which experiences, and
  that it spans ingestion through investigation.
- product_or_campaign: OpenTelemetry-native monitoring — existing capability

#### Company context

Datadog is an observability platform covering infrastructure monitoring, APM, logs and
security. A live competitive pressure is customers standardising on vendor-neutral
OpenTelemetry, which threatens proprietary agent lock-in.

#### Relevant product knowledge

- Native Infrastructure Monitoring, Kubernetes and APM experiences run directly on OTel data.
- Coverage spans ingestion through investigation, not just ingestion.
- Addresses the fear that OTel adoption costs you existing workflows.

#### Post

> Standardizing on OpenTelemetry shouldn't mean giving up the monitoring and troubleshooting workflows your teams rely on.
>
> Datadog now powers native Infrastructure Monitoring, Kubernetes, and APM experiences directly from OTel data, from ingestion through investigation.
>
> Learn more: https://bit.ly/4x8UvC1

---

### li-good-002

- platform: LinkedIn
- company: Datadog
- author: Datadog (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488919169267310592/
- published: 2026-07-31
- engagement: 33 reactions, 2 comments, 1 repost (retrieved 2026-07-31)
- selection_reason: Opens on a recognisable friction ("jumping between dashboards"), then
  lists three specific things the feature does and closes with the real benefit — "without
  leaving chat". Concrete throughout.
- product_or_campaign: Cloud Cost skill in Bits Chat — existing capability

#### Company context

As li-good-001. Bits Chat is Datadog's in-product conversational assistant; Cloud Cost is one
of its skills.

#### Relevant product knowledge

- Cloud Cost skill answers plain-language cost questions inside Bits Chat.
- Answers are grounded in both cost and observability data.
- Can investigate anomalies, attribute spend to teams or services, and surface root cause.

#### Post

> Cloud and SaaS costs can be hard to track down when the answer means jumping between dashboards.
>
> The Cloud Cost skill in Bits Chat lets you ask cost questions in plain language and get answers grounded in both cost and observability data. It can investigate anomalies, identify which teams or services are driving spend, and surface the root cause — all without leaving chat.
>
> Read the blog to learn more: https://bit.ly/4vGn9t7

---

### li-good-003

- platform: LinkedIn
- company: MongoDB
- author: MongoDB (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488571603983695872/
- published: 2026-07-30
- engagement: 99 reactions, 25 reposts (retrieved 2026-07-31)
- selection_reason: Customer story where the customer is the subject and MongoDB is the
  enabling detail. States what was replaced ("a more complex architecture") and what it
  bought ("less operational friction") without inventing a metric.
- product_or_campaign: MongoDB as unified data layer — named customer story

#### Company context

MongoDB is a document-database company whose managed platform, Atlas, is its primary
commercial product. Customer stories are a standing marketing channel.

#### Relevant product knowledge

- ElevenLabs replaced a more complex architecture with MongoDB as a unified data layer.
- Supports high-accuracy speech workflows and chat experiences.
- Framed as reduced operational friction, not a quantified performance claim.

#### Post

> Voice AI is scaling fast. ElevenLabs is showing what that looks like.
>
> ElevenLabs has evolved from breakthrough voice models into a platform for interactive, enterprise-ready AI agents.
>
> With MongoDB, the company replaced a more complex architecture with a unified data layer, making it easier to support high-accuracy speech workflows and chat experiences with less operational friction.
>
> See how they unlocked scale with MongoDB: https://lnkd.in/gFwmPCc7

---

### li-good-004

- platform: LinkedIn
- company: Grafana Labs
- author: Grafana Labs (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7486185930035466241/
- published: 2026-07-23
- engagement: 25 reactions, 1 comment, 1 repost (retrieved 2026-07-31)
- selection_reason: A migration notice written as marketing without becoming hype. States
  exactly what changes, and promises both the rationale and the next steps. Included as a
  deliberately low-ceiling positive: unglamorous operational communication done correctly.
- product_or_campaign: Source IP allowlists moving to a JSON API — minor change notice

#### Company context

Grafana Labs builds Grafana and Grafana Cloud, an observability stack for infrastructure and
application monitoring. Source IP allowlists are a network-access control in Grafana Cloud.

#### Relevant product knowledge

- Source IP allowlists are moving to a single, structured JSON API.
- The change affects existing Grafana Cloud customers and requires action.

#### Post

> Grafana Cloud's source IP allowlists are moving to a single, structured JSON API. Here's everything you need to know about the change and next steps.
>
> https://lnkd.in/gBd268vf

---

### li-good-005

- platform: LinkedIn
- company: Figma
- author: Figma (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7489084145005076480/
- published: 2026-07-31
- engagement: 117 reactions, 2 comments, 6 reposts (retrieved 2026-07-31)
- selection_reason: Promotes an existing integration by showing four concrete workflows, each
  attributed to a named employee with their role. Specific and browsable rather than
  a capability claim.
- product_or_campaign: Figma MCP server — existing integration, workflow showcase

#### Company context

Figma is a collaborative interface-design platform. Its MCP server exposes Figma content to
AI agents; FigJam, Figma Slides and Figma Make are surfaces within the product family.

#### Relevant product knowledge

- The MCP server has workflows across Figma Slides, FigJam, Figma Make and the Figma agent.
- Each workflow is contributed by a named Figma employee.

#### Post

> Figma MCP server workflows to try with
>
> Figma Slides → from designer advocate, Mallory Dean
> FigJam → from product manager, Prasant Lokinendi
> Figma Make → from product designer, Iris Lin
> Figma agent → from product manager, Yarden Chanel Katz

---

### x-good-001

- platform: X
- company: Linear
- author: `@linear`
- label: good
- source: https://x.com/linear/status/2082856036977803595
- published: 2026-07-30
- engagement: not available (logged-out preview does not attach counts reliably)
- selection_reason: Three specific verbs in one line — review code changes, comment on
  specific lines, send feedback to the agent. Says what you can now do and where, with no
  padding. Ideal density for X.
- product_or_campaign: Coding sessions on mobile — feature extension

#### Company context

Linear is an issue tracker and project-management tool for software teams. Coding Sessions
lets an agent draft pull requests from a Linear issue; the mobile app is a companion surface.

#### Relevant product knowledge

- Coding sessions are now usable from the Linear mobile app.
- Supports reviewing code changes, commenting on specific lines, and sending feedback to the agent.

#### Post

> New: Coding sessions on mobile
>
> Keep work moving from the Linear mobile app. Review code changes, comment on specific lines, and send feedback directly to the agent.

---

### x-good-002

- platform: X
- company: Notion
- author: `@NotionHQ`
- label: good
- source: https://x.com/NotionHQ/status/2083286274040119413
- published: 2026-07-31
- engagement: not available (logged-out preview)
- selection_reason: Leads with the trigger, then three concrete downstream actions, then a
  one-line payoff describing the state change for the user. Specific integrations named
  (tasks, project tracker, CRM, Slack) rather than "your tools".
- product_or_campaign: AI Meeting Notes triggering Custom Agents — feature extension

#### Company context

Notion is a connected workspace combining docs, databases and project tracking. AI Meeting
Notes transcribes and summarises calls; Custom Agents are user-configured automations.

#### Relevant product knowledge

- AI Meeting Notes can now trigger Custom Agents once a summary is ready.
- Agents can create tasks, update a project tracker or CRM, or send next steps to Slack.

#### Post

> Just shipped: AI Meeting Notes can now trigger Custom Agents.
>
> Once the summary’s ready, your agent can turn action items into tasks, update your project tracker or CRM, or send next steps to Slack.
>
> After your next call, your agent will get to work 🤙

---

### x-good-003

- platform: X
- company: Cloudflare
- author: `@Cloudflare`
- label: good
- source: https://x.com/Cloudflare/status/2083177117857005765
- published: 2026-07-31
- engagement: not available (logged-out preview)
- selection_reason: Frames an incremental addition against last year's foundation, states
  precisely what was added, and quantifies the deployment benefit (330+ cities, no servers or
  load balancers). Discloses beta status rather than obscuring it.
- product_or_campaign: Media over QUIC relays — capability extension

#### Company context

Cloudflare operates a global edge network providing CDN, security and developer platform
services. Media over QUIC (MoQ) is a low-latency media transport protocol it deployed to its
network in 2025.

#### Relevant product knowledge

- MoQ was brought to Cloudflare's global network last year.
- New additions: isolated relays and pub/sub access controls.
- Deploys across 330+ cities with no servers or load balancers; free in beta.

#### Post

> Last year, we brought Media over QUIC (MoQ) to our global network. Today, we’re adding isolated relays & pub/sub access controls, so you can run real applications.
>
> Deploy in seconds across 330+ cities—no servers or load balancers needed. Free in beta:

---

### x-good-004

- platform: X
- company: Stripe
- author: `@stripe`
- label: good
- source: https://x.com/stripe/status/2082180804458033451
- published: 2026-07-28
- engagement: not available (logged-out preview)
- selection_reason: A geographic-availability post that is entirely factual — one sentence of
  capability, then the countries. No adjectives at all. Useful precisely because the payload
  is a list a reader can check themselves against.
- product_or_campaign: MPP and x402 stablecoin payments — geographic expansion of an existing capability

#### Company context

Stripe is a payments infrastructure company. The Machine Payments Protocol (MPP) is an open
standard it co-authored for agent-initiated payments; x402 is a related payment scheme.

#### Relevant product knowledge

- Stablecoin payments from agents via MPP and x402 are now available to more businesses.
- Availability listed across 14 named countries.
- This is an expansion of an existing capability, not the protocol's introduction.

#### Post

> More businesses can now accept stablecoin payments from agents with MPP and x402.
>
> Available in: United States 🇺🇸 · France 🇫🇷 · Germany 🇩🇪 · Spain 🇪🇸 · Italy 🇮🇹 · Netherlands 🇳🇱 · Belgium 🇧🇪 · Ireland 🇮🇪 · Sweden 🇸🇪 · Poland 🇵🇱 · Denmark 🇩🇰 · Romania 🇷🇴 · Portugal 🇵🇹 · Austria 🇦🇹 Show more

---

### x-good-005

- platform: X
- company: Figma
- author: `@figma`
- label: good
- source: https://x.com/figma/status/2082550148576756201
- published: 2026-07-29
- engagement: not available (logged-out preview)
- selection_reason: Adopts the audience's own register ("wdym you can…") to make a capability
  feel discovered rather than announced, then states the concrete offer with an explicit
  duration. Platform-native without becoming content-free.
- product_or_campaign: Gen effect node in Figma Weave — feature availability plus time-boxed offer

#### Company context

As li-good-005. Figma Weave is a generative surface within the Figma product family;
custom-coded effects are an advanced capability within it.

#### Relevant product knowledge

- The Gen effect node is live on canvas in Figma Weave.
- Supports coding your own effects with custom controls.
- Free for everyone for two weeks.

#### Post

> wdym you can vibe code your own effects in Figma Weave with custom controls and all?
>
> → Gen effect node is now live in your canvas. Free for everyone for 2 weeks

---

### bsky-bad-001

- platform: Bluesky
- company: PostHog
- author: `@posthog.com`
- label: bad
- source: https://bsky.app/profile/posthog.com/post/3mp2gte2cpe2k
- published: 2026-06-24
- engagement: 3 likes, 0 reposts, 1 reply (retrieved 2026-07-31)
- selection_reason: No benefit, no product relevance, no audience, no call to action. An
  inside joke addressed to the marketing team itself ("We did it, team").
- product_or_campaign: None identifiable — mascot campaign self-reference

#### Company context

As bsky-good-001. PostHog's voice is deliberately irreverent and its hedgehog mascot recurs
across campaigns — which makes this a useful negative: the same voice fails when detached from
any product point.

#### Relevant product knowledge

- Max the hedgehog is PostHog's mascot and a recurring campaign device.
- No PostHog product, capability or offer is referenced.

#### Post

> This entire campaign was an excuse to put Max the hedgehog on a stripper pole.
> Mission accomplished. We did it, team.

---

### bsky-bad-002

- platform: Bluesky
- company: Tailscale
- author: `@tailscale.com`
- label: bad
- source: https://bsky.app/profile/tailscale.com/post/3mrruva5apn2n
- published: 2026-07-29
- engagement: 6 likes, 1 repost, 1 reply (retrieved 2026-07-31)
- selection_reason: Pure conference-presence announcement. The topic list is a catch-all
  identifying no audience and no benefit. No capability, no proof, no reason to act beyond
  physical proximity.
- product_or_campaign: Black Hat 2026 event presence

#### Company context

As bsky-good-003. Tailscale exhibits at security conferences.

#### Relevant product knowledge

- No specific Tailscale capability is named.
- Contrast with bsky-good-003, which names Aperture and one concrete capability.

#### Post

> The countdown to Black Hat is on. If you're heading to Las Vegas, come find the Tailscale team. We'd love to talk secure networking, zero trust, AI infrastructure, or whatever security challenge is top of mind. See you there!
>
> #BHUSA2026

---

### bsky-bad-003

- platform: Bluesky
- company: Supabase
- author: `@supabase.com`
- label: bad
- source: https://bsky.app/profile/supabase.com/post/3mgn2r3g3es2i
- published: 2026-03-09
- engagement: 2 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Generic-AI-slop phrasing throughout. "Ship Quickly, Stay Secure!", "Dive
  into", "Discover how to", "withstands production challenges" are filler; nothing states what
  will be taught or by whom. Directly comparable to bsky-good-104 from the same company.
- product_or_campaign: Agency webinar on AI prototyping

#### Company context

Supabase is an open-source backend platform built on Postgres providing auth, storage,
realtime and edge functions. It runs webinars targeting agencies moving prototypes to
production.

#### Relevant product knowledge

- The underlying event covers database safeguarding and project handoff.
- Those specifics exist but are not surfaced in the copy.

#### Post

> Ship Quickly, Stay Secure!
>
> Dive into AI prototyping that withstands production challenges
>
> Discover how to safeguard your database while learning the essentials of project handoff without losing safety standards
>
> Secure your spot today: supabase.com/events/agenc...

---

### li-bad-001

- platform: LinkedIn
- company: Cloudflare
- author: Cloudflare (official company page)
- label: bad
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488601842021679107/
- published: 2026-07-30
- engagement: 131 reactions, 4 comments, 8 reposts (retrieved 2026-07-31)
- selection_reason: Employer branding with no product content and no external audience. The
  recruiting CTA is bolted on at the end. High engagement makes it a useful calibration case:
  the judge must not reward reach over marketing substance.
- product_or_campaign: Intern appreciation — employer branding

#### Company context

As x-good-003. Cloudflare runs a global internship programme.

#### Relevant product knowledge

- No Cloudflare product or capability is referenced.

#### Post

> Happy
> hashtag
> #InternAppreciationDay! 🧡
>
> From writing production code to helping build a better, safer Internet, our global intern cohort tackles big challenges every single day.
>
> To all of our Cloudflare interns around the world: thank you for your curiosity, your fresh perspectives, and your impact. We’re so proud to be part of your career journey! 🚀
>
> Interested in launching your career with us? Check out our open early-talent roles at cloudflare.com/careers

---

### li-bad-002

- platform: LinkedIn
- company: Sentry
- author: Sentry (official company page)
- label: bad
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488317460207792129/
- published: 2026-07-29
- engagement: 16 reactions, 3 reposts (retrieved 2026-07-31)
- selection_reason: Event-hospitality post with no product content, no benefit and no audience
  qualification beyond physical attendance.
- product_or_campaign: gamescom dev — sponsored evening event

#### Company context

As bsky-good-006. Sentry sponsors developer-conference events, here with Perforce.

#### Relevant product knowledge

- No Sentry product capability is referenced.

#### Post

> Coming to gamescom dev?
>
> Join Sentry and Perforce Software as we take over a private VIP beach club on Cologne's waterfront for an evening with the developer community 🤝
>
> See you there! https://lnkd.in/ehnKUBb9

---

### x-bad-001

- platform: X
- company: Cloudflare
- author: `@Cloudflare`
- label: bad
- source: https://x.com/Cloudflare/status/2083112684287889881
- published: 2026-07-31
- engagement: not available (logged-out preview)
- selection_reason: Pure engagement bait. A calendar observance plus a "tag someone" prompt,
  with a branded hashtag attached. No product, no benefit, no audience beyond "everyone".
- product_or_campaign: None — calendar observance

#### Company context

As x-good-003.

#### Relevant product knowledge

- No Cloudflare product or capability is referenced.

#### Post

> Today is System Administrator Appreciation Day. Tag a sysadmin who has saved your bacon and say thank you. #CloudflareChat

---

### x-bad-002

- platform: X
- company: Cloudflare
- author: `@Cloudflare`
- label: bad
- source: https://x.com/Cloudflare/status/2082839849682264564
- published: 2026-07-30
- engagement: not available (logged-out preview)
- selection_reason: Analyst-badge post. The achievement is the company's, not the reader's;
  no capability, benefit or audience appears, and the CTA is to come back later for a document
  that is not yet available.
- product_or_campaign: Gartner Magic Quadrant placement

#### Company context

As x-good-003. Cloudflare sells SASE (Secure Access Service Edge) products to enterprises.

#### Relevant product knowledge

- No specific SASE capability is named.
- Contrast with x-good-003, which names a capability and quantifies deployment.

#### Post

> We’re honored to be a Visionary in the 2026 Gartner® Magic Quadrant™ for Secure Access Service Edge Platforms! Check back soon for your complimentary copy.

---

## Held-out

### bsky-good-101

- platform: Bluesky
- company: PostHog
- author: `@posthog.com`
- label: good
- source: https://bsky.app/profile/posthog.com/post/3mqa4eovtzc2h
- published: 2026-07-09
- engagement: 5 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Quantified outcome paired with an admission of initial failure, which
  raises credibility. Gives away the central lesson rather than withholding it for the click.
- product_or_campaign: Onboarding wizard — retrospective content marketing

#### Company context

As bsky-good-001. PostHog ships a setup wizard to reduce time-to-first-value.

#### Relevant product knowledge

- The wizard drove a 5× conversion increase and 2× activation increase.
- The first iteration underperformed before rework.
- Stated lesson: context matters more than surface polish.

#### Post

> We quintupled our conversion and doubled activation with our 🪄wizard🪄
>
> That was after the first version of the 🪄wizard🪄 kinda sucked
>
> We learned 6 big lessons from it. Mainly, context is the most important thing. The rest, Edwin wrote about in detail: newsletter.posthog.com/p/we-used-a...

---

### bsky-good-102

- platform: Bluesky
- company: PostHog
- author: `@posthog.com`
- label: good
- source: https://bsky.app/profile/posthog.com/post/3mqrkilshhf2i
- published: 2026-07-16
- engagement: 1 like, 2 reposts, 1 reply (retrieved 2026-07-31)
- selection_reason: Specific bounded claim (178 PRs in 30 days) attached to a named
  capability, then promises worked examples rather than more assertions. "Without us" is the
  benefit, stated plainly.
- product_or_campaign: Scouts — existing agent capability

#### Company context

As bsky-good-001. PostHog ships "scouts", long-running agents that analyse product data and
open pull requests.

#### Relevant product knowledge

- 178 scout-originated pull requests merged in a 30-day window.
- Linked content walks through six configured scouts.

#### Post

> We merged 178 pull requests in the last 30 days that originated in scouts – long-running agents that make sense of data in PostHog and turn it into fixes.
>
> To show you how they work, here's 6 real scouts we set up and the improvements they made without us.

---

### bsky-good-103

- platform: Bluesky
- company: Sentry
- author: `@sentry.io`
- label: good
- source: https://bsky.app/profile/sentry.io/post/3mqmq5qfofn2d
- published: 2026-07-14
- engagement: 0 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Before/after customer story with a named customer. The "before" is vividly
  specific and the "after" retains the human review step rather than overclaiming automation.
- product_or_campaign: Sentry + AI triage — named customer story

#### Company context

As bsky-good-006. Sentry publishes customer stories at `sentry.io/customers/`.

#### Relevant product knowledge

- Cursor's client infrastructure team previously triaged bugs manually.
- Sentry data now feeds an agent that identifies root cause and drafts a fix.
- An engineer still reviews before shipping.

#### Post

> Cursor's client infra team used to triage bugs manually: track down whoever caught the error, debug it over their shoulder in real time.
>
> Now Sentry data feeds an agent that finds the likely root cause and drafts a fix, with an engineer reviewing before it ships.
>
> https://sentry.io/customers/cursor/

---

### bsky-good-104

- platform: Bluesky
- company: Supabase
- author: `@supabase.com`
- label: good
- source: https://bsky.app/profile/supabase.com/post/3mih2kyc7dc2w
- published: 2026-04-01
- engagement: 8 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: A single surprising sentence as the hook, then the reason it matters.
  Shows the command inline instead of describing it. Zero marketing vocabulary.
- product_or_campaign: Docs-over-SSH — existing developer-experience capability

#### Company context

As bsky-bad-003. Much of Supabase's marketing targets developers using AI coding agents.

#### Relevant product knowledge

- `ssh supabase.sh` exposes the documentation tree over SSH.
- Gives an agent bash-level access to docs — grep, find, cat.
- Rationale: matches the interface an agent already uses against a codebase.

#### Post

> We put Supabase docs on an SSH server.
>
> 'ssh supabase.sh' gives your AI agent bash access to the full Supabase docs tree. grep, find, cat. The same interface it uses for your code.
>
> > ssh supabase.sh
>
> supabase.com/blog/supabas...

---

### bsky-good-105

- platform: Bluesky
- company: Supabase
- author: `@supabase.com`
- label: good
- source: https://bsky.app/profile/supabase.com/post/3mhy47qdkjk2d
- published: 2026-03-26
- engagement: 6 likes, 0 reposts, 1 reply (retrieved 2026-07-31)
- selection_reason: States exactly what is now possible in one sentence, names the partner,
  and qualifies the maturity level rather than implying general availability.
- product_or_campaign: Stripe CLI integration — existing integration availability

#### Company context

As bsky-bad-003. Supabase partners on integrations letting developers provision infrastructure
from tools they already use.

#### Relevant product knowledge

- A Supabase Postgres database can be provisioned from the Stripe CLI.
- Co-designed with Stripe under the Stripe Projects developer preview.
- Preview status is disclosed.

#### Post

> You can now provision a Supabase Postgres database (and the rest of Supabase) straight from the Stripe CLI.
>
> We co-designed the integration with Stripe as part of the Stripe Projects developer preview.
>
> supabase.com/blog/supabas...

---

### bsky-good-106

- platform: Bluesky
- company: Supabase
- author: `@supabase.com`
- label: good
- source: https://bsky.app/profile/supabase.com/post/3miyrleev5k2d
- published: 2026-04-08
- engagement: 4 likes, 1 repost, 0 replies (retrieved 2026-07-31)
- selection_reason: Minimal but correct. A minor feature update stated plainly with no padding
  and a single link. Included as a low-ceiling positive: brevity without hype is acceptable
  and should not be penalised for being short.
- product_or_campaign: Custom OIDC providers — minor feature update

#### Company context

As bsky-bad-003. Supabase Auth supports third-party identity providers.

#### Relevant product knowledge

- Custom OIDC providers can now be added to Supabase Auth.
- Incremental extension of existing auth functionality.

#### Post

> We now support adding your own custom OIDC providers
>
> Read more on our blog post: supabase.com/blog/custom-...

---

### li-good-101

- platform: LinkedIn
- company: PostHog
- author: PostHog (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7489019209981763585/
- published: 2026-07-31
- engagement: 10 reactions, 1 comment (retrieved 2026-07-31)
- selection_reason: Uses a sustained comedic conceit to make a changelog worth opening, and
  still lands three specific shipped changes. Distinctive voice carrying real substance — the
  combination separating it from bsky-bad-001 by the same company.
- product_or_campaign: Monthly changelog readership campaign

#### Company context

As bsky-good-001. PostHog publishes a high-volume monthly changelog and treats driving
readership of it as a marketing objective.

#### Relevant product knowledge

- 145 changelog entries published in the month referenced.
- Named changes: talking to agents in Self-Driving inbox reports; a new urgency category for
  critical support tickets; a new "AI" channel type in web analytics.
- Warehouse Sources is the highest-volume contributing team.

#### Post

> You, with the laptop and the phone! Wake up! They want to hide the changelog from you!
>
> 145 new entries this month, but what have you heard about them? Nothing! The cover up is working! Someone needs to stop this!
>
> Do not let them take you for sheep! Read all of them, even if it's mostly the Warehouse Sources team implementing sources! Free your mind!
>
> Where else are you going to read that in Self-Driving, you can now talk to agents in inbox reports?
> Who's watching the Conversations Team creating a new category of urgency for critical support tickets?
> Did you know there's a new "AI" channel type in web analytics?
> Of course not! The media titans are silent!

---

### li-good-102

- platform: LinkedIn
- company: Sentry
- author: Sentry (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488999230120828928/
- published: 2026-07-31
- engagement: 15 reactions (retrieved 2026-07-31)
- selection_reason: Community-built use case rather than a self-claim. Contrarian opening,
  then a specific workflow, then a concrete non-obvious result. Sentry is the enabling tool in
  someone else's story, which is more credible than asserting the capability directly.
- product_or_campaign: Sentry LLM instrumentation — existing use case

#### Company context

As bsky-good-006. Sentry has extended instrumentation to LLM applications.

#### Relevant product knowledge

- Sentry can instrument a Next.js app to capture LLM inputs, outputs, cost and tool calls.
- Captured data can be exported into an evaluation tool such as Braintrust.
- Positions Sentry as the capture layer, not the evaluator.

#### Post

> Public LLM benchmarks are just vibes. So Sergiy Dybskiy built his own.
>
> In this video, he instruments a Next.js app with Sentry to capture every real conversation (inputs, outputs, cost, tool calls), and then feeds it into Braintrust to eval models on quality, speed, and cost.
>
> The result? gpt-oss-20b matched Claude for way less $$ 👇

---

### li-good-103

- platform: LinkedIn
- company: Datadog
- author: Datadog (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488651383609647104/
- published: 2026-07-30
- engagement: 39 reactions, 2 comments, 1 repost (retrieved 2026-07-31)
- selection_reason: Educational post with a clear product-marketing purpose. Opens on a
  reframe ("isn't about finding more vulnerabilities"), names the author and outlet, and
  previews three specific arguments. The product thesis — runtime context — is embedded rather
  than asserted.
- product_or_campaign: Software risk prioritisation — thought-leadership byline

#### Company context

As li-good-001. Datadog sells application security products whose differentiator is runtime
context for prioritising vulnerabilities.

#### Relevant product knowledge

- Byline authored by Datadog's Eugene Kovnatsky for DEVOPSdigest.
- Covers the gap between perceived and actual software risk, supply-chain threat changes, and runtime context for prioritisation.

#### Post

> Software risk isn't just about finding more vulnerabilities, it's about understanding which ones actually matter.
>
> In a new byline for DEVOPSdigest, Datadog's Eugene Kovnatsky explores why the gap between perceived and actual software risk is growing, how software supply chains are changing the threat landscape, and why runtime context is essential for prioritizing what deserves attention.
>
> Read more: https://bit.ly/4wpfnFo

---

### li-good-104

- platform: LinkedIn
- company: Grafana Labs
- author: Grafana Labs (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7486359548753248256/
- published: 2026-07-24
- engagement: 21 reactions, 4 reposts (retrieved 2026-07-31)
- selection_reason: Leads with a verbatim customer quote rather than a company claim, then
  adds one line of substance explaining the mechanism behind it. The review is attributable
  and checkable on a third-party site.
- product_or_campaign: Customer review — alerting and SLA outcomes

#### Company context

As li-good-004. Grafana is used for alerting and incident response as well as dashboards.

#### Relevant product knowledge

- Customer quote concerns meeting SLAs while running on Grafana.
- Mechanism named: effective alerts paging the right teams, enabling faster recovery.
- Source is a Gartner Peer Insights review.

#### Post

> “Meeting SLAs is achievable & enjoyable by running on Grafana.”
>
> Faster recovery means having effective alerts that are paging the right teams.
>
> ⭐️⭐️⭐️⭐️⭐️. Read the full review on Gartner Peer Insights: https://gtnr.io/U0SYhAVxR

---

### li-good-105

- platform: LinkedIn
- company: Vercel
- author: Vercel (official company page)
- label: good
- source: https://www.linkedin.com/feed/update/urn:li:activity:7487557515308597249/
- published: 2026-07-27
- engagement: 534 reactions, 33 comments, 22 reposts (retrieved 2026-07-31)
- selection_reason: Markets an existing product (AI Gateway) via a new model becoming
  available on it, and adds two specifics an enterprise buyer actually cares about —
  USA-based inference providers and signed zero-data-retention agreements.
- product_or_campaign: Kimi K3 on AI Gateway — model availability on an existing product

#### Company context

Vercel is a deployment and infrastructure platform for web applications. AI Gateway is its
routing layer giving applications access to multiple model providers through one interface.

#### Relevant product knowledge

- Kimi K3 is available on Vercel AI Gateway.
- Served from USA-based inference providers at high availability.
- Zero-Data-Retention agreements are signed and can be enabled for all token traffic.

#### Post

> Kimi K3 is the most powerful open-weight model in the world. It's now available on Vercel AI Gateway from USA-based inference providers at high availability & performance. We've signed ZDR (Zero-Data Retention) agreements, which you can enable for all your token traffic.
>
> https://vercel.fyi/kimi-k3

---

### x-good-101

- platform: X
- company: Linear
- author: `@linear`
- label: good
- source: https://x.com/linear/status/2080750580964733153
- published: 2026-07-24
- engagement: not available (logged-out preview)
- selection_reason: Two sentences: what is available, and exactly where to switch it on and
  what it does. Model-availability posts are usually filler; this one is actionable because it
  names the setting and the outcome.
- product_or_campaign: Claude Opus 5 in Coding Sessions — model availability

#### Company context

As x-good-001. Linear's Coding Sessions feature drafts pull requests from issues using a
selectable model.

#### Relevant product knowledge

- Claude Opus 5 is selectable in Coding Sessions settings.
- Used to draft PRs directly from Linear.

#### Post

> Claude Opus 5 is now available in Linear.
>
> Select it in Coding Sessions settings to draft PRs from Linear.

---

### x-good-102

- platform: X
- company: Linear
- author: `@linear`
- label: good
- source: https://x.com/linear/status/2080326108252115177
- published: 2026-07-23
- engagement: not available (logged-out preview)
- selection_reason: Describes a capability and then, unusually, the governance around it —
  author attribution and version history. Anticipates the objection ("who changed this?") that
  automated document editing immediately raises.
- product_or_campaign: Linear Agent document editing — capability extension

#### Company context

As x-good-001. Linear Agent is Linear's automation surface; "loops" are recurring automated
routines.

#### Relevant product knowledge

- Linear Agent can edit documents and project descriptions.
- Loops can keep them updated automatically.
- Author names show which user or loop made a change; edits are traceable through version history.

#### Post

> You can now use Linear Agent to edit documents and project descriptions, or write loops to keep them up to date automatically.
>
> Show author names to see which user or loop made a change, or trace edits through version history.

---

### x-good-103

- platform: X
- company: Linear
- author: `@linear`
- label: good
- source: https://x.com/linear/status/2081773922618659265
- published: 2026-07-27
- engagement: not available (logged-out preview)
- selection_reason: A promotional offer stated with complete precision — who qualifies, how
  much, how it is pooled, and when it expires. One sentence, four facts, no adjectives.
- product_or_campaign: AI credits offer for Business and Enterprise workspaces

#### Company context

As x-good-001. Loops are Linear's recurring automation routines, billed via AI credits.

#### Relevant product knowledge

- $20 per seat in AI credits for Loops.
- Business and Enterprise workspaces only, pooled across the team.
- Expires Aug 20.

#### Post

> We're giving Business and Enterprise workspaces $20 per seat in AI credits for Loops, pooled across the team. Expires Aug 20.

---

### x-good-104

- platform: X
- company: Notion
- author: `@NotionHQ`
- label: good
- source: https://x.com/NotionHQ/status/2082913210630566079
- published: 2026-07-30
- engagement: not available (logged-out preview)
- selection_reason: Customer story told as a story, where the product occupies exactly one
  clause ("custom agents handle the admin work"). The restraint is the craft — the customer is
  interesting on their own terms, which is why the product mention lands.
- product_or_campaign: Custom Agents — customer story

#### Company context

As x-good-002. Notion publishes customer stories emphasising automation of administrative
work.

#### Relevant product knowledge

- Monumental Labs uses Notion custom agents for administrative work.
- Their operation combines robotic stone milling with hand carving.
- Product benefit framed as letting craftspeople focus on craft.

#### Post

> So @Monumental_Labs is bringing back the art of stone carving: robots mill the stone, artists carve by hand, and custom agents handle the admin work.
>
> Craftspeople focusing on their craft… Athena would love it.

---

### x-good-105

- platform: X
- company: Figma
- author: `@figma`
- label: good
- source: https://x.com/figma/status/2082913429765968109
- published: 2026-07-30
- engagement: not available (logged-out preview)
- selection_reason: Two lines, both load-bearing: what was added, and the capability that
  makes it matter (editing designs built in code). Names the surface precisely rather than
  saying "in Figma".
- product_or_campaign: Properties panel and annotations in Figma Make — feature update

#### Company context

As li-good-005. Figma Make is the surface where designs and prototypes are built in code.

#### Relevant product knowledge

- New properties panel and annotations in Figma Make.
- Enables direct editing of designs and prototypes built in code.

#### Post

> Introducing: a new properties panel and annotations in Figma Make
>
> Directly edit your designs and prototypes built in code

---

### bsky-bad-101

- platform: Bluesky
- company: Tailscale
- author: `@tailscale.com`
- label: bad
- source: https://bsky.app/profile/tailscale.com/post/3mrqbdqagbc2p
- published: 2026-07-28
- engagement: 5 likes, 1 repost, 0 replies (retrieved 2026-07-31)
- selection_reason: Engagement bait. The product reference is an unexplained fragment and the
  post pivots immediately to a reply-farming question. A reader who does not already know the
  product learns nothing.
- product_or_campaign: Unclear — appears to reference Aperture's model access

#### Company context

As bsky-good-003. Aperture provides access to multiple AI models through one layer.

#### Relevant product knowledge

- The "hold the tedium" fragment alludes to Aperture's multi-model access.
- Aperture is never named; the capability is never stated.

#### Post

> All your favorite models, hold the tedium … but now you've got us wondering: what's everyone's favorite model/task match?

---

### bsky-bad-102

- platform: Bluesky
- company: Tailscale
- author: `@tailscale.com`
- label: bad
- source: https://bsky.app/profile/tailscale.com/post/3mqkoyk2kdx2q
- published: 2026-07-13
- engagement: 8 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Conference recap with no marketing objective. Retrospective, so there is
  nothing to act on, and no product, capability or audience is referenced. Distinct campaign
  from bsky-bad-002 — different event, and retrospective rather than forward-looking.
- product_or_campaign: WeAreDevelopers Berlin — event recap

#### Company context

As bsky-good-003.

#### Relevant product knowledge

- No Tailscale capability is referenced.

#### Post

> Last week looked a little like this 📸 A few of our favorite moments from WeAreDevelopers. Until next time, Berlin. 🇩🇪

---

### bsky-bad-103

- platform: Bluesky
- company: Sentry
- author: `@sentry.io`
- label: bad
- source: https://bsky.app/profile/sentry.io/post/3mrvfvnfjyc2c
- published: 2026-07-30
- engagement: 2 likes, 0 reposts, 0 replies (retrieved 2026-07-31)
- selection_reason: Internal-culture post with no marketing objective, product reference or
  external audience. Reasonable as employer branding; included because a campaign generator
  must not produce this shape when asked for marketing copy.
- product_or_campaign: None — employer branding

#### Company context

As bsky-good-006.

#### Relevant product knowledge

- No Sentry product or capability is referenced.

#### Post

> Happy National Intern Day to the interns making Sentry cooler this summer 😎
>
> We’re better because you’re here!

---

### li-bad-101

- platform: LinkedIn
- company: PostHog
- author: PostHog (official company page)
- label: bad
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488971957418426368/
- published: 2026-07-31
- engagement: 9 reactions, 3 comments, 1 repost (retrieved 2026-07-31)
- selection_reason: Vague enthusiasm with no substance. "Context engineering, wizardry, and
  more" gestures at topics without conveying any, and the content is pushed to the comments.
  Nothing learnable from the post itself.
- product_or_campaign: Podcast appearance promotion

#### Company context

As bsky-good-001. PostHog staff appear on developer podcasts as a content channel.

#### Relevant product knowledge

- References PostHog's onboarding wizard work (see bsky-good-101) but conveys none of it.

#### Post

> Had a great time chatting with Jeff Auriemma!! Check it out, learn about context engineering, wizardry, and more. Full video is in the comments too :D

---

### li-bad-102

- platform: LinkedIn
- company: Tailscale
- author: Tailscale (official company page)
- label: bad
- source: https://www.linkedin.com/feed/update/urn:li:activity:7489060277263478784/
- published: 2026-07-31
- engagement: 9 reactions, 2 reposts (retrieved 2026-07-31)
- selection_reason: Engagement bait built on in-jokes from an event most readers did not
  attend. The references are unexplained and the closing question is generic reply-farming.
- product_or_campaign: DevRelCon 2026 — event recap

#### Company context

As bsky-good-003. Tailscale's developer-relations team attends DevRelCon.

#### Relevant product knowledge

- No Tailscale capability is referenced.

#### Post

> From living like a "low-rent Tony Stark" to a few thoughts on Nano vs. Vim, last week's DevRelCon had no shortage of hot takes. What are your devrel hot takes 🧐 ?
>
> hashtag
> #DevRelCon2026

---

### li-bad-103

- platform: LinkedIn
- company: MongoDB
- author: MongoDB (official company page)
- label: bad
- source: https://www.linkedin.com/feed/update/urn:li:activity:7488975408479166464/
- published: 2026-07-31
- engagement: 38 reactions, 2 reposts (retrieved 2026-07-31)
- selection_reason: Corporate-anniversary nostalgia fused with an employee profile. The reader
  gets no capability, benefit or reason to act; the milestone belongs to the company. Useful
  contrast with li-good-003 from the same company days apart.
- product_or_campaign: Atlas 10-year anniversary

#### Company context

As li-good-003. Atlas is MongoDB's managed database platform, launched 2016.

#### Relevant product knowledge

- No Atlas capability or benefit is stated.
- The post's subject is the anniversary and an employee's career history.

#### Post

> We're celebrating 10 years of MongoDB Atlas! 🎉
>
> Meet Chris Shum, Director of Product Management at MongoDB, who joined MongoDB as a software engineering intern back in 2016, right as Atlas was taking shape.
>
> Hear how Atlas has transformed over the past 10 years and what's next: https://lnkd.in/edpgyWFf

---

### x-bad-101

- platform: X
- company: Notion
- author: `@NotionHQ`
- label: bad
- source: https://x.com/NotionHQ/status/2082883231083569449
- published: 2026-07-30
- engagement: not available (logged-out preview)
- selection_reason: Event recap listing venues rather than substance. Retrospective and
  location-specific, so there is nothing for a reader to act on, and no product appears.
- product_or_campaign: Singapore events week — recap

#### Company context

As x-good-002. Notion runs regional developer and community events.

#### Relevant product knowledge

- No Notion capability is referenced.
- The Developer Platform panel is named but not described.

#### Post

> We spent a week with you in Singapore. Here are a few highlights:
>
> → Developer Platform panel at the National Gallery
> → Media event at a sake cocktail bar
> → Notion booth at the SuperAI conference
> → Startup AMA at a guitar shop
>
> Thank you for everyone for joining!

---

### x-bad-102

- platform: X
- company: Cloudflare
- author: `@Cloudflare`
- label: bad
- source: https://x.com/Cloudflare/status/2082994688261300588
- published: 2026-07-31
- engagement: not available (logged-out preview)
- selection_reason: The opening line is genuinely strong, then the post abandons it. The
  follow-up question is corporate filler, the audience shifts abruptly to "financial
  leadership" with no reason given, and the CTA is an unexplained webinar. A good hook
  attached to nothing — a more instructive failure than an obviously empty post.
- product_or_campaign: Security resilience webinar

#### Company context

As x-good-003. Cloudflare markets Zero Trust and identity-centric security products to
enterprises, including financial services.

#### Relevant product knowledge

- No Cloudflare capability is named.
- The identity-compromise premise maps to Cloudflare's Zero Trust products, but the post never makes that connection.

#### Post

> Adversaries aren't breaking in—they’re logging in. How is your financial leadership redefining security? Register for our webinar on security resilience. cfl.re/3RAm5co

---

## Counts

| Platform | Good | Bad | Companies | Target | Status |
|---|---|---|---|---|---|
| Bluesky | 12 | 6 | PostHog, Tailscale, Sentry, Supabase | 10 good / 3–5 bad | **Met** |
| LinkedIn | 10 | 5 | Datadog, MongoDB, Grafana, Figma, PostHog, Sentry, Vercel, Cloudflare, Tailscale | 10 good / 3–5 bad | **Met** |
| X | 10 | 4 | Linear, Notion, Cloudflare, Stripe, Figma | 10 good / 3–5 bad | **Met** |
| Reddit | 0 | 0 | — | 10 good / 3–5 bad | **Not met** |
| **Total** | **32** | **15** | | | |

Anchors: 16 good, 7 bad (23). Held-out: 16 good, 8 bad (24). Total 47 entries.

Good posts per platform span at least four companies each.

## Deficits and why

**Reddit — zero qualifying posts, despite full access.** This is a finding, not a tooling
failure. Authenticated browser access worked; `curl` and server-side fetches were 403-blocked,
so all Reddit queries ran in-browser. Official-account and moderator-distinguished listings
were searched across r/Tailscale, r/Supabase, r/ObsidianMD, r/Notion, r/ProtonMail,
r/jetbrains, r/1Password, r/vercel and r/ghost. What official accounts actually post is
security advisories (1Password phishing notice), version-release notes (Obsidian 1.13),
product-update notices (Vercel 2FA recovery) and giveaways (TailscaleUp ticket) — all either
excluded by the launch/corporate-news rule or not marketing at all. Reddit culture penalises
overt brand marketing, so companies engage through support and announcement posts instead.
Sourcing 10 good marketing posts here would require redefining "marketing post" more loosely
than the brief allows.

## Rejection log

| Candidate | Platform | Reason |
|---|---|---|
| Tailscale Black Hat countdown (`urn:li:activity:7488202002091614209`) | LinkedIn | Cross-platform twin of bsky-bad-002 — same campaign, near-identical wording. |
| PostHog changelog, Bluesky version (`3mrxkdx4n5l2n`) | Bluesky | Same campaign as li-good-101. LinkedIn version retained. |
| Cloudflare Gartner MQ, LinkedIn version (`urn:li:activity:7488605541729165312`) | LinkedIn | Cross-platform twin of x-bad-002. X version retained. |
| Cloudflare Intern Appreciation Day, X version (`2082836146132787387`) | X | Cross-platform twin of li-bad-001. LinkedIn version retained (complete text, engagement available). |
| Cloudflare "adversaries" webinar, LinkedIn version | LinkedIn | Cross-platform twin of x-bad-102; LinkedIn copy was truncated, X copy complete. |
| Vercel Passport GA (`3mrx4znfdfz2y`, `2083193506940829949`, `urn:li:activity:7488959210689507329`) | Bluesky, X, LinkedIn | General-availability launch announcement — excluded by the launch rule on all three platforms. |
| Figma "Gen effect node" duplicate (`2082487922347917752`) | X | Figma posted identical text twice within a day; only `2082550148576756201` retained. |
| Supabase "Introducing Supabase Evals" (`2083282155170340898`) | X | New-project launch announcement. |
| Stripe "We're launching the Machine Payments Protocol" (`2034257912973963374`) | X | Launch announcement. Its later geographic-expansion post (x-good-004) qualifies instead. |
| Vercel "Introducing eve" (`3mohzda42yl2b`) | Bluesky | New-product launch. |
| Vercel Ship 2026 Sydney recap (`urn:li:activity:7489062271172714497`) | LinkedIn | Event recap; bad-example quota already filled by more instructive cases. |
| Datadog NYC AI research evening (`urn:li:activity:7489008268694986752`) | LinkedIn | Event recap, no marketing objective. |
| Grafana "AI Week" close (`urn:li:activity:7489010276680220672`) | LinkedIn | Link-dump with no stated benefit; quota filled. |
| Atlassian Gartner MQ (`urn:li:activity:7488331296235229184`) | LinkedIn | Analyst-badge post; duplicate failure mode to x-bad-002. |
| Atlassian AI policy statement (`urn:li:activity:7488770651353436161`) | LinkedIn | Corporate positioning, no marketing objective. |
| PostHog repositioning post (`urn:li:activity:7487539753752481792`) | LinkedIn | Brand-repositioning announcement — corporate news. |
| Tailscale July new hires (`urn:li:activity:7489065807008780288`) | LinkedIn | Corporate news, no marketing objective. |
| Figma "boundary between code and canvas" (`urn:li:activity:7487174947417763840`) | LinkedIn | Vague thought leadership with no capability or audience; quota filled. |
| Stripe Economics productivity post (`2080419876729176373`) | X | Economics research with no product-marketing objective; text also truncated by "Show more". |
| Obsidian 1.13 release (`/r/ObsidianMD/comments/1vayyo4/`) | Reddit | Version-release announcement. |
| Supabase Evals (`/r/Supabase/comments/1vc27f5/`) | Reddit | New-project launch announcement. |
| 1Password phishing notice (`/r/1Password/comments/1uvuu3t/`) | Reddit | Security advisory, no marketing objective. |
| Vercel 2FA recovery (`/r/vercel/comments/1v5tzei/`) | Reddit | Product-update notice, no marketing framing. |
| `u/1Password`, `u/supabase` submissions | Reddit | Unaffiliated personal accounts with coincidentally matching usernames. |

## Known limitations

1. **Reddit is absent entirely.** Three of four target platforms are covered at full quota;
   Reddit contributes nothing, so a judge calibrated here will have no exposure to Reddit's
   community register.
2. **Engagement counts decay.** All were read on 2026-07-31. X entries carry none at all,
   because the logged-out preview does not attach counts reliably to individual posts — so
   engagement is available for 33 of 47 entries.
3. **Dates for X and LinkedIn are derived, not read.** Both are computed from the post
   identifier and cross-checked against the relative label shown on the page. Bluesky dates
   are exact ISO values from the API.
4. **Platform balance is uneven but no longer extreme**: Bluesky 18, LinkedIn 15, X 14.
5. **Bluesky skews older.** Six Bluesky entries date from March–April 2026 while LinkedIn and
   X entries are almost all from the last ten days, because Bluesky feeds were paged deeply
   and the other two were not.
6. **Cross-platform twins were resolved by hand**, not by an automated check. The test suite
   enforces no duplicate source URL and no near-duplicate text across anchor/held-out, but two
   genuinely different phrasings of one campaign on two platforms would pass it.
7. **Text is reproduced for evaluation purposes** with full attribution and source links.
   Posts are short-form and each entry links to its original.
