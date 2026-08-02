# Campaign Planner evaluation suite

A reproducible benchmark for evaluating marketing posts generated from campaign angles.

> **Status:** the "frozen contract" this suite was specified against did not exist in the
> repository. `schema/index.ts` is a provisional reconstruction. Read
> [`docs/issues/eval-suite-frozen-contract-missing.md`](./issues/eval-suite-frozen-contract-missing.md)
> before depending on its type signatures.

## Purpose

Two questions, deliberately separated:

1. **Is the judge calibrated?** Does an LLM judge agree with human taste about what makes a
   marketing post good? Measured against *real* public posts.
2. **Is the generator grounded?** Given controlled company knowledge, does the Campaign
   Planner stay inside what it was told, respect platform limits, and degrade honestly when
   the knowledge is thin? Measured against *synthetic* company fixtures.

Mixing these would make both unmeasurable, which is why the datasets never mix.

## The two datasets

|  | `references/evaluation.md` | `fixtures/companies/` |
|---|---|---|
| Contents | Real public marketing posts | Synthetic companies, documents and facts |
| Origin | Bluesky public API; authenticated LinkedIn session; public X profile preview | Hand-authored |
| Used as | Judge calibration examples | Generation inputs |
| Ground truth | A human `good` / `bad` label | Machine-checkable constraints |
| Ever fed to the generator? | **No** | Yes |
| Ever shown to the judge? | Anchors only | As company context |

### Reference posts

Real, verbatim, attributed, dated posts with engagement counts. Every entry carries a source
URL and a `selection_reason` explaining why it earned its label.

Each entry also carries **company and product context** — a short `#### Company context`
paragraph plus a `#### Relevant product knowledge` bullet list. This deliberately mimics what
the generation pipeline receives, so a judge can assess whether a post *used the available
product knowledge well* rather than only whether it reads nicely. The context is scoped to
what that specific post needs; full company profiles are not dumped into every entry.

### Anchors vs. held-out

- **Anchors** go into the judge prompt as worked examples.
- **Held-out** posts never appear in the prompt. They test whether calibration transfers.

Enforced by tests, not convention:

- no shared entry id, source URL or post text across sections
- cross-section post similarity stays below 0.6 (word-level Jaccard)
- any entry declaring a `campaign_group` keeps every member of that group in one section

That last rule exists because two posts can be different text but the same campaign — e.g.
two `#TailscaleUp` session-promotion posts. Splitting those across sections would leak the
anchors into the held-out set.

## Synthetic company fixtures

Four companies creating deliberately different evaluation conditions:

| Fixture | Archetype | What it tests |
|---|---|---|
| `meridian-rail-systems` | Technical B2B, deep docs | Attribution of customer-measured numbers; a hard regulatory boundary (advisory-only, never movement authority) |
| `fernwood-audio` | Consumer/prosumer, distinct voice | Voice adherence; qualified numbers keeping their qualifiers; the waterproof overclaim trap |
| `northwind-cold-chain` | Regulated, evidence-sensitive | Certification boundaries; accuracy figures keeping their valid range; a mandatory qualification |
| `tilde-labs` | Sparse and unresolved | Honest degradation — no invented customers, pricing, scale or superlatives |

Layout:

```
fixtures/companies/<company-id>/
  company.json      # parses against CompanyFixtureSchema
  docs/*.md         # documents the pipeline would retrieve
```

All names, products, documents, customers, metrics and claims are synthetic. Websites use
`.example`. A test asserts no fixture borrows a real company's identity.

### How `sourceFacts` work

Each company declares facts in three kinds:

| Kind | Meaning | Test enforces |
|---|---|---|
| `supported` | Directly backed by a fixture document | Every `provenance.quote` appears verbatim in the cited document |
| `contradictory` | Conflicts with the documents | Cites the conflicting document, names the `supported` fact it contradicts, and does **not** appear verbatim in any document |
| `distractor` | True in the fixture universe but irrelevant to the campaign | Cites a real document, declares `relevantTo: []`, and `contradicts: null` |

Facts span numeric claims, capabilities, integrations, pricing, audience, security and
compliance, geography, performance, limitations, comparatives and positioning.

The distractor category is the subtlest. A distractor is not false — it is *true and beside
the point*. Meridian being headquartered in Duluth is true; putting it in an
interchange-performance post is a failure of judgement, not of fact.

