import { describe, expect, it } from "vitest";
import {
    formatCompanyIdentity,
    formatMetadataContext,
    MIN_CONFIDENCE,
    readFact,
} from "@launchstack/tools/company-context";
import type { CompanyMetadataJSON, MetadataFact } from "@launchstack/tools/company-context/schema";

function fact<T>(value: T, overrides: Partial<MetadataFact<T>> = {}): MetadataFact<T> {
    return {
        value,
        visibility: "public",
        usage: "outreach_ok",
        confidence: 0.9,
        priority: "normal",
        status: "active",
        last_updated: "2026-08-01T00:00:00Z",
        sources: [],
        ...overrides,
    };
}

function emptyMetadata(): CompanyMetadataJSON {
    return {
        schema_version: "1.0.0",
        company_id: "1",
        updated_at: "2026-08-01T00:00:00Z",
        company: {},
        people: [],
        services: [],
        markets: {},
        projects: [],
        policies: {},
        legal: [],
        provenance: {
            total_documents_processed: 0,
            extraction_model: "test",
            extraction_version: "test",
        },
    };
}

describe("readFact", () => {
    it("returns the value for an active, confident fact", () => {
        expect(readFact(fact("Acme"))).toBe("Acme");
    });

    it("rejects missing, non-active, and low-confidence facts", () => {
        expect(readFact(undefined)).toBeUndefined();
        expect(readFact(fact("Acme", { status: "deprecated" }))).toBeUndefined();
        expect(readFact(fact("Acme", { confidence: MIN_CONFIDENCE - 0.01 }))).toBeUndefined();
    });

    it("accepts a fact exactly at the threshold", () => {
        expect(readFact(fact("Acme", { confidence: MIN_CONFIDENCE }))).toBe("Acme");
    });
});

describe("formatMetadataContext", () => {
    it("renders sections only for populated, confident data", () => {
        const md = emptyMetadata();
        md.company.name = fact("Acme Robotics");
        md.company.industry = fact("Robotics");
        md.services = [
            { name: fact("Arm assembly"), description: fact("Robotic arm assembly lines") },
            // Low-confidence service must be dropped entirely.
            { name: fact("Secret project", { confidence: 0.1 }) },
        ];
        md.markets = { primary: [fact("Manufacturing")] };

        const text = formatMetadataContext(md);

        expect(text).toContain("=== Company ===");
        expect(text).toContain("Name: Acme Robotics");
        expect(text).toContain("Industry: Robotics");
        expect(text).toContain("=== Services & Products ===");
        expect(text).toContain("- Arm assembly: Robotic arm assembly lines");
        expect(text).not.toContain("Secret project");
        expect(text).toContain("Primary markets: Manufacturing");
        // No people/projects/policies sections when those are empty.
        expect(text).not.toContain("=== Key People ===");
        expect(text).not.toContain("=== Projects & Outcomes ===");
        expect(text).not.toContain("=== Policies & Certifications ===");
    });
});

describe("formatCompanyIdentity", () => {
    it("emits only the lines that have data", () => {
        expect(
            formatCompanyIdentity({
                name: "Acme",
                description: "",
                industry: "Robotics",
                numberOfEmployees: "11-50",
                categories: [],
            })
        ).toBe("Company: Acme.\nIndustry: Robotics");
    });

    it("joins categories on one line", () => {
        expect(
            formatCompanyIdentity({
                name: "Acme",
                description: "Robots",
                industry: "",
                numberOfEmployees: null,
                categories: ["a", "b"],
            })
        ).toBe("Company: Acme.\nDescription: Robots\nCategories: a, b");
    });
});
