import { describe, expect, it } from "vitest";

import { CatalogueProgramSchema, type CatalogueProgram } from "./types";

const program: CatalogueProgram = {
    schemaVersion: 2,
    id: "validation-test",
    name: "Validation test Program",
    logo: { path: "/accelerators/logos/validation-test.png", sourceId: "official" },
    websiteUrl: "https://example.test/",
    applyUrl: "https://example.test/apply",
    description: { text: "A test description", sourceIds: ["official"], interpretation: false },
    targetApplicants: {
        text: "Solo founders exploring ideas, including teams without a product",
        sourceIds: ["official"],
        interpretation: true,
    },
    location: { text: "London", sourceIds: ["official"], interpretation: false },
    sources: [
        {
            id: "official",
            url: "https://example.test/apply",
            title: "Official test source",
            quote: "We welcome solo founders with an idea.",
            checkedAt: "2026-10-25T00:00:00Z",
        },
    ],
    cycles: [
        {
            id: "next",
            label: "Next intake",
            deadlineAt: null,
            deadlineTimezone: null,
            rolling: false,
            sourceIds: ["official"],
        },
    ],
};

function copyProgram(): CatalogueProgram {
    return structuredClone(program);
}

describe("public Program Catalogue contract", () => {
    it("preserves unknown timing and unrestricted sourced applicant narratives", () => {
        const parsed = CatalogueProgramSchema.parse(program);
        expect(parsed.cycles[0]).toEqual({
            id: "next",
            label: "Next intake",
            deadlineAt: null,
            deadlineTimezone: null,
            rolling: false,
            sourceIds: ["official"],
        });
        expect(parsed.targetApplicants).toEqual(program.targetApplicants);
    });

    it("preserves a date-only deadline without fabricating a time", () => {
        const dated = copyProgram();
        dated.cycles[0]!.dateOnly = "2028-02-29";
        const cycle = CatalogueProgramSchema.parse(dated).cycles[0]!;
        expect(cycle.dateOnly).toBe("2028-02-29");
        expect(cycle.deadlineAt).toBeNull();
        expect(cycle.deadlineTimezone).toBeNull();
        dated.cycles[0]!.dateOnly = "2027-02-29";
        expect(CatalogueProgramSchema.safeParse(dated).success).toBe(false);
    });

    it("requires evidence for a date-only deadline", () => {
        const unsourced = copyProgram();
        unsourced.cycles[0]!.dateOnly = "2028-02-29";
        unsourced.cycles[0]!.sourceIds = [];
        expect(CatalogueProgramSchema.safeParse(unsourced)).toMatchObject({
            success: false,
            error: {
                issues: expect.arrayContaining([
                    expect.objectContaining({ path: ["cycles", 0, "sourceIds"] }),
                ]),
            },
        });
    });

    it.each(["logo", "description", "targetApplicants", "location", "cycle"] as const)(
        "rejects dangling %s source references",
        field => {
            const invalid = copyProgram();
            if (field === "logo") invalid.logo.sourceId = "missing";
            else if (field === "cycle") invalid.cycles[0]!.sourceIds = ["missing"];
            else if (field === "location") invalid.location!.sourceIds = ["missing"];
            else invalid[field].sourceIds = ["missing"];
            expect(CatalogueProgramSchema.safeParse(invalid).success).toBe(false);
        }
    );

    it.each(["source", "cycle", "reference"] as const)("rejects duplicate %s identities", field => {
        const invalid = copyProgram();
        if (field === "source") invalid.sources.push({ ...invalid.sources[0]! });
        else if (field === "cycle") invalid.cycles.push({ ...invalid.cycles[0]! });
        else invalid.description.sourceIds.push("official");
        expect(CatalogueProgramSchema.safeParse(invalid).success).toBe(false);
    });

    it("requires a source-backed local logo instead of an external image request", () => {
        expect(CatalogueProgramSchema.safeParse({ ...program, logo: undefined }).success).toBe(
            false
        );
        expect(
            CatalogueProgramSchema.safeParse({
                ...program,
                logo: { ...program.logo, path: "https://tracker.example/logo.png" },
            }).success
        ).toBe(false);
    });

    it("accepts an unknown location but not a non-HTTP application link", () => {
        const unlocated = copyProgram();
        delete unlocated.location;
        expect(CatalogueProgramSchema.parse(unlocated).location).toBeUndefined();
        unlocated.applyUrl = "javascript:alert(1)";
        expect(CatalogueProgramSchema.safeParse(unlocated).success).toBe(false);
    });

    it.each(["no source", "no timezone", "invalid timezone", "conflicting date"] as const)(
        "rejects an exact deadline with %s",
        fault => {
            const invalid = copyProgram();
            const cycle = invalid.cycles[0]!;
            cycle.deadlineAt = "2026-11-30T17:00:00Z";
            cycle.deadlineTimezone = "Europe/London";
            if (fault === "no source") cycle.sourceIds = [];
            else if (fault === "no timezone") cycle.deadlineTimezone = null;
            else if (fault === "invalid timezone") cycle.deadlineTimezone = "Not/A_Timezone";
            else cycle.dateOnly = "2026-11-30";
            expect(CatalogueProgramSchema.safeParse(invalid).success).toBe(false);
        }
    );

    it("accepts an evidenced exact deadline with its timezone", () => {
        const exact = copyProgram();
        exact.cycles[0]!.deadlineAt = "2026-11-30T17:00:00+00:00";
        exact.cycles[0]!.deadlineTimezone = "Europe/London";
        expect(CatalogueProgramSchema.parse(exact).cycles[0]).toMatchObject({
            deadlineAt: "2026-11-30T17:00:00+00:00",
            deadlineTimezone: "Europe/London",
        });
    });

    it("rejects deprecated Form metadata rather than storing it in the Catalogue", () => {
        expect(
            CatalogueProgramSchema.safeParse({
                ...program,
                cycles: [{ ...program.cycles[0], form: { fields: [] } }],
            }).success
        ).toBe(false);
    });

    it("rejects private company-profile payloads at the public record boundary", () => {
        expect(
            CatalogueProgramSchema.safeParse({ ...program, companyProfile: { companyId: 1 } })
                .success
        ).toBe(false);
    });
});
