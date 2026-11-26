---
"@launchstack/pipelines": minor
---

The Prospects fit check learns as it goes, and a run keeps what it learned.

- The shortlist's fit check asks about ten companies a round, where it asked
  about two per open place (fifty in the first round of the default 25-place
  shortlist). After each round `fillShortlist` re-ranks everyone not checked
  yet from the verdicts so far (`createShortlistLearner`: LinUCB over the
  candidates' embeddings) and asks about the highest ranked next. Before any
  verdict the learner's prediction is the fixed relevance ranking; from the
  first round on it adds a bonus for companies unlike the ones already asked
  about, so the first round is close to the fixed order, not equal to it.
  Companies matched by shared words (no embedding model) are checked in the
  fixed order and rounds as before.
- Verdicts are kept in the new table `distribution_fit_verdicts`, one row per
  company and segment (`saveFitVerdicts`, `listFitExamples`). The next run's
  ranking starts from them and from the stage people moved the segment's
  deals to (`fitDecision`). The fit check's verdicts are kept under the
  question they answered (`segmentKey`: offering, categories, constraints,
  buyer kinds and area, as the run narrowed them), so a segment that was
  rewritten or moved starts afresh. People's decisions always count.
- A fit check that breaks off part-way no longer leaves a shortlist of only
  the companies it got through: the places it left open go to the next
  companies down the ranking, unchecked. A company named outside the
  segment's area that the check never read stays out, as it does with no fit
  check at all. The run's warning says which of the three happened: nothing
  was checked, part of the list is unchecked, or the list holds only the
  companies that were read.
- `RunSummary.fitCheck` (optional) says how many companies the fit check read,
  in how many rounds, how many it turned away, how many earlier verdicts the
  ranking started from and whether it broke off (`incomplete`). `Relevance`
  gains optional `vectors` and `measure`.

The table comes with the app's migration
`20261124154024_distribution_fit_verdicts`. A failure to read or keep verdicts
never stops a run: it learns from its own verdicts alone. When the learner
cannot be built, or cannot rank, the fixed ranking takes over.
