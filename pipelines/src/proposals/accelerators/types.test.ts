import { describe, expect, it } from "vitest";

import { hashValue } from "./hash";
import {
    CatalogueProgramSchema,
    FitAssessmentSchema,
    FormFieldSchema,
    type CatalogueProgram,
    type FormField,
} from "./types";

const field: FormField = {
    key: "answer",
    position: 0,
    question: "Describe the company",
    guidance: null,
    fieldType: "long_text",
    required: true,
    options: [],
    charLimit: null,
    wordLimit: null,
    limitConfirmed: false,
    limitSource: null,
};
const program: CatalogueProgram = {
    schemaVersion: 2,
    id: "validation-test",
    name: "Validation test Program",
    logo: { path: "/accelerators/logos/validation-test.png", sourceId: "official" },
    websiteUrl: "https://example.test/",
    applyUrl: "https://example.test/apply",
    description: { text: "A test description", sourceIds: ["official"], interpretation: false },
    targetApplicants: { text: "Test applicants", sourceIds: ["official"], interpretation: false },
    sources: [
        {
            id: "official",
            url: "https://example.test/apply",
            title: "Official test source",
            quote: "Describe the company",
            checkedAt: "2026-10-25T00:00:00Z",
        },
    ],
    cycles: [
        {
            id: "rolling",
            label: "Rolling",
            deadlineAt: null,
            deadlineTimezone: null,
            rolling: true,
            sourceIds: ["official"],
            form: {
                id: "test-form",
                status: "checked",
                sourceUrl: "https://example.test/apply",
                checkedAt: "2026-10-25T00:00:00Z",
                supported: true,
                limitations: [],
                fields: [field],
            },
        },
    ],
};

describe("Catalogue and Form validation", () => {
    it("keeps unknown limits and dates unknown in existing Form metadata", () => {
        expect(CatalogueProgramSchema.parse(program)).toEqual(program);
        expect(program.cycles[0]!.deadlineAt).toBeNull();
        expect(program.cycles[0]!.form!.fields[0]!.charLimit).toBeNull();
        expect(program.cycles[0]!.form!.fields[0]!.wordLimit).toBeNull();
    });

    it("validates discovery cycles without Form metadata and preserves sourced cycle details", () => {
        const discovery = structuredClone(program);
        delete discovery.cycles[0]!.form;
        discovery.cycles[0]!.dateOnly = "2026-11-02";
        const parsed = CatalogueProgramSchema.parse(discovery);
        expect(parsed).toEqual(discovery);
        expect(parsed.cycles[0]).toEqual({
            id: "rolling",
            label: "Rolling",
            deadlineAt: null,
            deadlineTimezone: null,
            dateOnly: "2026-11-02",
            rolling: true,
            sourceIds: ["official"],
        });
        expect(hashValue(parsed)).toBe(hashValue(discovery));
    });

    it("rejects missing logos, external logo requests, and untraceable logo sources", () => {
        expect(CatalogueProgramSchema.safeParse({ ...program, logo: undefined }).success).toBe(
            false
        );
        expect(
            CatalogueProgramSchema.safeParse({
                ...program,
                logo: { ...program.logo, path: "https://tracker.example/logo.png" },
            }).success
        ).toBe(false);
        expect(
            CatalogueProgramSchema.safeParse({
                ...program,
                logo: { ...program.logo, sourceId: "missing" },
            }).success
        ).toBe(false);
    });

    it("keeps location optional but requires traceable sources when supplied", () => {
        expect(CatalogueProgramSchema.parse(program).location).toBeUndefined();
        const located = {
            ...program,
            location: {
                text: "London, United Kingdom",
                sourceIds: ["official"],
                interpretation: false,
            },
        };
        expect(CatalogueProgramSchema.parse(located).location).toEqual(located.location);
        expect(
            CatalogueProgramSchema.safeParse({
                ...located,
                location: { ...located.location, sourceIds: ["missing"] },
            }).success
        ).toBe(false);
    });

    it("rejects duplicate Field identities and positions, options, unsourced limits, and dangling sources", () => {
        const duplicate = structuredClone(program);
        duplicate.cycles[0]!.form!.fields.push({ ...field, key: "another" });
        expect(CatalogueProgramSchema.safeParse(duplicate).success).toBe(false);
        duplicate.cycles[0]!.form!.fields[1] = { ...field, position: 1 };
        expect(CatalogueProgramSchema.safeParse(duplicate).success).toBe(false);
        expect(FormFieldSchema.safeParse({ ...field, charLimit: 100 }).success).toBe(false);
        expect(
            FormFieldSchema.safeParse({
                ...field,
                fieldType: "select",
                options: [
                    { value: "a", label: "A" },
                    { value: "a", label: "Again" },
                ],
            }).success
        ).toBe(false);
        const dangling = structuredClone(program);
        dangling.description.sourceIds = ["missing"];
        expect(CatalogueProgramSchema.safeParse(dangling).success).toBe(false);
    });

    it("does not fabricate an instant for a date-only deadline", () => {
        const dated = structuredClone(program);
        dated.cycles[0]!.dateOnly = "2026-11-02";
        expect(CatalogueProgramSchema.parse(dated).cycles[0]!.deadlineAt).toBeNull();
        dated.cycles[0]!.dateOnly = "2026-02-30";
        expect(CatalogueProgramSchema.safeParse(dated).success).toBe(false);
    });
});

describe("fit assessment validation", () => {
    it("rejects scores outside the match range", () => {
        expect(
            FitAssessmentSchema.safeParse({
                score: 101,
                reasons: [],
                concerns: [],
                unknowns: [],
                sourceIds: [],
                companyEvidenceIds: [],
            }).success
        ).toBe(false);
    });
});

describe("canonical JSON hashing", () => {
    it("ignores object key insertion order but preserves ordered arrays and changed values", () => {
        expect(hashValue({ b: { z: 1, a: 2 }, a: [1, 2] })).toBe(
            hashValue({ a: [1, 2], b: { a: 2, z: 1 } })
        );
        expect(hashValue({ a: [1, 2] })).not.toBe(hashValue({ a: [2, 1] }));
        expect(hashValue(program)).toMatch(/^[a-f0-9]{64}$/);
    });
});
