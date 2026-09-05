/**
 * Unattended runs. The property under test is the one the per-campaign send
 * key cannot provide: a retried `/api/email-campaign-runs` request must resume
 * the original campaign rather than generate and deliver a second one.
 *
 * Generation is stubbed — these tests are about orchestration, and a real LLM
 * call would make them slow, costly and non-deterministic.
 */

import type { EmailTemplate, TemplateReview } from "@launchstack/pipelines/email";

interface GeneratedTemplate {
    template: EmailTemplate;
    companyContext: string;
}

// `mock`-prefixed so babel-plugin-jest-hoist allows the factories, which are
// hoisted above these declarations, to close over them. `jest.fn<TReturn, TArgs>`
// — @types/jest still puts the return type first.
const mockGenerateTemplate = jest.fn<Promise<GeneratedTemplate>, []>();
const mockReviewTemplate = jest.fn<Promise<TemplateReview>, []>();

jest.mock("@launchstack/pipelines/email/generator", () => ({
    generateTemplate: () => mockGenerateTemplate(),
}));
jest.mock("@launchstack/pipelines/email/reviewer", () => ({
    reviewTemplate: () => mockReviewTemplate(),
}));

import {
    listCampaigns,
    listTemplateVersions,
    runAutomatedEmailCampaign,
    type AutomationPolicy,
    type SendAdapter,
} from "@launchstack/pipelines/email";

