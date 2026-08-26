# Email Outreach Pipeline — member.md

Covers recipients, company-data → template field mapping, deterministic validation,
the UI, and docs. Builds against the frozen contract (schema / types / interfaces)
in `lead.md`. **Status: implemented — see [README.md](./README.md) for the runbook,
the Phase 0 contract gaps, and known limitations.** Feature dir: `packages/features/src/email-pipeline/`.

## Phase 0 — Contract review

- [x] Read the schema + `types.ts` referenced in `lead.md`. Confirm the `Recipient`
      shape and the template's merge variables cover the outreach cases; flag any
      missing field before building on them.

## Phase 1 — Recipient ingestion

- [x] Turn recipient sources into a normalized `Recipient[]`:
  - **client-prospector** results ([`packages/features/src/client-prospector`](../client-prospector)) — prospects to reach out to about the owner's company.
  - a **manual list / CSV / pasted addresses**.
- [x] Normalize each to `{ email, name, company, contextNotes }`; attach per-recipient context used for personalization.
- **DoD:** a prospector run or a pasted list produces a validated `Recipient[]`.

## Phase 2 — Company-data field mapping + deterministic validators

- [x] Map `company` / `company_metadata` → the template's merge variables (owner company name, value prop, differentiators, proof, CTA link). This is the data the template fills from.
- [x] Deterministic validators (pure, **no LLM calls**):
  - email format, dedup, suppression-list check,
  - required merge fields present, subject length/format,
  - unsubscribe + sender-identity present,
  - **"no unresolved `{{token}}`"** after merge.
- [x] Unit-test each validator (always-on, no API cost).
- **DoD:** every non-LLM check has a tested validator; invalid recipients are flagged, not sent.

## Phase 3 — Template rendering (`merge()`) [backend]

Split from `lead.md` Phase 3 — the per-recipient renderer the send adapter consumes.

- [x] Implement `merge(template, recipient) → { subject, body }` (the `MergeFn`
      contract from `lead.md`): substitute every merge token — `{{firstName}}`,
      `{{recipientCompany}}`, the unsubscribe link, sender identity, etc. — for one
      recipient, returning the concrete subject/body that will be delivered.
- [x] Pure and deterministic (no LLM, no network). Enforce the **"no unresolved
      `{{token}}`"** guard (reuse the Phase 2 validator) so a half-filled email can
      never reach the send adapter.
- [x] Unit-test with tricky cases: missing recipient fields, repeated tokens,
      tokens inside subject and body, unknown tokens.
- **DoD:** any valid `Recipient` + template renders a fully-resolved email with zero
  leftover tokens; covered by unit tests. `lead.md`'s send adapter can call it directly.

## Phase 4 — UI (compose / preview / review / send)

- [x] A screen under `apps/web/src/app/employer/…`: pick recipients, **Generate template**, show the **LLM review score + issues**, **preview the per-recipient merged email**, **Dry-run**, then **Send** (with an explicit confirm step). Reuse the marketing-pipeline UI patterns.
- **DoD:** a user can go recipients → template → review → dry-run preview → send from one screen.

## Phase 5 — Seed templates, command, docs

- [x] A couple of seed outreach templates (intro, follow-up) as starting points.
- [x] One documented command / runbook: how to add recipients, generate, review, dry-run, and send — plus compliance notes (unsubscribe, sender identity, consent).
- **DoD:** one documented path runs the flow; runbook merged.

## Dependencies on lead.md

- Phase 2/3 need the finalized `types.ts` + API routes from `lead.md`.
- Recipient ingestion (Phase 1) is what unblocks the first end-to-end dry-run — prioritize it.

## Hard rules

- Never trigger a real send from tests or previews without an explicit confirmation.
- Recipients must pass validation (format, suppression, dedup) before they can be sent.
- Personalization from company data must be grounded — no fabricated recipient facts.
