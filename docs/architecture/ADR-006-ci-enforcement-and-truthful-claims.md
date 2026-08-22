# ADR-006: CI Enforcement, Build Integrity, and Truthful Product Claims

**Status:** Accepted
**Date:** 2026-08-09
**Deciders:** Repository maintainers

## Context

Verification is currently advisory in several places:

- `apps/web/next.config.ts` sets `eslint.ignoreDuringBuilds` and
  `typescript.ignoreBuildErrors` — production builds cannot fail on type or
  lint errors.
- `.github/workflows/CI.yml` runs lint with `continue-on-error: true` and
  permanently excludes nine legacy API-route test suites from the blocking
  Jest step (they fail on `main` today).
- The Python services have zero CI: `sidecar/tests` (including the Adeu
  preservation suite and the new auth tests) are never executed.
- `services/*` are outside the workspace and outside `pnpm -r typecheck`.
- The public landing page markets connectors as “Live” while
  `packages/features/src/connectors/index.ts` is `export {}`; it also shows
  fabricated statistics, an invented star count, anonymous testimonials
  presented as real, and a fake Python repository tree.

## Decision

1. **Builds fail on errors.** Remove `ignoreBuildErrors` and
   `ignoreDuringBuilds`; fix every surfaced error rather than suppressing it.
2. **CI is blocking end-to-end.** Lint loses `continue-on-error`; the nine
   excluded Jest suites are fixed and folded into the blocking test step; no
   `continue-on-error` remains in production validation.
3. **Every runtime is tested in CI.** New jobs cover: unit tests for
   `packages/{protocol,evidence,application,adapters}` (vitest), the worker
   build, TypeScript↔JSON-Schema contract generation drift, pytest for
   `services/transcription`, `services/adeu-ai-docs-editing`, and the `api/adeu`
   preservation suite, typecheck/tests for `services/document-converter`, and
   a Docker Compose smoke test that boots the required Local services
   (db → migrate → worker → converter → transcription → editor), ingests a
   document end-to-end through the outbox, and asserts a cited answer.
4. **Truthful public claims.** The landing/pricing pages may only describe
   shipped behavior: connectors are labeled as roadmap until implemented;
   fabricated metrics, invented review counts, fake file trees, and
   unverifiable institutional endorsements are removed. `docs/` claims about
   `/embed`, `/rerank`, `/extract-entities` are corrected (ADR-004).
5. **License obligations preserved.** All previously-public code remains
   Apache-2.0 with existing copyright notices; the new packages carry the same
   license; nothing public is relabeled proprietary.

## Consequences

- CI runtime grows (Python jobs, compose smoke). Accepted: the smoke test is
  the only executable proof of the single-ingestion-path invariant.
- The nine legacy suites required real fixes (they asserted pre-refactor
  behavior); their passing state becomes the regression contract for the
  compatibility adapters.
- Marketing copy shrinks. Accuracy outranks reach for an open-source
  self-hostable product; claims return as features actually ship.
