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

### 3.10 Distribution (`/employer/tools/distribution`)

Finds importers, distributors, wholesalers and retail accounts for what the
company sells, researches each with sourced evidence, scores fit, and runs the
relationship through stages. Reachable from the Studio drawer (Tools →
Distribution), the ⌘K palette, and onboarding.

**No login, no data:** `/dev/distribution` mounts the real page over an
in-memory API simulator. Turn on "Use sample data" in Runs and press the
button; everything below can be exercised there first.

**Sample data on a real workspace (no API keys, no credits):**

1. Program tab → New program. Name, offering, at least one two-letter
   territory (for example `DE; NL:Amsterdam:20000`), at least one partner kind.
   Add `nordwind-import.example` under existing partners' domains to see
   exclusion in action.
2. Runs tab → switch on **Use sample data** → Run with sample data. The run
   completes inline in a few seconds and shows a `sample` badge. Expand the
   row: sources `web ok`, `trade ok`, `place skipped`; shortlisted equals
   enriched; one candidate flagged by screening.
3. Partners tab: every candidate is `Researched` with a fit score and an
   evidence count; the excluded domain never appears; "Shady Trading Ltd"
   carries a screening flag; "Canal Concept Stores" (thin site) scores low.
4. Open a partner: the drawer shows the dossier (every fact tagged
   `E<n>`), the evidence list with verbatim quotes and source links, the fit
   breakdown, and "Dossier in Sources" (published under _Distribution /
   Sample_).
5. Stage rules: move `Researched → Contacted` without an owner → refused with
   "An owner is required". Set an owner, move again → succeeds and the
   timeline gains a `Moved` entry. Move to `In conversation` without a next
   action → refused. `Negotiating → Contracted` without an agreement →
   refused; add an agreement, move → succeeds.
6. Log activity (reply, meeting), add a note; both appear in the timeline and
   clear staleness.
7. Overview tab: the funnel, the coverage matrix (territory × kind: covered /
   in play / gap) and "Partners needing attention" match what you did.
8. Import partners (header button): paste
   `Nordic Foods AS,nordicfoods.no,NO,distributor,NO,active`. It appears as
   `Active`, source import, and its domain joins the program's exclusions.
9. Draft outreach from a `Researched`/`Contacted` partner: a campaign is
   drafted in Email (approve it there — nothing is sent from here). Try it on
   an `Active` or excluded partner: it is refused with the reason.
10. Run sample data again: no duplicate organisations or partners appear.

**Live discovery (needs `OPENAI_API_KEY` + `EXA_API_KEY` or `SERPER_API_KEY`;
optional `FOURSQUARE_SERVICE_KEY`, `OPENSANCTIONS_API_URL`,
`TRADE_DATA_PROVIDER`):** leave "Use sample data" off and start a run. It is
queued to the worker; the Runs table polls every 5 s through
`profiling → planning → gathering → resolving → enriching → … → completed`.
Expect a few minutes for 25 candidates. Check that every dossier fact links
to a real page containing the quote, and that credits per completed
candidate appear on the run row.

**From the terminal:** `pnpm --filter @launchstack/web distribution:fixture -- --company <id>`
runs the sample pipeline against `DATABASE_URL` and prints the summary and
partners (`--publish` also publishes dossiers into Sources). The same path is
covered by `apps/web/__tests__/api/distribution/pipeline.e2e.test.ts` against
the local test database.

### 3.11 Prospects (`/employer/tools/prospects`)

Prospects is the reframe of Distribution: find the companies that would buy
what the workspace sells, profile them with cited evidence, find the people,
run the deal. Reachable from the Studio drawer (Tools → Prospects), the ⌘K
palette, `/employer/documents?feature=prospects`, and the onboarding tile;
the rail's "Back to Studio" returns to the workspace.

**In the app** the `/api/prospects/*` routes are an adapter over today's
Distribution data: a segment is a program, a company is a discovered
organisation, a deal is its relationship, people are the public mailboxes in
the dossier. Until the pipeline reframe lands: the segment's buyer type comes
from the program's partner kinds, sources are what the gather stage has, and
their switches are locked.

**Run modes.** Find companies picks the mode from the environment:

- **Keyless** (no model or search key configured, which is every fresh dev
  setup): OpenStreetMap (Photon category search plus the OSM API, then
  Overpass, then Nominatim by native-language names) and the Y Combinator
  directory find organisations with a website in each territory; each site is read by the page profiler
  (home plus about/contact/careers pages) which records what the pages
  literally say as evidence — description, headcount, roles, countries,
  certifications, public mailboxes — and assembles the dossier. It runs in
  the web process after the response and updates the run row per stage, so
  the run sheet and the rail indicator show progress. Expect 30 s to 3 min
  depending on how many sites answer. Nothing is paid for.
- **Live** (a model key plus Exa, Serper or Foursquare): queued to the
  worker; the research agent profiles each company. Needs credits.
- **Sample** (the switch on Runs): deterministic fixtures, inline, seconds.

