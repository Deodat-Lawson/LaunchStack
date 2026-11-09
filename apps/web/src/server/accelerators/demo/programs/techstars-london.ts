import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["pre_seed", "seed"],
    generalist: true,
    sectors: [],
    regions: ["global"],
    format: "Three-month mentorship-driven accelerator in London",
    durationWeeks: null,
    contact: { email: null, phone: null, contactUrl: "https://www.techstars.com/contact" },
    applyRoutes: ["online_application"],
    batches: {
        cadence: null,
        next: {
            label: "London — March 2027",
            deadline: "2026-11-18",
            deadlineKind: "announced",
        },
        recent: [],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary: "$220,000: $20,000 for 5% common equity plus a $200,000 uncapped MFN SAFE",
        cashUsd: 220000,
        equityPercent: 5,
        instrument:
            "Post-money Convertible Equity Agreement (CEA) plus uncapped MFN SAFE and side letter",
        terms: `## $220,000 at acceptance

Techstars' current standard accelerator investment consists of **$20,000 through a post-money Convertible Equity Agreement (CEA)** and **$200,000 through an uncapped MFN SAFE**, plus a side letter. The total ownership is **5% common equity plus the future ownership from the SAFE**; $220,000 is not simply exchanged for 5%.

## $20,000 fixed-percentage CEA

At a priced round of **at least $1M**, the CEA converts into common stock equal to **5% of the company's equity, including the existing option pool**, after SAFEs and other convertibles have converted alongside the round. The CEA and SAFE are diluted by the priced round's new money and any option-pool increases.

## $200,000 uncapped MFN SAFE

The SAFE also converts at a priced round of **at least $1M**. It has no predetermined valuation cap or limit on the conversion valuation. It automatically adopts the lowest-cap SAFE terms, or other most favorable terms such as a discount, issued between the MFN start date and the priced round. Additional ownership from this instrument cannot be determined from the initial fixed 5% figure.

## Side letter and incorporation

The side letter establishes pro rata, digital-assets and drag-along rights, along with regulatory and tax matters. The ongoing relationship includes rights to invest in future financings, company reporting on operating metrics and burn, and obligations at a priced round or exit.

Techstars invests in U.S. corporations or approved foreign equivalents. Companies incorporated in non-approved countries must complete a reorganization before investment. The lower Asia-Pacific investment exception is not applied to London.

## London schedule

The London page welcomes early-stage founders worldwide across all verticals. Its published schedule gives **November 18, 2026** as the final application deadline, **March 8, 2027** as the accelerator start and **June 3, 2027** as Demo Day. No exact deadline time or timezone is published on that page, so the deadline is kept date-only.

[Source: Techstars investment terms](https://www.techstars.com/investment-terms) · [London Program and dates](https://www.techstars.com/accelerators/london)`,
    },
    sources: [
        {
            title: "Techstars London — official audience, three-month support, application deadline and 2027 dates",
            url: "https://www.techstars.com/accelerators/london",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "Techstars — current accelerator investment structure, conversion, MFN, side letter and incorporation terms",
            url: "https://www.techstars.com/investment-terms",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
