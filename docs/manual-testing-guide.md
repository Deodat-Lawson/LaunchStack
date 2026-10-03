# Manual Testing Guide (Dev)

Use this guide to **exhaustively manually test the website in development** after each PR. It covers all user-facing routes, auth flows, and major features so nothing is missed.

## Running the tests: two passes required

**Run the same test suite twice:**

1. **Run 1 — Local dev:** App and DB run on your machine (Next.js dev server + local or Docker DB).
2. **Run 2 — Docker:** Full stack runs via Docker Compose (app + DB + migrate, and optional services).

Use the **same checklist** (sections 1–5, and optionally 6) for both passes. This catches environment-specific issues (paths, env loading, build vs dev server, etc.).

---

## Run 1: Local dev setup

Before the first pass:

1. **Environment**
   - Copy `.env.example` to `.env` and fill required keys (see [README](../README.md) Quick Start).
   - Set `DATABASE_URL` for a local PostgreSQL (e.g. `localhost:5433` if using Docker for DB only).

2. **Database**

   ```bash
   pnpm --filter @launchstack/core db:migrate   # apply schema
   pnpm --filter @launchstack/core db:seed      # optional sample data
   ```

3. **Enable Inngest** (required for background document processing)
   - Set `INNGEST_EVENT_KEY=placeholder` in `.env`.
   - In a **separate terminal**, run the Inngest dev server:

   ```bash
   pnpm --filter @launchstack/web inngest:dev
   ```

   Dashboard: **http://localhost:8288**. Keep this running while testing.

4. **Run dev server**

   ```bash
   pnpm --filter @launchstack/web dev
   ```

   Open **http://localhost:3000**.

5. **Test accounts**
   - Have at least one **Owner** account (the first signup on a fresh instance).
   - Optionally have one **pending** member (joined through a join link under the default
     "approval required" policy) and one **Member** for the folder-access checks.

Complete sections 1–5 (and 6 if desired), then proceed to Run 2.

---

## Run 2: Docker setup

Before the second pass:

1. **Environment**
   - Use the same `.env` (or a copy) with keys valid for the Docker run (e.g. `DATABASE_URL` for the Compose `db` service).

