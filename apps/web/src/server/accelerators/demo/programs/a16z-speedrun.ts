import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["idea", "pre_seed", "seed"],
    generalist: false,
    sectors: ["ai", "robotics", "fintech", "consumer", "b2b_software"],
    regions: ["global"],
    format: "In person in San Francisco; founders are expected to build full-time",
    durationWeeks: 12,
    contact: {
        email: "sr-team@a16z.com",
        phone: null,
        contactUrl: "https://speedrun.a16z.com/faq",
    },
    applyRoutes: ["online_application", "rolling_application"],
    batches: {
        cadence:
            "Twice a year in San Francisco; SR009 starts in late July 2027. Applications are reviewed year-round for the following residency after the SR008 window.",
        next: null,
        recent: [
            "SR008: published application deadline November 1, 2026 at 11:59 PM PT (passed); residency begins February 1, 2027. The application page says April 16 and the FAQ says April 18 for its end date.",
        ],
    },
    selectivity: {
        acceptanceRatePercent: null,
        note: "The official FAQ reports fewer than 0.4% of applicants accepted and 70–80 companies in recent residencies. The bound is not an exact 0.4% acceptance rate.",
    },
    deal: {
        summary:
            "$500k for 10% upfront on a SAFE, plus up to $500k in a qualifying next round within 18 months",
        cashUsd: 500000,
        equityPercent: 10,
        instrument: "SAFE; additional qualifying-round investment subject to terms",
        terms: `## Standard deal: up to $1 million

- **$500,000 for 10% upfront on a SAFE.**
- **Up to an additional $500,000** in the next qualifying round of **$2 million or more**, within **18 months**.
- The additional investment is conditional; it is not an unconditional $1 million payment for the fixed 10% stake. Its pricing and detailed next-round definition are not stated on the public FAQ; the investing partner explains the terms before signing.

## Investor rights and early hires

- The current standard deal does **not** include a board seat.
- speedrun asks for **pro rata rights** in future rounds and an **option pool** for early hires.
- The Program generally offers its standard deal rather than negotiating individual terms.

## Credits and continuing support

- The Marketplace advertises **$10 million+ in credits from 200+ partners**. These are offers and credits, not investment cash.
- Credits unlock once the investment is wired. Amounts and terms are set by each partner and can change.
- The twelve-week residency is part of a longer-term relationship; follow-on funding remains subject to terms.

[Official capital and terms FAQ](https://speedrun.a16z.com/faq)`,
    },
    sources: [
        {
            title: "speedrun FAQ — deal, applicant stages, sectors, global founders, cadence, selectivity, and public contact",
            url: "https://speedrun.a16z.com/faq",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "speedrun Residency — twelve weeks in person in San Francisco",
            url: "https://speedrun.a16z.com/residency",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "Apply to speedrun — SR008 dates and year-round review; end date differs from FAQ",
            url: "https://speedrun.a16z.com/apply",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "speedrun Capital — Marketplace credits and conditional follow-on support",
            url: "https://speedrun.a16z.com/capital",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
    ],
};
