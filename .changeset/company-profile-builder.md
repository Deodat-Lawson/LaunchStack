---
"@launchstack/pipelines": minor
"@launchstack/tools": minor
---

One company profile, read only from sources about the company.
`@launchstack/pipelines/company-metadata` now sorts every source (about the
company, someone else's, nothing to read), drops reference lists, tables and
figure residue before extraction, and keeps a fact only with a quote found in
a source about the company. The profile is reassembled from the sources that
count plus a person's edits, so deleting or setting aside a source retracts
what it said. New: `rebuildProfile`, `refreshForDocument`,
`catchUpAndAssemble`, `recordOverride`, `applyFactEdit`/`resetFactEdit`,
`profileView`; `refreshForDocument` reports the profile as building until it
is reassembled.

Breaking: the Proposals org profile (`proposal_profiles` and its builder) is
removed; Proposals stages read the company profile. `@launchstack/tools`
`company-context` moves to metadata schema 1.1.0 (`profile.summary`,
`profile.applicant_type`, `profile.focus_areas`, `profile.facts`) and adds the
`company_profile_sources` table.
