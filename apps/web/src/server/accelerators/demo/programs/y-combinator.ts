import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

// Reuses the official-page excerpts already collected in the YC catalogue fixture.
// Their original checkedAt timestamps are retained; no YC website was fetched.
export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["idea", "pre_seed", "seed"],
    generalist: true,
    sectors: [],
    regions: ["global"],
    format: "Three months in person in San Francisco, with a three-day kickoff and regular meetups",
    durationWeeks: null,
    contact: { email: null, phone: null, contactUrl: null },
    applyRoutes: ["online_application"],
    batches: {
        cadence: "Four batches a year: Winter, Spring, Summer, and Fall",
        next: {
            label: "Winter 2027 — January to March in San Francisco; published on-time deadline November 2 at 8pm PT has no explicit calendar year in the collected excerpt. Late applications are considered without a promised response date.",
            deadline: null,
            deadlineKind: "announced",
        },
        recent: [],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary: "$500k: $125k for a fixed 7% plus $375k on an uncapped MFN SAFE",
        cashUsd: 500000,
        equityPercent: 7,
        instrument: "Post-money SAFE plus uncapped MFN SAFE",
        terms: `## Standard investment: $500,000

The official standard deal, as quoted in the existing catalogue fixture, is the same for every accepted company:

- **$125,000 on a post-money SAFE for a fixed 7%** of the company.
- **$375,000 on an uncapped SAFE with a Most Favored Nation (MFN) provision.**

YC's investment gives it **7% plus an incremental equity amount** that is fixed when the company raises money from other investors. The entire $500,000 is **not** exchanged for only 7%. The collected excerpts do not establish a valuation cap, exact total dilution, or additional investor-rights provisions, so none is inferred here.

## Incorporation and international applicants

- YC invests in **U.S., Canadian, Cayman, and Singapore corporations**.
- Founders do **not** need to incorporate before applying; YC says it helps accepted companies do so.
- A company already incorporated elsewhere may need to **flip its corporate structure** so its parent company is in one of those four jurisdictions.

## Participation and source freshness

- The collected FAQ expects founders to work **full-time on the company during the batch and afterwards** if accepted.
- The batch is **in person in San Francisco** for three months.
- These facts reuse the official excerpts in the existing YC fixture, checked **October 25, 2026**; they are not a new fetch or legal review of YC's site.

[Official deal cited in the existing fixture](https://www.ycombinator.com/deal) · [Official FAQ cited in the existing fixture](https://www.ycombinator.com/faq)`,
    },
    sources: [
        {
            title: "Cached YC catalogue source: What Happens at YC — three months and four batches a year",
            url: "https://www.ycombinator.com/about",
            checkedAt: "2026-10-25T07:43:02.304Z",
        },
        {
            title: "Cached YC catalogue source: Apply to YC — Winter 2027, San Francisco, deadline ambiguity, and late applications",
            url: "https://www.ycombinator.com/apply",
            checkedAt: "2026-10-25T07:43:02.304Z",
        },
        {
            title: "Cached YC catalogue source: Standard Deal — $500k split and incorporation jurisdictions",
            url: "https://www.ycombinator.com/deal",
            checkedAt: "2026-10-25T07:43:02.304Z",
        },
        {
            title: "Cached YC catalogue source: FAQ — global and any-sector applications, stages, commitment, and location",
            url: "https://www.ycombinator.com/faq",
            checkedAt: "2026-10-25T07:43:02.304Z",
        },
    ],
};
