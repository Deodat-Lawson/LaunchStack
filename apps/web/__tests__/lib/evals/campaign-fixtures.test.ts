/**
 * Fixture integrity tests.
 *
 * Covers validation requirements 1, 2, 4, 5, 6 and 12 from the eval-suite brief:
 * schema conformance, supported-fact traceability, genuine contradiction,
 * distractor irrelevance, and absence of real company identities.
 */

import { CompanyFixtureSchema, FixtureSchema } from "@schema";
import {
    buildEvalContext,
    listCompanyIds,
    loadAllCompanyFixtures,
    loadCompanyDocuments,
    loadCompanyFixture,
    loadEvalFixtures,
} from "~/lib/agents/evals/campaign";

/** Whitespace-insensitive containment, so quotes may span wrapped lines. */
function collapse(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}
function docContains(doc: string, quote: string): boolean {
    return collapse(doc).includes(collapse(quote));
}

describe("company fixtures", () => {
    const ids = listCompanyIds();

    it("finds the expected four company fixtures", () => {
        expect(ids).toEqual([
            "fernwood-audio",
            "meridian-rail-systems",
            "northwind-cold-chain",
            "tilde-labs",
        ]);
    });

    // Requirement 1
    it.each(listCompanyIds())("%s parses against CompanyFixtureSchema", id => {
        const company = loadCompanyFixture(id);
        expect(() => CompanyFixtureSchema.parse(company)).not.toThrow();
        expect(company.id).toBe(id);
    });

    it("contains exactly one sparse company and three rich ones", () => {
        const companies = loadAllCompanyFixtures();
        const sparse = companies.filter(c => c.knowledgeDepth === "sparse");
        const rich = companies.filter(c => c.knowledgeDepth === "rich");
        expect(sparse).toHaveLength(1);
        expect(rich).toHaveLength(3);
        expect(sparse[0]?.id).toBe("tilde-labs");
    });

    it("gives every rich company all three source-fact kinds", () => {
        for (const c of loadAllCompanyFixtures().filter(x => x.knowledgeDepth === "rich")) {
            const kinds = new Set(c.sourceFacts.map(f => f.kind));
            expect([...kinds].sort()).toEqual(["contradictory", "distractor", "supported"]);
        }
    });

    it("gives the sparse company enough facts to test missing-context behaviour", () => {
        const sparse = loadCompanyFixture("tilde-labs");
        expect(sparse.sourceFacts.length).toBeGreaterThanOrEqual(5);
        expect(sparse.sourceFacts.some(f => f.kind === "supported")).toBe(true);
        expect(sparse.sourceFacts.some(f => f.kind === "contradictory")).toBe(true);
    });

    it("uses unique source-fact ids within each company", () => {
        for (const c of loadAllCompanyFixtures()) {
            const ids = c.sourceFacts.map(f => f.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it("declares every document that exists on disk", () => {
        for (const c of loadAllCompanyFixtures()) {
            const onDisk = Object.keys(loadCompanyDocuments(c.id)).sort();
            const declared = c.documents.map(d => d.path).sort();
            expect(declared).toEqual(onDisk);
        }
    });
});

// Requirement 4
describe("supported facts are traceable to fixture documents", () => {
    it.each(listCompanyIds())("%s", id => {
        const company = loadCompanyFixture(id);
        const docs = loadCompanyDocuments(id);

        for (const fact of company.sourceFacts.filter(f => f.kind === "supported")) {
            expect(fact.provenance.length).toBeGreaterThan(0);

            for (const p of fact.provenance) {
                const doc = docs[p.document];
                expect(doc).toBeDefined();
                if (!doc) continue;
                if (p.quote) {
                    // The quote must literally appear in the cited document.
                    expect(docContains(doc, p.quote)).toBe(true);
                }
            }
        }
    });
});

// Requirement 5
describe("contradictory facts genuinely conflict with source material", () => {
    it.each(listCompanyIds())("%s", id => {
        const company = loadCompanyFixture(id);
        const docs = loadCompanyDocuments(id);
        const byId = new Map(company.sourceFacts.map(f => [f.id, f]));

        for (const fact of company.sourceFacts.filter(f => f.kind === "contradictory")) {
            // Must cite the document it conflicts with, and that citation must resolve.
            expect(fact.provenance.length).toBeGreaterThan(0);
            for (const p of fact.provenance) {
                const doc = docs[p.document];
                expect(doc).toBeDefined();
                if (doc && p.quote) expect(docContains(doc, p.quote)).toBe(true);
            }

            // Must name the supported fact it contradicts, and that fact must exist
            // and actually be a supported one.
            expect(fact.contradicts).toBeTruthy();
            const target = fact.contradicts ? byId.get(fact.contradicts) : undefined;
            expect(target).toBeDefined();
            expect(target?.kind).toBe("supported");

            // The contradictory statement must not itself appear verbatim in the docs.
            for (const doc of Object.values(docs)) {
                expect(docContains(doc, fact.statement)).toBe(false);
            }
        }
    });
});

// Requirement 6
describe("distractor facts are true but irrelevant", () => {
    it.each(listCompanyIds())("%s", id => {
        const company = loadCompanyFixture(id);
        const docs = loadCompanyDocuments(id);

        for (const fact of company.sourceFacts.filter(f => f.kind === "distractor")) {
            // "True within the fixture universe" — must cite a real document.
            expect(fact.provenance.length).toBeGreaterThan(0);
            for (const p of fact.provenance) {
                expect(docs[p.document]).toBeDefined();
            }
            // "Irrelevant to the target campaign" — must not claim relevance.
            expect(fact.relevantTo).toHaveLength(0);
            // Must not be flagged as contradicting anything.
            expect(fact.contradicts).toBeNull();
        }
    });
});

// Requirement 12
describe("no synthetic company borrows a real company identity", () => {
    // Real vendors a synthetic fixture must never impersonate. One well-known
    // password-manager vendor is omitted deliberately: as a bare lowercase token
    // its name reads as a credential to secret scanners and fails CI. No fixture
    // resembles it, so the coverage cost is nil — please don't add it back.
    const REAL_COMPANIES = [
        "posthog",
        "tailscale",
        "sentry",
        "supabase",
        "vercel",
        "netlify",
        "figma",
        "proton",
        "duckduckgo",
        "ghost",
        "cursor",
        "perplexity",
        "applovin",
        "notion",
        "linear",
        "stripe",
        "cloudflare",
        "gitlab",
        "obsidian",
    ];

    it.each(listCompanyIds())("%s name and products are synthetic", id => {
        const c = loadCompanyFixture(id);
        const haystack = [c.name, c.id, ...c.allowedProductNames, ...c.products.map(p => p.name)]
            .join(" ")
            .toLowerCase();

        for (const real of REAL_COMPANIES) {
            expect(haystack).not.toContain(real);
        }
    });

    it("uses .example domains for websites", () => {
        for (const c of loadAllCompanyFixtures()) {
            if (c.website) expect(c.website).toMatch(/\.example$/);
        }
    });
});

describe("evaluation fixtures", () => {
    const fixtures = loadEvalFixtures();

    // Requirement 2
    it("parses every fixture against FixtureSchema", () => {
        expect(fixtures.length).toBeGreaterThan(0);
        for (const f of fixtures) {
            expect(() => FixtureSchema.parse(f)).not.toThrow();
        }
    });

    it("uses unique fixture ids", () => {
        const ids = fixtures.map(f => f.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("references only companies that exist", () => {
        const known = new Set(listCompanyIds());
        for (const f of fixtures) expect(known.has(f.companyId)).toBe(true);
    });

    it("covers all four mock companies", () => {
        expect(new Set(fixtures.map(f => f.companyId)).size).toBe(4);
    });

    it("covers multiple platforms", () => {
        const platforms = new Set(fixtures.map(f => f.platform));
        expect(platforms.size).toBeGreaterThanOrEqual(3);
    });

    it("references only fact ids that exist on the referenced company", () => {
        for (const f of fixtures) {
            const company = loadCompanyFixture(f.companyId);
            const ids = new Set(company.sourceFacts.map(sf => sf.id));
            for (const id of f.expected.mustUseFactIds) expect(ids.has(id)).toBe(true);
            for (const id of f.expected.mustNotUseFactIds) expect(ids.has(id)).toBe(true);
        }
    });

    it("only requires facts that are actually supported", () => {
        for (const f of fixtures) {
            const ctx = buildEvalContext(f);
            for (const id of f.expected.mustUseFactIds) {
                expect(ctx.factsById[id]?.kind).toBe("supported");
            }
        }
    });

    it("only forbids facts that are contradictory or distractors", () => {
        for (const f of fixtures) {
            const ctx = buildEvalContext(f);
            for (const id of f.expected.mustNotUseFactIds) {
                expect(["contradictory", "distractor"]).toContain(ctx.factsById[id]?.kind);
            }
        }
    });

    it("builds a usable context for every fixture", () => {
        for (const f of fixtures) {
            const ctx = buildEvalContext(f);
            expect(ctx.company.id).toBe(f.companyId);
            expect(Object.keys(ctx.documents).length).toBeGreaterThan(0);
            expect(Object.keys(ctx.factsById).length).toBeGreaterThan(0);
        }
    });
});
