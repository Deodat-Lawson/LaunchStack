# Company search experiments

Can company search get more out of a limited number of search calls and page
fetches? Four experiments answer that for the four places a Prospects run
spends its budget, each against today's behaviour, on real data from free
public sources.

| #   | Question                                                         | Today (the baseline)                                   | Where the truth comes from                                        |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| E1  | What should a capped place search be asked, and where?           | Production's keyless `searchPhoton`, run unchanged     | Every place of the category in the country, from Overpass         |
| E2  | Which word and page should a paged keyword search be asked next? | Every planned word once, first page only               | Every company of the industry class, from the register            |
| E3  | Which pages of a company's site are worth a fetch?               | The site reader's order at the time (13 guessed paths) | Facts production's own `extractFacts` finds on all recorded pages |
| E4  | Which candidate should get the next expensive check?             | Production's fixed `semanticRelevance` ranking         | Industry codes and directory tags, hidden from the ranker         |

Nothing here ships: `tsconfig.build.json` only builds `src/`. The code is
type-checked and linted with the rest of the package.

E3's result has been built into production since: the keyless site reader
follows the homepage's links. `e3-what-to-read/` now also replays that
reader on the same recording (see its README, "What came of it").

## Run it

Replay everything from the local recordings (offline, deterministic, free):

```bash
cd pipelines
pnpm exec tsx experiments/company-search/run.ts
```

One experiment: `pnpm exec tsx experiments/company-search/run.ts e1`. Each
writes `results/<experiment>.json` and prints a table. Two replays of the
same recording give byte-identical result files.

`e1-production` is not an experiment but a check of what was built from E1:
it runs the app's own keyless place search against the recorded servers and
writes `results/e1-production-sweep.json` (see "E1 against production").

The recordings are not in git, so a fresh checkout has none. A replay then
stops with an error that names what is missing and leaves `results/` as it
is: no experiment writes a partial result, and none goes to the network. The
same holds for a recording that is only partly there, and for a world that
an older version of the recorder wrote: the replay names it and gives the
command that rebuilds it from the recorded requests, offline. To replay from
a copy kept elsewhere, point `COMPANY_SEARCH_BENCH_CACHE` at it.

## Record it (the only step that touches the network)

The recordings are not in git (see "What is not committed"). To collect them
again, run each experiment's recorder with `COMPANY_SEARCH_BENCH_MODE=record`:

```bash
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e1-where-to-look/record.ts
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e2-what-to-ask/record.ts
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e3-what-to-read/record.ts
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e4-whom-to-check/record.ts
```

A request that is already recorded is never sent again, so a recorder can be
stopped and restarted. One exception: a request whose answer the world is
built from (an E1 sweep box or tag look-up, an E2 page) that got no answer
(no response, 429 or 5xx) is sent again whenever its segment is recorded
again, because no answer is not the same as an empty one. Run without
`COMPANY_SEARCH_BENCH_MODE=record`, the E1 and E2 recorders send nothing and
rebuild their worlds from the requests already recorded. Live data moves, so
a fresh recording gives slightly different numbers than the ones in
`results/`.

Sources, all free and keyless: Photon and the OpenStreetMap API, Overpass,
the Norwegian company register (Brønnøysundregistrene), the YC company
directory, and the public pages of company websites. E4 also needs a local
Ollama with `nomic-embed-text` for embeddings. No paid search engine and no
paid model is called anywhere.

How the recorder behaves towards those sources:

- one request at a time per host with a gap: 1 s by default, more for Photon,
  the OSM API and Nominatim, and less for the Norwegian register (0.35 s in
  E2, 0.7 s in E4), which is built for bulk reads;
- a generic User-Agent (`company-search-bench/0.1`), never the product's name;
- failures are recorded and replayed as failures, so a flaky source is part
  of the measured world;
- where the simulated world is built from the answers themselves (the E1
  sweeps, the E2 pages), a request that got no answer is tried up to three
  times while recording and, if it still has none, kept as a hole and never
  as an empty answer. In E1 the simulation spends the request, learns nothing
  from it and does not treat the word as exhausted; in E2 the word's
  recording ends at that page and the word is never complete. `results/`
  lists every hole (`unansweredSweepRequests` in E1, `wordsCutShort` in E2);
  the recordings behind the committed results have none;
- E3 draws its sample from company directories, so a directory request that
  still has no answer after three back-offs stops the run rather than leave
  a shorter list to sample from;
- E3 reads `robots.txt` first and never fetches a disallowed path;
- Nominatim is only reached through production's own place search, once per
  E1 segment: its usage policy forbids systematic querying.

## What is not committed

`.cache/` holds the recorded HTTP exchanges, the derived worlds and the
embedding vectors. Register records and web pages contain contact details of
real people, so the cache stays on the machine that recorded it. `results/`
holds aggregates only: counts, means and intervals, no company rows, no names
of people, no email addresses.

## How the two discovery experiments work (E1, E2)

A search interface answers each request with a capped page: Photon returns at
most 50 places for a search word inside a map box; the register returns 20
companies per page for a word. Both mix what is wanted with what is already
known, and E2 also with companies of the wrong kind.

- An **arm** is a search word. **Pulling** it sends its next unsent request:
  the next page, or the next map box (a box that came back full is split in
  four and its quarters are queued).
- The **reward** is the number of target companies in the answer that were
  not known before. So every word wears out as it is used.
- A **policy** picks the next arm from what earlier answers showed.

Policies (`lib/bandits.ts`, `lib/discovery.ts`):

