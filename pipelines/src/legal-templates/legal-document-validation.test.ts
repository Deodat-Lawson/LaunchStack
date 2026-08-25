import { describe, expect, it } from "vitest";

import { validateFieldValue } from "./legal-document-validation";
import type { TemplateField } from "./template-registry";

const field = (over: Partial<TemplateField> = {}): TemplateField => ({
    key: "company_name",
    label: "Company name",
    type: "text",
    required: true,
    ...over,
});

describe("validateFieldValue", () => {
    it("accepts a filled required text field", () => {
        expect(validateFieldValue("company_name", "LaunchStack Oy", field())).toBeNull();
    });

    it("treats an untouched [placeholder] as missing for a required field", () => {
        expect(validateFieldValue("company_name", "[company_name]", field())).toMatch(/required/);
    });

    it("strips markup and zero-width placeholders before judging emptiness", () => {
        expect(validateFieldValue("company_name", "<p>​</p>", field())).toMatch(/required/);
        expect(validateFieldValue("company_name", "<b>ACME</b>", field())).toBeNull();
    });

    it("lets an optional empty field pass", () => {
        expect(validateFieldValue("company_name", "", field({ required: false }))).toBeNull();
    });

    it("validates numbers: NaN, negatives, and percentage bounds", () => {
        const pct = field({ key: "equity_percentage", label: "Equity %", type: "number" });
        expect(validateFieldValue("equity_percentage", "abc", pct)).toMatch(/valid number/);
        expect(validateFieldValue("equity_percentage", "-1", pct)).toMatch(/negative/);
        expect(validateFieldValue("equity_percentage", "150", pct)).toMatch(/between 0% and 100%/);
        expect(validateFieldValue("equity_percentage", "25", pct)).toBeNull();
    });

    it("rejects a select value outside the declared options", () => {
        const sel = field({ type: "select", options: ["Delaware", "Finland"] });
        expect(validateFieldValue("company_name", "Mars", sel)).toMatch(/Invalid value/);
        expect(validateFieldValue("company_name", "Finland", sel)).toBeNull();
    });
});
