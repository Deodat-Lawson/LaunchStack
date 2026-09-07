import { describe, expect, it } from "vitest";

import { RecipientSchema, type Recipient } from "./types";
import { EMAIL_MAX_CHARS, hasErrors, validateEmailAddress, validateRecipients } from "./validators";

const recipient = (email: string, extra: Partial<Recipient> = {}): Recipient =>
    RecipientSchema.parse({ email, ...extra });

describe("validateEmailAddress", () => {
    it("accepts a plain valid address", () => {
        expect(validateEmailAddress("ada@example.com")).toEqual([]);
    });

    it("rejects an empty address without running the other checks", () => {
        const issues = validateEmailAddress("   ");
        expect(issues).toHaveLength(1);
        expect(issues[0]?.code).toBe("email_empty");
    });

    it("names header injection for what it is", () => {
        const issues = validateEmailAddress("ada@example.com\r\nBCC: victim@example.com");
        expect(issues.map(i => i.code)).toContain("email_crlf");
    });

    it("enforces the RFC 5321 length ceiling", () => {
        const local = "a".repeat(EMAIL_MAX_CHARS);
        const issues = validateEmailAddress(`${local}@example.com`);
        expect(issues.map(i => i.code)).toContain("email_too_long");
    });
});

describe("validateRecipients", () => {
    it("keeps the first occurrence of a duplicate and rejects the second", () => {
        const result = validateRecipients([
            recipient("ada@example.com"),
            recipient("ADA@example.com"),
        ]);
        expect(result.valid).toHaveLength(1);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0]?.issues.map(i => i.code)).toContain("duplicate");
    });

    it("blocks suppressed addresses instead of silently dropping them", () => {
        const result = validateRecipients([recipient("gone@example.com")], {
            suppressed: new Set(["gone@example.com"]),
        });
        expect(result.valid).toEqual([]);
        expect(result.rejected[0]?.issues.map(i => i.code)).toContain("suppressed");
    });

    it("warns — not rejects — when a required personalization field is missing", () => {
        const result = validateRecipients([recipient("ada@example.com")], {
            requiredFields: ["company"],
        });
        expect(result.valid).toHaveLength(1);
        expect(result.warnings[0]?.issues.map(i => i.code)).toContain("missing_field");
        expect(hasErrors(result.warnings[0]?.issues ?? [])).toBe(false);
    });
});
