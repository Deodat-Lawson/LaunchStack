# Weekly Decision Agenda — Contract v1

Version **1.0**. **Frozen by Tech Lead approval on 2026-10-16.** The user accepted
the recommended interfaces, America/New_York time and one primary action per
topic for Week 1. A/B acknowledgement, implementation and integrated acceptance
are separate; none is claimed complete. This document replaces earlier v1 drafts.

- [Complete request/response and generation examples](examples/weekly-decision-agenda-v1.json)
- [Architecture](weekly-decision-agenda.md)
- [Assignments](../issues/weekly-decision-agenda.md)
- [Acceptance record](../runbooks/weekly-decision-agenda-week1.md)

## 1. Scope and ownership

Use Vantage, synthetic inputs, normal authentication and an isolated test
database/workspace. Reports and human edits persist there; no writes to the
existing business database. A branch isolates code, not data. A sole workspace
owner is not a feature requirement. Live-document ingestion, staff/sales features,
sharing, exports, external delivery, scheduling and durable workers are deferred.

| Owner | Input                                                        | Output / responsibility                                                                                               |
| ----- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| TL    | Authenticated session, selected week, test records, B result | Authorization, period-bounded data, API, versions, atomic persistence and integration acceptance                      |
| B     | GenerationInput and injected server-only runtime             | Evidence pack/signals, AI or rules draft, source-linked enhancement candidates, execution record and harness evidence |
| A     | Saved API responses and user input                           | Generate/result/source/edit UI, explicit enhancement review, stable submission keys and browser evidence              |

B does not query the database, call web authentication, save reports or create
actions from inside generation. TL does not implement B's prompts, provider logic
or harness. A/B internals are intentionally outside this contract.

## 2. Data and access boundary

Resolve company/user from the existing server session, never request JSON.
Week 1 admits explicitly configured test operators in the configured test
workspace, with documents.read and documents.edit. Membership roles alone do
not grant access. Enforce the same boundary on APIs, history, source and export
paths; use 401 without a session, 403 pilot_access_denied for excluded actors,
and 404 not_found for another company's record. Unrelated history stays available.

Evidence is private and topics/actions have shared=false. Shared-value requests
return 400 without changes. Sharing/triage/export routes return 403. Existing
source permissions apply before collection; URLs are not automatic ingestion.
Real document collection/provider use is not authorized by this test milestone.

## 3. Reporting period

ReportPeriod fields: weekStart (Monday date), timeZone, startInclusive,
endExclusive, asOf (ISO timestamps), kind=completed-week|week-to-date.
Time zone is **America/New_York**. Capture asOf once at request start.

- Monday without weekStart selects the previous complete Monday-to-Sunday week.
- Tuesday-Sunday default to this Monday through asOf.
- Explicit dates normalize to their Monday; historical weeks are complete.
- Future-week generation returns 400 future_week; reading an absent week may
  return agenda=null. Navigation does not advance time.
- Timestamp bounds are half-open. Date-only evidence retains its precision and
  uses observedAt in the selected local dates, with createdAt no later than asOf.
- Prior observations are separate comparable-period context; unfinished actions
  are labelled carry-forward with original dates. They are not current events.
  Do not compare a partial week with a complete week as equivalent periods.

Apply bounds before collection/limits and to signals, pack and prompt. The old
Thursday default and rolling evidence window are not the v1 policy.

## 4. TL to B: GenerationInput

One in-process async generation port is sufficient. Shared TypeScript contracts
belong in pipelines/src/vantage; no separate HTTP AI service is required.

| Field                        | Type / meaning                                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| contractVersion              | Literal v1                                                              |
| runId                        | Server-generated opaque execution ID                                    |
| inputVersion                 | Opaque fingerprint of the supplied input; B echoes it unchanged         |
| reportPeriod                 | ReportPeriod from TL                                                    |
| generationMode               | configured-model or rules; omitted HTTP mode means configured-model     |
| data.metricDefinitions       | Existing MetricDefinitionDto[]                                          |
| data.currentEvidence         | Authorized in-period EvidenceDto[]                                      |
| data.currentObservations     | In-period MetricObservationDto[]                                        |
| data.comparisonObservations  | Comparable prior-period MetricObservationDto[], context only            |
| data.resolvedCommitments     | In-period resolved CommitmentDto[]                                      |
| data.carryForwardCommitments | Eligible unfinished CommitmentDto[], context only                       |
| reviewedTopics               | Array of { topic: TopicDto, contentVersion: integer }; protected topics |

