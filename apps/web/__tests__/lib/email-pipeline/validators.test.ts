/**
 * Deterministic validation (member.md Phase 2) and the seed templates (Phase 5).
 *
 * These are the checks that decide whether an email may be sent at all, so they
 * are tested on positive, negative, empty and malformed input.
 */

import { createMerge } from "@launchstack/pipelines/email/merge";
import { RecipientSchema } from "@launchstack/pipelines/email/types";
import type { EmailTemplate } from "@launchstack/pipelines/email/types";
import { SEED_TEMPLATES, seedTemplate } from "@launchstack/pipelines/email/templates";
import {
    SUBJECT_MAX_CHARS,
    SUBJECT_RECOMMENDED_CHARS,
    assertSendable,
    hasErrors,
    resolveRecipientField,
    templateTokens,
    validateEmailAddress,
    validateRecipients,
    validateRendered,
    validateTemplate,
} from "@launchstack/pipelines/email/validators";

const recipient = (over: Record<string, unknown> = {}) =>
    RecipientSchema.parse({ email: "ada@example.com", ...over });

const codes = (issues: { code: string }[]) => issues.map(i => i.code);

const goodTemplate: EmailTemplate = {
    subject: "A short subject",
    body: "Hi {{firstName}} — {{senderIdentity}} — {{unsubscribeUrl}}",
    variables: ["firstName", "senderIdentity", "unsubscribeUrl"],
};

describe("validateEmailAddress", () => {
    it("accepts a normal address", () => {
        expect(validateEmailAddress("ada@example.com")).toEqual([]);
    });

    it("flags an empty address", () => {
        expect(codes(validateEmailAddress(""))).toEqual(["email_empty"]);
    });

    it("flags a malformed address", () => {
        expect(codes(validateEmailAddress("nope"))).toContain("email_format");
    });

    it("flags a CRLF header-injection attempt", () => {
        const issues = validateEmailAddress("ada@example.com\nBcc: evil@example.com");
        expect(codes(issues)).toContain("email_crlf");
    });

    it("flags an over-long address", () => {
        const long = `${"a".repeat(320)}@example.com`;
        expect(codes(validateEmailAddress(long))).toContain("email_too_long");
    });
});

describe("validateRecipients", () => {
    it("passes a clean list", () => {
        const r = validateRecipients([recipient(), recipient({ email: "grace@example.com" })]);
        expect(r.valid).toHaveLength(2);
        expect(r.rejected).toEqual([]);
    });

    it("rejects a duplicate and keeps the first", () => {
        const r = validateRecipients([recipient({ name: "First" }), recipient({ name: "Second" })]);
        expect(r.valid).toHaveLength(1);
        expect(r.valid[0]!.name).toBe("First");
        expect(codes(r.rejected[0]!.issues)).toContain("duplicate");
    });

    it("treats differing case as the same address", () => {
        const r = validateRecipients([
            recipient({ email: "ada@example.com" }),
            RecipientSchema.parse({ email: "ADA@example.com" }),
        ]);
        expect(r.valid).toHaveLength(1);
    });

    it("rejects a suppressed address", () => {
        const r = validateRecipients([recipient()], {
            suppressed: new Set(["ada@example.com"]),
        });
        expect(r.valid).toEqual([]);
        expect(codes(r.rejected[0]!.issues)).toContain("suppressed");
    });

    it("flags — but keeps — a recipient missing a personalization field", () => {
        const r = validateRecipients([recipient()], { requiredFields: ["firstName"] });
        expect(r.valid).toHaveLength(1);
        expect(codes(r.warnings[0]!.issues)).toContain("missing_field");
    });

    it("does not warn when the field is present", () => {
        const r = validateRecipients([recipient({ name: "Ada" })], {
            requiredFields: ["firstName"],
        });
        expect(r.warnings).toEqual([]);
    });

    it("handles an empty list", () => {
        expect(validateRecipients([])).toEqual({ valid: [], rejected: [], warnings: [] });
    });
});

describe("resolveRecipientField", () => {
    it("derives firstName from name", () => {
        expect(resolveRecipientField(recipient({ name: "Ada Lovelace" }), "firstName")).toBe("Ada");
    });

    it("reads a custom var", () => {
        expect(resolveRecipientField(recipient({ vars: { industry: "Rail" } }), "industry")).toBe(
            "Rail"
        );
    });

    it("returns null when absent", () => {
        expect(resolveRecipientField(recipient(), "firstName")).toBeNull();
        expect(resolveRecipientField(recipient(), "nothing")).toBeNull();
    });
});

