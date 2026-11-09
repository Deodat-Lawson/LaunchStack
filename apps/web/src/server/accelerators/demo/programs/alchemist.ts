import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["pre_seed", "seed"],
    generalist: true,
    sectors: ["ai", "deep_tech"],
    regions: ["global"],
    format: "Build from anywhere; optional San Francisco office access. No set main-program length.",
    durationWeeks: null,
    contact: {
        email: null,
        phone: null,
        contactUrl: "https://www.alchemist.vc/contact",
    },
    applyRoutes: ["online_application"],
    batches: {
        cadence:
            "Alchemist no longer calls itself an accelerator; the main founder experience has no set program length. Regional programs have separate calendars.",
        next: null,
        recent: [],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary: "$60,000–$1 million investment range, depending on the company and program.",
        cashUsd: null,
        equityPercent: null,
        instrument: null,
        terms: `## Current investment terms

Alchemist's current FAQ states: **“Our check size ranges from $60,000 to $1 million, depending on the company and the program.”** It invests at **pre-seed and seed** in deeply technical teams building for enterprise customers.

The checked current investment page and FAQ do **not** publish a single fixed check, fixed equity percentage, valuation cap, discount, or uniform instrument for the main Alchemist investment. The range is not a promise that every company receives $1 million. A single cash amount and fixed ownership percentage therefore remain unknown.

## Not the historical accelerator deal

Alchemist explicitly says it **no longer considers itself an accelerator** and now does business as **Alchemist** at alchemist.vc. Its main founder experience **does not run on a set program length**; it supports companies for as long as they are building toward a venture-scale outcome. Historical six-month-program or fixed-percentage claims are not represented as current terms here.

The Chicago and Japan partners still run programs on a set calendar. Regional investment terms and timelines are separate, not a uniform main-program offer.

## Support and equity alignment

Every backed founder receives commercialization and fundraising support, an equity-aligned Partner matched to the business, a founder community, and access to the mentor network. Alchemist says it assigns **part of its own equity to Partners**, with **no advisor shares to negotiate and no extra line on the startup's cap table**. That statement does not reveal Alchemist's total ownership percentage.

Founders **do not need to move to San Francisco**. Those based in Silicon Valley can have regular desk access for six months; others can drop in when visiting. Six months of desk access is not a six-month limit on founder support.

Sources: [current FAQ](https://www.alchemist.vc/faq) and [How We Invest](https://www.alchemist.vc/invest).`,
    },
    sources: [
        {
            title: "Alchemist FAQ — current terms, venture-firm positioning, founder fit, and format",
            url: "https://www.alchemist.vc/faq",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "Alchemist — How We Invest",
            url: "https://www.alchemist.vc/invest",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "Alchemist — current public founder application",
            url: "https://www.alchemist.vc/pitch",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "Alchemist — public contact form",
            url: "https://www.alchemist.vc/contact",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