Profiles are published into Sources only when `FILE_ACCESS_TOKEN_SECRET` is
set (the ingestion pipeline needs it); without it every row is kept and the
document is skipped, with one warning in the server log.

The run's `caps` line and the Sources yield labels say which mode produced
it ("OpenStreetMap" and "Public directories (YC)" for keyless; "Sample …" for
fixtures). Segments that name concrete, physical buyer types (cafés,
roasters, bakeries, warehouses, clinics) get the most from OpenStreetMap;
abstract software categories mostly reach the YC directory.

1. Open Prospects with no program: the rail says "No segment"; New segment
   (segment switcher → New segment) asks for a name, what you sell,
   industries and two-letter countries and creates the program.
2. Runs → switch on **Sample data** → Find companies. The run completes
   inline; the sheet shows Sources (web ok, trade ok, places skipped),
   Shortlist, Profiles n of n, People skipped ("arrives with people lookup").
   Companies fills with the fixture organisations; each opens to a cited
   profile (dossier facts with superscripts to the evidence list).
3. Stage rules are the Distribution ones in plain words: Contacted needs an
   owner ("Take it"), Meeting needs a next step, Won needs an agreement
   recorded in Distribution; Proposal is disabled ("Not a stage in this
   workspace yet").
4. Add to outreach (Companies bulk bar, or a company page's "Draft to the
   public inbox") drafts a campaign in Email and logs a note on the deal.
5. Exclude adds the domain to the program's exclusion list and parks the
   deal as Not a fit; the Excluded view lists it; Include again reverses.
6. Live runs need the same keys and credits as Distribution and are queued
   to the worker; the Runs table and the rail indicator poll until done.

**Preview harness** `/dev/prospects` (add `?reset=1` to start over) mounts
the same screens over an in-memory simulator with a richer fixture world.
Everything below can be exercised there without a login, a key or a credit.
The rail shows the segment "Fulfilment operators · EU", the views with
counts, and the segment switcher (the second segment is a draft).

1. **Home**: the serif headline names the segment. "To do" lists new high-fit
   companies, next steps due today and stale deals; each button lands on the
   right view. The funnel is one row; "Where companies come from" shows each
   source's yield and how many of its companies are in a deal.
2. **Companies**: views (All / New / High fit / Not contacted / Excluded) live
   in the URL. Type `/` to search, `j` `k` to move, `x` to select, `Enter` to
   open, `o` to add to outreach. Select three rows: the bulk bar floats up
   with Add to outreach / Move to Qualified / Exclude. "Move to Qualified"
   refuses companies that cannot move and says so in a toast.
3. **Company page** (open Delta Logistics): every sentence in About and Why
   they fit carries a superscript; hover shows the page and quote, click
   scrolls to the numbered evidence row and flashes it. The stage control
   lists every stage; illegal moves are disabled with the reason ("Needs an
   owner", "Needs a next step"). Open Nordlager Fulfilment: it is a lead with
   no owner — the menu refuses Contacted until you click "Take it". Set a
   next step inline, then Meeting is allowed. `↑` `↓` move between companies
   in the list's order.
4. **Add people to outreach**: the dialog preselects Verified and Found emails,
   disables Guess and Generic with the reason, and toasts "Campaign drafted in
   Email". On an excluded company (Excluded view → Globex Logistics) the
   button is disabled and the people rows say why.
5. **Find companies** (any screen): a sheet opens with the run's steps. Sources
   finish one by one over ~8 s with "41 found · 9 new"; Google Maps shows
   cities; OpenStreetMap and Trustpilot are skipped as off, Glassdoor as "no
   key". Then Shortlist, Profiles n of 25, People. "Run in background" closes
   the sheet; the rail keeps a "Finding companies · 4 of 7 done" indicator
   that reopens it. At ~19 s the run completes and five new companies appear
   in Companies (view New) and on Home. "Stop" ends a run early and keeps
   what was found.
6. **Runs**: the finished run is a row; expanding it shows the yield table per
   source with status words (ok / off / no key / rate limited).
7. **People**: filter by email status; only Verified and Found rows can be
   selected; Add to outreach reports how many were skipped and why.
8. **Deals**: board by stage (leads stay in Companies). A stale deal has a thin
   warn rule on the left and says how long it has been quiet. The card's
   stage menu enforces the same rules as the company page.
9. **Segment**: every field shows where it came from. Edit a chip list, save:
   the segment becomes a draft and "Find companies" refuses until you Confirm.
   Re-derive updates the date.
10. **Sources**: switches per platform; Glassdoor is disabled with "Needs
    SERPER_API_KEY". Turn OpenStreetMap on and start a run: it now appears in
    the step list. The rail's Sources count follows the switches.
11. **Themes**: the harness follows `data-theme` on `<html>`; check both.

Design rules for the surface are in
`apps/web/src/app/employer/tools/prospects/DESIGN.md`. The simulator's rules
are covered by `apps/web/__tests__/prospects/simulator.test.ts`; the adapter's
stage mapping, reasons and run steps by `adapter.test.ts`.

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
