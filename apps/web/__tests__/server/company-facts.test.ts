/**
 * The company-facts leg's pure half: flattening the projection into citeable
 * rows, scoping by cited document, ranking against a question, rendering.
 */

import type {
    CompanyMetadataJSON,
    MetadataFact,
    MetadataSource,
} from "@launchstack/tools/company-context/schema";

import {
    flattenCompanyFacts,
    formatCompanyFact,
    rankCompanyFacts,
    rowsCitingDocuments,
    rowsVisibleUnder,
    tokenize,
} from "~/server/rag/company-facts";

const orgChart: MetadataSource = {
    doc_id: 41,
    doc_name: "Org chart 2026.pdf",
    extracted_at: "2026-08-01T00:00:00Z",
    version_id: 7,
    page: 3,
    quote: "Jane Doe, Chief Technology Officer",
};
const lease: MetadataSource = {
    doc_id: 58,
    doc_name: "Office lease.pdf",
    extracted_at: "2026-07-10T00:00:00Z",
    version_id: 9,
    page: 12,
};
const manual: MetadataSource = {
    doc_id: 0,
    doc_name: "Manual edit",
    extracted_at: "2026-08-20T00:00:00Z",
};

function fact<T>(
    value: T,
    overrides: Partial<MetadataFact<T>> = {},
    sources: MetadataSource[] = [orgChart]
): MetadataFact<T> {
    return {
        value,
        visibility: "internal",
        usage: "no_outreach",
        confidence: 0.9,
        priority: "normal",
        status: "active",
        last_updated: "2026-08-01T00:00:00Z",
        sources,
        ...overrides,
    };
}

function projection(): CompanyMetadataJSON {
    return {
        schema_version: "1.0.0",
        company_id: "1",
        updated_at: "2026-08-20T00:00:00Z",
        company: {
            name: fact("Acme Robotics"),
            industry: fact("Industrial automation"),
            headquarters: fact("Austin, Texas", {}, [manual]),
        },
        people: [
            {
                name: fact("Jane Doe"),
                role: fact("CTO"),
                department: fact("Engineering"),
                email: fact("jane@acme.example", { confidence: 0.3 }),
            },
            {
                name: fact("Bob Smith", { status: "deprecated" }),
                role: fact("Head of Sales", { status: "deprecated" }),
            },
            {
                name: fact("Alan Doe"),
                role: fact("Warehouse lead"),
            },
        ],
        services: [
            {
                name: fact("Pick-and-place arms"),
                description: fact("Robotic arms for assembly lines"),
            },
        ],
        markets: { primary: [fact("Automotive"), fact("Electronics")] },
        projects: [
            {
                name: fact("Atlas"),
                status: fact("in progress"),
                subprojects: [{ name: fact("Atlas vision") }],
            },
        ],
        policies: { refund_policy: fact("30-day refunds on unused hardware") },
        legal: [
            {
                name: fact("Office lease", {}, [lease]),
                type: fact("lease", {}, [lease]),
                expiry_date: fact("2027-03-31", { confidence: 0.8 }, [lease]),
                parties: fact("Acme Robotics; Congress Ave Properties", {}, [lease]),
            },
        ],
        provenance: {
            total_documents_processed: 2,
            extraction_model: "test",
            extraction_version: "1",
        },
    };
}

describe("flattenCompanyFacts", () => {
    it("drops deprecated entries and low-confidence fields, keeps the rest citeable", () => {
        const rows = flattenCompanyFacts(projection());
        const subjects = rows.map(r => r.subject);

        expect(subjects).toContain("Jane Doe");
        expect(subjects).not.toContain("Bob Smith");

        const jane = rows.find(r => r.subject === "Jane Doe")!;
        expect(jane.details).toEqual([
            { field: "role", value: "CTO" },
            { field: "department", value: "Engineering" },
        ]);
        expect(jane.source).toEqual(orgChart);
        expect(jane.sourceDocumentIds).toEqual([41]);
        expect(jane.confidence).toBe(0.9);
    });

    it("cites a document-backed source even when the subject was edited by hand", () => {
        const rows = flattenCompanyFacts(projection());
        const company = rows.find(r => r.path === "company")!;
        expect(company.subject).toBe("Acme Robotics");
        expect(company.details.map(d => d.field)).toEqual(["industry", "headquarters"]);
        expect(company.source?.doc_id).toBe(41);
    });

    it("folds list fields and subprojects into one row each", () => {
        const rows = flattenCompanyFacts(projection());
        expect(rows.find(r => r.path === "markets")?.details).toEqual([
            { field: "primary", value: "Automotive, Electronics" },
        ]);
        expect(rows.find(r => r.subject === "Atlas")?.details).toEqual([
            { field: "status", value: "in progress" },
            { field: "subprojects", value: "Atlas vision" },
        ]);
        expect(rows.find(r => r.path === "policies.refund_policy")?.subject).toBe("refund policy");
    });
});

