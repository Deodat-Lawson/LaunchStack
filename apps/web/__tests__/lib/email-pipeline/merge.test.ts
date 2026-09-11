/**
 * Per-recipient rendering (member.md Phase 3).
 *
 * Covers the cases member.md calls out — missing recipient fields, repeated
 * tokens, tokens in subject and body, unknown tokens — plus the precedence
 * rule that stops recipient data from overriding compliance values.
 */

import {
    DEFAULT_FALLBACKS,
    createMerge,
    merge,
    mergeStrict,
    renderTokens,
    simpleMerge,
    unresolvedTokens,
} from "@launchstack/pipelines/email/merge";
import { RecipientSchema } from "@launchstack/pipelines/email/types";
import type { EmailTemplate } from "@launchstack/pipelines/email/types";

const recipient = (over: Record<string, unknown> = {}) =>
    RecipientSchema.parse({ email: "ada@example.com", ...over });

const tpl = (subject: string, body: string): EmailTemplate => ({
    subject,
    body,
    variables: [],
});

describe("renderTokens", () => {
    it("substitutes a known token", () => {
        expect(renderTokens("Hi {{firstName}}", { firstName: "Ada" })).toBe("Hi Ada");
    });

    it("tolerates whitespace inside the braces", () => {
        expect(renderTokens("Hi {{  firstName  }}", { firstName: "Ada" })).toBe("Hi Ada");
    });

    it("replaces every occurrence of a repeated token", () => {
        expect(renderTokens("{{a}}-{{a}}-{{a}}", { a: "x" })).toBe("x-x-x");
    });

    it("leaves an unknown token intact so the guard can catch it", () => {
        expect(renderTokens("Hi {{nope}}", {})).toBe("Hi {{nope}}");
    });

    it("handles empty and undefined input", () => {
        expect(renderTokens("", {})).toBe("");
        expect(renderTokens(undefined as unknown as string, {})).toBe("");
    });
});

describe("unresolvedTokens", () => {
    it("lists what is still unfilled", () => {
        expect(unresolvedTokens("Hi {{a}} and {{b}}")).toEqual(["a", "b"]);
    });

    it("returns nothing for fully rendered text", () => {
        expect(unresolvedTokens("Hi Ada")).toEqual([]);
    });
});

describe("createMerge", () => {
    it("renders tokens in both subject and body", () => {
        const out = createMerge()(
            tpl("For {{recipientCompany}}", "Hi {{firstName}},"),
            recipient({ name: "Ada Lovelace", company: "Analytical Engines" })
        );
        expect(out.subject).toBe("For Analytical Engines");
        expect(out.body).toBe("Hi Ada,");
    });

    it("uses the first word of the name for firstName", () => {
        const out = createMerge()(tpl("s", "{{firstName}}"), recipient({ name: "Ada Lovelace" }));
        expect(out.body).toBe("Ada");
    });

    it("falls back when the recipient has no name or company", () => {
        const out = createMerge()(tpl("{{recipientCompany}}", "{{firstName}}"), recipient());
        expect(out.body).toBe(DEFAULT_FALLBACKS.firstName);
        expect(out.subject).toBe(DEFAULT_FALLBACKS.recipientCompany);
    });

    it("prefers a real name over the fallback", () => {
        const out = createMerge()(tpl("s", "{{firstName}}"), recipient({ name: "Grace" }));
        expect(out.body).toBe("Grace");
    });

    it("lets recipient vars override a derived field", () => {
        const out = createMerge()(
            tpl("s", "{{firstName}}"),
            recipient({ name: "Ada Lovelace", vars: { firstName: "Countess" } })
        );
        expect(out.body).toBe("Countess");
    });

    it("lets recipient data override company fields", () => {
        const out = createMerge({ companyFields: { valueProp: "generic" } })(
            tpl("s", "{{valueProp}}"),
            recipient({ vars: { valueProp: "specific" } })
        );
        expect(out.body).toBe("specific");
    });

    it("resolves company fields when the recipient has nothing to say", () => {
        const out = createMerge({ companyFields: { ownerCompany: "Meridian" } })(
            tpl("s", "{{ownerCompany}}"),
            recipient()
        );
        expect(out.body).toBe("Meridian");
    });

    it("does NOT let recipient data override the unsubscribe link", () => {
        const out = createMerge({
            compliance: { unsubscribeUrl: "https://real.example/u/1" },
        })(
            tpl("s", "{{unsubscribeUrl}}"),
            recipient({ vars: { unsubscribeUrl: "https://evil.example" } })
        );
        expect(out.body).toBe("https://real.example/u/1");
    });

    it("does NOT let recipient data override the sender identity", () => {
        const out = createMerge({
            compliance: { senderIdentity: "Meridian, 12 Mill St" },
        })(tpl("s", "{{senderIdentity}}"), recipient({ vars: { senderIdentity: "Someone Else" } }));
        expect(out.body).toBe("Meridian, 12 Mill St");
    });

    it("ignores blank recipient vars rather than rendering an empty string", () => {
        const out = createMerge()(
            tpl("s", "{{firstName}}"),
            recipient({ name: "Ada", vars: { firstName: "   " } })
        );
        expect(out.body).toBe("Ada");
    });

    it("leaves genuinely unknown tokens for the guard", () => {
        const out = createMerge()(tpl("s", "{{noSuchThing}}"), recipient());
        expect(out.body).toBe("{{noSuchThing}}");
    });

    it("survives a malformed template without throwing", () => {
        const out = createMerge()(
            { subject: undefined, body: undefined } as unknown as EmailTemplate,
            recipient()
        );
        expect(out).toEqual({ subject: "", body: "" });
    });
});

describe("mergeStrict", () => {
    const complete = { compliance: { unsubscribeUrl: "u", senderIdentity: "s" } };

    it("returns the rendered email when everything resolves", () => {
        const out = mergeStrict(
            tpl("Hi", "{{firstName}} {{unsubscribeUrl}} {{senderIdentity}}"),
            recipient({ name: "Ada" }),
            complete
        );
        expect(out.body).toBe("Ada u s");
    });

    it("throws rather than deliver a half-filled email", () => {
        expect(() =>
            mergeStrict(tpl("Hi", "Hello {{missingThing}}"), recipient(), complete)
        ).toThrow(/unresolved merge tokens/i);
    });

    it("names the recipient and the offending token in the error", () => {
        expect(() => mergeStrict(tpl("Hi", "{{missingThing}}"), recipient(), complete)).toThrow(
            /ada@example\.com.*\{\{missingThing\}\}/s
        );
    });

    it("catches an unresolved token in the subject too", () => {
        expect(() => mergeStrict(tpl("Hi {{gone}}", "body"), recipient(), complete)).toThrow(
            /gone/
        );
    });
});

describe("merge / simpleMerge", () => {
    it("merge() is the one-shot form of createMerge", () => {
        const t = tpl("s", "{{firstName}}");
        const r = recipient({ name: "Ada" });
        expect(merge(t, r)).toEqual(createMerge()(t, r));
    });

    it("simpleMerge stays behaviour-compatible for existing callers", () => {
        const out = simpleMerge(tpl("{{recipientCompany}}", "{{firstName}}"), recipient());
        expect(out).toEqual({ subject: "your team", body: "there" });
    });
});
