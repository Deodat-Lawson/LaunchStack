import { describe, expect, it } from "vitest";

import { hashValue } from "./hash";
import {
    AnswerPatchSchema,
    ApplyEditSchema,
    CatalogueProgramSchema,
    FitAssessmentSchema,
    FormFieldSchema,
    assertAnswer,
    canStartForm,
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
    schemaVersion: 1,
    id: "validation-test",
    name: "Validation test Program",
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
    it("keeps unknown limits and dates unknown, and requires a checked supported nonempty Form", () => {
        expect(CatalogueProgramSchema.parse(program)).toEqual(program);
        const form = program.cycles[0]!.form;
        expect(canStartForm(form)).toBe(true);
        expect(canStartForm({ ...form, status: "unconfirmed" })).toBe(false);
        expect(canStartForm({ ...form, supported: false })).toBe(false);
        expect(canStartForm({ ...form, fields: [] })).toBe(false);
        expect(canStartForm({ ...form, checkedAt: null })).toBe(false);
    });

    it("rejects duplicate Field identities and positions, options, unsourced limits, and dangling sources", () => {
        const duplicate = structuredClone(program);
        duplicate.cycles[0]!.form.fields.push({ ...field, key: "another" });
        expect(CatalogueProgramSchema.safeParse(duplicate).success).toBe(false);
        duplicate.cycles[0]!.form.fields[1] = { ...field, position: 1 };
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

describe("typed answers and edits", () => {
    it("allows unfinished required answers, counts UTF16 characters and enforces only actual limits", () => {
        expect(() => assertAnswer(field, null)).not.toThrow();
        expect(() => assertAnswer(field, "a".repeat(5000))).not.toThrow();
        expect(() => assertAnswer({ ...field, charLimit: 1 }, "😀")).toThrow(/character limit/);
        expect(() => assertAnswer({ ...field, wordLimit: 2 }, "one\ntwo three")).toThrow(
            /word limit/
        );
    });

    it("rejects invalid typed values and unknown or repeated choices", () => {
        for (const [fieldType, value] of [
            ["number", "Infinity"],
            ["number", "0x10"],
            ["email", "not-email"],
            ["url", "javascript:alert(1)"],
            ["date", "2026-02-30"],
            ["short_text", "two\nlines"],
        ] as const) {
            expect(() => assertAnswer({ ...field, fieldType }, value)).toThrow();
        }
        const choices: FormField = {
            ...field,
            fieldType: "multi_select",
            options: [{ value: "one", label: "One" }],
        };
        expect(() => assertAnswer(choices, '["one"]')).not.toThrow();
        expect(() => assertAnswer(choices, '["missing"]')).toThrow();
        expect(() => assertAnswer(choices, '["one","one"]')).toThrow();
        expect(() => assertAnswer({ ...field, fieldType: "file" }, "uploaded.pdf")).toThrow(
            /portal/
        );
        expect(() =>
            assertAnswer({ ...field, fieldType: "video" }, "https://example.test/video")
        ).toThrow(/portal/);
    });

    it("requires an authoritative nonnegative revision and a nonempty UTF16 selection", () => {
        expect(AnswerPatchSchema.safeParse({ draft: "answer" }).success).toBe(false);
        expect(AnswerPatchSchema.safeParse({ expectedRevision: -1, draft: "answer" }).success).toBe(
            false
        );
        expect(
            ApplyEditSchema.safeParse({ expectedRevision: 0, start: 1, end: 1, replacement: "" })
                .success
        ).toBe(false);
        expect(
            ApplyEditSchema.safeParse({ expectedRevision: 0, start: 1, end: 2, replacement: "" })
                .success
        ).toBe(true);
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
