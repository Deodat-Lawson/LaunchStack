import type { IllustrativeFit } from "~/app/employer/tools/accelerators/_lib/demo";

/**
 * Hand-written, illustrative fit for the synthetic Northwind demo company only
 * (UK cold-chain monitoring hardware and software, founded 2014, 112 people).
 * Stand-in for Workstream 2's scorer; ratings use the anchors 0/25/50/75/100
 * and leave unknown evidence null. Northwind's profile states no funding needs,
 * so deal compatibility is unknown everywhere rather than guessed.
 */
const DEAL_UNKNOWN = {
    score: null,
    applicable: true,
    note: "The profile states no funding needs or dilution limits, so the terms cannot be compared.",
};
const NOT_SUPPORTED = {
    score: null,
    applicable: false,
    note: "Past-company data is collected only for Supported accelerators (Y Combinator in this demo).",
};
const STAGE_ESTABLISHED =
    "Northwind was founded in 2014 and has 112 employees; this Program backs much earlier companies.";

export const NORTHWIND_FITS: Record<string, IllustrativeFit> = {
    "y-combinator": {
        eligibility: "unknown",
        eligibilityNote:
            "YC invests in U.S., Canadian, Cayman or Singapore corporations. Northwind is UK-based and would need to change its structure.",
        dimensions: {
            sector: {
                score: 50,
                applicable: true,
                note: "Generalist; funds hardware and logistics but states no cold-chain focus.",
            },
            stage: { score: 25, applicable: true, note: STAGE_ESTABLISHED },
            businessModel: {
                score: 75,
                applicable: true,
                note: "B2B hardware plus subscription software is common among YC companies.",
            },
            portfolio: {
                score: 75,
                applicable: true,
                note: "Close past companies include Fresh Factory (W22, cold-chain fulfilment) and other logistics and hardware-monitoring startups.",
            },
            deal: DEAL_UNKNOWN,
            operations: {
                score: 25,
                applicable: true,
                note: "Three months in person in San Francisco; Northwind's team is in Leeds.",
            },
            value: {
                score: 50,
                applicable: true,
                note: "Strong network and fundraising support; no cold-chain specialism.",
            },
        },
    },
    "techstars-london": {
        eligibility: "eligible",
        eligibilityNote: "No published requirement that Northwind is known to fail.",
        dimensions: {
            sector: { score: 50, applicable: true, note: "Generalist London program." },
            stage: { score: 25, applicable: true, note: STAGE_ESTABLISHED },
            businessModel: { score: 75, applicable: true, note: "Backs B2B companies." },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: 75,
                applicable: true,
                note: "Runs in London, a short trip from Leeds.",
            },
            value: {
                score: 50,
                applicable: true,
                note: "UK investor and mentor network; no stated food-logistics track.",
            },
        },
    },
    "a16z-speedrun": {
        eligibility: "unknown",
        eligibilityNote:
            "Expects founders to build full-time in San Francisco; relocation is unconfirmed.",
        dimensions: {
            sector: {
                score: 25,
                applicable: true,
                note: "Stated focus areas (AI, robotics, fintech, consumer, B2B software) only partly overlap cold-chain hardware.",
            },
            stage: { score: 25, applicable: true, note: STAGE_ESTABLISHED },
            businessModel: {
                score: 50,
                applicable: true,
                note: "B2B software is in scope; hardware less so.",
            },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: 25,
                applicable: true,
                note: "Twelve weeks in person in San Francisco.",
            },
            value: {
                score: 25,
                applicable: true,
                note: "Consumer and games network is less relevant.",
            },
        },
    },
    antler: {
        eligibility: "unknown",
        eligibilityNote:
            "Built around founders forming new teams; an existing company's eligibility is unconfirmed.",
        dimensions: {
            sector: {
                score: 50,
                applicable: true,
                note: "Broad sector list including climate and deep tech.",
            },
            stage: {
                score: 0,
                applicable: true,
                note: "Backs founders at idea and pre-seed, before they have a company; Northwind is long established.",
            },
            businessModel: { score: 50, applicable: true, note: "B2B in scope." },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: 50,
                applicable: true,
                note: "Location-dependent residencies, including some outside the U.S.",
            },
            value: {
                score: 25,
                applicable: true,
                note: "Team-formation support Northwind no longer needs.",
            },
        },
    },
    "entrepreneurs-first": {
        eligibility: "unknown",
        eligibilityNote: "Designed for individuals before they have a co-founder or company.",
        dimensions: {
            sector: { score: 50, applicable: true, note: "Generalist, with deep-tech strength." },
            stage: {
                score: 0,
                applicable: true,
                note: "Backs individuals before company formation; Northwind is a 112-person company.",
            },
            businessModel: { score: 50, applicable: true, note: "No stated preference." },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: { score: 50, applicable: true, note: "London pathway available." },
            value: { score: 25, applicable: true, note: "Co-founder matching is the core value." },
        },
    },
    "500-global": {
        eligibility: "unknown",
        eligibilityNote: "No published requirement that Northwind is known to fail.",
        dimensions: {
            sector: { score: 50, applicable: true, note: "No stated sector restriction found." },
            stage: { score: 25, applicable: true, note: STAGE_ESTABLISHED },
            businessModel: { score: 50, applicable: true, note: "No stated preference." },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: 25,
                applicable: true,
                note: "Four months in person in San Francisco.",
            },
            value: { score: 50, applicable: true, note: "Large global investor network." },
        },
    },
    "south-park-commons": {
        eligibility: "unknown",
        eligibilityNote: "The Fellowship targets founders at idea or pre-seed stage.",
        dimensions: {
            sector: { score: 50, applicable: true, note: "Generalist." },
            stage: {
                score: 0,
                applicable: true,
                note: "Backs founders exploring ideas; Northwind is long established.",
            },
            businessModel: { score: 50, applicable: true, note: "No stated preference." },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: 25,
                applicable: true,
                note: "Eight weeks in San Francisco, New York or Bangalore.",
            },
            value: {
                score: 25,
                applicable: true,
                note: "Exploration community less relevant to a scaling company.",
            },
        },
    },
    "berkeley-skydeck": {
        eligibility: "unknown",
        eligibilityNote: "No published requirement that Northwind is known to fail.",
        dimensions: {
            sector: {
                score: 75,
                applicable: true,
                note: "Lists hardware and climate among its sectors.",
            },
            stage: { score: 25, applicable: true, note: STAGE_ESTABLISHED },
            businessModel: {
                score: 75,
                applicable: true,
                note: "Hardware plus software companies are in scope.",
            },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: 25,
                applicable: true,
                note: "Six months with required events in Berkeley.",
            },
            value: {
                score: 50,
                applicable: true,
                note: "University research network and advisors.",
            },
        },
    },
    hax: {
        eligibility: "unknown",
        eligibilityNote: "No published requirement that Northwind is known to fail.",
        dimensions: {
            sector: {
                score: 100,
                applicable: true,
                note: "Hardware-focused program; temperature probes are core hardware.",
            },
            stage: { score: 25, applicable: true, note: STAGE_ESTABLISHED },
            businessModel: {
                score: 75,
                applicable: true,
                note: "Hardware with recurring software revenue.",
            },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: null,
                applicable: true,
                note: "Residency location and length for Northwind are unconfirmed.",
            },
            value: {
                score: 75,
                applicable: true,
                note: "Engineering and manufacturing support suits a hardware product.",
            },
        },
    },
    masschallenge: {
        eligibility: "eligible",
        eligibilityNote:
            "Accepts companies up to Series A; no published requirement Northwind is known to fail.",
        dimensions: {
            sector: {
                score: 75,
                applicable: true,
                note: "Food and agriculture and climate are named focus areas.",
            },
            stage: {
                score: 50,
                applicable: true,
                note: "Accepts later-stage startups than most programs, though Northwind is still beyond its usual range.",
            },
            businessModel: { score: 75, applicable: true, note: "B2B in scope." },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: null,
                applicable: true,
                note: "A track Northwind could attend from the UK is unconfirmed.",
            },
            value: {
                score: 50,
                applicable: true,
                note: "Corporate-partner introductions in food and logistics.",
            },
        },
    },
    alchemist: {
        eligibility: "unknown",
        eligibilityNote: "No published requirement that Northwind is known to fail.",
        dimensions: {
            sector: {
                score: 50,
                applicable: true,
                note: "Generalist with AI and deep-tech emphasis.",
            },
            stage: { score: 25, applicable: true, note: STAGE_ESTABLISHED },
            businessModel: { score: 75, applicable: true, note: "Enterprise and B2B focus." },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: 75,
                applicable: true,
                note: "Build from anywhere; no relocation required.",
            },
            value: { score: 50, applicable: true, note: "Enterprise sales network." },
        },
    },
    "abovea-startup-accelerator": {
        eligibility: "unknown",
        eligibilityNote: "Geographic and stage requirements are not published.",
        dimensions: {
            sector: { score: null, applicable: true, note: "No sector focus is published." },
            stage: {
                score: 0,
                applicable: true,
                note: "Targets idea-stage founders; Northwind is long established.",
            },
            businessModel: {
                score: null,
                applicable: true,
                note: "No business-model preference is published.",
            },
            portfolio: NOT_SUPPORTED,
            deal: DEAL_UNKNOWN,
            operations: {
                score: null,
                applicable: true,
                note: "Delivery-location requirements are not published.",
            },
            value: { score: 25, applicable: true, note: "Early-stage curriculum." },
        },
    },
};
