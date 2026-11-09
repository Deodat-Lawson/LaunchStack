import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["idea", "pre_seed"],
    generalist: true,
    sectors: [],
    regions: ["global"],
    format: "Eight-week in-person bootcamp in San Francisco, New York City, or Bangalore, followed by open-ended Fellow Residency",
    durationWeeks: null,
    contact: { email: null, phone: null, contactUrl: null },
    applyRoutes: ["online_application"],
    batches: {
        cadence: "Two Fellowship cohorts per year: spring and fall",
        next: null,
        recent: ["Fall 2026 — bootcamp late September to late November; applications closed"],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary: "$400,000 upfront for 7% on a SAFE, plus $600,000 in the next external round",
        cashUsd: 400000,
        equityPercent: 7,
        instrument:
            "Standard SAFE for the initial investment; follow-on investment in the next external funding round",
        terms: `## Founder Fellowship investment

SPC publishes **$400K upfront for 7% on a standard SAFE, plus $600K guaranteed in the next external funding round**. The advertised $1M total therefore includes follow-on capital; it is not all paid upfront and is not all exchanged for a fixed 7%.

The initial SAFE accounts for the published 7% equity. The checked pages do not establish the valuation or additional ownership associated with the $600K follow-on, so the final total dilution is unknown.

Teams are funded immediately on acceptance, without waiting for bootcamp. SPC also advertises up to $1M in partner credits and perks; those are not cash investment.

## Fellowship versus Member Residency

The funded Fellowship has no fixed end date: an **eight-week in-person bootcamp** is followed by Fellow Residency for as long as needed. Fellows work from San Francisco, New York City or Bangalore during bootcamp, with a kickoff in Northern California and San Francisco.

The separate **Member Residency** is six months, fee-free and equity-free. Its lack of equity rights should not be confused with the funded Fellowship's SAFE terms. SPC's FAQ states that membership has no fees or dues.

## Application timing

Fall 2026 applications are closed. SPC says Spring 2027 Fellowship applications will open later in 2026 but does not publish an exact deadline on the checked application page. General rolling community applications are not evidence that Fellowship cohort deadlines are rolling.

[Source: Fall 2026 Founder Fellowship and terms](https://www.southparkcommons.com/news/f26-founder-fellowship) · [FAQ](https://www.southparkcommons.com/faq) · [Current application availability](https://www.southparkcommons.com/apply)`,
    },
    sources: [
        {
            title: "SPC Founder Fellowship Fall 2026 — funding terms, applicants, bootcamp and residency",
            url: "https://www.southparkcommons.com/news/f26-founder-fellowship",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "SPC FAQ — Fellowship cadence, investment timing and membership fees",
            url: "https://www.southparkcommons.com/faq",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "SPC application page — Fall 2026 closed, Spring 2027 opening later in 2026",
            url: "https://www.southparkcommons.com/apply",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
