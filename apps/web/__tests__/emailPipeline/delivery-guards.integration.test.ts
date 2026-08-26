import {
    addSuppression,
    appendTemplateVersion,
    approveEmailCampaign,
    createCampaign,
    dispatchEmailCampaign,
    upsertRecipients,
    type SendAdapter,
} from "@launchstack/pipelines/email";

import { createEmailPipelineTestDatabase, type EmailPipelineTestDatabase } from "./testDb";

/**
 * Delivery guards that the lifecycle suite does not cover: the campaign-level
 * recipient claim under CONCURRENT distinct idempotency keys, DB-backed
 * suppression end-to-end, tenant isolation on the staged flow, and the
 * frozen-audience rule against post-freeze additions.
 */

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const TEMPLATE = {
    subject: "Hello {{firstName}}",
    body: "Hi {{firstName}} at {{recipientCompany}} — {{senderIdentity}} {{unsubscribeUrl}}",
    variables: ["firstName", "recipientCompany", "senderIdentity", "unsubscribeUrl"],
};

const PASSING_REVIEW = {
    scores: [],
    issues: [],
    verdict: "pass" as const,
    summary: "ok",
};

function recipients(n: number, prefix = "person") {
    return Array.from({ length: n }, (_, i) => ({
        email: `${prefix}${i}@example.com`,
        name: `Person ${i}`,
        company: `Company ${i}`,
        contextNotes: null,
        vars: {},
    }));
}

/** Adapter that records every delivery and can slow down to force overlap. */
function countingAdapter(delayMs = 0) {
    const delivered: string[] = [];
    const adapter: SendAdapter = {
        name: "counting",
        async send(email) {
            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
            delivered.push(email.to);
            return { messageId: `msg-${delivered.length}` };
        },
    };
    return { adapter, delivered };
}

describeIfDatabase("email delivery guards", () => {
    let harness: EmailPipelineTestDatabase;

    beforeAll(async () => {
        harness = await createEmailPipelineTestDatabase();
    }, 120_000);

    afterAll(async () => {
        await harness?.close();
    });

    async function seedApprovedCampaign(audience = recipients(8)) {
        const companyId = await harness.createCompany();
        const campaign = await createCampaign({ companyId, name: "Guards" });
        const version = await appendTemplateVersion({
            campaignId: campaign.id,
            template: TEMPLATE,
            source: "ai_generated",
            review: PASSING_REVIEW,
        });
        await upsertRecipients(campaign.id, audience);
        await approveEmailCampaign({
            companyId,
            campaignId: campaign.id,
            templateVersionId: version.id,
            approvedByEmail: "approver@example.com",
        });
        return { companyId, campaignId: campaign.id, versionId: version.id };
    }

    const dispatchArgs = (companyId: number, campaignId: number) => ({
        companyId,
        campaignId,
        senderIdentity: "sender@example.com",
        unsubscribeBaseUrl: "https://example.com/api/email-pipeline/unsubscribe",
    });

    it("never double-delivers under two CONCURRENT distinct idempotency keys", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign(recipients(10));
        const { adapter, delivered } = countingAdapter(5);

        const dispatch = (key: string) =>
            dispatchEmailCampaign({
                ...dispatchArgs(companyId, campaignId),
                idempotencyKey: key,
                mode: "send",
                adapter,
                ratePerMinute: 6_000_000,
            }).catch((err: unknown) => err);

        await Promise.all([dispatch("key-A"), dispatch("key-B")]);

        const perAddress = new Map<string, number>();
        for (const to of delivered) {
            perAddress.set(to, (perAddress.get(to) ?? 0) + 1);
        }
        for (const [address, count] of perAddress) {
            expect({ address, count }).toEqual({ address, count: 1 });
        }
        // Every recipient was delivered exactly once across the two attempts.
        expect(delivered).toHaveLength(10);
    }, 60_000);

    it("suppresses a DB-suppressed address end-to-end and delivers the rest", async () => {
        const audience = recipients(5, "supp");
        const { companyId, campaignId } = await seedApprovedCampaign(audience);
        await addSuppression(companyId, "supp2@example.com");
        const { adapter, delivered } = countingAdapter();

        const result = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "supp-key",
            mode: "send",
            adapter,
            ratePerMinute: 6_000_000,
        });

        expect(delivered).not.toContain("supp2@example.com");
        expect(delivered).toHaveLength(4);
        const suppressed = result.results.filter(r => r.status === "suppressed");
        expect(suppressed.map(r => r.recipientEmail)).toEqual(["supp2@example.com"]);
    }, 60_000);

    it("does not suppress across companies", async () => {
        const audience = recipients(2, "tenant");
        const { companyId, campaignId } = await seedApprovedCampaign(audience);
        const otherCompany = await harness.createCompany();
        await addSuppression(otherCompany, "tenant0@example.com");
        const { adapter, delivered } = countingAdapter();

        await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "tenant-key",
            mode: "send",
            adapter,
            ratePerMinute: 6_000_000,
        });

        expect(delivered).toContain("tenant0@example.com");
    }, 60_000);

    it("refuses the staged flow for the wrong company", async () => {
        const { campaignId, versionId } = await seedApprovedCampaign();
        const wrongCompany = await harness.createCompany();

        await expect(
            approveEmailCampaign({
                companyId: wrongCompany,
                campaignId,
                templateVersionId: versionId,
                approvedByEmail: "intruder@example.com",
            })
        ).rejects.toThrow(/not found/i);

        await expect(
            dispatchEmailCampaign({
                ...dispatchArgs(wrongCompany, campaignId),
                idempotencyKey: "wrong-co",
                mode: "dry_run",
            })
        ).rejects.toThrow(/not found/i);
    }, 60_000);

    it("ignores recipients added after the audience is frozen", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign(recipients(3, "frozen"));
        const { adapter, delivered } = countingAdapter();

        await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "freeze-1",
            mode: "send",
            adapter,
            ratePerMinute: 6_000_000,
        });
        expect(delivered).toHaveLength(3);

        // Post-freeze addition must be ignored by both the upsert and the next
        // dispatch's audience.
        await upsertRecipients(campaignId, recipients(1, "smuggled"));

        const second = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "freeze-2",
            mode: "send",
            adapter,
            ratePerMinute: 6_000_000,
        });

        expect(delivered).toHaveLength(3);
        expect(second.results.map(r => r.recipientEmail)).not.toContain("smuggled0@example.com");
    }, 60_000);

    it("fails a recipient whose merge data would inject headers into the subject", async () => {
        // `name` is neutralized by the first-word split, so the live vector is an
        // explicit CSV var: interior CRLF survives the trim.
        const audience = [
            {
                email: "crlf@example.com",
                name: "Bob",
                company: "Acme",
                contextNotes: null,
                vars: { firstName: "Bob\r\nBcc: victim@example.com" },
            },
        ];
        const { companyId, campaignId } = await seedApprovedCampaign(audience);
        const { adapter, delivered } = countingAdapter();

        const result = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "crlf-key",
            mode: "send",
            adapter,
            ratePerMinute: 6_000_000,
        });

        expect(delivered).toHaveLength(0);
        expect(result.results[0]?.status).toBe("failed");
        expect(result.results[0]?.error).toMatch(/line break/i);
    }, 60_000);
});
