# E3: what to read

Production's keyless site reader (`profileFromPages` in
`pipelines/src/distribution/keyless/profile.ts`) reads a company's homepage
and then guesses up to 13 URL paths (`/about`, `/about-us`, `/over-ons`, …)
until 4 pages were readable. It does not look at the links on the homepage
and it learns nothing from one site to the next.

**Question.** For the same number of HTTP requests per company, do smarter
ways of choosing pages find more facts?

## What is measured

- **Cost.** Every HTTP request a policy makes costs 1, whatever comes back: a
  page, a 404, a timeout, `robots.txt` or a sitemap file. A redirect chain
  counts as one request. The homepage is always request number 1. Budgets:
  2, 4, 6, 8 and 14 requests (14 is the most production can spend).
- **A readable page** is production's rule: status below 400, at least 120
  characters of readable text, and a final URL not already read in the visit.
- **Facts.** Production's own `extractFacts` runs on every readable page.
  Five fact types are tracked per site: a contact email, a self-description,
  a staff count, at least one certification, at least one stated role. The
  **fact score** is how many of the five have been found so far (0 to 5). An
  email on any domain counts; "email on the site's own domain" is reported
  next to it. The site's **ceiling** is the score over all its recorded pages.
- **Per policy and budget:** mean fact score; share of sites with an email,
  with a self-description; share of requests wasted (nothing readable came
  back); requests needed to reach the score `today` ends with; and the paired
  difference against `today` (paired by site, a stochastic policy averaged
  over its 40 seeds first) with a bootstrap 95% interval from `lib/stats.ts`.
  Everything is also broken down by the three site groups.

## The sample

About 180 sites, 60 per group, all from free keyless directories:

| Group  | Source                              | How                                                                                                          |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `no`   | Norwegian register (Brreg)          | NACE 10.830, 11.050, 46.370, 71.110, 62.100; at least 5 employees; companies only; a website on record       |
| `nlde` | OpenStreetMap places with a website | production's `searchPhoton`, three tags and four name words, four cities each in the Netherlands and Germany |
| `en`   | YC company directory                | active B2B companies in the US, UK or Canada, with a website                                                 |

Each directory list is shuffled with a fixed seed (sub-lists take turns),
de-duplicated by host, and stripped of social, link-hub and marketplace
hosts. Candidates are tried in that order until 60 per group have a homepage
that `robots.txt` allows and production's fetcher can read. The results file
says how many candidates were tried and why the others were left out.

## What is recorded per site

At most 45 requests, one at a time per host with the recorder's 1 s gap, 8
hosts in parallel, all through production's `fetchReadable` on top of the
recorder:

1. `/robots.txt`. `Disallow` rules for `*` are honoured: a disallowed path is
   never fetched. (`Crawl-delay` is not read; the recorder's fixed gap applies.)
2. The homepage, `https://<host>/`, as production asks for it.
3. The sitemap: `/sitemap.xml`; if that is not a sitemap, the first `Sitemap:`
   line of `robots.txt`; if the file is an index, one child (the one named
   "page…", else the first). At most 200 URLs are kept.
4. Each of production's 13 guessed paths.
5. The sitemap's 6 best URLs by the keyword prior.
6. Up to 25 same-site links found on the homepage: the best by the keyword
   prior, ties in page order.

Guessed paths and links are fetched in turn, and a site is given up on after
3 consecutive failures (no response, 401, 403, 429 or 5xx). Requests that
were never sent for that reason replay as failed requests.

Page text is not kept outside the recorder's cache. A page is reduced to
which fact types were found on it.

## Policies

| Policy                                        | What it does                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `today`                                       | Production's order: homepage, then the 13 guessed paths in order, stop at 4 readable pages.                                                                                                                                                                                                                                                                                 |
| `link-keyword`                                | The homepage's links, best first by a fixed multilingual keyword prior on anchor text and path. No guessed paths.                                                                                                                                                                                                                                                           |
| `link-keyword+fallback`                       | The same; when the links run out, production's guessed paths the homepage did not link.                                                                                                                                                                                                                                                                                     |
| `link-keyword@today-spend`                    | `link-keyword`, never allowed more requests on a site than `today` made there (it makes fewer where the homepage has fewer links). Separates "better pages" from "more requests".                                                                                                                                                                                           |
| `learned-links-thompson`                      | Links fall into 10 classes (contact, about, team, careers, legal, quality, products, news, shop, other). A Beta posterior per class for "fetching a page of this class reveals a fact type this site did not have yet", learned online across sites visited in a seeded random order. Thompson sampling picks the class; the keyword prior picks the link within the class. |
| `learned-links-ucb1`, `learned-links-egreedy` | The same classes and reward with UCB1 and epsilon-greedy (0.1).                                                                                                                                                                                                                                                                                                             |
| `sitemap-first`                               | Pays for the sitemap (see step 3 above: 1 to 4 requests), reads its 6 best URLs by the keyword prior, then goes on with the homepage's links.                                                                                                                                                                                                                               |
| `random-link`                                 | The same recorded links in random order. Lower bound.                                                                                                                                                                                                                                                                                                                       |
| `oracle`                                      | Knows the facts on every recorded page, takes the page that adds most each time (greedy set cover). Upper bound; the results file says on how many sites greedy equals the exact optimum.                                                                                                                                                                                   |

The keyword prior (`prior.ts`) was written before any site was recorded. Two
misclassifications were fixed after a 9-site pilot that looked at link
classes only, not at outcomes ("terms of service" counted as a services page;
Norwegian "jobb" counted as careers). It was not touched after that.

The learned policies are run once per budget: a policy that may make 4
requests per site learns from 3 picks per site, not from 13.

## Run it

Replay (offline, deterministic, about a minute):

```bash
cd pipelines
pnpm exec tsx experiments/company-search/e3-what-to-read/run.ts
```

It prints a compact table and writes `../results/e3-what-to-read.json`
(counts and aggregates only: no site rows, no names, no email addresses).
Two replays give byte-identical JSON. `run.ts` forces replay mode and never
goes to the network.

Record (the only step that touches the network, about half an hour):

```bash
cd pipelines
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e3-what-to-read/record.ts
```

Recording is resumable: what is already in the cache is not asked for again.
Without `COMPANY_SEARCH_BENCH_MODE=record` the same command touches no
network and only checks that the recording is complete.
`E3_SITES_PER_GROUP=3` gives a 9-site smoke test of either command.

The recording lives in `.cache/e3/` (not in git). Besides the recorder's
exchanges it holds `_fetch-errors.json`: requests that failed before any HTTP
exchange existed (a DNS failure, for example), so they replay as failures.

## Checks built in

- **`today` is production.** `run.ts` runs the real `profileFromPages` on
  every site, with a `fetchPage` built on the recorder and a stub
  `recordEvidence`, and compares the URLs it asks for (and their order), the
  number of pages it counts, and the fact types in the dossier it returns
  with the replayed `today`. The counts are in the results file and on the
  first lines of the table.
- **The oracle is an upper bound.** The exact best score for each budget is
  computed by enumeration (5 fact types) and compared with the greedy oracle.
- **Every stochastic choice is seeded** (site order, link shuffles, Thompson
  draws, ties, bootstrap resamples).

## Files

| File          | What                                                             |
| ------------- | ---------------------------------------------------------------- |
| `record.ts`   | Live collection.                                                 |
| `run.ts`      | Offline replay, table and results file.                          |
| `dataset.ts`  | Builds the sample and its recording, the same way in both modes. |
| `sources.ts`  | The three directories.                                           |
| `site.ts`     | What is recorded for one site.                                   |
| `html.ts`     | Links, `robots.txt` and sitemap parsing.                         |
| `prior.ts`    | The keyword prior and the link classes.                          |
| `policies.ts` | The policies.                                                    |
| `verify.ts`   | The check against the real `profileFromPages`.                   |

## Limits

- **Only sites this fetcher can read.** A candidate is left out when its
  homepage does not answer, answers 401/403/429 to the recorder's generic
  user agent, has fewer than 120 characters of text without JavaScript, or is
  closed to crawlers by `robots.txt`. Sites that need a browser are therefore
  missing from every number here. Production sends a different user agent,
  so the set of sites that block it may differ.
- **About 180 sites, 60 per group.** Intervals are bootstrap intervals over
  sites. Group results rest on about 60 sites each; the NL/DE group is small
  shops and offices from OpenStreetMap, the Norwegian group five industries,
  the English group venture-backed software companies.
- **Facts are what production's regular expressions find**, not what is true.
  A footer that says "webshop" counts as a stated role; an email hidden by
  Cloudflare's obfuscation is not seen; staff counts are only recognised in
  English, Dutch and German wording.
- **Soft 404s count as pages**, as in production: a site that answers 200
  with a "not found" page for any path gives `today` its 4 readable pages
  after 4 requests. The results file reports how often a page repeated the
  text of an earlier one.
- **At most 25 homepage links per site were recorded**, chosen by the keyword
  prior. On link-rich homepages `random-link` is therefore random among
  those 25, not among all links, so it is a more generous lower bound than a
  truly random link would be; the learned policies see fewer "other" links
  than the page has. The results file repeats every comparison on the sites
  where all links were recorded (`allLinksRecorded`).
- **Only same-host links.** Pages on a subdomain or on another host (a jobs
  board, a shop) are not followed.
- **`robots.txt` is honoured by the experiment, not by production.** A
  disallowed path was never recorded, so no policy asks for it and it costs
  nothing; the results file counts how many guessed paths that removed.
- **No clock.** A request costs 1 whether it took 50 ms or timed out after
  10 s. Production also stops a candidate after 40 s; the results file says
  on how many sites the recorded response times would have triggered that.
- **Budgets above 4 read more pages than production allows itself**
  (production stops at 4 readable pages). `link-keyword@today-spend` gives
  the comparison at equal spend per site.
- **The learned policies learn on the sites they are scored on**, online, one
  site after another. With about 180 sites and 10 classes they have little to
  learn from; the learning curve (first third against last third of the
  sites visited) and its interval over 40 site orders are in the results
  file. The interval says how much the order matters on this sample, not how
  the policy would do on new sites.
- **One recording, one day.** Sites change; a fresh recording gives somewhat
  different numbers.