2. **Start full stack**
   - Ensure `INNGEST_EVENT_KEY` (and optionally `INNGEST_SIGNING_KEY`) is set in `.env`.
   - The default profile already includes the worker (which processes uploads via the transactional outbox) and the Inngest dev server:

   ```bash
   docker compose --env-file .env up
   ```

   Wait until the stack is ready (migrate completes, app listens, worker healthy at **http://localhost:8020/healthz**). Open **http://localhost:3000**; Inngest dashboard at **http://localhost:8288**.

3. **Test accounts**
   - Reuse the same Owner/Member accounts (auth and app rows live in the same DB) or create fresh ones.

Run the **same checklist** (sections 1–5, and optionally 6) again. Note any differences from Run 1 (e.g. upload paths, API base URL, env-only features).

---

## 1. Public pages (Only needs to be tested if working on the main landing page)

| #   | Check               | Route                                | Expected                                |
| --- | ------------------- | ------------------------------------ | --------------------------------------- |
| 1.1 | Landing page loads  | `/`                                  |
| 1.2 | Sign up link        | Click “Start Free Trial” / `/signup` | Navigates to signup.                    |
| 1.3 | Sign in link        | Nav or `/signin`                     | Sign-in form (email + password).        |
| 1.4 | Contact             | `/contact`                           | Contact page loads.                     |
| 1.5 | About               | `/about`                             | About page loads.                       |
| 1.6 | Pricing             | `/pricing`                           | Pricing page loads.                     |
| 1.7 | Deployment (public) | `/deployment`                        | Deployment/setup guide loads (no auth). |

---

## 2. Authentication flows (Only needed if working on authentication)

### 2.1 Sign up and join

| #     | Check                  | Steps                                                                                                                                                                                                              | Expected                                                                                                                                                                                        |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1.1 | New workspace          | Go to `/signup`, create an account, choose "Create a workspace", submit.                                                                                                                                           | Company created; the account is its **Owner**, active immediately; redirected to `/employer/documents`.                                                                                         |
| 2.1.2 | Join link              | As an Owner, Settings → People and access → Join links → create one (role Member). Open its URL in a fresh browser and sign up.                                                                                    | Membership created with status **pending** (default policy); redirected to `/employer/pending-approval`. With join policy "open", status is active and the person lands in the workspace.       |
| 2.1.3 | Email invitation       | Settings → People and access → Invitations → invite an address as Viewer. Copy the accept link (also in the server log on a self-hosted instance). Open it signed out, then sign in / sign up with **that** email. | `/invite/<token>` shows the workspace and role; accepting creates an **active** Viewer membership and lands in the workspace. Accepting with a different email is refused with a clear message. |
| 2.1.4 | Second workspace       | Accept an invitation while signed in with an account that already belongs to another workspace.                                                                                                                    | A second membership is created; `/workspaces` lists both.                                                                                                                                       |
| 2.1.5 | Expired / revoked link | Revoke a join link or invitation, then open it.                                                                                                                                                                    | The preview says it is no longer valid; nothing is created.                                                                                                                                     |

### 2.2 Sign in & redirects

| #     | Check                           | Steps                                                | Expected                                                                  |
| ----- | ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 2.2.1 | Member sign in                  | Sign in as an active member. Visit `/` or `/signin`. | Redirect to `/employer/documents` (or `/workspaces` with 2+ memberships). |
| 2.2.2 | Old employee URLs               | Visit `/employee/documents` signed in.               | Redirect to `/employer/documents` — there is one app.                     |
| 2.2.3 | Protected route unauthenticated | Log out, visit `/employer/documents`.                | Redirect to `/signin`.                                                    |
| 2.2.4 | Suspended everywhere            | Suspend a member's only membership, sign in as them. | Sent to `/workspaces`; every product API answers 403.                     |

### 2.3 Pending approval

| #     | Check          | Steps                                                  | Expected                                                                         |
| ----- | -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 2.3.1 | Pending member | Sign in as a member whose membership is `pending`.     | Redirect to `/employer/pending-approval`; the page names the workspace and role. |
| 2.3.2 | Approve        | As Owner/Admin, People and access → Members → Approve. | The person's next request succeeds; an audit event `member.approved` exists.     |

---

## 3. Employer flows

### 3.1 Upload (`/employer/upload`)

| #     | Check                 | Expected                                                                                                |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| 3.2.1 | Upload page           | Form to upload file(s); optional category/settings if present.                                          |
| 3.2.2 | Upload PDF            | Select a PDF, submit; success feedback and document appears in list or documents page.                  |
| 3.2.3 | Upload DOCX/XLSX/PPTX | Same for other supported types; no client/server crash.                                                 |
| 3.2.4 | Validation            | Invalid or oversized file shows clear error.                                                            |
| 3.2.5 | OCR (if configured)   | With OCR provider keys set, option to run OCR on scanned PDF; processing completes or fails gracefully. |

### 3.2 Documents (`/employer/documents`)

| #     | Check                           | Expected                                                                                            |
| ----- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| 3.3.1 | List loads                      | Document list (or sidebar) loads; can select a document.                                            |
| 3.3.2 | Document viewer                 | Selecting a document opens viewer (PDF/DOCX/XLSX/PPTX as applicable).                               |
| 3.3.3 | PDF viewer                      | PDF renders in iframe or native viewer; scroll/zoom ok.                                             |
| 3.3.4 | DOCX/XLSX/PPTX                  | Respective viewers render content without crash.                                                    |
| 3.3.5 | AI chat / Q&A                   | Chat or Q&A panel sends query; response returned (RAG); no 500.                                     |
| 3.3.6 | Document generator (if present) | Outline/citation/grammar/research/export panels open and behave; export works or shows clear state. |
| 3.3.7 | Simple query / Agent chat       | Query panel or agent chat returns answers; no infinite loading.                                     |

### 3.3 Statistics (`/employer/statistics`)

| #     | Check      | Expected                                                                                 |
| ----- | ---------- | ---------------------------------------------------------------------------------------- |
| 3.4.1 | Page loads | Charts and tables load (employee activity, document stats).                              |
| 3.4.2 | Data       | Numbers and trends match backend; document details sheet or drill-down works if present. |

### 3.4 People and access (`/employer/settings#people`) (Only if working on access)

| #     | Check               | Expected                                                                                                                                                                                  |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.5.1 | Members             | List loads with role, status, groups; counts (active / pending / suspended) match.                                                                                                        |
| 3.5.2 | Change role         | An Admin can make a Member a Viewer but not an Admin; an Owner can. Your own row has no actions. The last Owner cannot be demoted or removed.                                             |
| 3.5.3 | Suspend / reinstate | Suspending a member makes their next request 403; reinstating restores it. Audit shows both.                                                                                              |
| 3.5.4 | Groups              | Create a group, add two members, grant it a restricted folder; both see the folder. Deleting the group warns how many people lose access and removes the grant.                           |
| 3.5.5 | Custom roles        | Create a role with `documents.read` + `documents.delete`; owner-only permissions are not offered; a Member cannot create roles. Assign it and check the member can delete but not invite. |
| 3.5.6 | Audit               | Every action above appears newest-first with a plain sentence; filters and CSV export work.                                                                                               |

### 3.5 Folder access (`/employer/documents`) (Only if working on access)

| #      | Check                    | Expected                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.5.7  | Restrict a folder        | Folder rail → Share folder… → "Only people added below" → Save. The folder shows a lock for people who manage it and disappears entirely for a Member without a grant: not in the rail, not in `GetCategories`, its documents absent from the list, their content routes 404.                                            |
| 3.5.8  | Grant view               | Add the Member with "Can view"; the folder and its documents reappear for them; upload into it is refused for them (needs "Can edit").                                                                                                                                                                                   |
| 3.5.9  | Assistant stays in scope | Put a document with a unique sentence in the restricted folder. As the Member without a grant, ask about the sentence with every document selected (the "everything I can see" search): the answer does not contain it and cites nothing from that folder. `authz_retrieval_dropped_total` on `/api/metrics` stays at 0. |
| 3.5.10 | Restrict one document    | Document menu → Restrict access… → add one person. Everyone else stops seeing that document while still seeing its folder.                                                                                                                                                                                               |

### 3.6 Settings (`/employer/settings`) (Only if working on settings)

| #     | Check      | Expected                                          |
| ----- | ---------- | ------------------------------------------------- |
| 3.6.1 | Page loads | Settings form (profile, preferences, etc.) loads. |
| 3.6.2 | Save       | Changing and saving updates without error.        |

### 3.7 Contact support (`/employer/contact`) (Only if working on support)

| #     | Check      | Expected                            |
| ----- | ---------- | ----------------------------------- |
| 3.7.1 | Page loads | Contact/support form or info loads. |

### 3.9 Pending approval (`/employer/pending-approval`) (Only if working on authentication)

| #     | Check   | Expected                                                                                       |
| ----- | ------- | ---------------------------------------------------------------------------------------------- |
| 3.9.1 | Message | Clear "pending approval" message naming the workspace; product APIs answer 403 until approved. |

---

### 3.10 Growth (`/employer/tools/growth`)

Growth is two tool pages behind one front door: **Brand** (make the company
known) and **Prospects** (find the companies that will buy). Each page is
laid out like every other tool: the shell's back bar, a header with the
tool's icon, name, one line and its actions, then the workspace. There is no
rail and there are no tabs; a company, the runs, the segment, the composer
and the accounts open as side panels over the workspace, and everything a
panel or a filter shows is spelled in the URL. Reachable from the Studio
drawer (Tools → Growth), the ⌘K palette (Growth, Brand, Prospects), the
onboarding tiles, and `?feature=growth|brand|prospects|marketing|distribution`
on the workspace. The old routes `/employer/tools/marketing-pipeline`,
`/employer/tools/distribution`, `/employer/tools/prospects/*` and the former
sub-pages (`/growth/brand/compose|calendar|accounts`,
`/growth/prospects/companies|people|deals|runs|segment|sources`) redirect
into the right page with the right panel or view open.

1. `/employer/tools/growth` is a page of its own: a card per side with the
   week's numbers (posts coming up and overdue, posts out, networks
   connected; companies, deals, things to do) and the two things to do next.
   The back bar above it says Studio; on Brand and Prospects it says Growth.