### Mapping to production metadata

Production reads `pdr_ai_v2_company_metadata.metadata` (jsonb) as `CompanyMetadataJSON`, where
every leaf is a `MetadataFact` carrying confidence, visibility and provenance.

Full field-by-field mapping, including fields that exist in one representation but not the
other: [`fixtures/companies/METADATA-MAPPING.md`](../fixtures/companies/METADATA-MAPPING.md).

The single most important divergence: **`sourceFacts` has no production equivalent.**
Production stores only facts believed true, so grounding criteria can run against fixtures but
not against live company data.

## Criteria

### Deterministic — implemented here

24 assertions in `apps/web/src/lib/agents/evals/campaign/assertions.ts`, grouped by category:

| Category | Assertions |
|---|---|
| structure | `non-empty-output` |
| length | `max-chars`, `platform-char-limit`, `max-words` |
| variants | `variant-count`, `no-duplicate-variants`, `variant-similarity`, `distinct-opening-hooks` |
| formatting | `hashtag-limit`, `emoji-limit`, `url-policy`, `question-limit` |
| content | `must-mention`, `must-not-mention`, `required-phrases`, `require-disclaimer`, `no-prohibited-competitors` |
| grounding | `must-use-supported-facts`, `no-contradictory-facts`, `no-distractor-facts`, `no-unsupported-numerics`, `no-unsupported-superlatives`, `no-hallucinated-product-names`, `no-copied-source-runs` |

Every assertion returns a `CriterionScore`, never throws, handles empty and malformed input,
and is a pure function of `(output, context, params)` — no network, no clock.

### Subjective — owned by the LLM judge, deliberately absent here

Hook quality · brand voice · audience fit · campaign-goal alignment · persuasiveness ·
platform-native tone · overall creativity.

These are not implemented as deterministic checks and should not be. Where a subjective
property has a deterministic *proxy*, only the proxy is implemented — for example, brand voice
is subjective, but "does the copy contain a word the brand guide forbids" is a
`must-not-mention` check.

## Running it

The suite's code and tests live inside the `apps/web` workspace, so its commands run from
there. The fixtures, references and this contract live at the repository root.

```bash
cd apps/web

# The eval suite's own tests (149 tests, 3 suites)
npx jest __tests__/lib/evals

# or via the package script
pnpm test:evals

# Everything in the web workspace
pnpm test
pnpm typecheck

# Repo-wide
cd ../.. && pnpm lint && pnpm format:check
```

`tsc --noEmit` reports pre-existing errors elsewhere in the repository. None are in
`schema/`, `apps/web/src/lib/agents/evals/campaign/` or `apps/web/__tests__/lib/evals/`;
filter with:

```bash
cd apps/web && npx tsc --noEmit 2>&1 \
  | grep -E "(schema/index|agents/evals/campaign/|__tests__/lib/evals/)"
```

### Evaluating real generator output

The runner does not call the Campaign Planner — generation is the caller's job, which keeps
the runner pure and testable without API keys.

```ts
import {
    buildEvalContext,
    loadEvalFixtures,
    runFixture,
    buildReport,
} from "~/lib/agents/evals/campaign";

const results = loadEvalFixtures().map((fixture) => {
    const context = buildEvalContext(fixture);
    const output = yourGenerator(fixture); // → GeneratedOutput
    return runFixture(fixture, output, context);
});

console.log(buildReport(results));
```

## Adding a new company fixture

1. `mkdir -p fixtures/companies/<kebab-id>/docs`
2. Write the documents first. Facts cite documents by exact quote, so the quote has to exist
   before the fact does.
3. Write `company.json` against `CompanyFixtureSchema`. Set `knowledgeDepth`, and write an
   `archetype` line stating what the fixture is *for* evaluation-wise.
4. Add `sourceFacts`. A rich company needs all three kinds. Every `supported` fact needs
   `provenance` whose `quote` appears verbatim in the cited document. Every `contradictory`
   fact needs `contradicts` pointing at a `supported` fact id. Every `distractor` needs
   `relevantTo: []`.
5. List every document in `documents[]` — a test asserts the declared list matches disk
   exactly.
6. Use synthetic names and a `.example` website.
7. `npx jest __tests__/lib/evals` and fix what it reports. The traceability and contradiction
   tests are strict on purpose.