import { createEmailPipelineTestDatabase, type EmailPipelineTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const TEMPLATE = {
    subject: "Hello {{firstName}}",
    body: "Hi {{firstName}} at {{recipientCompany}} — {{senderIdentity}} {{unsubscribeUrl}}",
    variables: ["firstName", "recipientCompany", "senderIdentity", "unsubscribeUrl"],
};

const RECIPIENTS = [
    { email: "ada@example.com", name: "Ada L", company: "Acme", contextNotes: null, vars: {} },
];

const STRICT: AutomationPolicy = { requireReviewPass: true, maxRecipients: 200 };

function review(verdict: "pass" | "revise") {
    return { scores: [], issues: [], verdict, summary: `${verdict} summary` };
}

function countingAdapter() {
    const delivered: string[] = [];
    const adapter: SendAdapter = {
        name: "counting",
        async send(email) {
            delivered.push(email.to);
            return { messageId: `msg-${delivered.length}` };
        },
    };
    return { adapter, delivered };
}

describeIfDatabase("automated email campaign runs", () => {
    jest.setTimeout(120_000);

    let harness: EmailPipelineTestDatabase;

    beforeAll(async () => {
        harness = await createEmailPipelineTestDatabase();
    }, 120_000);

    afterAll(async () => {
        await harness?.close();
    });

    beforeEach(() => {
        mockGenerateTemplate.mockReset();
        mockReviewTemplate.mockReset();
        mockGenerateTemplate.mockResolvedValue({
            template: TEMPLATE,
            companyContext: "context",
        });
        mockReviewTemplate.mockResolvedValue(review("pass"));
    });

    const runArgs = (companyId: number) => ({
        companyId,
        name: "August outreach",
        goal: "Introduce us",
        recipients: RECIPIENTS,
        senderIdentity: "sender@example.com",
        unsubscribeBaseUrl: "https://example.com/api/email-pipeline/unsubscribe",
        policy: STRICT,
    });

    it("resumes rather than regenerating when the run key is retried", async () => {
        const companyId = await harness.createCompany();
        const { adapter, delivered } = countingAdapter();

        const first = await runAutomatedEmailCampaign({
            ...runArgs(companyId),
            mode: "send",
            idempotencyKey: "nightly-2026-08-08",
            adapter,
        });
        const retry = await runAutomatedEmailCampaign({
            ...runArgs(companyId),
            mode: "send",
            idempotencyKey: "nightly-2026-08-08",
            adapter,
        });

        // The bug this replaces: a retry used to mint a second campaign, generate
        // a different template, and email everyone again.
        expect(retry.resumed).toBe(true);
        expect(retry.campaign.id).toBe(first.campaign.id);
        expect(await listCampaigns(companyId)).toHaveLength(1);
        expect(mockGenerateTemplate).toHaveBeenCalledTimes(1);
        expect(await listTemplateVersions(first.campaign.id)).toHaveLength(1);
        expect(delivered).toEqual(["ada@example.com"]);
    });

    it("starts a genuinely new campaign for a different key", async () => {
        const companyId = await harness.createCompany();
        const { adapter } = countingAdapter();

        await runAutomatedEmailCampaign({
            ...runArgs(companyId),
            idempotencyKey: "run-a",
            adapter,
        });
        await runAutomatedEmailCampaign({
            ...runArgs(companyId),
            idempotencyKey: "run-b",
            adapter,
        });

        expect(await listCampaigns(companyId)).toHaveLength(2);
        expect(mockGenerateTemplate).toHaveBeenCalledTimes(2);
    });

    it("scopes run keys to a company", async () => {
        const [a, b] = [await harness.createCompany(), await harness.createCompany()];
        const { adapter } = countingAdapter();

        const first = await runAutomatedEmailCampaign({
            ...runArgs(a),
            idempotencyKey: "shared-key",
            adapter,
        });
        const second = await runAutomatedEmailCampaign({
            ...runArgs(b),
            idempotencyKey: "shared-key",
            adapter,
        });

        // One workspace's key must not collide with another's.
        expect(second.campaign.id).not.toBe(first.campaign.id);
        expect(second.resumed).toBe(false);
    });

    it("blocks delivery when the review asks for revisions", async () => {
        const companyId = await harness.createCompany();
        mockReviewTemplate.mockResolvedValue(review("revise"));
        const { adapter, delivered } = countingAdapter();

        const run = await runAutomatedEmailCampaign({
            ...runArgs(companyId),
            mode: "send",
            idempotencyKey: "blocked-run",
            adapter,
        });

        expect(run.blockedReason).toMatch(/revise/);
        expect(run.approval).toBeNull();
        expect(delivered).toHaveLength(0);
        // The work is not thrown away — a human can pick it up in the staged flow.
        expect(await listTemplateVersions(run.campaign.id)).toHaveLength(1);
    });

    it("sends a revise verdict only when server policy allows it", async () => {
        const companyId = await harness.createCompany();
        mockReviewTemplate.mockResolvedValue(review("revise"));
        const { adapter, delivered } = countingAdapter();

        const run = await runAutomatedEmailCampaign({
            ...runArgs(companyId),
            policy: { requireReviewPass: false, maxRecipients: 200 },
            mode: "send",
            idempotencyKey: "permitted-run",
            adapter,
        });

        expect(run.blockedReason).toBeNull();
        expect(delivered).toEqual(["ada@example.com"]);
        // Sending past a failing review is allowed, but never silently: the
        // approval row records that automation did it and why.
        expect(run.approval?.approvedByKind).toBe("automation");
        expect(run.approval?.overrideReason).toBeTruthy();
    });

    it("blocks a run whose audience exceeds the policy cap", async () => {
        const companyId = await harness.createCompany();
        const { adapter, delivered } = countingAdapter();

        const run = await runAutomatedEmailCampaign({
            ...runArgs(companyId),
            policy: { requireReviewPass: true, maxRecipients: 0 },
            mode: "send",
            idempotencyKey: "too-many",
            adapter,
        });

        expect(run.blockedReason).toMatch(/exceeds the automation limit/);
        expect(delivered).toHaveLength(0);
    });

    it("requires a run key", async () => {
        const companyId = await harness.createCompany();

        await expect(
            runAutomatedEmailCampaign({ ...runArgs(companyId), idempotencyKey: "  " })
        ).rejects.toThrow(/idempotency key/i);
        expect(mockGenerateTemplate).not.toHaveBeenCalled();
    });
});