TL filters authority/time and normalizes data; B computes signals, relevance and
bounded pack selection. Runtime separately injects model resolution, AbortSignal
and budgets. Runtime functions/secrets are not JSON, frontend payload or prompt
content. A fixed per-run input does not require a historical snapshot system.

## 5. B to TL: GenerationResult

Fields are runId, inputVersion, draft:AgendaDraft, signals:WeeklySignals,
enhancements:EnhancementCandidate[], execution:ExecutionRecord. Reuse existing
draft fields; no second report domain. Complete examples are linked above.

ExecutionRecord: outcome=generated|empty, mode=ai|rules, nullable fallbackReason
and modelId, promptVersion, attempts, durationMs. Available usage may be retained
in modelMetadata. AI uses origin=ai; rules uses origin=rules. Empty input may skip
the model and return empty topics with outcome=empty, mode=rules, attempts=0.

Fallback reasons: no-model, timeout, provider-error, invalid-output. Explicit
rules mode and empty input are not provider failures. Fallback failure returns
500 generation_failed without replacing the prior saved report. A missing B
adapter is 503 generation_unavailable, not fabricated AI/rules success.

Refs use existing ev:/obs:/cm: identifiers. Reconstruct source labels/dates from
the supplied records; unknown refs are not valid citations. Existence is not
semantic support. Keep unsupported statements explicit and separate observation,
interpretation and suggestion. Neither B nor a model can approve/share content.

## 6. Execution policy and harness boundary

| Policy                    | v1 value                           |
| ------------------------- | ---------------------------------- |
| Per model attempt         | 20 seconds                         |
| Maximum provider attempts | 2 total, including repair attempts |
| Transient retry wait      | 1 second, within the deadline      |
| Total generation budget   | 45 seconds, including fallback     |
| Synchronous API budget    | 60 seconds, including data/save    |

Retry temporary network/rate-limit/provider errors only; credentials/permission
failures do not retry blindly. Include SDK retries in the same budget. Cancel
superseded/timed-out work and never save late output. Deployment timeout support
must be verified; these are policy limits, not measured latency promises.

B owns normal/thin/conflicting/out-of-period/failure/edit-protection fixtures and
quality review. Require one observed real-provider success plus forced fallback;
separate mocks, provider calls, source-support review, DB and browser evidence.

## 7. Saved response and regeneration

Keep HTTP 201 {agenda} for synchronous POST /agendas, and existing envelopes.
Saved agenda adds reportPeriod:ReportPeriod|null, version:integer and
enhancements:EnhancementDto[]. New v1 reports have a period; legacy reports may
have null rather than invented metadata. Topics add contentVersion:integer.
Agenda execution is the saved ExecutionRecord, nullable on legacy records.

TL reads input/version, calls B without a long DB lock, then saves in a short
transaction. Reject changed report state with 409 stale_agenda; retain human
work and ask for reload/regeneration. Reject wrong runId/inputVersion and do not
persist invalid output. Concurrent first generation cannot create two agendas.

Preserve founder-created, reviewed/edited, kept, dismissed and decided topics,
IDs, text, refs and action links. Only untouched generated suggestions without
decisions are replaceable. Human topic writes increment contentVersion and report
version; regeneration and enhancement review increment report version. Content
versions detect edits, not sharing approval. ready/closed do not publish content
or automatically resolve actions.

## 8. Enhancement I/O

EnhancementCandidate fields: topicId, baseTopicVersion:integer,
kind=evidence|idea|question, text, refs:VantageEvidenceRef[], rationale.
Only target protected topics supplied in reviewedTopics. TL assigns ID and
persists status=suggested, createdAt. The result is EnhancementDto.

PATCH /topics/:topicId/enhancements/:enhancementId accepts
{status:accepted|dismissed, baseTopicVersion:integer}; returns
{enhancement:EnhancementDto, agendaVersion:integer}. Scope both IDs to the actor's
company. A stale original returns 409 stale_topic. Repeating the same terminal
status is a no-op; changing a terminal decision returns 409 enhancement_finalized.
Accepting appends a separate approved addition to report display; it does not
rewrite original text, decisions or actions. No internet/source expansion is implied.

