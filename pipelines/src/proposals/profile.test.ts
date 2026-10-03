/**
 * The proposal stages read the company profile through `orgProfileFromView`:
 * the same facts and excerpt numbers the profile page shows, plus people,
 * products and projects folded into facts a draft can name.
 */
import { describe, expect, it } from "vitest";

import type { ProfileView } from "../company-metadata";

import { orgProfileFromView } from "./profile";
import { formatProfileBlock } from "./stages";

const VIEW: ProfileView = {
    summary: "Riverbend runs after-school reading programmes.",
    summaryCites: [1],
    applicantType: "nonprofit",
    focusAreas: ["youth literacy"],
    geography: ["Portland, Oregon"],
    markets: ["K-12 schools"],
    facts: [
        {
            path: "company.founded_year",
            key: "founded_year",
            label: "Founded",
            value: "2014",
            cites: [1],
            source: "documents",
        },
        {
            path: "profile.facts.annual_budget",
            key: "annual_budget",
            label: "Annual budget",
            value: "$1.2m in FY2025",
            cites: [],
            source: "manual",
        },
    ],
    people: [
        {
            path: "people.0",
            name: "Ana Ruiz",
            detail: "Executive Director",
            detailPath: "people.0.role",
            cites: [2],
            source: "documents",
        },
    ],
    services: [],
    projects: [],
    evidence: [
        {
            n: 1,
            documentId: 11,
            title: "Annual report",
            page: 2,
            quote: "Founded in 2014, Riverbend…",
        },
        { n: 2, documentId: 12, title: "Team", page: null, quote: "Ana Ruiz, Executive Director" },
    ],
    documents: 2,
};

describe("orgProfileFromView", () => {
    it("keeps the profile's facts and excerpt numbers and folds people into a Team fact", () => {
        const profile = orgProfileFromView(VIEW, new Date("2026-10-03T00:00:00Z"));
        expect(profile.summary).toBe(VIEW.summary);
        expect(profile.applicantType).toBe("nonprofit");
        expect(profile.facts.map(f => [f.key, f.value, f.cites, f.source])).toEqual([
            ["founded_year", "2014", [1], "documents"],
            ["annual_budget", "$1.2m in FY2025", [], "manual"],
            ["team", "Ana Ruiz — Executive Director", [2], "documents"],
            ["markets", "K-12 schools", [], "documents"],
        ]);
        expect(profile.evidence.map(e => [e.n, e.url])).toEqual([
            [1, null],
            [2, null],
        ]);
        expect(profile.builtFrom).toEqual({ documents: 2, snippets: 2 });
        expect(formatProfileBlock(profile)).toContain("- Team: Ana Ruiz — Executive Director");
    });

    it("reads an empty profile as 'any' applicant with no facts", () => {
        const profile = orgProfileFromView(
            {
                ...VIEW,
                summary: null,
                applicantType: null,
                facts: [],
                people: [],
                markets: [],
                evidence: [],
            },
            new Date()
        );
        expect(profile.applicantType).toBe("any");
        expect(profile.summary).toBe("");
        expect(profile.facts).toEqual([]);
    });
});
