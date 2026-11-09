import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["pre_seed", "seed"],
    generalist: false,
    sectors: ["hardware", "deep_tech", "climate", "healthcare", "robotics", "biotech"],
    regions: ["global"],
    format: "Six-month residency anchored in Newark, New Jersey, with engineering and manufacturing support from Pune and Shenzhen; technical development can take longer.",
    durationWeeks: null,
    contact: { email: null, phone: null, contactUrl: "https://hax.co/contact/" },
    applyRoutes: ["online_application", "rolling_application"],
    batches: {
        cadence: "Rolling investment and intake; typically 2–3 teams admitted each month.",
        next: null,
        recent: [],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary:
            "Up to $550,000 initial pre-seed funding advertised; current cash split and fixed ownership are unconfirmed.",
        cashUsd: null,
        equityPercent: null,
        instrument: "Post-money SAFEs; exact company-specific terms require confirmation",
        terms: `## Advertised initial funding

The current HAX program page advertises **up to $550,000 in initial pre-seed funding**, structured to reach critical technical milestones. It also describes follow-on participation and investor-network access. **“Up to” is a ceiling, not a guaranteed check or an established all-cash amount.**

## SOSV's published investment structure

SOSV's legal FAQ says its program investments are **typically two separate SAFEs**:

- **Cash SAFE:** cash paid directly to the company, usually in tranches tied to time or milestones. It converts using the stated valuation cap or discount, whichever produces more shares for the investor.
- **Program SAFE:** program costs are paid directly to the program on the company's behalf, covering facilities, equipment, in-house technical support, mentorship, and investor access. It converts to a **fixed percentage** of preferred equity. The checked pages do not state the numerical percentage applicable to a new HAX investment.
- **Possible Additional Cash SAFE:** the legal FAQ describes possible additional investment of **$250,000 at a $6 million post-money cap and 20% discount**, at SOSV's sole discretion and contingent on performance and milestones. The page itself calls this a “further fixed percentage SAFE investment” while also specifying a cap and discount; this record does not resolve that wording into a guaranteed fixed ownership stake.

## Conflicting public deal descriptions

The HAX FAQ's older detailed Deal section still says the first investment is **$250,000**, comprising **$150,000 cash and $100,000 in-kind support**, paid at thirty-day intervals. It describes a post-money SAFE with no valuation cap and a pre-negotiated target ownership stake. That is not a verified breakdown of the current program page's **up to $550,000** offer, and its single-SAFE description differs from SOSV's typical Cash SAFE plus Program SAFE structure.

For that reason, **the current cash amount and fixed equity percentage are left unknown**, not filled from the older FAQ or calculated from an investment cap. Confirm the actual offer, tranches, program costs, fixed ownership, valuation cap, and discount with HAX before evaluating a deal.

## Residency and technical work

The current program page describes a **six-month residency** anchored in Newark. The FAQ separately describes **6–18 months** of technical de-risking depending on product complexity. These are different measures; no single exact duration in weeks is asserted.

Sources: [current HAX program](https://hax.co/program/), [HAX FAQ](https://hax.co/faq/), and [SOSV legal FAQ](https://sosv.com/legal-faqs/).`,
    },
    sources: [
        {
            title: "HAX — SOSV affiliation and pre-seed hard-tech focus",
            url: "https://hax.co/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "HAX Program — advertised funding, six-month residency, and engineering support",
            url: "https://hax.co/program/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "HAX FAQ — hardware fit, rolling intake, older deal, and technical development period",
            url: "https://hax.co/faq/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "SOSV Legal FAQs — typical Cash SAFE, Program SAFE, and discretionary additional cash",
            url: "https://sosv.com/legal-faqs/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "SOSV — public HAX application entry point",
            url: "https://sosv.com/apply/hax/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "HAX — public contact form and worldwide startup reach",
            url: "https://hax.co/contact/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