Then add at least one evaluation fixture in `fixtures/evaluations/campaign-fixtures.json`
pointing at it, or the company is never exercised.

## Adding a new reference post

1. Retrieve it from the platform, preserving exact text.
   - **Bluesky** — easiest, no auth:
     `curl "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>&limit=100"`
     returns exact `record.text` with ISO dates and live engagement counts.
   - **LinkedIn** — authenticated browser session on
     `linkedin.com/company/<slug>/posts/`. Expand every
     `.feed-shared-inline-show-more-text__see-more-less-toggle` before reading
     `.update-components-text`, and iterate those text nodes directly rather than
     descending from the `data-urn` container — on some company pages the text node is
     not a descendant of it. The feed lazy-loads, so scroll and re-read; extraction
     immediately after navigation returns nothing.
   - **X** — the logged-out profile preview exposes roughly five posts per profile. Read the
     longest `div[class*="text-body"][class*="whitespace-pre-wrap"]` inside each `article`
     (the first match is the display name, not the post). Do not authenticate.
   - **Dates** for LinkedIn and X are not exposed; derive them from the identifier
     (see Known limitations) and cross-check against the relative label on the page.
2. Apply the selection rule. Marketing an *existing* product, capability, use case, offer or
   minor feature update — **not** a launch, founding announcement, fundraising post, or
   corporate news with no marketing objective. Log anything rejected in the rejection log.
3. Add it under `## Anchors` or `## Held-out` following the existing entry format. Required
   fields: `platform`, `company`, `label`, `source`, `published`, `selection_reason`,
   `product_or_campaign`, plus `#### Company context`, `#### Relevant product knowledge` and
   `#### Post`.
4. Quote the text exactly. Preserve line breaks, emoji, hashtags, typos and any
   platform-truncated links. If you cannot obtain exact text, reject the candidate — do not
   reconstruct it.
5. Include engagement only if verifiable, and always with a `retrieved YYYY-MM-DD` date.
6. If it belongs to the same campaign as an existing entry, give both the same
   `campaign_group` and keep them in the same section.
7. Update the counts table.
8. `npx jest __tests__/lib/evals/references.test.ts`.

## Known limitations

1. **Reddit is absent entirely.** Bluesky, LinkedIn and X each hit the 10-good / 3+-bad
   target; Reddit contributes nothing, so a judge calibrated here has no exposure to Reddit's
   community register. Official Reddit accounts post security advisories, release notes and
   product-update notices — all excluded by the launch and corporate-news rules. This is a
   finding about Reddit's culture, not a tooling failure.
2. **Engagement is available for 33 of 47 entries.** All counts were read on 2026-07-31 and
   decay. X entries carry none: its logged-out profile preview does not attach counts reliably
   to individual posts, and the alternative required authenticating, which was out of scope.
3. **X and LinkedIn dates are derived, not read.** Neither surface exposes absolute
   timestamps, so dates are computed from the post identifier — X snowflake
   `(id >> 22) + 1288834974657` ms, LinkedIn activity URN `(id >> 22)` ms — and cross-checked
   against the relative label on the page. Bluesky dates are exact ISO values from the API.
4. **Bluesky entries skew older.** Six date from March–April 2026 while LinkedIn and X entries
   are almost all from the last ten days, because Bluesky feeds were paged deeply and the other
   two were read from the first screens only.
5. **Cross-platform twins were resolved by hand.** Companies routinely post one campaign to two
   or three platforms within hours; each campaign appears once here, on one platform, with the
   twins logged as rejections. The test suite catches duplicate source URLs and near-duplicate
   text across anchor/held-out, but two genuinely different phrasings of one campaign on two
   platforms would pass it.
7. **The confidence threshold is untested.** Fixtures carry no `MetadataFact.confidence`, so
   production behaviour where a fact is suppressed for low confidence is not covered. See the
   mapping document for the edge case this hides.
8. **`no-hallucinated-product-names` is heuristic.** It flags TitleCase and code-like spans not
   matching an allow-list, so unusual-but-legitimate capitalisation can false-positive. It
   scores partial credit rather than failing outright for this reason.
9. **`no-unsupported-numerics` matches numerals only.** A number written as a word
   ("quintupled", "four thousand") is not detected.
10. **Assertions are single-variant-aware but not cross-variant-semantic.** They detect
    duplicate and near-duplicate variants lexically; they cannot tell that two differently
    worded variants make the same argument.
