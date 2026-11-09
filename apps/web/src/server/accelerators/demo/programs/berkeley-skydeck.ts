import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["pre_seed", "seed"],
    generalist: true,
    sectors: ["biotech", "healthcare", "hardware", "deep_tech", "fintech", "climate"],
    regions: ["global"],
    format: "Six-month Accelerator Cohort with designated workspace and required events at Berkeley SkyDeck",
    durationWeeks: null,
    contact: { email: "SkyDeck@Berkeley.edu", phone: null, contactUrl: null },
    applyRoutes: ["online_application"],
    batches: {
        cadence: "A new Accelerator Cohort every six months",
        next: null,
        recent: [
            "Batch 23 — November 2, 2026 to April 15, 2027; application deadline August 21, 2026",
        ],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary: "$210,000 for 7.25%, plus a $7,500 Cohort Program fee",
        cashUsd: 210000,
        equityPercent: 7.25,
        instrument: "Standard post-money cap SAFE, or another form as needed",
        terms: `## Accelerator Cohort investment

The current general Program FAQ states that the Berkeley SkyDeck Fund will invest **$210K for 7.25%** in companies accepted into the six-month Cohort Program. This can be structured as a **standard post-money cap SAFE, or other forms as needed**.

The Fund also has the **option to invest up to 10% of the first institutional funding round**. That option is not an additional fixed 10% ownership stake and is separate from the initial 7.25% investment.

## Fee and investment review

SkyDeck charges **a $7.5K Program fee to each Cohort startup**. The $210K is the stated gross investment, not a net-of-fee cash figure.

The Berkeley SkyDeck Fund has its own investment review process for legal reasons. SkyDeck's selection process is designed to identify teams eligible for investment; each company selected for investment receives $210K. Admission should not be represented as an unconditional payment guarantee.

## Scope and differing published figures

This record describes the funded **Accelerator Cohort**, not Pad-13 or the Innovation Partners Program. Their fees, investments and participation rights differ.

Some older specialized-track copy on the same official Program page still advertises **$200K** (including the Bio+Health and Chip & Quantum sections). This record uses the general FAQ's **$210K / 7.25%** and $7.5K Cohort fee rather than combining inconsistent offers. Track-specific terms should be confirmed directly with SkyDeck.

## Timing

Batch 23 runs November 2, 2026–April 15, 2027, with a past date-only application deadline of August 21, 2026. The application page says **Batch 24 applications open in January** but does not publish their exact opening date, deadline or calendar year in that announcement. No next deadline is inferred.

[Source: Program FAQ, investment review, fees and specialized-track copy](https://skydeck.berkeley.edu/program/) · [Application page and schedules](https://skydeck.berkeley.edu/apply/)`,
    },
    sources: [
        {
            title: "Berkeley SkyDeck — Accelerator overview, general FAQ terms, fees, investment review, tracks and public contact",
            url: "https://skydeck.berkeley.edu/program/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "Berkeley SkyDeck — application eligibility, Batch 23 dates and Batch 24 announcement",
            url: "https://skydeck.berkeley.edu/apply/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
