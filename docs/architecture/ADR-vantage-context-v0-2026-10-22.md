# ADR: Proposed Vantage context v0 handoffs

**Status:** Proposed (2026-10-22)

## Context

The Vantage weekly decision workflow has a frozen Contract v1. Week 2 needs a
reviewable seam for multiple business roles, a canonical company architecture,
personal Vantage stars, permission-scoped retrieval, optional bounded research,
and a context manifest. Joseph owns role/star inputs, Sophia owns retrieval
and optional research, and the Tech Lead owns authenticated ACL resolution and
manifest assembly. None of these proposed seams authorizes a production
connector, a new route, or a change to v1 generation input/output.

## Decision

Keep proposed types in `pipelines/src/vantage/proposals/context-v0.ts` and
export shared infrastructure through the separate
`@launchstack/pipelines/vantage/context-v0` subpath. Use object-shaped,
versioned discriminated source refs with existing `ev`/`obs`/`cm` kinds and
proposed `doc`/`company`/`public` kinds. Preserve v1's string source refs as a
separate contract.

Require server-resolved actor scope and ACL digests on each handoff. V0
audiences are limited to the authenticated actor; business role context is
descriptive and never an ACL grant. Treat Company Architecture,
workspace-mandatory docs, and selected personal Vantage stars as required
context with explicit checked/used/missing/revoked/omitted coverage. Zero
personal stars is valid, but every selected star must be checked and carry the
Vantage module plus actor binding. A required omission or revocation blocks a
complete bundle or manifest, and revoked content cannot be cached as fallback.
Actor source audiences must match the resolved principal, and the validation
seam accepts expected company, principal, and ACL digest bindings from the
server. The stub consumer fails closed if those bindings are absent; proposal
data never grants authorization by itself.

Give retrieval and research explicit finite budgets, report window and `asOf`,
exact source versions, bounded excerpts, deterministic dedup keys, reasons,
omissions, and partial/timeout/failure state. Public research can consume only
a server-approved public-safe query projection whose token, projection ID, and
query content match a trusted server record. Token shape alone fails closed.
Types
separate that projection from private excerpts but do not claim compile-time
proof of semantic safety; server validation and token issuance remain required.
Private source kinds cannot be relabeled as public, and a manifest research
citation must match an exact public source ref already in the manifest
registry. Revoked retrieval registry entries and selected items are rejected.
Source keys preserve the simple `kind:id@version` form for ordinary tokens and
escape delimiter-bearing IDs or versions; date-only values must be real calendar
dates and timestamps must use the strict ISO shape accepted by the validator.

Implement an immutable trusted source registry, deterministic manifest/evidence
assembler, replaceable provider ports and mocks. Required coverage failures
block generation; optional retrieval/research completeness is explicit.
Freeze actor/source ACLs, content hashes, exact versions, role profiles,
architecture and personal stars. Recheck before and after generation and in the
same transaction as persistence. A compatibility adapter preserves the v1 wire
contract and explicitly reports `ignored-v0`; a separate context-aware sidecar
supports exact V0 citations. Neither adapter claims live model acceptance.

## Consequences

The proposal can be implemented independently and tested with synthetic data.
It makes stale versions, cross-company context, role escalation, missing
required stars, outside-`asOf` sources, duplicate retrieval, public-query
approval, and non-finite budgets visible before any downstream generation.
The proposal adds no production schema, API route, or v1 wire field. Its
separately versioned package export is usable by teammate implementations.
The trusted registry and assembled evidence form the citation allow-list.

The proposal intentionally leaves product and TL policy decisions open:
role/profile ownership and merge policy, required-context override/deletion
semantics, audience for derived role views, recent-change definitions,
retrieval/research quotas and latency, provider and retention policy, and the
future asynchronous boundary.

## Rejected alternatives

- Extending `GenerationInput`/`GenerationResult` in place would violate the
  frozen v1 ownership boundary.
- Treating role IDs as permissions would make a descriptive business view an
  authorization path.
- Passing raw private context to public search would make audience checking
  impossible to audit.
- Implementing retrieval or Joseph's persistence here would cross the stated
  ownership seams and make this proposal non-reviewable in isolation.