2. **Harness**: `/dev/growth`, `/dev/growth/brand`, `/dev/growth/brand/campaigns`
   and `/dev/growth/prospects` mount the real pages over the in-memory
   simulator (`?reset=1` starts over). Brand posts publish in memory; a
   credential ending in `-bad` is refused by the fake network; Find
   companies runs a simulated 20-second run.

### 3.11 Growth › Brand (`/employer/tools/growth/brand`)

Brand is the marketing tool reframed around running a presence: compose
once, schedule or publish, see the week, know which accounts post. Posts are
one row per network in `brand_posts`; the worker's `brand-publish-due` cron
(every minute) claims due rows with one conditional update and publishes
them through the adapters (LinkedIn, X, Bluesky, Reddit). The web app never
publishes on a timer any more: a transient failure (429, 5xx, a timeout)
puts the row back to `scheduled` with a retry time (1, 5, 15 then 60
minutes, five attempts in all) and the calendar shows "Retrying"; a refused
credential or the last attempt marks it failed with the reason.

**Accounts** are per workspace: a member with `connectors.manage` enters a
network's credential once, it is verified against the network, stored
sealed in `brand_accounts`, and only its presence and identity are ever
shown. A workspace with no account of its own falls back to the
deployment's environment tokens (`LINKEDIN_ACCESS_TOKEN`,
`TWITTER_BEARER_TOKEN`, `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD`,
`REDDIT_CLIENT_ID/SECRET/USER_AGENT`), which the Accounts panel labels
"deployment-wide". A workspace that has connected its own account never
falls back. When a network refuses a stored credential the account is
marked revoked, the panel says "Needs reconnecting" with the network's
words, and posts to it fail until it is reconnected.

