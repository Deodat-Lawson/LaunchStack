/**
 * The rendered subject must reach the audit trail.
 *
 * `email_sends.subject` is written by the campaign lifecycle, but the value it
 * was given came from `version.template.subject` — the template's raw form,
 * still holding `{{tokens}}`. So every row read back "Hello {{firstName}}"
 * rather than what the recipient was actually sent.
 *
 * `SendResult` now carries the merged subject and `dispatch.ts` prefers it,
 * falling back to the template only for rows settled before rendering.
 *
 * Pure: no DB, no network. `sendCampaign` is driven directly.
 */

import { sendCampaign } from "@launchstack/pipelines/email/send";
import { RecipientSchema } from "@launchstack/pipelines/email/types";
import type { EmailTemplate, SendResult } from "@launchstack/pipelines/email/types";

const recipient = (over: Record<string, unknown> = {}) =>
    RecipientSchema.parse({ email: "ada@example.com", ...over });

const template: EmailTemplate = {
    subject: "Hello {{firstName}}",
    body: "Hi {{firstName}} — {{senderIdentity}} — {{unsubscribeUrl}}",
    variables: ["firstName", "senderIdentity", "unsubscribeUrl"],
};

const base = {
    template,
    senderIdentity: "Meridian, 12 Mill St",
    // A function, not a base URL: the real link carries a signed per-recipient token.
    unsubscribeUrl: (email: string) => `https://example.com/u/${encodeURIComponent(email)}`,
};

const okAdapter = {
    name: "test",
    send: () => Promise.resolve({ messageId: "m-1" }),
};

describe("sendCampaign records the merged subject, not the template's", () => {
    it("resolves tokens in the recorded subject on a dry run", async () => {
        const [result] = await sendCampaign({
            ...base,
            recipients: [recipient({ name: "Ada Lovelace" })],
            mode: "dry_run",
        });

        expect(result).toMatchObject({ status: "dry_run", subject: "Hello Ada" });
        // The regression this guards: the template's raw form must not be stored.
        expect(result!.subject).not.toBe(template.subject);
        expect(result!.subject).not.toContain("{{");
    });

    it("resolves tokens on a real send", async () => {
        const [result] = await sendCampaign({
            ...base,
            recipients: [recipient({ name: "Grace Hopper" })],
            mode: "send",
            adapter: okAdapter,
        });
        expect(result).toMatchObject({ status: "sent", subject: "Hello Grace" });
    });

    it("differs per recipient, which a template-level subject could never do", async () => {
        const results = await sendCampaign({
            ...base,
            recipients: [
                recipient({ email: "ada@example.com", name: "Ada Lovelace" }),
                recipient({ email: "grace@example.com", name: "Grace Hopper" }),
            ],
            mode: "dry_run",
        });
        expect(results.map(r => r.subject)).toEqual(["Hello Ada", "Hello Grace"]);
    });

    it("keeps the subject when the provider throws, so a retry is diagnosable", async () => {
        const [result] = await sendCampaign({
            ...base,
            recipients: [recipient({ name: "Ada Lovelace" })],
            mode: "send",
            adapter: { name: "test", send: () => Promise.reject(new Error("provider down")) },
        });
        expect(result).toMatchObject({
            status: "failed",
            subject: "Hello Ada",
            error: "provider down",
        });
    });

    it("omits the subject for recipients settled before rendering", async () => {
        const results = await sendCampaign({
            ...base,
            recipients: [
                recipient({ email: "sup@example.com" }),
                recipient({ email: "dupe@example.com" }),
            ],
            mode: "dry_run",
            isSuppressed: email => email === "sup@example.com",
            alreadySent: email => email === "dupe@example.com",
        });

        expect(results.map(r => [r.status, r.subject])).toEqual([
            ["suppressed", undefined],
            ["skipped", undefined],
        ]);
    });

    it("hands the same subject to the record hook that the audit trail stores", async () => {
        const recorded: SendResult[] = [];
        await sendCampaign({
            ...base,
            recipients: [recipient({ name: "Ada Lovelace" })],
            mode: "dry_run",
            record: result => {
                recorded.push(result);
            },
        });
        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.subject).toBe("Hello Ada");
    });
});

describe("dispatch fallback semantics", () => {
    /**
     * dispatch.ts records `result.subject ?? version.template.subject`. Mirrored
     * here so the intent is pinned even though dispatch itself needs a DB.
     */
    const resolve = (result: SendResult, templateSubject: string) =>
        result.subject ?? templateSubject;

    it("prefers the rendered subject when there is one", () => {
        expect(
            resolve(
                { recipientEmail: "a@example.com", status: "sent", subject: "Hello Ada" },
                "Hello {{firstName}}"
            )
        ).toBe("Hello Ada");
    });

    it("falls back to the template for rows settled before rendering", () => {
        expect(
            resolve(
                { recipientEmail: "a@example.com", status: "suppressed" },
                "Hello {{firstName}}"
            )
        ).toBe("Hello {{firstName}}");
    });
});
