# Email outreach pipeline — runbook

Recipients → template → review → dry-run → send.

This file covers the `member.md` half: recipient ingestion, deterministic
validation, company-data field mapping, the per-recipient renderer, the UI, and
the operating procedure. `lead.md` owns generation, the LLM review, the DB
schema and the send adapter.

## The one path

1. **Open** `/employer/tools/email-pipeline`.
2. **Add recipients** — paste addresses, or paste a CSV with an `email` column.
   Parsing and validation run locally as you type; nothing is sent anywhere yet.
3. **Generate a template** (or start from a seed). The LLM writes it from your
   company's own data; a second LLM call scores it.
4. **Preview** — pick any recipient and read the exact bytes they would receive.
5. **Dry run** — renders and records every email, delivers nothing.
6. **Send** — requires ticking the confirmation box _and_ a server-side
   kill-switch (`EMAIL_SENDING_ENABLED`). Both, every time.

## Recipient sources

| Source            | Function                  | Notes                                                                                                                                         |
| ----------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pasted list       | `parsePastedRecipients`   | One per line or comma/semicolon separated. Accepts `Ada Lovelace <ada@example.com>`.                                                          |
| CSV               | `parseRecipientCsv`       | Needs an `email` column. `name`, `company`, `notes` are recognised (with aliases); every other column becomes a per-recipient merge variable. |
| client-prospector | `recipientsFromProspects` | See the caveat below.                                                                                                                         |

Combine sources with `combineRecipients(...)`, which de-duplicates by address
and keeps the first occurrence.

Nothing that fails to parse is silently dropped — every bad row comes back in
`skipped` with its row number and the reason, so it can be shown to a user.

### The prospector caveat

`ProspectResult` carries name, address, website, phone, categories and a
relevance rationale — but **no email address**. A prospector run therefore
cannot by itself produce a sendable recipient.

`recipientsFromProspects` reflects that honestly: prospects without a known
address are returned in `needsEmail`, with their context preserved, for a human
to complete. It does **not** guess `info@`/`contact@` — that would be a
fabricated fact and a deliverability risk.

## Deterministic validation

Everything in `validators.ts` is pure: strings, numbers and sets. No LLM, no
network — so it is free, reproducible, and safe to run on every keystroke.

| Check                                      | Function                                   | Severity        |
| ------------------------------------------ | ------------------------------------------ | --------------- |
| Address format, length, CRLF injection     | `validateEmailAddress`                     | error           |
| Duplicates within a list                   | `validateRecipients`                       | error           |
| Suppression list                           | `validateRecipients` (inject `suppressed`) | error           |
| Missing personalization data               | `validateRecipients` (`requiredFields`)    | warning         |
| Empty subject/body, CRLF in subject        | `validateTemplate`                         | error           |
| Subject over 120 chars / over 78           | `validateTemplate`                         | error / warning |
| Unsubscribe token present in template      | `validateTemplate`                         | error           |
| Token used but undeclared                  | `validateTemplate`                         | warning         |
| **Unresolved `{{token}}` after merge**     | `validateRendered`                         | error           |
| Unsubscribe link + sender identity in body | `validateRendered`                         | error           |

The LLM review scores taste. These validators decide whether an email is
_allowed to be sent at all_, which is why they are separate and never advisory.

## Merge and precedence

`createMerge(options)` returns the `MergeFn` the send path consumes. Precedence,
lowest to highest:

```
fallbacks  →  company fields  →  recipient (derived, then vars)  →  compliance
```

Compliance wins deliberately: a CSV column named `unsubscribeUrl` must never be
able to replace the real unsubscribe link or the sender identity.

Unknown tokens are left intact rather than blanked, so the unresolved-token
guard can catch them. Prefer `mergeStrict()` on the send path — it throws rather
than deliver `Hi {{firstName}},`.

## Company field mapping

`buildCompanyMergeFields(companyId)` maps the owner's company data to merge
variables, deterministically and with no LLM:

| Variable          | Source                                                  |
| ----------------- | ------------------------------------------------------- |
| `ownerCompany`    | `company.name`, then `company_metadata.company.name`    |
| `valueProp`       | `company.description`, then metadata description        |
| `ownerIndustry`   | `company.industry`, then metadata industry              |
| `differentiators` | metadata `services[].name`                              |
| `proofPoint`      | first metadata `projects[]`, falling back to `policies` |
| `ctaLink`         | metadata `company.website`                              |

Facts are read only when `status === "active"` and `confidence >= 0.5` — the
same thresholds `marketing-pipeline/context.ts` uses.

Anything ungrounded is returned in `missing` rather than filled with plausible
filler. A template referencing a missing field will fail the unresolved-token
guard, which is the intended outcome.

## Compliance

- Every template must contain `{{unsubscribeUrl}}`; `validateTemplate` enforces it.
- Every rendered body must contain the unsubscribe link **and** the sender
  identity; `validateRendered` enforces it.
- Unsubscribes are per company and honoured across all future campaigns
  (`email_suppressions`, unique per `(companyId, email)`).
- Set a real sender identity (legal name + postal address) before sending.

## Tests

```bash
cd apps/web && npx jest __tests__/lib/email-pipeline
```

91 tests over ingestion, merge precedence, every validator, and the seed
templates, on positive, negative, empty and malformed input. No API keys, no
network, no DB — the whole member.md surface is pure by construction.

## Contract gaps found in Phase 0

Reviewing the `lead.md` schema and `types.ts` surfaced three mismatches.
Gaps 1 and 2 are now **fixed**; gap 3 is inherent and handled by design.

1. ~~**`Recipient.vars` has nowhere to live.**~~ **Fixed.** `email_recipients`
   now has a `vars jsonb` column (migration `0017_email_recipient_vars.sql`), and
   `saveRecipients()` / `loadRecipients()` round-trip it. `runEmailCampaign`
   persists the list alongside the campaign. An empty `vars` is stored as `NULL`
   rather than `{}`, so "no extra variables" has one representation.
2. ~~**`email_sends.subject` is never written.**~~ **Fixed.** `SendResult` now
   carries `subject`, `sendCampaign()` sets it on every post-render result
   (dry-run, sent, and both failure paths), and `saveSends()` writes it. It stays
   `NULL` for `suppressed` / `skipped`, which are decided before the template is
   merged and so never produce a subject.
3. **`ProspectResult` has no email**, so the recipient source named in
   `member.md` Phase 1 cannot produce a sendable recipient unaided. Handled via
   `needsEmail` rather than by guessing addresses, but it means "prospector →
   send" is always a two-step flow with a human in the middle.

## Known limitations

- The UI previews the unsubscribe link with a placeholder base URL; the real one
  is built server-side in `send.ts`.
- `parseRecipientCsv` handles quoted fields and escaped quotes, but not embedded
  newlines inside a quoted cell.
- Suppression is checked server-side per send. The UI can pre-flight it by
  passing a `suppressed` set into `validateRecipients`, but does not yet fetch
  one.