| Policy                                            | What it knows                                                                                                                                                         | Kind                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `plan-static`                                     | The planned words, in order, then their deeper requests level by level                                                                                                | Fixed order, nothing learned                                    |
| `letters-static`, `letters-random`                | The planned words, then a to z (E1 only: Photon matches the start of a word)                                                                                          | Fixed order                                                     |
| `egreedy`, `ucb1`, `thompson`                     | The same arms; how many new targets each returned so far                                                                                                              | Bandits over a fixed set of arms                                |
| `mined-greedy`, `mined-egreedy`, `mined-thompson` | Also the names of what was found: words that recur in target names become new arms, and every unasked word gets an expected yield                                     | Bandits whose arms grow from feedback                           |
| `mined-greedy-plan`                               | As `mined-greedy`, but a planned word it has read nothing about keeps the plan's own prior. Added after the frozen design was scored (`postHoc: true` in the results) | Feedback bandit, exploratory                                    |
| `oracle`                                          | Every recorded answer in advance; always sends the request with the most new targets right now                                                                        | Reference point: greedy with full knowledge, not a strict bound |

The feedback policies estimate a word's first request as (results expected) ×
(share that are targets) × (share of those that are new). The counts come
from "side evidence": a result found by asking for `c` says nothing new about
`c`, but its other name words are a fair sample of what names contain. Three
factors are learned as the run goes (results per known result, how
over-optimistic the target share has been, how many returned targets were
new). A learning policy never asks a word whose every match is already known
because a completed word covers it.

Both experiments also report, along a run, two estimates of how much of the
population has been seen: Chao1 and Good-Turing coverage, computed from how
often each target was returned (`populationEstimates`).

Stochastic policies run with 30 seeds; a result is the mean with a 95%
bootstrap interval over seeds.

## E1 against production

E1's finding was built into the keyless place search
(`src/distribution/keyless/pool.ts`, `sweep.ts`): Overpass first where one
request covers the territory, a letter sweep of Photon with box splitting
when Overpass does not answer, and a stored pool so a second run carries on.
`e1-where-to-look/production.ts` replays that code, called the way the app
calls it (`createKeylessPorts().searchPlaces`), for each recorded segment:

- **Photon is replayed by URL.** The sweep has to send requests the recording
  holds, byte for byte; any other request is an error. So the box, the page
  size and the request shape are checked along with the numbers.
- **The OSM API is replayed by place.** The recording read the same places'
  tags in other groups of 100, so a request gets the recorded tags of the ids
  it names.
- **Overpass is the recorded answer to the same statement** (every named
  place with the tag in the country), served only to a query that holds that
  statement; or it is down, which is what makes the sweep run.

`production-sweep.test.ts` asserts the outcome and prints it beside today's
first step (`searchPhoton`, unchanged, replayed) and the one live sample of
the old whole search. On the recordings of 2026-11-24:

- One answered Overpass request knows 100% of the named places in every
  segment. That is true by construction: the same answer is the benchmark's
  count of what exists.
- The sweep knows 45% after 16 Photon requests, 72% after 32, 90% after 64
  and 94% after 96, as a mean over the six segments. Counted over all 5,069
  places together it is 34%, 53%, 71% and 84%, because the largest segment
  (2,637 Dutch bicycle shops) is at 45% after 64.
- In runs of 64, three segments complete in one run, one in two and the
  largest in five (282 requests), and no answered request is sent twice. The
  sixth, Belgian breweries, stops one box short at 240 of 246 places: the
  recording holds a failed answer for that box, and the sweep keeps an
  unanswered box to ask again on the next run instead of giving it up.
- The old first step kept 0 to 17 on-target places with a website for 6 to
  12 requests.

What the replay does not show: how the live servers answer today, how long
they take, and a large country (those are swept whole and not asked on
Overpass; the benchmark has small countries only).

## Honest limits

- **The paid company index was not tested.** No Exa call was made. E2 is a
  stand-in for "a keyword search that returns a mixed page": it shares the
  structure (capped pages, overlapping queries, diminishing returns) but not
  the ranking of a neural index. Treat E2 as direction, not magnitude, for
  the live Prospects path.
- **Targets are structural.** A place is a target because OpenStreetMap tags
  it with the category; a company because the register files it under the
  class. That makes recall measurable, and it is not the same as "would buy".
- **The feedback policy was designed while looking at data.** Its estimator
  was changed three times after reading traces of `dk-bicycle` and
  `be-chocolate` (E1) and the first E2 table. The segments `nl-bicycle`,
  `dk-dentist` (E1) and `no-dentist` (E2) were recorded and scored only after
  the design was frozen. The plain bandits were never changed. One variant,
  `mined-greedy-plan`, was added after every E2 segment had been scored; its
  numbers are exploratory.
- **Recording limits bound the replay.** A policy can only ask words that
  were recorded: the planned words, the letters, and the most frequent words
  in found names (fewer for a very large population, to spare the public
  server). In E2 planned words are recorded 40 pages deep and mined words 10.
- **One live sample of production's whole place search per segment.** Its
  Overpass step depends on how busy the public servers were that minute; the
  attempts are in the results file. The sample is of the search as it was on
  2026-11-24 (Photon, then Overpass, then Nominatim, 40 places kept). The
  search has since changed (see "E1 against production"), so recording a
  segment again samples the new one.
- **One segment was completed two days after the rest.** When `be-brewery`
  was first recorded (24 November 2026), one of its 58 sweep requests got no
  answer: the letter "s" over all of Belgium, HTTP 503. It was asked again on
  26 November, which added two places. The rest of that world, and the five
  other worlds, are as recorded on the 24th.