## 9. Decision/action and idempotency

Keep POST /topics/:id/decide body {decision, commitment:null|{title,owner,dueOn,
test?,shared?:false}} and 200 {topic}. v1 clients must send Idempotency-Key
(1-128 visible characters); missing/invalid keys return 400 idempotency_key_required.
The key is scoped to actor, company, operation and topic. Keep test records until
workspace cleanup. Normalize strings before hashing the submission.

- Same key/payload returns current linked resources, stable IDs, original action
  creation and decision timestamps; do not reopen/erase resolved outcomes.
- Same key/different payload returns 409 idempotency_conflict, no writes.
- Week 1 has at most one primary linked action per topic. A conflicting new
  action returns 409 commitment_exists; intentional action changes use PATCH.
- Decision-only submission retains existing action. New key may intentionally
  edit decision text. Save decision, action and submission record atomically.
- Existing ambiguous links return 409 commitment_ambiguous; do not select/delete
  a row silently. Other linked-action creation paths must obey the same limit.

owner remains free text, not an account assignment. Demo actions need an owner,
due date and nonempty test. Outcome check-in uses PATCH /commitments/:id; require
an outcome when resolving. Broader multi-action support is a later revision.

## 10. HTTP operations and errors

Paths are relative to /api/vantage. IDs are opaque strings; dates must be real
YYYY-MM-DD dates. Actor/company fields cannot select identity. PATCH omission
leaves a field unchanged; null only clears fields that permit it.

| Operation                                     | Response                                                |
| --------------------------------------------- | ------------------------------------------------------- |
| POST /evidence; GET /evidence                 | 201 {evidence}; 200 {evidence:EvidenceDto[]}            |
| POST /metrics; GET /metrics                   | 201 {definition}; 200 {definitions,observations}        |
| POST /metrics/observations                    | 201 {observations:MetricObservationDto[]}               |
| POST /metrics/import                          | 200 {imported,problems:[{line,message}],createdMetrics} |
| POST /agendas {weekStart?,generationMode?}    | 201 {agenda}                                            |
| GET /agendas?week=...; GET /agendas/:id       | 200 {week,agenda,agendas}; 200 {agenda}                 |
| PATCH /topics/:id                             | 200 {topic}; existing editable fields                   |
| POST /topics/:id/decide                       | 200 {topic}; required Idempotency-Key                   |
| GET /commitments; PATCH /commitments/:id      | 200 {commitments}; 200 {commitment}                     |
| PATCH /topics/:id/enhancements/:enhancementId | 200 {enhancement,agendaVersion}                         |

GET /overview returns the period-scoped overview in the linked full examples.
The existing sharing_disabled code remains a 403 alias for disabled legacy routes.

CSV columns stay metric,value,period_start,period_end,source,note. Valid rows can
succeed alongside problems; A must show problems. Preserve existing schema bounds.

Errors are {error:string,code?:string}. Use 400 validation/future_week/key errors,
401 no session, 403 pilot_access_denied/feature_unavailable, 404 not_found,
409 idempotency_conflict/commitment_exists/commitment_ambiguous/stale_agenda/
stale_topic/enhancement_finalized, 500 generation_failed/unexpected failures,
503 generation_unavailable for an uninstalled B port. No 202 or 422 in v1.
Never put provider secrets or private source bodies in errors/logs.

## 11. Acceptance and changes

TL approval of this interface is recorded from this conversation, 2026-10-16.
Do not invent A/B signoff: their conformance review is pending. Frozen contract
does not mean implementation passes. Record actual unit/mocked, real DB/API,
provider and browser results separately in the acceptance record.

Existing drafts are owner-reviewed adopt/revise/defer inputs. A owns frontend,
B AI/harness, TL data/auth/API/storage. Changes to these I/O guarantees require a
dated contract revision; incompatible changes require explicit client migration.
Staff identity/delegation, sharing/approval, real-source retention and pilot
thresholds remain later product decisions, not unresolved Week 1 wire details.
