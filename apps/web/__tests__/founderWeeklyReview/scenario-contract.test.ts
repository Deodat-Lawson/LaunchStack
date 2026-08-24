/**
 * The scenario contract's own rules — the ones that stop an unfalsifiable or
 * unseedable fixture from reaching the integration suite.
 */

import {
    FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION,
    FounderWeeklyReviewScenarioSchema,
} from "../../test-fixtures/founder-weekly-review/scenarios/contracts";

const base = {
    name: "example",
    reportingPeriod: { start: "2026-07-20", end: "2026-07-26" },
    workspaceTimezone: "America/New_York",
    companies: [{ name: "Northstar Analytics", underReview: true, documents: [] }],
    expect: { evidence: { sourceTypeCounts: { founder_context: { exact: 0 } } } },
};

describe("founder weekly review scenario contract", () => {
    it("defaults the schema version and normalizes optional collections", () => {
        const parsed = FounderWeeklyReviewScenarioSchema.parse(base);
        expect(parsed.schemaVersion).toBe(FOUNDER_WEEKLY_REVIEW_SCENARIO_SCHEMA_VERSION);
        expect(parsed.companies[0]!.documents).toEqual([]);
    });

    it("rejects a scenario with no expectations", () => {
        // The defect this contract exists to prevent: a fixture that cannot fail.
        const withoutExpect = { ...base };
        delete (withoutExpect as Partial<typeof base>).expect;
        expect(() => FounderWeeklyReviewScenarioSchema.parse(withoutExpect)).toThrow();
        expect(() => FounderWeeklyReviewScenarioSchema.parse({ ...base, expect: {} })).toThrow(
            /expect must assert something/
        );
    });

    it("rejects a count expectation that constrains nothing", () => {
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: { evidence: { sourceTypeCounts: { founder_context: {} } } },
            })
        ).toThrow(/must constrain something/);
    });

    it("rejects contradictory count bounds", () => {
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: { evidence: { sourceTypeCounts: { document_change: { min: 3, max: 1 } } } },
            })
        ).toThrow(/min must not exceed max/);
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: {
                    evidence: { sourceTypeCounts: { document_change: { min: 2, exact: 1 } } },
                },
            })
        ).toThrow(/exact must satisfy min\/max/);
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: { documentChanges: { min: 2, max: 1 } },
            })
        ).toThrow(/min must not exceed max/);
    });

    it("requires document-change assertions to be falsifiable and consistent", () => {
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: { documentChanges: {} },
            })
        ).toThrow(/documentChanges must assert something/);
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: {
                    documentChanges: {
                        min: 1,
                        requireNoInventedBaseline: true,
                    },
                },
            })
        ).toThrow(/cannot require document-change groups/);
    });

    it("requires exactly one company under review", () => {
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                companies: [
                    { name: "A", underReview: true, documents: [] },
                    { name: "B", underReview: true, documents: [] },
                ],
            })
        ).toThrow(/Exactly one company/);
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                companies: [{ name: "A", underReview: false, documents: [] }],
            })
        ).toThrow(/Exactly one company/);
    });

    it("rejects a leakage claim that has nothing to leak from", () => {
        // One company means the assertion passes vacuously, which reads as
        // coverage in the fixture while testing nothing.
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: { sourceSemantics: { noCrossCompanyLeakage: true } },
            })
        ).toThrow(/needs a second, non-under-review company/);
    });

    it("accepts a leakage claim once a control company exists", () => {
        const parsed = FounderWeeklyReviewScenarioSchema.parse({
            ...base,
            companies: [
                { name: "Subject", underReview: true, documents: [] },
                { name: "Control", underReview: false, documents: [] },
            ],
            expect: { sourceSemantics: { noCrossCompanyLeakage: true } },
        });
        expect(parsed.expect.sourceSemantics?.noCrossCompanyLeakage).toBe(true);
    });

    it("rejects duplicate version numbers within a document", () => {
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                companies: [
                    {
                        name: "Northstar Analytics",
                        underReview: true,
                        documents: [
                            {
                                title: "Plan",
                                category: "Planning",
                                versions: [
                                    { versionNumber: 1, timestamp: "2026-07-21T10:00:00.000Z" },
                                    { versionNumber: 1, timestamp: "2026-07-22T10:00:00.000Z" },
                                ],
                            },
                        ],
                    },
                ],
            })
        ).toThrow(/versionNumber must be unique/);
    });

    it("caps document titles at the database column width", () => {
        // Review finding: a 512-character title parsed fine and then failed on
        // INSERT into varchar(256).
        const parse = (length: number) =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                companies: [
                    {
                        name: "Northstar Analytics",
                        underReview: true,
                        documents: [
                            { title: "t".repeat(length), category: "Planning", versions: [] },
                        ],
                    },
                ],
            });
        expect(parse(256).companies[0]!.documents[0]!.title).toHaveLength(256);
        expect(() => parse(257)).toThrow();
    });

    it("rejects unknown keys rather than silently ignoring them", () => {
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({ ...base, unexpected: true })
        ).toThrow();
        expect(() =>
            FounderWeeklyReviewScenarioSchema.parse({
                ...base,
                expect: { evidence: { sourceTypeCounts: {} }, misspelled: {} },
            })
        ).toThrow();
    });
});
