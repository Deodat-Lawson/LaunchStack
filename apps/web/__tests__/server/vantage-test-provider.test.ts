import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    calculateWeeklyReviewBudget,
    runWeeklyReviewV21,
    WeeklyReviewV21Schema,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { weeklyReviewTestPorts } from "~/server/vantage/weekly-review-test-provider";

const allowedDatabase =
    "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_production_acceptance";
const savedEnv = { ...process.env };
beforeEach(() => {
    process.env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER = "true";
    process.env.DATABASE_URL = allowedDatabase;
    Object.assign(process.env, { NODE_ENV: "test" });
});
afterEach(() => {
    process.env = { ...savedEnv };
});

function input(texts: string[]): WeeklyReviewInput {
    return {
        candidateId: "sample-budget-regression",
        week: "2026-11-16",
        asOf: "2026-11-16T00:00:00Z",
        role: "Engineering lead",
        mandatoryCoverage: { required: 1, included: 1 },
        sources: texts.map((text, index) => ({
            ref: `doc:${index + 1}@${index + 101}`,
            version: String(index + 101),
            hash: createHash("sha256").update(text).digest("hex"),
            text,
            purpose: index === 0 ? "company-architecture" : "retrieved",
            title: `Synthetic document ${index + 1}`,
        })),
    };
}

const sampleFiles = [
    "weekly-priorities.md",
    "release-plan-v2.md",
    "qa-retest.md",
    "security-review.md",
    "rollback-runbook.md",
    "pilot-support.md",
];
// Model bounded selection excerpts, keeping the real Markdown prefixes that the adapter copies.
const sampleTexts = () =>
    sampleFiles.map(file =>
        readFileSync(
            path.resolve(__dirname, "../../../../docs/samples/vantage/harborlight-release", file),
            "utf8"
        ).slice(0, 850)
    );

describe("injected deterministic weekly-review report budget", () => {
    it.each([
        ["realistic sample Markdown", sampleTexts],
        [
            "Unicode and JSON escapes",
            () =>
                Array.from(
                    { length: 6 },
                    (_, i) => `Source ${i}: ` + '审核😀 "quoted" \\path\n'.repeat(30)
                ),
        ],
    ])("fits the useful reserve and runs admission with %s", async (_name, texts) => {
        const candidate = input(texts());
        const budget = calculateWeeklyReviewBudget(candidate, "internal-v1");
        expect(budget.feasible).toBe(true);
        const ports = weeklyReviewTestPorts(candidate)!;
        const answer = await ports.invoke(ports.generation, WeeklyReviewV21Schema, [], {
            signal: new AbortController().signal,
            timeoutMs: 1000,
            maxOutputTokens: 3600,
        });
        const bytes = Buffer.byteLength(JSON.stringify(answer.result));
        // Show the observed boundary, without source payloads or credentials.
        console.info({ fixture: _name, reportBytes: bytes, maxReportBytes: budget.maxReportBytes });
        const authorizeDispatch = jest.fn(async () => {});
        const admitted = await runWeeklyReviewV21(candidate, {
            ...ports,
            budgetProfile: "internal-v1",
            authorizeDispatch,
        });
        expect(bytes).toBeLessThanOrEqual(2800);
        expect(bytes).toBeLessThanOrEqual(budget.maxReportBytes);
        expect(admitted.report.brief).toBe("Injected deterministic engineering acceptance.");
        expect(admitted.report.topics[0]!.facts).toHaveLength(6);
        admitted.report.topics[0]!.facts.forEach((fact, index) => {
            expect(fact.refs).toEqual([candidate.sources[index]!.ref]);
            expect(fact.text.trim()).not.toBe("");
            expect(candidate.sources[index]!.text).toContain(fact.text);
            expect(fact.text).not.toMatch(/[\uD800-\uDBFF]$/);
        });
        expect(authorizeDispatch.mock.calls).toEqual([["generation"], ["judge"]]);
    });

    it("preserves tiny evidence and avoids splitting a supplementary character at the excerpt boundary", async () => {
        const candidate = input(["Small evidence.", "a".repeat(499) + "😀remaining"]);
        const ports = weeklyReviewTestPorts(candidate)!;
        const result = await runWeeklyReviewV21(candidate, {
            ...ports,
            budgetProfile: "internal-v1",
            authorizeDispatch: async () => {},
        });
        expect(result.report.topics[0]!.facts.map(fact => fact.text)).toEqual([
            "Small evidence.",
            "a".repeat(499),
        ]);
    });

    it("keeps disabled, production and wrong-database refusal", () => {
        const candidate = input(["Synthetic evidence."]);
        process.env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER = "false";
        expect(weeklyReviewTestPorts(candidate)).toBeNull();
        process.env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER = "true";
        Object.assign(process.env, { NODE_ENV: "production" });
        expect(() => weeklyReviewTestPorts(candidate)).toThrow("test_provider_not_allowed");
        Object.assign(process.env, { NODE_ENV: "test" });
        process.env.DATABASE_URL = "postgres://localhost/other";
        expect(() => weeklyReviewTestPorts(candidate)).toThrow("test_provider_not_allowed");
    });
});
