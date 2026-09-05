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

| # | Check | Route | Expected |
|---|--------|--------|----------|
| 1.1 | Landing page loads | `/` |
| 1.2 | Sign up link | Click “Start Free Trial” / `/signup` | Navigates to signup. |
| 1.3 | Sign in link | Nav or `/signin` | Sign-in form (email + password). |
| 1.4 | Contact | `/contact` | Contact page loads. |
| 1.5 | About | `/about` | About page loads. |
| 1.6 | Pricing | `/pricing` | Pricing page loads. |
| 1.7 | Deployment (public) | `/deployment` | Deployment/setup guide loads (no auth). |
---

## 2. Authentication flows (Only needed if working on authentication)

### 2.1 Sign up and join

| # | Check | Steps | Expected |
|---|--------|--------|----------|
| 2.1.1 | New workspace | Go to `/signup`, create an account, choose "Create a workspace", submit. | Company created; the account is its **Owner**, active immediately; redirected to `/employer/documents`. |
| 2.1.2 | Join link | As an Owner, Settings → People and access → Join links → create one (role Member). Open its URL in a fresh browser and sign up. | Membership created with status **pending** (default policy); redirected to `/employer/pending-approval`. With join policy "open", status is active and the person lands in the workspace. |
| 2.1.3 | Email invitation | Settings → People and access → Invitations → invite an address as Viewer. Copy the accept link (also in the server log on a self-hosted instance). Open it signed out, then sign in / sign up with **that** email. | `/invite/<token>` shows the workspace and role; accepting creates an **active** Viewer membership and lands in the workspace. Accepting with a different email is refused with a clear message. |
| 2.1.4 | Second workspace | Accept an invitation while signed in with an account that already belongs to another workspace. | A second membership is created; `/workspaces` lists both. |
| 2.1.5 | Expired / revoked link | Revoke a join link or invitation, then open it. | The preview says it is no longer valid; nothing is created. |

### 2.2 Sign in & redirects

| # | Check | Steps | Expected |
|---|--------|--------|----------|
| 2.2.1 | Member sign in | Sign in as an active member. Visit `/` or `/signin`. | Redirect to `/employer/documents` (or `/workspaces` with 2+ memberships). |
| 2.2.2 | Old employee URLs | Visit `/employee/documents` signed in. | Redirect to `/employer/documents` — there is one app. |
| 2.2.3 | Protected route unauthenticated | Log out, visit `/employer/documents`. | Redirect to `/signin`. |
| 2.2.4 | Suspended everywhere | Suspend a member's only membership, sign in as them. | Sent to `/workspaces`; every product API answers 403. |

### 2.3 Pending approval

| # | Check | Steps | Expected |
|---|--------|--------|----------|
| 2.3.1 | Pending member | Sign in as a member whose membership is `pending`. | Redirect to `/employer/pending-approval`; the page names the workspace and role. |
| 2.3.2 | Approve | As Owner/Admin, People and access → Members → Approve. | The person's next request succeeds; an audit event `member.approved` exists. |

---

## 3. Employer flows

### 3.1 Upload (`/employer/upload`)

| # | Check | Expected |
|---|--------|----------|
| 3.2.1 | Upload page | Form to upload file(s); optional category/settings if present. |
| 3.2.2 | Upload PDF | Select a PDF, submit; success feedback and document appears in list or documents page. |
| 3.2.3 | Upload DOCX/XLSX/PPTX | Same for other supported types; no client/server crash. |
| 3.2.4 | Validation | Invalid or oversized file shows clear error. |
| 3.2.5 | OCR (if configured) | With OCR provider keys set, option to run OCR on scanned PDF; processing completes or fails gracefully. |

### 3.2 Documents (`/employer/documents`)

| # | Check | Expected |
|---|--------|----------|
| 3.3.1 | List loads | Document list (or sidebar) loads; can select a document. |
| 3.3.2 | Document viewer | Selecting a document opens viewer (PDF/DOCX/XLSX/PPTX as applicable). |
| 3.3.3 | PDF viewer | PDF renders in iframe or native viewer; scroll/zoom ok. |
| 3.3.4 | DOCX/XLSX/PPTX | Respective viewers render content without crash. |
| 3.3.5 | AI chat / Q&A | Chat or Q&A panel sends query; response returned (RAG); no 500. |
| 3.3.6 | Document generator (if present) | Outline/citation/grammar/research/export panels open and behave; export works or shows clear state. |
| 3.3.7 | Simple query / Agent chat | Query panel or agent chat returns answers; no infinite loading. |

