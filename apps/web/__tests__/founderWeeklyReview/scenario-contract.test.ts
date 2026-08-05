import { FounderWeeklyReviewScenarioSchema } from "../../test-fixtures/founder-weekly-review/scenarios/contracts";

function baseScenario() {
    return {
        name: "single-version-change",
        reportingPeriod: { start: "2026-07-20", end: "2026-07-26" },
        workspaceTimezone: "America/New_York",
        founderContext: "Focus on onboarding reliability.",
        companies: [
            {
                name: "Northstar Analytics",
                underReview: true,
                documents: [
                    {
                        title: "Onboarding Plan",
                        category: "Planning",
                        versions: [
                            {
                                versionNumber: 1,
                                timestamp: "2026-07-24T10:00:00.000Z",
                                changelog: "Updated ownership.",
                                chunks: [
                                    { section: "Ownership", content: "Platform owns retry telemetry." },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

describe("FounderWeeklyReviewScenarioSchema", () => {
    it("accepts a minimal scenario with one under-review company", () => {
        const parsed = FounderWeeklyReviewScenarioSchema.parse(baseScenario());
        expect(parsed.name).toBe("single-version-change");
        expect(parsed.companies).toHaveLength(1);
        expect(parsed.companies[0]!.underReview).toBe(true);
    });

    it("defaults omitted version chunks to an empty array", () => {
        const scenario = baseScenario();
        delete (scenario.companies[0]!.documents[0]!.versions[0] as { chunks?: unknown }).chunks;
        const parsed = FounderWeeklyReviewScenarioSchema.parse(scenario);
        expect(parsed.companies[0]!.documents[0]!.versions[0]!.chunks).toEqual([]);
    });

    it("accepts additional non-under-review companies in scenario", () => {
        const scenario = baseScenario();
        scenario.companies.push({
            name: "Acme (control)",
            underReview: false,
            documents: [
                {
                    title: "Unrelated control",
                    category: "Product",
                    versions: [
                        {
                            versionNumber: 1,
                            timestamp: "2026-07-24T10:00:00.000Z",
                            changelog: "Control.",
                            chunks: [],
                        },
                    ],
                },
            ],
        });
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).not.toThrow();
    });

    it("accepts documents whose versions are all outside the reporting window", () => {
        const scenario = baseScenario();
        scenario.companies[0]!.documents.push({
            title: "Company Handbook",
            category: "Reference",
            versions: [
                {
                    versionNumber: 1,
                    timestamp: "2026-01-01T10:00:00.000Z",
                    changelog: "Standing reference.",
                    chunks: [{ section: "Reliability", content: "Retry telemetry ownership." }],
                },
            ],
        });
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).not.toThrow();
    });

    it("rejects scenarios with no under-review company", () => {
        const scenario = baseScenario();
        scenario.companies[0]!.underReview = false;
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow(
            /Exactly one company must have underReview/
        );
    });

    it("rejects scenarios with multiple under-review companies", () => {
        const scenario = baseScenario();
        scenario.companies.push({
            name: "Second Co",
            underReview: true,
            documents: [],
        });
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow(
            /Exactly one company must have underReview/
        );
    });

    it("rejects duplicate version numbers within the same document", () => {
        const scenario = baseScenario();
        scenario.companies[0]!.documents[0]!.versions.push({
            versionNumber: 1,
            timestamp: "2026-07-25T10:00:00.000Z",
            changelog: "Duplicate number.",
            chunks: [],
        });
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow(
            /versionNumber must be unique within a document/
        );
    });

    it("rejects reporting periods whose start date is after the end date", () => {
        const scenario = baseScenario();
        scenario.reportingPeriod = { start: "2026-07-26", end: "2026-07-20" };
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow();
    });

    it("rejects reporting-period dates that are not in YYYY-MM-DD format", () => {
        const scenario = baseScenario();
        scenario.reportingPeriod = { start: "2026-7-20", end: "2026-07-26" };
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow();
    });

    it("rejects version timestamps without an ISO timezone offset", () => {
        const scenario = baseScenario();
        scenario.companies[0]!.documents[0]!.versions[0]!.timestamp = "2026-07-24 10:00:00";
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow();
    });

    it("rejects unknown top-level scenario fields", () => {
        const scenario = { ...baseScenario(), unexpected: true };
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow();
    });

    it("rejects scenarios with an empty companies list", () => {
        const scenario = baseScenario();
        scenario.companies = [];
        expect(() => FounderWeeklyReviewScenarioSchema.parse(scenario)).toThrow();
    });
});
