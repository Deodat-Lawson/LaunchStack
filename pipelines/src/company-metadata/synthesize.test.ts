/**
 * The written part of the profile cites the facts it rests on, and records
 * every document behind them — so a viewer who may not open one of those
 * documents does not see the summary, however many excerpts it cites.
 */
import { describe, expect, it } from "vitest";

import type { GenerateStructuredFn } from "./extractor";
import { synthesizeProfile } from "./synthesize";
import { createEmptyMetadata, type MetadataFact } from "./types";
import { numberedFacts, profileView } from "./views";

const NOW = new Date("2026-10-03T12:00:00Z");

function fact(value: string, docId: number, quote: string): MetadataFact {
    return {
        value,
        visibility: "public",
        usage: "outreach_ok",
        confidence: 0.9,
        priority: "normal",
        status: "active",
        last_updated: NOW.toISOString(),
        sources: [
            { doc_id: docId, doc_name: `Doc ${docId}`, extracted_at: NOW.toISOString(), quote },
        ],
    };
}

describe("synthesizeProfile", () => {
    it("records a restricted document cited past the excerpt cap, so the summary is hidden from who can't open it", async () => {
        const m = createEmptyMetadata("7", NOW);
        for (let i = 0; i < 14; i++)
            m.services.push({
                name: fact(`Product ${i}`, 1, `Our product ${i} is on the website.`),
            });
        m.legal.push({
            name: fact("Series A term sheet", 2, "Signed a Series A term sheet with Sequoia."),
        });
        const all = numberedFacts(m).map(f => f.id);

        const generate = (async () => ({
            summary: "Acme sells fourteen products and signed a Series A term sheet.",
            summary_facts: all,
            applicant_type: "for_profit",
            applicant_facts: all,
            focus_areas: [{ value: "robots", facts: all }],
        })) as unknown as GenerateStructuredFn;
        m.profile = await synthesizeProfile({
            metadata: m,
            companyName: "Acme",
            generate,
            now: NOW,
        });

        const docs = new Set(m.profile.summary!.sources.map(s => s.doc_id));
        expect(docs.has(2)).toBe(true);
        expect(m.profile.summary!.sources.filter(s => s.quote).length).toBeLessThanOrEqual(12);

        expect(profileView(m).summary).not.toBeNull();
        const hidden = profileView(m, { canSee: id => id !== 2 });
        expect(hidden.summary).toBeNull();
        expect(hidden.applicantType).toBeNull();
        expect(hidden.focusAreas).toEqual([]);
    });
});
