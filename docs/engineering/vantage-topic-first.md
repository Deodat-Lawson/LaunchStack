# Vantage topic-first contract and operations

The Vantage app has three screens, This week, Context, and My topics. The user owns their personal topics, watch list, confirmed role context, and Stars. Authorized workspace administrators manage required context. Vantage records human decisions against saved reports. Recording a decision does not verify execution.

## Evidence and admission

Generation selects required context and authorized Stars, then seeds an as-of document catalogue using watches, prior topic signals, lexical question ranking, and recency. Versioned digests help the explorer choose evidence. Source citations resolve to exact document versions or scoped excerpts with parent and excerpt hashes. After explorer selection, question-ranked backfill supplies additional authorized evidence within the 80,000-byte ceiling. The frozen evidence binds the input to its authority epoch and source versions.

The shared V2.1 generator receives the frozen snapshot. Deterministic validation and an independent Judge must succeed before admission. Persistence binds encrypted evidence to company, owner, and run using authenticated encryption. Admission and activation recheck source authority and the active run. Reads of historical evidence also check current authority. Authority epochs track document, chunk, and access changes regardless of rollout settings.

## Rollout and rollback

- Set up the workspace model routes and allowance, the encryption key, and the official engine and product migrations. Digest and generation default to `default`. Exploration and Judge default to `reasoning`. The overrides are listed in `.env.example`.
- A workspace administrator enables Beta apps in Workspace → Labs. The deployment also needs `VANTAGE_WEEKLY_REVIEW_ENABLED=true` for new generation. Both controls default off.
- Set the creation switch to `false` to stop new reports while keeping authorized history and permitted decisions available. Turn off Beta apps in a workspace to hide Vantage and refuse its APIs and history. Keep migrations and the keys needed to decrypt saved records in place.
- On a disposable system, provision the local `vantage_port` database with pgvector on port 55439 as specified by the acceptance runner. Run `node scripts/dev/vantage-production-acceptance.mjs migrate`, start `serve`, and run `browser` in another terminal. Restart the server with `serve-off` and run `browser-off` to check the saved report with creation disabled. The fixture uses injected models and synthetic accounts on localhost.
