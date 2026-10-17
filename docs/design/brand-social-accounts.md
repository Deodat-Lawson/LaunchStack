# Brand social accounts (Growth › Brand)

Growth › Brand is LaunchStack's social-media manager: a workspace connects
its own accounts, then composes, schedules and publishes posts, reads back
how they did, and answers comments — the job Hootsuite, Buffer, Postiz and
Mixpost do. This note covers how it is put together and what an operator
does to switch LinkedIn on.

## Vocabulary

| Word                   | Means                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Network**            | LinkedIn, X, Bluesky, Reddit.                                                                                                                                                        |
| **Connection**         | One sign-in a workspace made to a network: a LinkedIn member's OAuth grant, a Bluesky app password. A row in `connector_connections`, encrypted with `EMBEDDING_SECRETS_KEY`.        |
| **Channel**            | One place a post goes out as: a LinkedIn profile, each LinkedIn Page that member administers, a Bluesky account. A row in `brand_channels`; disconnecting its connection removes it. |
| **Deployment account** | The operator's env keys for a network (`TWITTER_BEARER_TOKEN`, …). Shown as one channel per network until the workspace connects an account of its own there.                        |

## Flow

```
Accounts ──Connect LinkedIn──▶ /api/connectors/linkedin/oauth/start ──▶ LinkedIn consent
                                                                            │
Accounts ◀── channels (profile + Pages) ◀── callback: token sealed, Pages read
   │
Compose ──▶ brand_posts (one row per channel, images in brand_media)
                │
scheduler (worker cron, every minute) ──▶ publishForWorkspace ──▶ LinkedIn /rest/posts
                                                                  (+ /rest/images)
sync (worker cron, every 6 h; "Sync now") ──▶ numbers, followers, comments
                │                                   │
            Analytics                           Engagement ──reply──▶ /rest/socialActions
```

- **Who may do what.** Anyone in the workspace reads the calendar, numbers
  and comments. Composing, scheduling, publishing, replying and Sync now
  speak as the company, so they need `social.publish` (Members and up; never
  a Viewer or Guest). Connecting, disconnecting and switching channels
  decide which accounts speak for it, so they need `connectors.manage`
  (owners and admins). The campaign generator's Publish button goes through
  the same channels and permission.
- **Scopes decide features.** LinkedIn grants scopes per developer app, so
  Brand never assumes a product: posting as a Page needs
  `w_organization_social`, listing Pages needs `rw_organization_admin` or
  `r_organization_admin`, Page numbers need `rw_organization_admin` and the
  ADMINISTRATOR role, comments need `r_organization_social` +
  `w_organization_social` (or their `_feed` forms). See
  `apps/web/src/server/brand/capabilities.ts`.
- **A refused credential never retries.** A 401 from the network marks every
  channel of that connection "Reconnect" and fails the post with the reason.
  Rate limits and outages before the post is created (image upload, token
  refresh, a 429) put it back on the calendar 2, 8 and 32 minutes later
  before failing it. A 5xx or dropped connection on the create call itself
  never retries: neither network takes an idempotency key, so the post may
  exist, and the failure says to check the Page first.
- **Read-back budget.** A Community Management app on LinkedIn's development
  tier gets 500 calls a day. One Page costs about 2 + (posts in the last 30
  days, up to 20) calls per sync, so the six-hourly cron plus a few "Sync now"
  presses stay well inside it. "Sync now" is ignored within a minute of the
  last sync.

## Code map

