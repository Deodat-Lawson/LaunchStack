import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["idea", "pre_seed"],
    generalist: true,
    sectors: [],
    regions: ["north_america", "europe", "asia_pacific"],
    format: "Pathway-dependent: London or Bangalore FORM, then San Francisco LAUNCH for funded teams; separate U.S. and European residency routes",
    durationWeeks: null,
    contact: { email: null, phone: null, contactUrl: null },
    applyRoutes: ["online_application", "rolling_application"],
    batches: {
        cadence: "Rolling application review; timing and duration depend on pathway",
        next: null,
        recent: [],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary:
            "Up to $250k: $125k for 8% plus optional $125k uncapped MFN SAFE; equity-free grants vary by pathway",
        cashUsd: 250000,
        equityPercent: 8,
        instrument:
            "Post-money SAFE plus optional uncapped MFN SAFE; equivalent local instruments where applicable",
        terms: `## Company investment: up to $250,000

The London and Bangalore FAQs describe an Investment Committee decision at the end of **FORM (the first 12 weeks)**. The U.S. funding pathway instead advertises investment **on day one**. These are distinct pathways, not one uniform investment timeline.

- **$125,000 from EF for 8%** through a post-money SAFE. The London terms say this converts immediately before a priced round issuing preferred shares; it is diluted by that round, but not by warrants, employee share option pools, or other convertible investments.
- **An optional further $125,000** from EF and its partner **Transpose Platform**, through an **uncapped Most Favoured Nation (MFN) SAFE**. This is available if the team relocates to San Francisco for LAUNCH and incorporates as a **Delaware C-corp**; the U.S. FAQ states the same relocation and incorporation conditions.
- The MFN SAFE converts in the same priced round at that round's price, unless another SAFE has a discount or cap, in which case it inherits the SAFE terms giving it the best outcome.
- The fixed **8% applies only to the first $125,000**. The optional MFN investment adds equity on conversion; the entire $250,000 is not exchanged for a fixed 8%.

## Equity-free financial support

- **London:** a **£6,000 Talent Investment**, upon signing the offer, subject to required KYC and an appropriate visa if applicable. It can cover living or company costs during FORM. If no company is formed or EF does not invest further, no equity is taken and nothing is owed back.
- **Bangalore:** an **INR 360,000 Talent Investment**, subject to KYC and visa conditions. The FAQ reports **10% tax deducted at source as of April 2026**. If no company is formed or EF does not invest further, no equity is taken and nothing is owed back.
- **U.S. exploratory Fellowship:** an **equity-free $10,000 grant** and housing for three months. It supports exploring ideas and cofounders before potentially progressing to the full investment pathway; it does not guarantee the $250,000 investment.

## Local instruments and final documentation

- Where incorporated in France, the UK, or India, EF says it uses equivalent local instruments: **BSA Air**, **Convertible Loan Note**, or **Compulsory Convertible Preference Shares**, respectively.
- Further details on timing, EF's standard investor rights, and a cap-table calculator are provided with an offer. The public FAQ is not the complete legal documentation.
- London and Bangalore routes are **12 weeks FORM plus 12 weeks LAUNCH for funded teams**. The U.S. pathway describes three months in San Francisco; the Europe FAQ describes a separate eight-week Bay Area route. No single Program-wide duration is inferred.

[London terms](https://www.joinef.com/faqs/london/) · [Bangalore terms](https://www.joinef.com/faqs/bangalore/) · [U.S. terms](https://www.joinef.com/faqs/us/) · [Europe pathway](https://www.joinef.com/faqs/europe/)`,
    },
    sources: [
        {
            title: "EF General FAQs — individual applicants, commitment, hubs, rolling review, and conditional investment",
            url: "https://www.joinef.com/faqs/",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "EF London FAQs — grant, 12+12-week format, detailed SAFE terms, conditions, and local instruments",
            url: "https://www.joinef.com/faqs/london/",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "EF Bangalore FAQs — grant, tax deduction, format, and investment terms",
            url: "https://www.joinef.com/faqs/bangalore/",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "EF U.S. FAQs — day-one funding, fellowship, rolling applications, and sector-agnostic investing",
            url: "https://www.joinef.com/faqs/us/",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
        {
            title: "EF Europe FAQs — separate eight-week Bay Area residency",
            url: "https://www.joinef.com/faqs/europe/",
            checkedAt: "2026-11-07T00:00:00.000Z",
        },
    ],
};