describe("rowsCitingDocuments", () => {
    it("keeps only rows whose surviving facts cite one of the documents", () => {
        const rows = flattenCompanyFacts(projection());
        const fromLease = rowsCitingDocuments(rows, [58]);
        expect(fromLease.map(r => r.subject)).toEqual(["Office lease"]);
        expect(rowsCitingDocuments(rows, [999])).toEqual([]);
    });
});

describe("rowsVisibleUnder", () => {
    it("drops facts whose every source is out of scope, keeps document-free facts", () => {
        const rows = flattenCompanyFacts(projection());
        // Only the lease document is readable: the legal entry stays, the
        // org-chart-backed people go, and nothing declared by hand is lost.
        const visible = rowsVisibleUnder(rows, new Set([58]));
        expect(visible.map(r => r.subject)).toEqual(["Office lease"]);

        expect(rowsVisibleUnder(rows, new Set())).toEqual([]);

        const withManual = rowsVisibleUnder(
            [
                ...rows,
                {
                    path: "custom.motto",
                    section: "policies",
                    subject: "motto",
                    details: [{ field: "motto", value: "Ship it" }],
                    confidence: 1,
                    lastUpdated: "2026-08-20T00:00:00Z",
                    sourceDocumentIds: [],
                },
            ],
            new Set()
        );
        expect(withManual.map(r => r.subject)).toEqual(["motto"]);
    });
});

describe("rankCompanyFacts", () => {
    const rows = flattenCompanyFacts(projection());

    it("puts the person asked about first, by whole-name match over a shared surname", () => {
        const ranked = rankCompanyFacts("What is Jane Doe's role?", rows, 3);
        expect(ranked[0]?.row.subject).toBe("Jane Doe");
        expect(ranked.find(r => r.row.subject === "Alan Doe")).toBeDefined();
        expect(ranked[0]!.score).toBeGreaterThan(
            ranked.find(r => r.row.subject === "Alan Doe")!.score
        );
    });

    it("answers a role question from the role field", () => {
        const ranked = rankCompanyFacts("who is our cto", rows, 2);
        expect(ranked[0]?.row.subject).toBe("Jane Doe");
    });

    it("finds a dated legal fact from a paraphrase, with light stemming", () => {
        const ranked = rankCompanyFacts("when does the office lease expire", rows, 2);
        expect(ranked[0]?.row.subject).toBe("Office lease");
        expect(
            rankCompanyFacts("which contracts name Congress Ave Properties", rows, 1)[0]?.row
                .subject
        ).toBe("Office lease");
    });

    it("returns nothing for a question that touches no fact", () => {
        expect(rankCompanyFacts("how do I reset my password", rows, 5)).toEqual([]);
        expect(rankCompanyFacts("the and of", rows, 5)).toEqual([]);
    });

    it("respects topK", () => {
        expect(rankCompanyFacts("Doe", rows, 1)).toHaveLength(1);
    });
});

describe("formatCompanyFact", () => {
    it("states the fact, names its source and page, and carries confidence", () => {
        const jane = flattenCompanyFacts(projection()).find(r => r.subject === "Jane Doe")!;
        const text = formatCompanyFact(jane);
        expect(text).toContain("Person — Jane Doe. role: CTO; department: Engineering.");
        expect(text).toContain(
            'Source: Org chart 2026.pdf, p. 3 — "Jane Doe, Chief Technology Officer".'
        );
        expect(text).toContain("Confidence 0.90, updated 2026-08-01.");
    });
});

describe("tokenize", () => {
    it("drops stopwords, keeps emails whole, and stems plurals", () => {
        expect(tokenize("Who are our contracts with jane@acme.example?")).toEqual([
            "contract",
            "jane@acme.example",
        ]);
        expect(tokenize("policies")).toEqual(["policy"]);
    });
});