1. Header: Networks pill ("2 of 4 connected", "reconnect" in warn when one
   is revoked) opens the Accounts panel; "Generate a campaign" opens the
   generator page; "Compose" (or `c`) opens the composer panel.
2. Compose: type a post, tick LinkedIn and X, watch the counters; over 280
   characters the X row and preview turn red and the primary button
   disables. Not-connected and revoked networks say so in the checklist.
   Choose "Schedule for" (defaults to the next quarter hour), Schedule →
   the panel closes, the week shows one block per network.
3. Week: previous and next week, "This week" when away, `?week=YYYY-MM-DD`
   in the URL. Click a block → the popover shows the text, the due time and
   the actions: move, publish now, cancel (stays, struck through), delete a
   draft, open where it went. When a scheduled time passes, the block reads
   "Due" and the toolbar offers "Publish overdue now"; within a minute the
   worker tries it. With no credential it lands as failed with the reason;
   with a network error it reads "Retrying · attempt 1 · next at HH:MM".
4. Lists under the week: Coming up (failed count in danger), Drafts, Went
   out (last 7 days).
5. Accounts panel: each network's status, identity, limit, cost note and
   what connecting takes; the connect form asks for the fields the network
   needs (secrets as password fields), verifies them and shows the
   network's refusal inline; Disconnect (with a confirm) only for the
   workspace's own accounts.
6. Campaigns (`/growth/brand/campaigns`): the generator, embedded under the
   same header; "Schedule…" beside "Publish" hands the edited post to the
   composer with the network preselected.

### 3.12 Growth › Prospects (`/employer/tools/growth/prospects`)

Prospects is the reframe of Distribution: find the companies that would buy
what the workspace sells, profile them with cited evidence, find the people,
run the deal. One page: the segment switcher, the run pill and "Find
companies" in the header; a "To do" column with the funnel and each
source's yield beside the list; the list itself in three views (Companies,
People, Deals) with filters, search, sort and "Show more" paging; a company
as a side panel with previous and next.

**In the app** the `/api/prospects/*` routes are an adapter over the
Distribution data: a segment is a program, a company is a discovered
organisation, a deal is its relationship, people are the public mailboxes in
the dossier. Every list is a query: the page, the count and the five view
counts come from the database, so a workspace with thousands of companies
costs the same per screen as one with ten. The old `/api/distribution/*`
routes are gone.

**Run modes.** Find companies picks the mode from the environment, and every
mode but sample runs on the worker (ADR-003):

- **Keyless** (no model or search key configured, which is every fresh dev
  setup): OpenStreetMap (Photon, then Overpass with a pause between areas,
  then Nominatim) and the Y Combinator directory find organisations with a
  website in each territory; each site is read by the page profiler, which
  records what the pages literally say as evidence and assembles the
  dossier. Expect 30 s to 4 min. Nothing is paid for. The Runs panel says
  when this is the mode in use. **Needs the worker running** (`pnpm
  --filter @launchstack/worker dev` and the Inngest dev server).
