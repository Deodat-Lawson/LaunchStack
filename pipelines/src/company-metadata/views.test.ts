/**
 * The read model both profile screens and the proposal stages use: what is
 * shown, in what order, and which excerpt each superscript points at.
 */
import { describe, expect, it } from "vitest";

import { applyFactEdit } from "./edit";
import { createEmptyMetadata, type MetadataFact } from "./types";
import { profileView } from "./views";

const NOW = new Date("2026-10-03T12:00:00Z");

function fact(
    value: string,
    docId: number,
    quote: string,
    confidence = 0.9,
    page = 1
): MetadataFact {
    return {
        value,
        visibility: "public",
        usage: "outreach_ok",
        confidence,
        priority: "normal",
        status: "active",
        last_updated: NOW.toISOString(),
        sources: [
            {
                doc_id: docId,
                doc_name: `Doc ${docId}`,
                extracted_at: NOW.toISOString(),
                page,
                quote,
            },
        ],
    };
}

function sample() {
    const m = createEmptyMetadata("7", NOW);
    m.company.headquarters = fact("Baltimore, MD", 1, "Headquartered in Baltimore, MD.");
    m.company.name = fact("Acme Robotics", 1, "Acme Robotics builds warehouse robots.");
    m.company.industry = fact("Robotics", 2, "a robotics company", 0.3);
    m.people.push({
        name: fact("Jane Doe", 2, "Jane Doe, CEO", 0.9, 4),
        role: fact("CEO", 2, "Jane Doe, CEO", 0.9, 4),
    });
    m.markets.geographies = [fact("United States", 1, "across the United States")];
    m.profile = {
        facts: {
            mission: {
                ...fact("Safer warehouses", 1, "Our mission is safer warehouses."),
                label: "Mission",
            },
        },
        summary: {
            ...fact(
                "Acme Robotics builds warehouse robots.",
                1,
                "Acme Robotics builds warehouse robots."
            ),
            confidence: 0.9,
        },
        applicant_type: {
            ...fact("for_profit", 1, "Acme Robotics builds warehouse robots."),
            value: "for_profit" as const,
        },
    };
    return m;
}

describe("profileView", () => {
    it("orders company facts, then profile facts, numbering excerpts in reading order", () => {
        const view = profileView(sample());
        expect(view.facts.map(f => [f.label, f.value, f.cites])).toEqual([
            ["Name", "Acme Robotics", [1]],
            ["Headquarters", "Baltimore, MD", [2]],
            ["Mission", "Safer warehouses", [3]],
        ]);
        // Low-confidence industry is not shown; the person cites one excerpt once.
        expect(view.people).toEqual([
            {
                path: "people.0",
                name: "Jane Doe",
                detail: "CEO",
                detailPath: "people.0.role",
                cites: [4],
                source: "documents",
            },
        ]);
        expect(view.summaryCites).toEqual([1]);
        expect(view.applicantType).toBe("for_profit");
        expect(view.geography).toEqual(["United States"]);
        expect(view.evidence.map(e => [e.n, e.documentId, e.page])).toEqual([
            [1, 1, 1],
            [2, 1, 1],
            [3, 1, 1],
            [4, 2, 4],
            [5, 1, 1],
        ]);
        expect(view.documents).toBe(2);
    });

    it("hides a fact whose every source the viewer cannot open, and its excerpt", () => {
        const view = profileView(sample(), { canSee: id => id !== 2 });
        expect(view.people).toEqual([]);
        expect(view.evidence.some(e => e.documentId === 2)).toBe(false);
    });

    it("shows manual edits as manual, hides removals", () => {
        const m = sample();
        applyFactEdit(m, { path: "company.headquarters", value: "Remote" }, NOW);
        applyFactEdit(m, { path: "profile.facts.mission", value: "" }, NOW);
        const view = profileView(m);
        expect(view.facts.find(f => f.label === "Headquarters")).toMatchObject({
            value: "Remote",
            source: "manual",
            cites: [],
        });
        expect(view.facts.find(f => f.label === "Mission")).toBeUndefined();
    });

    it("reads no profile as empty", () => {
        expect(profileView(null)).toMatchObject({
            summary: null,
            applicantType: null,
            facts: [],
            evidence: [],
        });
    });
});
