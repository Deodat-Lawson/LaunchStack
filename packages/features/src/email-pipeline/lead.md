# Email Outreach Pipeline — lead.md

Build a pipeline that (1) generates a **company-grounded outreach email template**
from the account owner's company data with an LLM, (2) **reviews that draft with a
second LLM call**, and (3) sends personalized emails to a recipient list.

This file covers the core path: data → template generation, the review call, the
DB schema/contract, and the send adapter + safety. `member.md` covers recipients,
validation, UI, and docs.

Feature lives in `packages/features/src/email-pipeline/` (mirror
`packages/features/src/marketing-pipeline/`). Reuse company context from
[`marketing-pipeline/context.ts`](../marketing-pipeline/context.ts)
(`buildCompanyKnowledgeContext`, `extractCompanyDNA`) and the LLM pattern
(`resolveChatModel` + `invokeStructured`, per-stage routes in a `models.ts`).

## Phase 0 — Frozen contract (do first; unblocks member.md)
- [ ] DB schema in `packages/core/src/db/schema/` (`pgTable`, `pdr_ai_v2_` prefix) + a Drizzle migration:
  - `email_campaigns` — id, companyId, name, status, templateVersion, model, promptVersion, createdAt
  - `email_recipients` — id, campaignId, email, name, company, contextNotes, status
  - `email_sends` — id, campaignId, recipientId, subject, body, status (`dry_run|queued|sent|failed`), providerMessageId, error, sentAt
  - `email_suppressions` — companyId, email, reason (`unsubscribe|bounce|manual`); unique per (companyId, email)
- [ ] `types.ts` (zod + inferred): `Recipient`, `EmailTemplate { subject, body, variables[] }`, `TemplateReview { scores, issues[], verdict }`, `SendResult`.
- [ ] `contracts.ts` interfaces: `GenerateTemplateFn`, `ReviewTemplateFn`, `MergeFn(template, recipient) → { subject, body }`, `SendAdapter`.
- **DoD:** schema migrates on a test DB; `member.md` can import the types.

## Phase 1 — Company-grounded template generation
- [ ] Assemble owner-company facts from `buildCompanyKnowledgeContext` / `extractCompanyDNA` + `company_metadata` (value prop, differentiators, proof points, CTA).
- [ ] `models.ts`: pin the generation + review models.
- [ ] `generateTemplate()`: structured-output LLM → `{ subject, body, variables }`, where `body` uses merge tokens (`{{firstName}}`, `{{recipientCompany}}`, …). Every claim must trace to the company context — no invented facts.
- **DoD:** given a `companyId`, returns a valid template grounded in that company's data.

## Phase 2 — LLM review call
- [ ] `reviewTemplate()`: a second structured LLM call that critiques the draft — grounding vs company facts, clarity, tone, spam/deliverability risk, CTA strength, and compliance (has an unsubscribe token, honest subject) → `{ perCriterion scores, issues[], verdict: pass|revise }`. **Scores only; a human decides.** Version the rubric; low temperature.
- **DoD:** review returns structured, reproducible output.

## Phase 3 — Send adapter + safety (highest-risk)
- [ ] `SendAdapter` over an email provider (e.g. Resend, or SMTP via nodemailer) — new dependency; keys from env only.
- [ ] Consume `merge()` (the per-recipient renderer implemented in `member.md`) to get the concrete subject/body — the adapter never renders, only delivers.
- [ ] Safety — non-negotiable:
  - **dry-run is the DEFAULT**; a real send requires an explicit flag + confirmation.
  - check the suppression list before every send; inject an unsubscribe link; include required sender identity (CAN-SPAM / GDPR).
  - per-campaign **rate limit** + **idempotency** (never double-send a recipientId).
  - never send from tests; never touch production data.
- **DoD:** dry-run renders per-recipient emails and writes `email_sends` rows **without sending**; real send is gated, rate-limited, and logged.

## Phase 4 — Orchestration + API + audit
- [ ] Runner ties generate → review → (approve) → merge → send.
- [ ] API routes under `apps/web/src/app/api/email-pipeline/` (auth + `resolveActiveCompanyForUser`, mirroring [`marketing-pipeline/route.ts`](../../../../apps/web/src/app/api/marketing-pipeline/route.ts)): `generate`, `review`, `dry-run`, `send`, `status`.
- [ ] Record model / prompt / template versions per campaign for reproducibility.
- **DoD:** end-to-end from `companyId` to a dry-run batch through one API flow.

## Dependencies on member.md
- The `Recipient` shape + validators feed `merge()` / send.
- The UI calls these routes.

## Hard rules
- Grounded: template claims trace to company data; the review call enforces it.
- dry-run default; real sends explicit, rate-limited, idempotent, suppression-aware, unsubscribe-bearing.
- No real sends and no production data in tests; provider keys from env only.
