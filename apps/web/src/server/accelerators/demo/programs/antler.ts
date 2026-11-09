import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["idea", "pre_seed"],
    generalist: false,
    sectors: ["ai", "b2b_software", "consumer", "fintech", "climate", "deep_tech", "healthcare"],
    regions: ["global"],
    format: "Location-dependent; U.S. residency is in person in San Francisco, New York City, or Austin",
    durationWeeks: null,
    contact: { email: null, phone: null, contactUrl: null },
    applyRoutes: ["online_application", "rolling_application"],
    batches: {
        cadence:
            "Location-dependent; the U.S. residency has monthly intake and reviews applications year-round",
        next: null,
        recent: [],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary:
            "Location-specific investment terms; U.S. initial commitment typically $500k–$1m following investment approval",
        cashUsd: null,
        equityPercent: null,
        instrument: null,
        terms: `## Investment depends on location and selection

Antler does not publish a single global standard check size or equity stake. Its explanation of the residency model says:

- Founders may pitch Antler's **Investment Committee** for pre-seed capital.
- **If successful**, founders receive funding for an equity stake. Residency admission is not a guaranteed investment.
- Each location's **check size and stake may vary**. Antler says it shares its full term sheet when accepting a founder into a residency.

That explanation was published **August 31, 2023**; the current U.S. location page below supplies the U.S. figures rather than treating historical checks as current global terms.

## U.S. offer — not a global deal

- The current U.S. page describes an initial commitment typically between **$500,000 and $1 million**, plus **$650,000 in partner credits**.
- Residents pitch the Investment Committee for the opportunity to receive that commitment. Investment is not promised to every resident.
- There is **no fee to join the U.S. Antler Residency**.
- The checked U.S. page does not specify the current equity percentage, instrument, valuation, or detailed investor rights. Those values remain unknown rather than importing an older U.S. deal.
- Partner credits are not investment cash.

## Beyond the first check

Antler describes continued support and potential follow-on funding as companies grow. These opportunities do not establish a guaranteed additional check for every participant.

[Antler's location-dependent investment model](https://www.antler.co/blog/antler-beyond-traditional-vc) · [Current U.S. offer](https://www.antler.co/location/us)`,
    },
    sources: [
        {
            title: "Antler — global early-stage investor",
            url: "https://www.antler.co/",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "Antler U.S. — current investment opportunity, residency, cadence, applicant sectors, and fee",
            url: "https://www.antler.co/location/us",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "Antler beyond traditional VC — August 31, 2023 model explanation and location-specific terms",
            url: "https://www.antler.co/blog/antler-beyond-traditional-vc",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "Antler Pitch Us — current public application destination",
            url: "https://www.antler.co/pitch",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
    ],
};
