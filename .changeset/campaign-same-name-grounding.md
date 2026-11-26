---
"@launchstack/pipelines": patch
---

The campaign generator no longer takes a company or product that merely shares
our name for ours. Its two web-research stages search on the company's name,
so they find unrelated namesakes; those pages were being summarised as facts
about us, listed as strategy `keyProof`, and written into drafts.

- Trend search: the synthesizer says who each result is about (`subject`:
  `market`, `company` or `namesake`) and drops namesakes for every caller.
  `SearchResult.subject` is new and optional. Campaign research keeps only
  `market` results.
- Competitor analysis: the analyst is shown "Our company" and "Web search
  results" as separate labelled blocks; `ourAdvantages` may only restate the
  first.
- Strategy: the context is banded into ABOUT US (the only source for
  `keyProof`), THE OUTSIDE WORLD (competitors, the analyst's view, trends) and
  OUR EARLIER POSTS (past angles, so one bad run does not teach the next).
- Generation: the company context outranks the strategy; a product in a trend
  reference is never ours.
