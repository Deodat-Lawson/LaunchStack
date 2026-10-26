import { describe, expect, it } from "vitest";

import { PROPOSAL_CREDITS } from "../ports";
import { stepsFor } from "../run";
import { RUN_KINDS, RunInputSchema } from "../types";
import { ApplyEditSchema, EditSuggestionRequestSchema } from "./types";

const selection = {
    sectionId: "section-1",
    expectedRevision: 3,
    start: 2,
    end: 5,
    instruction: "Make it clearer",
};

describe("selected-text Apply contract", () => {
    const apply = {
        expectedRevision: 1,
        start: 10,
        end: 13,
        original: "old",
        replacement: "new",
    };

    it("requires the original text and its UTF-16 length to match the range", () => {
        expect(ApplyEditSchema.safeParse(apply).success).toBe(true);
        const withoutOriginal: Record<string, unknown> = { ...apply };
        delete withoutOriginal.original;
        expect(ApplyEditSchema.safeParse(withoutOriginal).success).toBe(false);
        expect(ApplyEditSchema.safeParse({ ...apply, original: "" }).success).toBe(false);
        expect(ApplyEditSchema.safeParse({ ...apply, original: "older" }).success).toBe(false);
    });

    it("measures the range in UTF-16 code units, so an emoji counts as two", () => {
        expect(
            ApplyEditSchema.safeParse({ ...apply, start: 0, end: 2, original: "😀" }).success
        ).toBe(true);
        expect(
            ApplyEditSchema.safeParse({ ...apply, start: 0, end: 1, original: "😀" }).success
        ).toBe(false);
    });

    it("rejects unknown keys", () => {
        expect(ApplyEditSchema.safeParse({ ...apply, extra: true }).success).toBe(false);
    });

    it("still allows an empty replacement, which deletes the selection", () => {
        expect(ApplyEditSchema.safeParse({ ...apply, replacement: "" }).success).toBe(true);
    });
});

describe("accel_edit run input", () => {
    it("accepts a valid selection and rejects extra keys", () => {
        expect(RunInputSchema.safeParse({ acceleratorEdit: selection }).success).toBe(true);
        expect(
            RunInputSchema.safeParse({ acceleratorEdit: { ...selection, extra: 1 } }).success
        ).toBe(false);
    });

    it("rejects an empty or reversed range and a blank instruction", () => {
        for (const bad of [
            { ...selection, start: 5, end: 5 },
            { ...selection, start: 6, end: 5 },
            { ...selection, instruction: "   " },
            { ...selection, expectedRevision: -1 },
        ]) {
            expect(RunInputSchema.safeParse({ acceleratorEdit: bad }).success).toBe(false);
        }
    });

    it("stays aligned with the public request contract", () => {
        const request: Record<string, unknown> = { ...selection };
        delete request.sectionId;
        expect(EditSuggestionRequestSchema.safeParse(request).success).toBe(true);
        expect(
            EditSuggestionRequestSchema.safeParse({ ...request, start: 5, end: 5 }).success
        ).toBe(false);
    });
});

describe("accel_edit run kind", () => {
    it("is a registered kind with its own price", () => {
        expect(RUN_KINDS).toContain("accel_edit");
        expect(PROPOSAL_CREDITS.accel_edit).toBe(1_000);
    });

    it("shows the same generate and save steps as the other Accelerator runs", () => {
        const steps = stepsFor("accel_edit", { acceleratorEdit: selection });
        expect(steps.map(step => step.id)).toEqual(["generate", "save"]);
        expect(steps.every(step => step.status === "waiting")).toBe(true);
    });
});
