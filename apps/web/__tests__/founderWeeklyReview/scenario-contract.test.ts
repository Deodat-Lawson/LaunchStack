import { FounderWeeklyReviewScenarioSchema } from "../../test-fixtures/founder-weekly-review/scenarios/contracts";

const baseScenario = () => ({
    name: "contract-test",
    reportingPeriod: { start: "2026-07-20", end: "2026-07-26" },
    workspaceTimezone: "UTC",
    companies: [{ name: "Northstar", underReview: true, documents: [] }],
});

describe("FounderWeeklyReviewScenarioSchema", () => {
    it("accepts bounded invariant expectations", () => {
        const parsed = FounderWeeklyReviewScenarioSchema.parse({
            ...baseScenario(),
            expect: {
                evidence: { sourceTypeCounts: { document_change: { min: 1 }, founder_context: { exact: 0 } } },
                documentChanges: { minGroups: 1, maxGroups: 8, requireNoInventedBaseline: true },
                sourceSemantics: { customerFeedbackOnly: true, currentWorkspaceOnly: true },
                review: { sectionStates: { whatShipped: "no_evidence" }, requiredThemes: ["ownership"] },
            },
        });
        expect(parsed.expect?.documentChanges?.requireNoInventedBaseline).toBe(true);
    });

    it("rejects contradictory count bounds and duplicate versions", () => {
        expect(() => FounderWeeklyReviewScenarioSchema.parse({ ...baseScenario(), expect: { evidence: { sourceTypeCounts: { document_change: { min: 3, max: 1 } } } } })).toThrow(/min must not exceed max/);
        const scenario = baseScenario() as any;
        scenario.companies[0]!.documents = [{ title: "Plan", category: "Planning", versions: [
            { versionNumber: 1, timestamp: "2026-07-20T10:00:00.000Z", chunks: [] },
            { versionNumber: 1, timestamp: "2026-07-21T10:00:00.000Z", chunks: [] },
        ] }];
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow(/versionNumber must be unique/);
    });
});
