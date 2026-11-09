import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    stages: ["pre_seed", "seed", "series_a"],
    generalist: false,
    sectors: ["healthcare", "biotech", "fintech", "climate", "food_agriculture"],
    regions: ["global"],
    format: "Varies by program: the 2026–2027 Challenge Cycle requires Boston events; SMU Cox combines virtual programming with three Dallas immersions.",
    durationWeeks: null,
    contact: {
        email: "programs@masschallenge.org",
        phone: null,
        contactUrl: "https://masschallenge.org/2026-2027-challenge-cycle/",
    },
    applyRoutes: ["online_application"],
    batches: {
        cadence: "Program-specific cohorts; no single organization-wide intake calendar.",
        next: {
            label: "2026–2027 Challenge Cycle — published date only; cutoff time not stated",
            deadline: "2026-11-09",
            deadlineKind: "announced",
        },
        recent: [],
    },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: {
        summary:
            "Equity-free accelerator support; no uniform guaranteed cash investment published.",
        cashUsd: null,
        equityPercent: 0,
        instrument: null,
        terms: `## Equity-free support

MassChallenge's official equity article says it assists startups with growth, resources, and industry-leading mentors **but does not take equity**.

The **2026 Security & Resiliency Traction Program** FAQ is more specific: it is a **no-cost, non-dilutive accelerator**, with **no program fee and no equity taken**. Its travel costs are self-funded; the FAQ says there are no travel reimbursements or stipends. Those fee and travel statements describe that program, not an independently verified universal policy for every MassChallenge offering.

## Commercial support is not a guaranteed investment

MassChallenge's Traction programs focus on go-to-market, strategic exposure, and early commercialization. Its Challenge programs create opportunities for design partnerships, pilots, proofs of concept, and commercialization with corporate partners. The checked pages do not publish a uniform guaranteed investment, prize amount, SAFE, or investment valuation for every accepted startup. **Cash is unknown, not zero and not a promised award.**

## Current opportunities have separate requirements

- **2026–2027 Challenge Cycle:** apply by **November 9, 2026**; no cutoff time or timezone is published. The program runs February–June 2027. At least one founder or C-suite team member must attend the required Boston events, including finalist matchmaking on January 6–8 and kickoff on February 9–10. The detailed time-commitment answer identifies a virtual mid-program day in April, while another FAQ answer describes the mid-program session as in person; confirm that requirement with the team.
- **SMU Cox FinTech Accelerator:** separate **November 19, 2026** application deadline, a stated **16-week hybrid program**, and three required Dallas immersions. These dates and duration are not an organization-wide MassChallenge schedule.

Sources: [equity policy](https://masschallenge.org/articles/equity-compensation/), [Security & Resiliency economics](https://masschallenge.org/security-and-resiliency-traction-2026/), [accelerator families](https://masschallenge.org/our-accelerators/), [Challenge Cycle](https://masschallenge.org/2026-2027-challenge-cycle/), and [SMU Cox FinTech](https://masschallenge.org/smu-cox-fintech-accelerator/).`,
    },
    sources: [
        {
            title: "MassChallenge — current focus areas",
            url: "https://masschallenge.org/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "MassChallenge — accelerator families and stages",
            url: "https://masschallenge.org/our-accelerators/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "MassChallenge — equity-free policy",
            url: "https://masschallenge.org/articles/equity-compensation/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "2026 Security & Resiliency Traction — participation costs",
            url: "https://masschallenge.org/security-and-resiliency-traction-2026/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "2026–2027 Challenge Cycle — dates, eligibility, travel, and public contact",
            url: "https://masschallenge.org/2026-2027-challenge-cycle/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "SMU Cox FinTech Accelerator — separate deadline and hybrid format",
            url: "https://masschallenge.org/smu-cox-fintech-accelerator/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "MassChallenge Challenge programs — commercial collaboration",
            url: "https://masschallenge.org/challenge-program/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
