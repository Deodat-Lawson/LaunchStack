import { resolveAutomationPolicy } from "@launchstack/pipelines/email";

import { AutomatedRunSchema } from "~/app/api/email-campaigns/_lib/schemas";

/**
 * The automation policy decides whether an unattended run may send a template
 * the AI reviewer asked to revise. That decision must belong to the server: a
 * policy any caller can relax is not a gate.
 */

const baseBody = {
    name: "August outreach",
    recipients: [{ email: "person@example.com" }],
};

describe("automation policy is server-controlled", () => {
    it("requires a passing review by default", () => {
        expect(resolveAutomationPolicy({})).toEqual({
            requireReviewPass: true,
            maxRecipients: 200,
        });
    });

    it("only relaxes the review gate through server configuration", () => {
        expect(
            resolveAutomationPolicy({ EMAIL_AUTOMATION_ALLOW_UNREVIEWED: "true" }).requireReviewPass
        ).toBe(false);

        // Anything other than an explicit "true" keeps the gate closed.
        for (const value of ["false", "1", "yes", "TRUE", ""]) {
            expect(
                resolveAutomationPolicy({ EMAIL_AUTOMATION_ALLOW_UNREVIEWED: value })
                    .requireReviewPass
            ).toBe(true);
        }
    });

    it("falls back to a sane recipient cap when misconfigured", () => {
        expect(
            resolveAutomationPolicy({ EMAIL_AUTOMATION_MAX_RECIPIENTS: "25" }).maxRecipients
        ).toBe(25);

        for (const value of ["0", "-5", "abc", "1.5", ""]) {
            expect(
                resolveAutomationPolicy({ EMAIL_AUTOMATION_MAX_RECIPIENTS: value }).maxRecipients
            ).toBe(200);
        }
    });

    it("rejects a request that tries to supply its own policy", () => {
        // The bypass this guards: post a policy that disables the review gate.
        const attack = AutomatedRunSchema.safeParse({
            ...baseBody,
            policy: { requireReviewPass: false, overrideReason: "anything" },
        });

        expect(attack.success).toBe(false);
    });

    it("rejects any unknown field rather than silently ignoring it", () => {
        for (const extra of [
            { requireReviewPass: false },
            { maxRecipients: 100000 },
            { overrideReason: "ship it" },
            { approvedByKind: "human" },
        ]) {
            expect(AutomatedRunSchema.safeParse({ ...baseBody, ...extra }).success).toBe(false);
        }
    });

    it("still accepts a well-formed request", () => {
        const parsed = AutomatedRunSchema.safeParse({
            ...baseBody,
            goal: "Introduce us to CTOs",
            mode: "dry_run",
            idempotencyKey: "run-1",
        });

        expect(parsed.success).toBe(true);
    });
});
