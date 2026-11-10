import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadPublishedCatalogue } from "./catalogue";
import {
    ProgramIntelligenceSchema,
    applySourceRefresh,
    identityKeys,
    recordConflict,
} from "./intelligence";

const root = fileURLToPath(new URL("../../../../fixtures/accelerators/", import.meta.url));

describe("Program intelligence contract", () => {
    const published = loadPublishedCatalogue(root);
    const byId = new Map(published.dossiers.map(dossier => [dossier.programId, dossier]));
    const speedrun = byId.get("a16z-speedrun");
    const antler = byId.get("antler");
    const skydeck = byId.get("berkeley-skydeck");
    const ef = byId.get("entrepreneurs-first");
    const era = byId.get("entrepreneurs-roundtable-accelerator");
    const yc = byId.get("y-combinator");

    it("publishes a dossier for every reviewed Program", () => {
        expect(published.dossiers.length).toBeGreaterThan(200);
        expect(speedrun && antler && skydeck && ef && era && yc).toBeTruthy();
        for (const dossier of published.dossiers) {
            expect(dossier).not.toHaveProperty("similarity");
            expect(dossier).not.toHaveProperty("fitScore");
            expect(dossier.programId).toMatch(/^[a-z0-9-]+$/);
        }
    });

    it("keeps mixed instruments separate and does not treat a SAFE as fixed dilution", () => {
        expect(speedrun!.deal.comparableDilution).toBe(false);
        expect(speedrun!.deal.components.map(component => component.kind)).toEqual([
            "safe",
            "safe",
            "credits",
        ]);
        expect(speedrun!.deal.components[0]!.equity).toBe("10% upfront");
        expect(speedrun!.deal.components[1]!.equity).toBeNull();
        expect(speedrun!.deal.components[2]!.amount).toBeNull();
        expect(speedrun!.deal.summary.claim).toBe("interpretation");
        expect(speedrun!.deal.formatted.claim).toBe("fact");

        expect(yc!.deal.comparableDilution).toBe(false);
        expect(yc!.deal.components.map(component => [component.amount, component.equity])).toEqual([
            ["125000", "7%"],
            ["375000", null],
        ]);
        expect(ef!.deal.components.map(component => component.kind)).toEqual([
            "grant",
            "unspecified_investment",
            "follow_on",
            "credits",
        ]);
        expect(new Set(ef!.deal.components.map(component => component.kind)).size).toBe(4);
    });

    it("keeps conflicts, missing deadlines, and absent portfolios explicit", () => {
        expect(antler!.identity.locationCount.state).toBe("conflicting");
        expect(antler!.identity.locationCount.value).toBeNull();
        expect(
            antler!.review.some(item => item.field === "locationCount" && item.status === "open")
        ).toBe(true);
        expect(antler!.batches.nextDeadline.value).toBeNull();
        expect(antler!.batches.nextDeadline.state).toBe("unavailable");
        expect(antler!.portfolio.companies).toEqual([]);
        expect(antler!.portfolio.state).toBe("unavailable");
        expect(antler!.identity.operatingStatus.state).toBe("not_checked");
        expect(antler!.identity.applicationsOpen.value).not.toBe(false);

        expect(speedrun!.batches.residencyEnd.state).toBe("conflicting");
        expect(speedrun!.batches.residencyEnd.value).toBeNull();
        expect(speedrun!.batches.cycles.map(cycle => cycle.id)).toEqual(["sr008", "sr009"]);
        expect(speedrun!.batches.cycles[1]!.announcedDeadline.value).toBeNull();
        expect(speedrun!.batches.nextDeadline.value).toBe("2026-11-01T23:59:00-08:00");
        expect(speedrun!.portfolio.state).toBe("unavailable");
        expect(speedrun!.selectivity.value).toBeNull();

        expect(skydeck!.batches.cycles.map(cycle => cycle.id)).toEqual(["batch-23", "batch-24"]);
        expect(skydeck!.batches.cycles[1]!.announcedDeadline.value).toBeNull();
        expect(skydeck!.batches.nextDeadline.state).toBe("unavailable");
        expect(skydeck!.batches.nextDeadline.value).toBeNull();
        expect(skydeck!.batches.historicalCadence.value).toBe("every six months");
        expect(skydeck!.batches.historicalCadence.detail).toMatch(/not the next deadline/i);
        expect(skydeck!.deal.components[0]!.equity).toBeNull();
        expect(skydeck!.deal.components[0]!.kind).toBe("unspecified_investment");
    });

    it("separates participation from investment and returns from capital raised", () => {
        expect(era!.portfolio.companies.length).toBeGreaterThan(10);
        expect(new Set(era!.portfolio.companies.map(company => company.relationship))).toEqual(
            new Set(["participation"])
        );
        expect(era!.portfolio.companies.every(company => company.returns === null)).toBe(true);
        expect(era!.portfolio.companies.every(company => company.rounds.length === 0)).toBe(true);
        expect(era!.portfolio.returns.state).toBe("unavailable");
        expect(era!.portfolio.returns.value).toBeNull();
        expect(
            era!.deal.blocks.some(
                block => block.type === "caveat" && block.text.includes("2.5 billion")
            )
        ).toBe(true);
        expect(
            ef!.portfolio.companies.every(company => company.relationship === "portfolio_listing")
        ).toBe(true);
        expect(
            skydeck!.portfolio.companies.every(
                company => company.relationship === "companies_page_listing"
            )
        ).toBe(true);
    });

    it("records a public historical application without copying answers or merging acceptance", () => {
        const example = yc!.historicalExamples.examples[0]!;
        expect(yc!.historicalExamples.state).toBe("available");
        expect(example.kind).toBe("original_application");
        expect(example.textAvailability).toBe("published");
        expect(example.answersCopied).toBe(false);
        expect(example.acceptance.state).toBe("verified");
        expect(example.acceptance.evidenceIds).not.toEqual([example.sourceUrl]);
        expect(example.acceptance.detail).toMatch(/successful application/i);
        expect(byId.get("antler")!.historicalExamples.state).toBe("not_checked");
    });

    it("attaches several evidence-backed tags and no tag without a quote", () => {
        expect(speedrun!.tagIds.length).toBeGreaterThan(1);
        expect(new Set(published.taxonomy.tags.map(tag => tag.facet)).size).toBeGreaterThan(1);
        expect(yc!.tagIds).toEqual(
            expect.arrayContaining([
                "instrument.safe",
                "instrument.post-money-safe",
                "instrument.mfn-safe",
                "geography.san-francisco",
            ])
        );
        expect(published.taxonomy.tags.every(tag => tag.evidence.length > 0)).toBe(true);
    });

    it("refreshes without replacing excerpts, inventing values, or changing identity", () => {
        const before = identityKeys(speedrun!);
        const excerpt = speedrun!.evidence.find(item => item.id === "sr-faq-terms")!.excerpt;
        const checkedAt = speedrun!.evidence.find(item => item.id === "sr-faq-terms")!.checkedAt;
        const stale = applySourceRefresh(speedrun!, {
            evidenceId: "sr-faq-terms",
            outcome: "stale",
            checkedAt: "2026-11-09T12:00:00Z",
            detail: "The terms excerpt is no longer on the page.",
        });
        expect(identityKeys(stale)).toEqual(before);
        expect(stale.evidence.find(item => item.id === "sr-faq-terms")!.excerpt).toBe(excerpt);
        expect(stale.evidence.find(item => item.id === "sr-faq-terms")!.checkedAt).toBe(checkedAt);
        expect(stale.deal.formatted.state).toBe("stale");
        expect(stale.deal.formatted.value).toBe(speedrun!.deal.formatted.value);
        expect(stale.review.some(item => item.state === "stale" && item.status === "open")).toBe(
            true
        );

        const blocked = applySourceRefresh(speedrun!, {
            evidenceId: "sr-faq-terms",
            outcome: "inaccessible",
            checkedAt: "2026-11-09T12:00:00Z",
            detail: "The terms page could not be fetched.",
        });
        expect(blocked.evidence.find(item => item.id === "sr-faq-terms")!.checkedAt).toBe(
            checkedAt
        );
        expect(blocked.deal.formatted.value).toBe(speedrun!.deal.formatted.value);
        expect(blocked.deal.formatted.state).toBe("inaccessible");

        const current = applySourceRefresh(stale, {
            evidenceId: "sr-faq-terms",
            outcome: "current",
            checkedAt: "2026-11-09T13:00:00Z",
            detail: "The excerpt is still on the page.",
        });
        expect(current.deal.formatted.state).toBe("available");
        expect(current.deal.formatted.value).toBe(speedrun!.deal.formatted.value);
        expect(current.batches.residencyEnd.state).toBe("conflicting");
        expect(current.batches.residencyEnd.value).toBeNull();
    });

    it("sends a new conflict to operator review instead of choosing a value", () => {
        const opened = recordConflict(
            skydeck!,
            ["identity", "locationCount"],
            "Two pages disagree. Neither count was stored.",
            ["homepage", "program"],
            "identity",
            "locationCount"
        );
        expect(opened.identity.locationCount.value).toBeNull();
        expect(opened.identity.locationCount.state).toBe("conflicting");
        expect(
            opened.review.some(item => item.field === "locationCount" && item.status === "open")
        ).toBe(true);
        const chosen = structuredClone(opened);
        chosen.identity.locationCount.value = "20";
        expect(ProgramIntelligenceSchema.safeParse(chosen).success).toBe(false);
        const fakeReturn = structuredClone(era!);
        fakeReturn.portfolio.companies[0]!.returns = {
            basis: "realized",
            asOf: "2026-01-01",
            narrative: "Alumni capital raised.",
            evidenceIds: [],
        };
        expect(ProgramIntelligenceSchema.safeParse(fakeReturn).success).toBe(false);
    });
});
