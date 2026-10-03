import { describe, expect, it } from "vitest";

import { requirementsFromExtracted, sanitizeExtracted, toggleRequirement } from "./requirements";
import type { ExtractedRequest } from "./types";

const RAW: ExtractedRequest = {
    title: "  Community Resilience Fund  ",
    funder: "Meyer Memorial Trust",
    summary: "Grants  for   Oregon nonprofits.",
    deadline: "June 30, 2026",
    amountMin: 150_000,
    amountMax: 25_000.4,
    eligibility: ["501(c)(3) status", " 501(c)(3) status ", "", "Based in Oregon"],
    sections: [
        {
            key: "",
            question: "Describe your organization's mission & history.",
            guidance: null,
            wordLimit: 250.4,
            required: true,
        },
        {
            key: "Organization Mission & History",
            question: "Describe your organization's mission & history.",
            guidance: "Include founding year.",
            wordLimit: 0,
            required: false,
        },
        { key: "budget", question: "   ", guidance: null, wordLimit: null, required: true },
    ],
    attachments: ["Budget", "budget", "IRS determination letter"],
    format: ["PDF only"],
};

describe("sanitizeExtracted", () => {
    it("slugs keys, keeps them unique, and cleans limits, lists and money", () => {
        const clean = sanitizeExtracted(RAW);
        expect(clean.title).toBe("Community Resilience Fund");
        expect(clean.deadline).toBe("2026-06-30");
        // The model swapped floor and ceiling; the smaller one is the floor.
        expect(clean.amountMin).toBe(25_000);
        expect(clean.amountMax).toBe(25_000);
        expect(clean.eligibility).toEqual(["501(c)(3) status", "Based in Oregon"]);
        expect(clean.sections.map(s => s.key)).toEqual([
            "describe-your-organization-s-mission-history",
            "organization-mission-history",
        ]);
        expect(clean.sections[0]!.wordLimit).toBe(250);
        expect(clean.sections[1]!.wordLimit).toBeNull();
        expect(clean.sections[1]!.required).toBe(false);
        expect(clean.attachments).toEqual(["Budget", "IRS determination letter"]);
        expect(clean.summary).toBe("Grants for Oregon nonprofits.");
    });

    it("gives two identical questions distinct keys", () => {
        const clean = sanitizeExtracted({
            ...RAW,
            sections: [
                {
                    key: "goals",
                    question: "Goals",
                    guidance: null,
                    wordLimit: null,
                    required: true,
                },
                {
                    key: "goals",
                    question: "Goals",
                    guidance: null,
                    wordLimit: null,
                    required: true,
                },
            ],
        });
        expect(clean.sections.map(s => s.key)).toEqual(["goals", "goals-2"]);
    });
});

describe("requirementsFromExtracted", () => {
    it("lists eligibility, deadline, budget, sections, attachments and format with stable ids", () => {
        const rows = requirementsFromExtracted(sanitizeExtracted(RAW));
        expect(rows.map(r => r.kind)).toEqual([
            "eligibility",
            "eligibility",
            "deadline",
            "budget",
            "section",
            "section",
            "attachment",
            "attachment",
            "format",
        ]);
        expect(rows.find(r => r.kind === "budget")!.text).toBe(
            "Request between $25,000 and $25,000"
        );
        const section = rows.find(r => r.sectionKey === "organization-mission-history")!;
        expect(section.text).toMatch(/^Optional: /);
        expect(section.done).toBe(false);
    });

    it("keeps a person's ticks across a re-extraction", () => {
        const first = requirementsFromExtracted(sanitizeExtracted(RAW));
        const ticked = toggleRequirement(first, first[0]!.id, true);
        expect(ticked[0]!.done).toBe(true);
        const again = requirementsFromExtracted(sanitizeExtracted(RAW), ticked);
        expect(again[0]!.done).toBe(true);
        expect(again[1]!.done).toBe(false);
    });

    it("never ticks a section row by hand", () => {
        const rows = requirementsFromExtracted(sanitizeExtracted(RAW));
        const section = rows.find(r => r.kind === "section")!;
        expect(toggleRequirement(rows, section.id, true).find(r => r.id === section.id)!.done).toBe(
            false
        );
    });
});
