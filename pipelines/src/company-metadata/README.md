# Company profile — what a workspace's sources prove about its organisation

One builder for the facts every surface reads: Settings › Company and
Proposals › Profile (the same page), chat's company-facts leg, the
marketing/email context block, legal-chat pre-fill and the proposal stages.
It writes the `company_metadata` JSON (schema 1.1.0); readers did not change
shape.

```
document version ──► passages ──► triage ──► extractor ──► source row (cached per version)
                     noise out    about us?   cited facts,        │
                                  someone     quotes checked      ▼
                                  else's?     verbatim       assemble (all counted rows,
                                  nothing?                    fresh, + people's edits)
                                                                   │
                                                                   ▼
                                                     synthesize summary / applicant type /
                                                     focus areas from the facts ──► company_metadata
```

## Modules

| File            | Does                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `passages.ts`   | Pure. Drops reference lists, number tables, chart residue, boilerplate, repeated overlap and empty mindmap nodes; strips inline Markdown; `quoteAppearsIn` is the grounding check.                                                         |
| `triage.ts`     | Rules first (nothing readable → `no_content`), else one small model call on the opening: `about_us`, `third_party` or `no_content`, with a one-sentence reason shown to people.                                                            |
| `extractor.ts`  | Flat statements (section, subject, field, value, quote, passage) — a nested schema is too big for Gemini. A fact survives only if its quote is in a passage of its call, its numbers are in the quote, and a name is written in the quote. |
| `assemble.ts`   | Pure. The profile rebuilt from every counted source, then `manual_override` facts (edits and removals) laid back on top. Retraction is automatic.                                                                                          |
| `synthesize.ts` | Summary, applicant type and focus areas, written from the numbered facts and citing them; skipped when the facts are unchanged (`facts_hash`).                                                                                             |
| `views.ts`      | Pure read model with labels and excerpt numbers, shared by the page and the proposal stages.                                                                                                                                               |
| `edit.ts`       | A person's edit (or removal, or reset) to one fact, applied under the row lock.                                                                                                                                                            |
| `build.ts`      | `refreshForDocument` (per upload, from the worker's `evidence.version.indexed` handler), `rebuildProfile` (the Rebuild button), `assembleProfile`, `recordOverride`.                                                                       |
| `db.ts`         | Documents, chunks, `company_profile_sources` rows, the locked save.                                                                                                                                                                        |

## Rules worth knowing

- **A source is read again** only when its version, its chunk count or
  `READER_VERSION` (prompts.ts) changes, or a person's override makes it count
  and it has no facts yet. Bump `READER_VERSION` when a prompt or rule changes.
- **People decide last.** An override (`about_us` / `set_aside`) outlives new
  versions; an edited fact is never overwritten by a build; clearing a fact
  hides it even when sources still say it; "use what the sources say" drops
  the edit.
- **Deleting a document** cascades its source row; the delete routes then
  reassemble, so its facts leave the stored JSON too.
- **Builds read every document** (the profile is workspace-wide); the page
  hides facts and excerpts from documents the viewer may not open.
