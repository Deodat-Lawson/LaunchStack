import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["idea", "pre_seed"],
    generalist: false,
    sectors: [],
    regions: ["global"],
    format: "Four months in person in San Francisco, California",
    durationWeeks: null,
    contact: { email: null, phone: null, contactUrl: "https://500.co/contact" },
    applyRoutes: ["online_application"],
    batches: {
        cadence: null,
        next: null,
        recent: [],
    },
    selectivity: {
        acceptanceRatePercent: null,
        note: "The page's 'top 0.1% of founders' language describes the intended audience, not an acceptance rate.",
    },
    deal: {
        summary: "Up to $50,000 initially, with the potential for up to $1 million more",
        cashUsd: null,
        equityPercent: null,
        instrument: null,
        terms: `## Published investment description

Companies accepted into The 500 Fellowship **can receive up to $50K right away**, with **the potential for up to $1M more as they progress**. These are upper bounds, not a guaranteed initial check or a committed $1.05M package.

The current official page does not publish a fixed equity percentage, valuation cap, investment instrument, participation fee, or the conditions for further investment. Those terms remain unknown; older Flagship Accelerator offers should not be substituted for this Fellowship's current description.

## Program and conditions

The advertised Fellowship runs **November 30, 2026–April 9, 2027**, in person in San Francisco. The page describes four months of work with a cohort, mentors, weekly group sessions and 1:1s. Fundraising starts at a company inflection point rather than on a fixed calendar.

The official disclaimer states that **applying does not guarantee an investment** from 500 Global or its affiliates. The page is informational and does not constitute legal, tax, investment or financial advice.

[Source: The 500 Fellowship](https://500.co/founders/flagship)`,
    },
    sources: [
        {
            title: "500 Global — The 500 Fellowship: overview, audience, dates, investment and disclaimer",
            url: "https://500.co/founders/flagship",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
