# Vantage Context v0 proposal

Status: proposed, dated 2026-10-22. This is a typed handoff proposal for
Joseph's business-role and required-context work, Sophia's bounded retrieval
and optional research work, and the Tech Lead assembler. It is not part of the
frozen Vantage Contract v1 wire format.

Types and runtime validators live in
[`pipelines/src/vantage/proposals/context-v0.ts`](../../pipelines/src/vantage/proposals/context-v0.ts).
The implemented registry, assembler, evidence snapshot, injectable ports,
compatibility adapters and deterministic mocks live in
[`pipelines/src/vantage/context-v0`](../../pipelines/src/vantage/context-v0),
exported separately as `@launchstack/pipelines/vantage/context-v0`.
This adds no route, migration, role/star database, retrieval agent or public
search client. The adapters reuse the frozen v1 result validator without
extending the v1 generation wire format.

## Ownership and handoffs

Joseph supplies `BusinessRoleContextV0` and `RequiredContextBundleV0`.
`roleIds` is zero-to-many and `primaryRoleId` is optional. A role description
contains responsibilities and agenda priorities and is accompanied by a
mapping version, provenance, user-confirmed flag, and fallback flag. This is
business context only: role IDs never grant membership, ACL, or document
access.

`RequiredContextBundleV0` requires a canonical `CompanyArchitectureRefV0`,
workspace-mandatory document entries, and actor-only personal Vantage stars.
Zero personal stars is valid; every selected star must still be permission
checked before it can be used. A star carries `module: "vantage"` and must
match the bundle actor's principal.
Every entry carries an object source ref, exact version, company, ACL digest,
audience, source date, permission-check time, and a bounded excerpt. Where a
source adapter supplies offsets, `excerptOffsets` includes ordered offsets and
must repeat the exact source version. Coverage
records `checked`, `used`, `missing`, `revoked`, and `omitted`. Missing or
revoked required context prevents a `complete` status. A revoked source may
not provide a cacheable excerpt or be used as fallback.

The assembler must recheck the source version and ACL immediately before
saving or reading a manifest. A manifest's stored ACL digest is evidence to
compare, not permission to widen the actor scope.

Sophia receives `DynamicRetrievalInputV0`, which contains the server-resolved
actor/audience scope, verified roles, report window and `asOf`, authorized
source catalog, and finite budgets. `DynamicRetrievalBundleV0` returns three
bounded categories: `roleMatches`, `recentChanges`, and
`unresolvedOlderItems`. Items have canonical source refs, exact versions,
source dates, ACL/audience, role matches, rank, selection reason, and a
deterministic dedup key. The bundle records a source registry, deduped refs,
omissions, failures, and `complete`/`partial`/`timeout` status. Sophia cannot
choose a tenant, widen an audience, or write Vantage report tables.
`maxSources` limits the combined selected items across all three categories;
`maxExcerptChars` limits their aggregate excerpt length. Every selected item
and registry entry must match an allowed source and its ACL/audience metadata
from the input catalog.

`ContextResearchPlanV0` and `ContextResearchResultV0` are optional. The plan
chooses `STOP`, `internal`, or `public`, states the gap purpose, and carries
budgets; `maxQueries` bounds the number of public projections, and `STOP` has
zero queries. A public plan/result may carry only a
`PublicSafeQueryProjectionV0` whose token, projection ID, and query content
match a server-resolved trusted projection record; a token-shaped string alone
is rejected. Raw private excerpts are not a public query field. Results retain public
source dates and provenance and record partial/failure state. The type split
does not claim that TypeScript can prove a query is public-safe: the server
must mint and validate the approval token/projection before a public call. V0
actor scopes are limited to the authenticated actor; business roles are never
audience values. Company and public values may appear as source visibility
metadata, while company-wide report audiences remain a future policy decision.

The TL assembler produces `ContextManifestV0`. It binds `runId`,
`inputVersion`, `contextFingerprint`, actor/company/audience and the
server-resolved ACL digest, report window/asOf, role map and profile versions,
Company Architecture version, personal-star versions, exact source versions,
an authorized source registry, coverage, omissions, and research state. A
downstream consumer may cite only exact versioned refs present in the authorized
evidence snapshot. The implemented assembler resolves selections against an
immutable trusted catalog, preserves separate retrieval/research states, and
returns no evidence snapshot when mandatory context is unresolved. The adapter
validates server-owned freshness before generation, after generation, and
inside the final persistence transaction. A validation-only consumer remains
available for testing individual handoff shapes; it is not the orchestrator.

## Source refs and validation

The proposed source ref is a discriminated object:

```ts
{
  kind: "ev" | "obs" | "cm" | "doc" | "company" | "public";
  id: string;
  version: string;
}
```

`ev`, `obs`, and `cm` preserve the existing source concepts. `doc`,
`company`, and `public` are proposed namespace kinds. They cannot be passed as
v1's string refs such as `ev:123`; v1 remains unchanged and is not made
structurally interoperable with this proposal.

Runtime validators reject cross-company entries, unknown companies when a
known-company set is supplied, role escalation, missing stars, missing ACL
digests, unregistered or changed source versions, duplicate retrieval results,
sources later than `asOf`, invalid windows, revoked used refs, and non-finite
budgets. They require public citations to include source date and provenance.
`dedupeContextSourceRefs` is deterministic and keys on kind, ID, and exact
version; delimiter-bearing ID/version parts are escaped so distinct refs cannot
collide, while the ordinary `doc:d1@v1` representation remains unchanged. Date
and timestamp fields use strict calendar and ISO validation rather than permissive
`Date.parse` normalization. The assembler must repeat the source-version and ACL check immediately
before saving or reading a manifest; an old open manifest is not permission
evidence.
Private `ev`, `obs`, `cm`, `doc`, and `company` refs cannot use public audience
metadata; `public` refs must use public metadata. Research citation refs must
match an exact public ref and version already present in the manifest registry.

The suggested HTTP-compatible error classes are 400 validation, 401 missing
session, 403 authorization/revocation, 404 unknown company or source, 409
stale/version/as-of conflict, 500 unexpected failure, and 503 timeout or
unavailable dependency. These are proposal guidance only and do not alter v1
error envelopes.

## Fixtures and focused checks

[`fixtures/vantage-context-v0/normal.json`](../../fixtures/vantage-context-v0/normal.json)
contains a complete Joseph → Sophia → TL path, including a public research
projection. `negative-cases.json` names focused mutations for cross-company,
role escalation, missing star, unknown company, changed version, old window,
duplicate source, source after `asOf`, untrusted public query, and non-finite
budget. The focused proposal tests exercise each validator. Separate registry,
assembler, adapter and mock-integration tests exercise actual shared
infrastructure, without network providers or teammate databases.

## Decisions still requiring TL/product sign-off

The following remain deliberately open and are not silently chosen by these
types: role directory and role-profile ownership; role priority merge rules;
what counts as sufficiently reviewed Company Architecture; whether a required
star may be explicitly overridden and how reduced excerpts disclose coverage;
document deletion/version retention; the reporting audience and permissions
for derived role views; the internal index inventory; recent-change and
unresolved-item definitions; provider/tool/query/token quotas and total
latency; public-source retention; trusted-token issuance and projection
scrubbing policy; and whether a future asynchronous job contract is needed.
Until those decisions receive dated approval, use synthetic fixtures and keep
the existing v1 GenerationInput/GenerationResult unchanged.