describe("validateTemplate", () => {
    it("passes a well-formed template", () => {
        expect(validateTemplate(goodTemplate)).toEqual([]);
    });

    it("requires an unsubscribe token", () => {
        const t = {
            ...goodTemplate,
            body: "Hi {{firstName}} {{senderIdentity}}",
            variables: ["firstName", "senderIdentity"],
        };
        expect(codes(validateTemplate(t))).toContain("missing_unsubscribe_token");
    });

    it("rejects an empty subject or body", () => {
        expect(codes(validateTemplate({ ...goodTemplate, subject: "  " }))).toContain(
            "subject_empty"
        );
        expect(codes(validateTemplate({ ...goodTemplate, body: "  " }))).toContain("body_empty");
    });

    it("rejects a newline in the subject", () => {
        expect(codes(validateTemplate({ ...goodTemplate, subject: "a\nb" }))).toContain(
            "subject_crlf"
        );
    });

    it("errors past the hard subject limit and warns past the recommended one", () => {
        const tooLong = { ...goodTemplate, subject: "x".repeat(SUBJECT_MAX_CHARS + 1) };
        expect(codes(validateTemplate(tooLong))).toContain("subject_too_long");

        const longish = { ...goodTemplate, subject: "x".repeat(SUBJECT_RECOMMENDED_CHARS + 1) };
        const issues = validateTemplate(longish);
        expect(codes(issues)).toContain("subject_long");
        expect(hasErrors(issues)).toBe(false);
    });

    it("warns when a used token is not declared in variables", () => {
        const t = { ...goodTemplate, body: `${goodTemplate.body} {{extra}}` };
        expect(codes(validateTemplate(t))).toContain("undeclared_variable");
    });

    it("lists every distinct token", () => {
        expect(templateTokens(goodTemplate).sort()).toEqual([
            "firstName",
            "senderIdentity",
            "unsubscribeUrl",
        ]);
    });
});

describe("validateRendered", () => {
    const opts = {
        senderIdentity: "Meridian, 12 Mill St",
        unsubscribeUrl: "https://x.example/u/1",
    };
    const ok = {
        subject: "Hello",
        body: `Hi Ada — ${opts.senderIdentity} — ${opts.unsubscribeUrl}`,
    };

    it("passes a fully rendered compliant email", () => {
        expect(validateRendered(ok, opts)).toEqual([]);
    });

    it("errors — not warns — on an unresolved token", () => {
        const issues = validateRendered({ ...ok, body: `${ok.body} {{firstName}}` }, opts);
        expect(codes(issues)).toContain("unresolved_tokens");
        expect(hasErrors(issues)).toBe(true);
    });

    it("catches a missing unsubscribe link", () => {
        expect(
            codes(validateRendered({ ...ok, body: "Hi Ada — Meridian, 12 Mill St" }, opts))
        ).toContain("missing_unsubscribe");
    });

    it("catches a missing sender identity", () => {
        expect(
            codes(validateRendered({ ...ok, body: `Hi Ada — ${opts.unsubscribeUrl}` }, opts))
        ).toContain("missing_sender_identity");
    });

    it("handles empty and malformed input safely", () => {
        expect(() => validateRendered({ subject: "", body: "" }, opts)).not.toThrow();
        expect(() => validateRendered(undefined as never, opts)).not.toThrow();
    });
});

describe("assertSendable", () => {
    const opts = { senderIdentity: "S", unsubscribeUrl: "U" };

    it("does not throw on a valid email", () => {
        expect(() => assertSendable({ subject: "s", body: "b S U" }, opts)).not.toThrow();
    });

    it("throws on an unresolved token", () => {
        expect(() => assertSendable({ subject: "s", body: "{{x}} S U" }, opts)).toThrow(
            /refusing to send/
        );
    });
});

describe("seed templates", () => {
    it("every seed passes template validation as shipped", () => {
        for (const seed of SEED_TEMPLATES) {
            expect({ id: seed.id, issues: validateTemplate(seed.template) }).toEqual({
                id: seed.id,
                issues: [],
            });
        }
    });

    it("every seed renders with no leftover tokens given full data", () => {
        const senderIdentity = "Meridian Rail Systems, Duluth MN";
        const unsubscribeUrl = "https://meridianrail.example/u/1";

        const render = createMerge({
            companyFields: {
                ownerCompany: "Meridian Rail Systems",
                valueProp: "Scheduling for short-line railroads.",
                proofPoint: "Cedar Ridge: interchange 71% to 88%.",
                ctaLink: "https://meridianrail.example",
            },
            compliance: { unsubscribeUrl, senderIdentity },
        });

        const recipientWithEverything = RecipientSchema.parse({
            email: "ada@example.com",
            name: "Ada Lovelace",
            company: "Analytical Engines",
            contextNotes: "runs a 180-mile short line",
        });

        for (const seed of SEED_TEMPLATES) {
            const rendered = render(seed.template, recipientWithEverything);
            expect({
                id: seed.id,
                issues: validateRendered(rendered, { senderIdentity, unsubscribeUrl }),
            }).toEqual({ id: seed.id, issues: [] });
        }
    });

    it("declares every token it uses", () => {
        for (const seed of SEED_TEMPLATES) {
            expect(templateTokens(seed.template).sort()).toEqual(
                [...seed.template.variables].sort()
            );
        }
    });

    it("looks up a seed by id", () => {
        expect(seedTemplate("intro")?.name).toBe("Cold intro");
        expect(seedTemplate("nope")).toBeUndefined();
    });
});
