/**
 * Seeder → collector wiring, on an inline scenario rather than a fixture file.
 *
 * The fixture suite proves each committed scenario meets its declared
 * expectations. This proves the seeder itself puts rows where the collector
 * looks for them, and covers the one boundary no fixture states outright: a
 * version dated after the reporting period is seeded but must not be
 * collected. Keeping it inline means the scenario and its assertions are read
 * together, which suits a wiring smoke test.
 *
 * Ported from #318, whose assertions were sound; only the seeder's return
 * shape and the default document-change source changed underneath it.
 */

import { eq } from "drizzle-orm";

import { document } from "@launchstack/core/db/schema";
import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewDocumentVersionStore } from "~/server/founder-weekly-review/document-version-chunks";

import { parseScenario } from "../../scripts/founder-weekly-review-scenario-loader";
import { seedScenario } from "../../scripts/founder-weekly-review-scenario-seeder";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const SCENARIO = parseScenario({
    name: "seeder-smoke",
    description: "Every source type at once, plus an out-of-window version and a control company.",
    reportingPeriod: { start: "2026-07-20", end: "2026-07-26" },
    workspaceTimezone: "America/New_York",
    founderContext: "Focus on onboarding reliability.",
    companies: [
        {
            name: "Northstar Analytics",
            underReview: true,
            documents: [
                {
                    title: "Pricing Page",
                    category: "Product",
                    versions: [
                        {
                            versionNumber: 1,
                            timestamp: "2026-07-21T10:00:00.000Z",
                            changelog: "Baseline inside the window.",
                            chunks: [{ section: "Tiers", content: "Monthly billing only." }],
                        },
                        {
                            versionNumber: 2,
                            timestamp: "2026-07-22T10:00:00.000Z",
                            changelog: "Reworked pricing tiers.",
                            chunks: [{ section: "Tiers", content: "Monthly and annual billing." }],
                        },
                        {
                            versionNumber: 3,
                            timestamp: "2026-07-28T10:00:00.000Z",
                            changelog: "Post-window tweak; must be excluded.",
                            chunks: [
                                { section: "Tiers", content: "Monthly, annual, and usage-based." },
                            ],
                        },
                    ],
                },
                {
                    title: "Customer Feedback - July",
                    category: "Customer Feedback",
                    versions: [
                        {
                            versionNumber: 1,
                            timestamp: "2026-07-23T10:00:00.000Z",
                            changelog: "Processed customer feedback.",
                            chunks: [
                                {
                                    section: "Billing",
                                    content: "Customers asked for annual billing.",
                                },
                                { section: "SSO", content: "Multiple requests for SSO / SAML." },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            name: "Acme (control)",
            underReview: false,
            documents: [
                {
                    title: "Acme roadmap",
                    category: "Product",
                    versions: [
                        {
                            versionNumber: 1,
                            timestamp: "2026-07-22T10:00:00.000Z",
                            changelog: "Cross-company control; must never appear.",
                            chunks: [{ section: "Plan", content: "Acme plans a billing rewrite." }],
                        },
                    ],
                },
            ],
        },
    ],
    expect: {
        evidence: { sourceTypeCounts: { customer_feedback: { exact: 2 } } },
        sourceSemantics: { noCrossCompanyLeakage: true },
    },
});

describeIfDatabase("seedScenario -> collector", () => {
    jest.setTimeout(120_000);

    it("seeds a scenario the real collector turns into the expected snapshot", async () => {
        const testDb = await createFounderWeeklyReviewTestDatabase();
        try {
            const { underReviewCompanyId, companyNamesToId } = await seedScenario(
                testDb.db,
                SCENARIO
            );

            const snapshot = await new FounderWeeklyReviewEvidenceService(
                testDb.db,
                () => new Date("2026-07-27T00:00:00.000Z"),
                { kind: "computed", store: new FounderWeeklyReviewDocumentVersionStore(testDb.db) }
            ).collectFounderWeeklyReviewEvidence({
                companyId: underReviewCompanyId,
                reportingPeriod: SCENARIO.reportingPeriod,
                workspaceTimezone: SCENARIO.workspaceTimezone,
                founderContext: SCENARIO.founderContext,
                actor: { externalUserId: "scenario-runner" },
                requestKey: "scenario-seeder-smoke",
                capturedAt: new Date("2026-07-27T00:00:00.000Z"),
            });

            const itemsOfType = (sourceType: string) =>
                snapshot.items.filter(item => item.sourceType === sourceType);

            // The in-window v1 -> v2 pair is comparable, so it yields change evidence.
            expect(itemsOfType("document_change").map(item => item.title)).toEqual([
                "Pricing Page — Tiers",
            ]);

            // One customer_feedback item per processed section.
            const feedback = itemsOfType("customer_feedback");
            expect(feedback).toHaveLength(2);
            expect(feedback.every(item => item.title === "Customer Feedback - July")).toBe(true);

            expect(itemsOfType("founder_context")).toHaveLength(1);

            // The post-window version is seeded but out of scope. Asserted on the
            // excerpt, because the document itself legitimately appears via the
            // in-window pair — only v3's content must be absent.
            const excerpts = snapshot.items.map(item => item.excerpt).join("\n");
            expect(excerpts).not.toContain("usage-based");
            expect(excerpts).not.toContain("Post-window tweak");

            // Cross-company isolation, with a positive control: the rows exist,
            // so their absence from the snapshot is filtering rather than a
            // seeder that never wrote them.
            expect(snapshot.items.some(item => item.title === "Acme roadmap")).toBe(false);
            const controlId = companyNamesToId.get("Acme (control)")!;
            const controlDocs = await testDb.db
                .select()
                .from(document)
                .where(eq(document.companyId, controlId));
            expect(controlDocs.length).toBeGreaterThan(0);

            const sourceIds = snapshot.items.map(item => item.sourceId);
            expect(new Set(sourceIds).size).toBe(sourceIds.length);
        } finally {
            await testDb.close();
        }
    });
});
