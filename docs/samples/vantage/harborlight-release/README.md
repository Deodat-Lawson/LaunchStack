# Harborlight Atlas weekly-review sample

This is entirely fictional, AI-authored local sample data created by Codex for this task. Harborlight Analytics, its people, customers, tickets, builds, and measurements are invented. The source text was not copied from a connected workspace, customer material, or saved application-provider responses. The simulated reporting week is November 9-15, 2026; every version is available before the manifest cutoff of November 16 at 00:00 UTC.

The manifest defines 12 logical sources and 13 Markdown version files. Release plan revision 1 is deliberately stale; revision 2 is current. Each ingested file carries its own fictional label. Contradictions, missing ownership, optional QA coverage, limited security permission, denominator ambiguity, and topical distractors are intentional source conditions.

Expected importer flow: read manifest.json, create a separate sample workspace, preserve logical keys and version timestamps, and import only files explicitly listed in documents[].versions[]. Apply suggestedRole as editable role context and the required/star suggestions as optional defaults. Use the cutoff for a weekly review. The importer implementation belongs outside this corpus directory. Do not ingest README.md, manifest.json, or expectations.json as source documents.

expectations.json contains authored human check questions, exact source anchors, and interpretation caveats. It is a separate review aid, not an independently collected Gold set, a scoring oracle, or evidence of retrieval/model quality. Source anchors demonstrate textual support only; they do not establish real operational readiness, numerical validity, or completeness. A different selected role can legitimately prioritize different optional sources. See the dated [verification report](../../../engineering/vantage-realistic-samples-20261116.md) for executed checks and their limits.

## Import into the local sample app

First validate the corpus without contacting a database or provider:

```sh
node scripts/dev/vantage-sample-documents.mjs
node --test scripts/dev/vantage-sample-documents.test.mjs
```

Using the existing local test account, create a separate workspace through the normal workspace UI:

- Name: `Harborlight Analytics (fictional sample)`
- Slug: `vantage-harborlight-sample-20261116`

Provide the existing dedicated local test database through `DATABASE_URL`, then run the following from the repository root, replacing `<workspace-id>` with that workspace's ID:

```sh
node scripts/dev/vantage-sample-documents.mjs --apply --company-id <workspace-id> --actor-email vantage@test.com
```

The importer accepts only the loopback `vantage_production_acceptance` database and the exact sample workspace identity. The account must already have an active owner membership. It creates local previewable text files, document versions and exact-text chunks in one transaction. It does not run migrations, create accounts, invoke OCR/embeddings, or change another workspace. A second import verifies the existing files and reuses their IDs; partial imports or changed stored content are rejected.

In Vantage's **Context** tab, use `Atlas weekly priorities` as the architecture/context document and `Pilot reporting and finance definitions` as the other required company document. Star the current release plan and open-actions document. The suggested Engineering lead role is fictional sample configuration. Keep the QA document optional. These choices are in the manifest and use the existing authorized configuration controls.

Open **This week**, select `2026-11-16`, and generate a review. The local acceptance host uses clearly labeled injected responses unless live providers have been explicitly enabled. Verify the current release-plan version, missing ownership, evidence limits, source preview and report reload. This corpus's pre-indexed insertion checks the retrieval/report path; it does not test the production upload, OCR or embedding pipeline.