- **Live** (a model key plus Exa, Serper or Foursquare): the research agent
  profiles each company. Needs credits.
- **Sample** (the switch in the Runs panel, or "Run once with sample data"
  under the Find companies chevron): deterministic fixtures, inline,
  seconds, no worker needed.

One run per segment at a time: a second "Find companies" while one is in
flight is refused ("A run is already in progress for this segment"). "Stop"
asks the worker to finish the company it is on and stop; the run ends as
"Stopped" with what it found. Progress ("12 of 25 profiled") is written by
the worker as it goes and read every three seconds.

Profiles are published into Sources only when `FILE_ACCESS_TOKEN_SECRET` is
set (the ingestion pipeline needs it); without it every row is kept and the
document is skipped, with one warning in the worker's log.

1. Open Prospects with no program: the empty state says to create a segment;
   the segment switcher → New segment asks for a name, what you sell,
   industries and two-letter countries and creates the program.
2. Find companies chevron → "Run once with sample data". The Runs panel
   opens with the run's steps and completes inline; Companies fills with
   the fixture organisations, the To do column lists the new ones, the
   funnel and the yield fill in.
3. Companies: filters (All / New / High fit / Not contacted / Excluded)
   with server counts, `/` to search, sort by fit, activity or name, "Show
   more" at fifty rows. `j` `k` move, `x` selects, `Enter` opens, `o` adds
   to outreach. Select three rows: the bulk bar floats up with Add to
   outreach / Move to Qualified / Exclude.
4. Company panel: every sentence in About and Why they fit carries a
   superscript; hover shows the page and quote, click scrolls to the
   evidence row. The stage control lists every stage; illegal moves are
   disabled with the reason, in production's words ("Needs an owner",
   "Move to Contacted first", "Needs an agreement recorded in Distribution",
   "Not a stage in this workspace yet" for Proposal). `↑` `↓` move through
   the list behind the panel; `?company=<id>` deep-links to it.
5. Add people to outreach drafts a campaign in Email and logs a note on the
   deal; a company already drafted today is skipped with that reason.
6. Exclude adds the domain to the segment's exclusion list and parks the
   deal as Not a fit; the Excluded filter lists it; Include again reverses.
7. People: found and shared-inbox mailboxes, searchable and paged; only
   found mailboxes can be selected for outreach.
8. Deals: the board by stage (leads stay in Companies); a quiet deal has a
   thin warn rule and says how long; the card's stage menu enforces the
   same rules as the panel.
9. Segment panel: every field shows where it came from; editing makes the
   segment a draft until it is confirmed; the sources for the next run are
   listed under the fields with their last yield.
10. Runs panel: the run in flight with its steps, progress bar and Stop; the
    sample-data switch; earlier runs, each expanding to its yield per source.
11. Themes: the harness follows `data-theme` on `<html>`; check both.

Design rules for the surface are in
`apps/web/src/app/employer/tools/growth/DESIGN.md`. Routes are covered by
`apps/web/__tests__/api/prospects/routes.test.ts`, the simulator's rules
(which are production's) by `__tests__/prospects/simulator.test.ts`, the
adapter's stage mapping, reasons and run steps by `adapter.test.ts`, and the
scheduler's claim and retries by `__tests__/api/brand/posts.integration.test.ts`.

## 4. Members and viewers (Everyone shares one document screen; what differs is what their role permits)

### 4.1 Member

| #     | Check           | Expected                                                                                                    |
| ----- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| 4.1.1 | Documents       | Only folders and documents in the member's scope are listed (see 3.5.7).                                    |
| 4.1.2 | Upload / rename | Allowed into workspace-visible folders and folders they can edit; refused elsewhere. Delete is not offered. |
| 4.1.3 | AI Q&A          | Every search scope works; answers are limited to what they can read.                                        |
| 4.1.4 | Studio          | Settings is not offered; Workspace/People is not offered without `members.view` actions.                    |

### 4.2 Viewer and Guest

| #     | Check  | Expected                                                                                                   |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------- |
| 4.2.1 | Viewer | Can open, search and download; upload, rename and delete are not offered and the APIs answer 403.          |
| 4.2.2 | Guest  | Sees only folders explicitly granted to them (or to the Guest role); workspace-visible folders are absent. |
