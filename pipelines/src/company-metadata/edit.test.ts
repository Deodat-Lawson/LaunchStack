/** A person's edits: every path the profile page sends, removals, and refusals. */
import { describe, expect, it } from "vitest";

import { applyFactEdit, resetFactEdit } from "./edit";
import { createEmptyMetadata, type MetadataFact } from "./types";

const NOW = new Date("2026-10-03T12:00:00Z");

function doc() {
    const m = createEmptyMetadata("7", NOW);
    const f = (value: string): MetadataFact => ({
        value,
        visibility: "public",
        usage: "outreach_ok",
        confidence: 0.9,
        priority: "normal",
        status: "active",
        last_updated: NOW.toISOString(),
        sources: [{ doc_id: 3, doc_name: "Deck", extracted_at: NOW.toISOString() }],
    });
    m.company.headquarters = f("Baltimore, MD");
    m.people.push({ name: f("Jane Doe"), role: f("CEO") });
    m.services.push({ name: f("Pick-bot") });
    m.markets.geographies = [f("United States")];
    m.legal.push({ name: f("MSA with Globex") });
    return m;
}

describe("applyFactEdit", () => {
    it("writes a manual override that keeps the replaced fact's visibility and usage", () => {
        const m = doc();
        const out = applyFactEdit(m, { path: "company.headquarters", value: "Remote" }, NOW);
        expect(out.ok).toBe(true);
        expect(m.company.headquarters).toMatchObject({
            value: "Remote",
            priority: "manual_override",
            status: "active",
            confidence: 1,
            visibility: "public",
            usage: "outreach_ok",
        });
    });

    it("parses founded_year as a year", () => {
        const m = doc();
        applyFactEdit(m, { path: "company.founded_year", value: "Founded in 2019" }, NOW);
        expect(m.company.founded_year?.value).toBe(2019);
    });

    it("removes by tombstone: an empty value keeps the old value with status deprecated", () => {
        const m = doc();
        expect(applyFactEdit(m, { path: "people.0.role", value: "  " }, NOW).ok).toBe(true);
        expect(m.people[0]?.role).toMatchObject({
            value: "CEO",
            status: "deprecated",
            priority: "manual_override",
        });
    });

    it("adds a profile fact with its label, and refuses one without", () => {
        const m = doc();
        expect(
            applyFactEdit(
                m,
                { path: "profile.facts.annual_budget", value: "$1.2m", label: "Annual budget" },
                NOW
            ).ok
        ).toBe(true);
        expect(m.profile?.facts?.annual_budget).toMatchObject({
            label: "Annual budget",
            value: "$1.2m",
        });
        expect(applyFactEdit(m, { path: "profile.facts.staff", value: "12" }, NOW)).toEqual({
            ok: false,
            error: "A new fact needs a label",
        });
        expect(
            applyFactEdit(m, { path: "profile.facts.Bad-Key", value: "x", label: "X" }, NOW).ok
        ).toBe(false);
    });

    it("reaches every section the page edits", () => {
        const m = doc();
        for (const path of [
            "services.0.description",
            "markets.geographies.0",
            "legal.0.status",
            "policies.SOC2",
            "profile.summary",
        ])
            expect(applyFactEdit(m, { path, value: "x" }, NOW).ok).toBe(true);
    });

    it("refuses an out-of-range index, an unknown path, and removing what isn't there", () => {
        const m = doc();
        expect(applyFactEdit(m, { path: "people.4.role", value: "x" }, NOW)).toEqual({
            ok: false,
            error: "Invalid people index",
        });
        expect(applyFactEdit(m, { path: "secrets.key", value: "x" }, NOW).ok).toBe(false);
        expect(applyFactEdit(m, { path: "company.website", value: "" }, NOW).ok).toBe(false);
    });
});

describe("resetFactEdit", () => {
    it("drops a person's edit so the sources' value can come back, and only an edit", () => {
        const m = doc();
        applyFactEdit(m, { path: "company.headquarters", value: "Remote" }, NOW);
        expect(resetFactEdit(m, "company.headquarters")).toBe(true);
        expect(m.company.headquarters).toBeUndefined();
        expect(resetFactEdit(m, "people.0.role")).toBe(false); // a document fact, not an edit
        applyFactEdit(m, { path: "people.0.role", value: "" }, NOW);
        expect(applyFactEdit(m, { path: "people.0.role", value: "", reset: true }, NOW).ok).toBe(
            true
        );
        expect(m.people[0]?.role).toBeUndefined();
    });
});
