import { eq } from "drizzle-orm";

import { document } from "@launchstack/core/db/schema";
import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

import { parseScenario } from "../../scripts/founder-weekly-review-scenario-loader";
import { seedScenario } from "../../scripts/founder-weekly-review-scenario-seeder";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

// skip unless passed a local db url
const describeIfDatabase =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL
        ? describe
        : describe.skip;

// verify that a comprehensive scenario can be seeded and transformed into an evidence snapshot
const SCENARIO = parseScenario({
    name: "seeder-smoke",
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
                            timestamp: "2026-07-22T10:00:00.000Z",
                            changelog: "Reworked pricing tiers.",
                        },
                        {
                            versionNumber: 2,
                            timestamp: "2026-07-28T10:00:00.000Z",
                            changelog: "Post-window tweak; must be excluded.",
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
                                { section: "Billing", content: "Customers asked for annual billing." },
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
                        },
                    ],
                },
            ],
        },
    ],
});

describeIfDatabase("seedScenario → collector", () => {
    it("seeds a scenario the real collector turns into the expected snapshot", async () => {
        const testDb = await createFounderWeeklyReviewTestDatabase();
        try {
            const { underReviewCompanyId, companyNamesToId } = await seedScenario(
                testDb.db,
                SCENARIO
            );

            const snapshot = await new FounderWeeklyReviewEvidenceService(
                testDb.db
            ).collectFounderWeeklyReviewEvidence({
                companyId: underReviewCompanyId,
                reportingPeriod: SCENARIO.reportingPeriod,
                workspaceTimezone: SCENARIO.workspaceTimezone,
                founderContext: SCENARIO.founderContext,
                actor: { externalUserId: "scenario-runner" },
                requestKey: "scenario-seeder-smoke",
            });

            const titlesOfType = (sourceType: string) =>
                snapshot.items
                    .filter((item) => item.sourceType === sourceType)
                    .map((item) => item.title);

            expect(titlesOfType("document_change").filter((t) => t === "Pricing Page")).toHaveLength(1);

            const feedbackTitles = titlesOfType("customer_feedback");
            expect(feedbackTitles).toHaveLength(2);
            expect(feedbackTitles.every((t) => t === "Customer Feedback - July")).toBe(true);

            expect(snapshot.items.filter((i) => i.sourceType === "founder_context")).toHaveLength(1);

            expect(snapshot.items.some((i) => i.title === "Acme roadmap")).toBe(false);

            const controlId = companyNamesToId.get("Acme (control)")!;
            const controlDocs = await testDb.db
                .select()
                .from(document)
                .where(eq(document.companyId, controlId));
            expect(controlDocs.length).toBeGreaterThan(0);

            const sourceIds = snapshot.items.map((i) => i.sourceId);
            expect(new Set(sourceIds).size).toBe(sourceIds.length);
        } finally {
            await testDb.close();
        }
    });
});
