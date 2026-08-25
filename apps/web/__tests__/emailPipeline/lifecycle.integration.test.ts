import { eq } from "drizzle-orm";

import {
    appendTemplateVersion,
    approveEmailCampaign,
    createCampaign,
    dispatchEmailCampaign,
    freezeRecipients,
    listSendAttempts,
    upsertRecipients,
    type SendAdapter,
} from "@launchstack/pipelines/email";
import { emailSendAttempts, emailSends } from "@launchstack/pipelines/schema";

import { createEmailPipelineTestDatabase, type EmailPipelineTestDatabase } from "./testDb";

/**
 * Delivery invariants, exercised against the real migrations.
 *
 * These are the properties the staged lifecycle exists to provide: an
 * unapproved campaign cannot send, an edited one cannot ship the version a
 * reviewer cleared earlier, a retry cannot deliver twice, and a process that
 * dies mid-send cannot cause the survivors to be emailed again.
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

const RECIPIENTS = [
    { email: "ada@example.com", name: "Ada L", company: "Acme", contextNotes: null, vars: {} },
    { email: "bob@example.com", name: "Bob R", company: "Beta", contextNotes: null, vars: {} },
];

function countingAdapter() {
    const delivered: string[] = [];
    const idempotencyKeys: (string | undefined)[] = [];
    const adapter: SendAdapter = {
        name: "counting",
        async send(email) {
            delivered.push(email.to);
            idempotencyKeys.push(email.idempotencyKey);
            return { messageId: `msg-${delivered.length}` };
        },
    };
    return { adapter, delivered, idempotencyKeys };
}

describeIfDatabase("email campaign delivery", () => {
    let harness: EmailPipelineTestDatabase;

    beforeAll(async () => {
        harness = await createEmailPipelineTestDatabase();
    }, 120_000);

    afterAll(async () => {
        await harness?.close();
    });

    async function seedApprovedCampaign() {
        const companyId = await harness.createCompany();
        const campaign = await createCampaign({ companyId, name: "Test campaign" });
        const version = await appendTemplateVersion({
            campaignId: campaign.id,
            template: TEMPLATE,
            source: "ai_generated",
            review: PASSING_REVIEW,
        });
        await upsertRecipients(campaign.id, RECIPIENTS);
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

    it("refuses to send a campaign with no approved version", async () => {
        const companyId = await harness.createCompany();
        const campaign = await createCampaign({ companyId, name: "Unapproved" });
        await appendTemplateVersion({
            campaignId: campaign.id,
            template: TEMPLATE,
            source: "ai_generated",
            review: PASSING_REVIEW,
        });
        await upsertRecipients(campaign.id, RECIPIENTS);
        const { adapter, delivered } = countingAdapter();

        await expect(
            dispatchEmailCampaign({
                ...dispatchArgs(companyId, campaign.id),
                idempotencyKey: "k1",
                mode: "send",
                adapter,
            })
        ).rejects.toThrow(/no approved template version/i);
        expect(delivered).toHaveLength(0);
    });

    it("sends the approved version and hands the provider an idempotency key", async () => {
        const { companyId, campaignId, versionId } = await seedApprovedCampaign();
        const { adapter, delivered, idempotencyKeys } = countingAdapter();

        const result = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "launch-1",
            mode: "send",
            adapter,
        });

        expect(result.version.id).toBe(versionId);
        expect(delivered.sort()).toEqual(["ada@example.com", "bob@example.com"]);
        expect(idempotencyKeys.every(k => typeof k === "string" && k.length > 0)).toBe(true);
        // Distinct per recipient, or the provider would dedup real deliveries.
        expect(new Set(idempotencyKeys).size).toBe(2);
    });

    it("replays instead of re-sending when the same key is retried", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign();
        const { adapter, delivered } = countingAdapter();

        await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "launch-1",
            mode: "send",
            adapter,
        });
        const retry = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "launch-1",
            mode: "send",
            adapter,
        });

        expect(retry.replayed).toBe(true);
        expect(retry.results).toHaveLength(2);
        expect(delivered).toHaveLength(2); // nothing new left the building
    });

    it("does not re-deliver under a fresh key either", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign();
        const { adapter, delivered } = countingAdapter();

        await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "launch-1",
            mode: "send",
            adapter,
        });
        const second = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "launch-2",
            mode: "send",
            adapter,
        });

        expect(delivered).toHaveLength(2);
        expect(second.results.every(r => r.status === "skipped")).toBe(true);
    });

    it("serialises concurrent sends that share a key", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign();
        const { adapter, delivered } = countingAdapter();

        const settled = await Promise.allSettled([
            dispatchEmailCampaign({
                ...dispatchArgs(companyId, campaignId),
                idempotencyKey: "race",
                mode: "send",
                adapter,
            }),
            dispatchEmailCampaign({
                ...dispatchArgs(companyId, campaignId),
                idempotencyKey: "race",
                mode: "send",
                adapter,
            }),
        ]);

        // Exactly one claims the attempt; the other is told it is in progress or
        // replays. Either way the audience is emailed once.
        const fulfilled = settled.filter(s => s.status === "fulfilled");
        expect(fulfilled.length).toBeGreaterThanOrEqual(1);
        expect(delivered.sort()).toEqual(["ada@example.com", "bob@example.com"]);

        const attempts = await listSendAttempts(campaignId);
        expect(attempts.filter(a => a.idempotencyKey === "race")).toHaveLength(1);
    });

    it("keeps the audience frozen after the first dispatch", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign();
        const { adapter } = countingAdapter();

        await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "launch-1",
            mode: "dry_run",
            adapter,
        });

        const frozen = await freezeRecipients(campaignId, [
            {
                email: "intruder@example.com",
                name: null,
                company: null,
                contextNotes: null,
                vars: {},
            },
        ]);

        expect(frozen.alreadyFrozen).toBe(true);
        expect(frozen.recipients.map(r => r.email).sort()).toEqual([
            "ada@example.com",
            "bob@example.com",
        ]);
    });

    it("stops delivering the old version once a new one is created", async () => {
        const { companyId, campaignId, versionId } = await seedApprovedCampaign();
        const { adapter, delivered } = countingAdapter();

        // A human edits the template after approval. The earlier approval refers
        // to text nobody is proposing to send any more.
        const v2 = await appendTemplateVersion({
            campaignId,
            template: { ...TEMPLATE, subject: "Rewritten {{firstName}}" },
            source: "human_edited",
            review: PASSING_REVIEW,
        });
        expect(v2.id).not.toBe(versionId);

        await expect(
            dispatchEmailCampaign({
                ...dispatchArgs(companyId, campaignId),
                idempotencyKey: "after-edit",
                mode: "send",
                adapter,
            })
        ).rejects.toThrow(/approved/i);
        expect(delivered).toHaveLength(0);

        // Approving the new version is what unblocks delivery — of the NEW text.
        await approveEmailCampaign({
            companyId,
            campaignId,
            templateVersionId: v2.id,
            approvedByEmail: "approver@example.com",
        });
        const sent = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "after-edit",
            mode: "send",
            adapter,
        });
        expect(sent.version.id).toBe(v2.id);
    });

    it("treats a crashed attempt's in-flight recipients as already delivered", async () => {
        const { companyId, campaignId, versionId } = await seedApprovedCampaign();

        // Reproduce the crash window: the provider was called for ada@ and the
        // process died before the outcome could be written. The claim row survives
        // as `queued` and the attempt is stuck `running` with a stale heartbeat.
        const stale = new Date(Date.now() - 60 * 60 * 1000);
        const [crashed] = await harness.db
            .insert(emailSendAttempts)
            .values({
                campaignId,
                templateVersionId: versionId,
                idempotencyKey: "crashed",
                mode: "send",
                status: "running",
                recipientCount: 2,
                startedAt: stale,
                heartbeatAt: stale,
            })
            .returning();
        await harness.db.insert(emailSends).values({
            campaignId,
            attemptId: crashed!.id,
            recipientEmail: "ada@example.com",
            status: "queued",
        });

        const { adapter, delivered } = countingAdapter();
        const recovery = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "after-crash",
            mode: "send",
            adapter,
        });

        // ada@ may already have been emailed, so it is never retried; bob@ was
        // never reached, so the campaign can still finish.
        expect(delivered).toEqual(["bob@example.com"]);
        expect(recovery.results.find(r => r.recipientEmail === "ada@example.com")?.status).toBe(
            "skipped"
        );

        const [reclaimed] = await harness.db
            .select()
            .from(emailSendAttempts)
            .where(eq(emailSendAttempts.id, crashed!.id));
        expect(reclaimed?.status).toBe("abandoned");
    });

    it("records a provider failure without blocking a later retry", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign();
        const failing: SendAdapter = {
            name: "failing",
            send: () => Promise.reject(new Error("provider exploded")),
        };

        const failed = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "fails",
            mode: "send",
            adapter: failing,
        });
        expect(failed.results.every(r => r.status === "failed")).toBe(true);

        // A failure is a known outcome, not an unknown one — those addresses are
        // safe to try again, unlike the in-flight case above.
        const { adapter, delivered } = countingAdapter();
        const retried = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "retry-after-failure",
            mode: "send",
            adapter,
        });

        expect(delivered.sort()).toEqual(["ada@example.com", "bob@example.com"]);
        expect(retried.results.every(r => r.status === "sent")).toBe(true);
    });

    it("never delivers in dry-run mode but still records every recipient", async () => {
        const { companyId, campaignId } = await seedApprovedCampaign();
        const { adapter, delivered } = countingAdapter();

        const result = await dispatchEmailCampaign({
            ...dispatchArgs(companyId, campaignId),
            idempotencyKey: "preview",
            mode: "dry_run",
            adapter,
        });

        expect(delivered).toHaveLength(0);
        expect(result.results.every(r => r.status === "dry_run")).toBe(true);

        const rows = await harness.db
            .select()
            .from(emailSends)
            .where(eq(emailSends.attemptId, result.attempt.id));
        expect(rows).toHaveLength(2);
    });
});
