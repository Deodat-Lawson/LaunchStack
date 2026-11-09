import type { ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";

export const details: ProgramDetails = {
    operatingStatus: "active",
    // The pages explicitly welcome ideas and MVPs but do not define funding-round eligibility.
    stages: ["idea"],
    // No explicit any-sector policy or sector taxonomy was established on the checked pages.
    generalist: false,
    sectors: [],
    regions: [],
    format: "Flexible-paced, hands-on work with team feedback; designed for at least 10 focused hours weekly, with a computer and stable internet. Location requirements are unconfirmed.",
    durationWeeks: 12,
    contact: {
        email: null,
        phone: null,
        contactUrl: "https://abovea.tech/contact-us-2/",
    },
    applyRoutes: ["online_application"],
    batches: { cadence: null, next: null, recent: [] },
    selectivity: { acceptanceRatePercent: null, note: null },
    deal: null,
    sources: [
        {
            title: "aboveA Startup Accelerator — idea and MVP routes, flexible 12-week design, and requirements",
            url: "https://abovea.tech/academy/main/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "aboveA — Idea to Launch route for early-stage startups",
            url: "https://abovea.tech/academy/idea-to-launch-early-stage-startups/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "aboveA — Business acceleration route for founders with a working product",
            url: "https://abovea.tech/academy/startup-acceleration-for-late-stage-startups/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "aboveA — public startup application entry point; no published intake dates",
            url: "https://abovea.tech/academy/accelerator-application-form/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
        {
            title: "aboveA — public contact form",
            url: "https://abovea.tech/contact-us-2/",
            checkedAt: "2026-11-07T00:00:00Z",
        },
    ],
};
