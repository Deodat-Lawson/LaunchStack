/**
 * Assembly is what makes the profile honest over time: rebuilt from the
 * sources that count, so a source that stops counting takes its facts with
 * it, while a person's edits — including removals — survive every rebuild.
 */
import { describe, expect, it } from "vitest";

import { applyManualOverrides, assembleMetadata, diffMetadata, factsHash } from "./assemble";
import { applyFactEdit } from "./edit";
import type { MetadataFact, SourceFacts } from "./types";

const NOW = new Date("2026-10-03T12:00:00Z");

function fact<T = string>(
    value: T,
    docId: number,
    quote: string,
    confidence = 0.9
): MetadataFact<T> {
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
                page: 1,
                quote,
            },
        ],
    };
}

const DECK: SourceFacts = {
    company: {
        name: fact("Acme Robotics", 1, "Acme Robotics builds warehouse robots."),
        headquarters: fact("Baltimore, MD", 1, "Headquartered in Baltimore, MD."),
    },
    people: [{ name: fact("Jane Doe", 1, "Jane Doe, CEO"), role: fact("CEO", 1, "Jane Doe, CEO") }],
    profile: {
        facts: {
            mission: {
                ...fact("Make warehouses safer", 1, "Our mission is to make warehouses safer."),
                label: "Mission",
            },
        },
    },
};
const SITE: SourceFacts = {
    company: { name: fact("Acme Robotics", 2, "Welcome to Acme Robotics") },
    markets: {
        geographies: [fact("United States", 2, "We serve customers across the United States.")],
    },
};

describe("assembleMetadata", () => {
    it("merges every counted source and keeps both citations for the same statement", () => {
        const m = assembleMetadata(
            "7",
            [
                { documentId: 2, title: "Site", facts: SITE },
                { documentId: 1, title: "Deck", facts: DECK },
            ],
            null,
            NOW
        );
        expect(m.schema_version).toBe("1.1.0");
        expect(m.company.name?.sources.map(s => s.doc_id)).toEqual([1, 2]);
        expect(m.company.headquarters?.value).toBe("Baltimore, MD");
        expect(m.markets.geographies?.map(f => f.value)).toEqual(["United States"]);
        expect(m.profile?.facts?.mission?.label).toBe("Mission");
        expect(m.provenance.sources_counted).toBe(2);
    });

    it("drops the facts of a source that no longer counts (deleted, set aside, rewritten)", () => {
        const before = assembleMetadata(
            "7",
            [
                { documentId: 1, title: "Deck", facts: DECK },
                { documentId: 2, title: "Site", facts: SITE },
            ],
            null,
            NOW
        );
        const after = assembleMetadata(
            "7",
            [{ documentId: 2, title: "Site", facts: SITE }],
            before,
            NOW
        );
        expect(after.company.headquarters).toBeUndefined();
        expect(after.people).toEqual([]);
        expect(after.company.name?.sources.map(s => s.doc_id)).toEqual([2]);
        const diff = diffMetadata(before, after);
        expect(diff.deprecated.map(d => d.path)).toEqual(
            expect.arrayContaining(["company.headquarters", "profile.facts.mission"])
        );
    });

    it("keeps a person's edits and removals across rebuilds", () => {
        const built = assembleMetadata(
            "7",
            [{ documentId: 1, title: "Deck", facts: DECK }],
            null,
            NOW
        );
        const edited = structuredClone(built);
        expect(
            applyFactEdit(edited, { path: "company.headquarters", value: "Remote" }, NOW).ok
        ).toBe(true);
        expect(
            applyFactEdit(edited, { path: "people.0.role", value: "Founder & CEO" }, NOW).ok
        ).toBe(true);
        expect(applyFactEdit(edited, { path: "profile.facts.mission", value: "" }, NOW).ok).toBe(
            true
        );
        expect(
            applyFactEdit(
                edited,
                {
                    path: "profile.facts.annual_budget",
                    value: "$1.2m (FY2025)",
                    label: "Annual budget",
                },
                NOW
            ).ok
        ).toBe(true);

        const rebuilt = assembleMetadata(
            "7",
            [{ documentId: 1, title: "Deck", facts: DECK }],
            edited,
            NOW
        );
        expect(rebuilt.company.headquarters?.value).toBe("Remote");
        expect(rebuilt.company.headquarters?.priority).toBe("manual_override");
        expect(rebuilt.people[0]?.role?.value).toBe("Founder & CEO");
        // The removal is a manual fact with status deprecated: the source still says it, the profile doesn't.
        expect(rebuilt.profile?.facts?.mission?.status).toBe("deprecated");
        expect(rebuilt.profile?.facts?.annual_budget?.value).toBe("$1.2m (FY2025)");
        // Idempotent: re-applying under the row lock changes nothing.
        expect(applyManualOverrides(rebuilt, edited)).toEqual(rebuilt);
    });

    it("drops an edit to someone the sources no longer mention, but keeps a person added by hand", () => {
        const built = assembleMetadata(
            "7",
            [{ documentId: 1, title: "Deck", facts: DECK }],
            null,
            NOW
        );
        const edited = structuredClone(built);
        applyFactEdit(edited, { path: "people.0.role", value: "Chair" }, NOW);
        edited.people.push({
            name: { ...fact("Sam Lee", 0, ""), priority: "manual_override", sources: [] },
        });
        const rebuilt = assembleMetadata(
            "7",
            [{ documentId: 2, title: "Site", facts: SITE }],
            edited,
            NOW
        );
        expect(rebuilt.people.map(p => p.name.value)).toEqual(["Sam Lee"]);
    });
});

describe("factsHash", () => {
    it("is stable for the same facts and changes when a fact changes", () => {
        const a = assembleMetadata("7", [{ documentId: 1, title: "Deck", facts: DECK }], null, NOW);
        const b = assembleMetadata(
            "7",
            [{ documentId: 1, title: "Deck", facts: DECK }],
            null,
            new Date("2027-01-01")
        );
        expect(factsHash(a)).toBe(factsHash(b));
        const c = structuredClone(a);
        applyFactEdit(c, { path: "company.headquarters", value: "Remote" }, NOW);
        expect(factsHash(c)).not.toBe(factsHash(a));
    });
});