| Piece                              | Where                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| LinkedIn / Bluesky REST clients    | `packages/tools/src/social-publish/{linkedin,bluesky}/`                       |
| Publish adapters (env or channel)  | `packages/tools/src/social-publish/adapters/`                                 |
| LinkedIn OAuth provider            | `apps/web/src/server/services/connectors/providers/linkedin.ts`               |
| Channels, accounts, publish port   | `apps/web/src/server/brand/{channels,accounts,publish}.ts`                    |
| Images, read-back, comments        | `apps/web/src/server/brand/{media,sync,insights,comments}.ts`                 |
| Tables                             | `apps/web/src/server/db/schema/brand.ts`, `pipelines/src/marketing/schema.ts` |
| Routes                             | `apps/web/src/app/api/brand/**`                                               |
| Crons                              | `apps/web/src/server/inngest/functions/brand{PublishDue,SyncInsights}.ts`     |
| Screens                            | `apps/web/src/app/employer/tools/growth/brand/`                               |
| Dev stand-ins for LinkedIn/Bluesky | `apps/web/src/app/dev/stand-ins/`                                             |

## Switching LinkedIn on

1. **Create the app** at <https://developer.linkedin.com> → Create app. Name it
   without "Linked" or "In", associate it with the company's LinkedIn Page,
   add a logo and a privacy-policy URL.
2. **Pick the products.** LinkedIn decides what the app can do:
   - _Profiles only, today, no review_: add **Share on LinkedIn** and **Sign
     In with LinkedIn using OpenID Connect**. Scopes: `openid profile email
w_member_social`. Members post as themselves; tokens last 60 days and
     cannot refresh, so Accounts asks them to reconnect.
   - _The company Page, numbers and comments_: request the **Community
     Management API** on a **separate app with no other products**. LinkedIn
     wants a registered legal entity, a business email, the company's
     address and website, and a super admin of the Page to verify the app.
     You start on the development tier (500 calls a day, enough for one
     company); the standard tier needs a narrated screencast showing the
     OAuth flow, posting to a Page and how comments appear — all of which
     Brand does.
3. **Redirect URL.** Under the app's Auth tab add
   `<BETTER_AUTH_URL>/api/connectors/linkedin/oauth/callback`
   (e.g. `https://launchstack-internal.com/api/connectors/linkedin/oauth/callback`).
4. **Server settings.** Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`,
   and `LINKEDIN_OAUTH_SCOPES` to exactly the scopes the Auth tab lists
   (space-separated). `EMBEDDING_SECRETS_KEY` and `BETTER_AUTH_URL` must be set.
   Compose passes all of them to the app and worker.
5. **Connect.** An admin opens Growth › Brand › Accounts → Connect LinkedIn.
   The Pages they administer appear as channels, switched on; their own
   profile appears switched off when there is a Page to speak for the company.

`LINKEDIN_API_VERSION` (default `202609`) is the Posts API version; LinkedIn
supports each version for about a year, so bump it once a year.

## Developing without LinkedIn

`next dev` serves stand-ins for both networks under `/dev/stand-ins/` (404 in a
production build unless `ENABLE_DEV_ROUTES` is set). Point the app at them:

```
LINKEDIN_CLIENT_ID=standin
LINKEDIN_CLIENT_SECRET=standin
LINKEDIN_OAUTH_SCOPES="r_basicprofile w_member_social rw_organization_admin w_organization_social r_organization_social r_organization_followers"
LINKEDIN_OAUTH_BASE_URL=http://localhost:3000/dev/stand-ins/linkedin/oauth/v2
LINKEDIN_API_BASE_URL=http://localhost:3000/dev/stand-ins/linkedin
BLUESKY_SERVICE_URL=http://localhost:3000/dev/stand-ins/bluesky
BLUESKY_APPVIEW_URL=http://localhost:3000/dev/stand-ins/bluesky
```

The stand-in's consent page signs you in as a fictional member who
administers two Pages; `/dev/stand-ins/linkedin` shows what was posted and can
add comments or revoke every token (to see "Reconnect"). The Bluesky stand-in
accepts `launchstack.bsky.social` with any `xxxx-xxxx-xxxx-xxxx` app password.

## Not built yet

Instagram, Facebook Pages and Threads (Meta app review), TikTok, YouTube; X
and Reddit per workspace (they use deployment keys); video, document and poll
posts; per-network text variants; approvals; LinkedIn webhooks (standard tier
only, so comments are polled); member-post analytics
(`r_member_postAnalytics`).