### 3.3 Statistics (`/employer/statistics`)

| # | Check | Expected |
|---|--------|----------|
| 3.4.1 | Page loads | Charts and tables load (employee activity, document stats). |
| 3.4.2 | Data | Numbers and trends match backend; document details sheet or drill-down works if present. |

### 3.4 People and access (`/employer/settings#people`) (Only if working on access)

| # | Check | Expected |
|---|--------|----------|
| 3.5.1 | Members | List loads with role, status, groups; counts (active / pending / suspended) match. |
| 3.5.2 | Change role | An Admin can make a Member a Viewer but not an Admin; an Owner can. Your own row has no actions. The last Owner cannot be demoted or removed. |
| 3.5.3 | Suspend / reinstate | Suspending a member makes their next request 403; reinstating restores it. Audit shows both. |
| 3.5.4 | Groups | Create a group, add two members, grant it a restricted folder; both see the folder. Deleting the group warns how many people lose access and removes the grant. |
| 3.5.5 | Custom roles | Create a role with `documents.read` + `documents.delete`; owner-only permissions are not offered; a Member cannot create roles. Assign it and check the member can delete but not invite. |
| 3.5.6 | Audit | Every action above appears newest-first with a plain sentence; filters and CSV export work. |

### 3.5 Folder access (`/employer/documents`) (Only if working on access)

| # | Check | Expected |
|---|--------|----------|
| 3.5.7 | Restrict a folder | Folder rail → Share folder… → "Only people added below" → Save. The folder shows a lock for people who manage it and disappears entirely for a Member without a grant: not in the rail, not in `GetCategories`, its documents absent from the list, their content routes 404. |
| 3.5.8 | Grant view | Add the Member with "Can view"; the folder and its documents reappear for them; upload into it is refused for them (needs "Can edit"). |
| 3.5.9 | Assistant stays in scope | Put a document with a unique sentence in the restricted folder. As the Member without a grant, ask about the sentence with every document selected (the "everything I can see" search): the answer does not contain it and cites nothing from that folder. `authz_retrieval_dropped_total` on `/api/metrics` stays at 0. |
| 3.5.10 | Restrict one document | Document menu → Restrict access… → add one person. Everyone else stops seeing that document while still seeing its folder. |

### 3.6 Settings (`/employer/settings`) (Only if working on settings)

| # | Check | Expected |
|---|--------|----------|
| 3.6.1 | Page loads | Settings form (profile, preferences, etc.) loads. |
| 3.6.2 | Save | Changing and saving updates without error. |

### 3.7 Contact support (`/employer/contact`) (Only if working on support)

| # | Check | Expected |
|---|--------|----------|
| 3.7.1 | Page loads | Contact/support form or info loads. |

### 3.9 Pending approval (`/employer/pending-approval`) (Only if working on authentication)

| # | Check | Expected |
|---|--------|----------|
| 3.9.1 | Message | Clear "pending approval" message naming the workspace; product APIs answer 403 until approved. |
---

## 4. Members and viewers (Everyone shares one document screen; what differs is what their role permits)

### 4.1 Member

| # | Check | Expected |
|---|--------|----------|
| 4.1.1 | Documents | Only folders and documents in the member's scope are listed (see 3.5.7). |
| 4.1.2 | Upload / rename | Allowed into workspace-visible folders and folders they can edit; refused elsewhere. Delete is not offered. |
| 4.1.3 | AI Q&A | Every search scope works; answers are limited to what they can read. |
| 4.1.4 | Studio | Settings is not offered; Workspace/People is not offered without `members.view` actions. |

### 4.2 Viewer and Guest

| # | Check | Expected |
|---|--------|----------|
| 4.2.1 | Viewer | Can open, search and download; upload, rename and delete are not offered and the APIs answer 403. |
| 4.2.2 | Guest | Sees only folders explicitly granted to them (or to the Guest role); workspace-visible folders are absent. |
