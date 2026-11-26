---
"@launchstack/tools": minor
"@launchstack/pipelines": minor
---

`fetchReadable` keeps a page's links. `ReadablePage.links` (new, optional) lists
every `<a href>` of an HTML response in document order as `{ url, text }`:
relative targets resolved against the URL that answered (or the page's
`<base>`), fragments dropped, http(s) only, and an icon link's aria-label,
title or image alt standing in for its words. `extractPageLinks(html, pageUrl)`
is exported for callers that already hold the HTML. The page `text` is
unchanged.

The distribution pipeline's keyless site reader follows the homepage's own
links instead of guessing 13 paths on every site. It reads the homepage, then
the pages its links name as contact, imprint, about or team (by the words in
each link, in the languages of the countries the keyless search serves), never
a login, account, cart or search link, and guesses paths only when the
homepage has no link to follow. A site gets 4 requests instead of up to 14.
Replayed on 180 recorded company sites: a contact email on 74% of sites (was
58%) for 3.9 requests a site (was 13.3).

For callers of the keyless reader:

- `KeylessProfileLimits.maxPages` is replaced by `maxRequests`: HTTP requests
  per site, the homepage included, counted whatever comes back.
- `createKeylessPorts`' option `pagesPerCandidate` is now
  `requestsPerCandidate`.
- `profileFromPages` is `readSite` (which pages) followed by
  `dossierFromPages` (what they say); both are exported, with
  `DEFAULT_KEYLESS_LIMITS` and `GUESSED_PATHS`.
- The profiler's version string is `keyless-profile/v2`.
