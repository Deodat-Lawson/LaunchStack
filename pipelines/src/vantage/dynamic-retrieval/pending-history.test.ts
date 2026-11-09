import { describe, expect, it } from "vitest";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import {
    projectPendingHistoricalQuestions,
    type PendingHistoricalStateV1,
} from "../pending-questions-v1";
import type { ContextSourceEntryV0, DynamicRetrievalInputV0 } from "../proposals/context-v0";
import { createDynamicRetrievalProviderV0 } from "./retrieve";
import type { RetrievalMetadataV0 } from "./types";

/** Synthetic boundary cases: historical review state is not current work state. */
function fixture() {
    const input = structuredClone(normal.retrievalInput) as DynamicRetrievalInputV0;
    input.budgets = {
        maxSources: 8,
        maxExcerptChars: 8000,
        maxTokens: 8000,
        maxQueries: 2,
        timeoutMs: 5000,
    };
    input.verifiedRoleContext.roles = [
        {
            roleId: "founder",
            description: "Founder",
            responsibilities: ["deployment reliability"],
            priorities: ["deployment"],
        },
    ];
    const source: ContextSourceEntryV0 = {
        source: { kind: "ev", id: "historical-deployment", version: "v1" },
        companyId: input.actor.companyId,
        aclDigest: "synthetic-company-acl",
        access: "allowed",
        audience: { kind: "company", companyId: input.actor.companyId },
        checkedAt: input.reportWindow.asOf,
        sourceDate: "2026-10-07T16:00:00Z",
        excerpt: "The October 7 account said the deployment reliability blocker remains open.",
    };
    input.sourceCatalog = [source];
    const state: PendingHistoricalStateV1 = {
        version: 1,
        questions: [
            {
                questionId: "historical-deployment-question",
                originReportId: "synthetic-week-one-report",
                originTopicId: "historical-deployment-question",
                originWeekStart: "2026-10-05",
                originGeneratedAt: "2026-10-11T20:00:00Z",
                title: "Deployment reliability review",
                question: "What deployment check should be reviewed before enabling access?",
                origin: "ai",
                humanReview: {
                    kind: "recorded-decision",
                    contentVersion: 2,
                    status: "kept",
                    decision: "Review deployment reliability before enabling access.",
                    decidedAt: "2026-10-11T21:00:00Z",
                },
                suggestedDue: "2026-10-10",
                sourceRefs: [
                    {
                        ref: "ev:historical-deployment",
                        label: "October 7 synthetic account",
                        date: "2026-10-07",
                    },
                ],
            },
        ],
        reviews: {},
    };
    function historicalContext(available = true) {
        return projectPendingHistoricalQuestions({
            state,
            originAvailability: { "historical-deployment-question": "available" },
            sourceStates: [
                {
                    ref: "ev:historical-deployment",
                    status: available ? "available" : "missing-or-unauthorized",
                    documentVerification: "not-applicable",
                },
            ],
            asOf: input.reportWindow.asOf,
            currentWeekStart: input.reportWindow.startInclusive.slice(0, 10),
        });
    }
    function currentState(value: "open" | "resolved", asOf = input.reportWindow.asOf) {
        return [{ source: source.source, state: { value, asOf } }] satisfies RetrievalMetadataV0[];
    }
    return { input, state, historicalContext, currentState };
}

describe("pending historical questions and current retrieval state remain independent", () => {
    it("does not infer open work from a kept past decision, an expired due date, or historical open prose", async () => {
        const { input, state, historicalContext } = fixture();
        const original = structuredClone({ input, state });
        const pending = historicalContext();
        const result = await createDynamicRetrievalProviderV0().retrieve(input);

        expect(pending.questions).toHaveLength(1);
        expect(pending.questions[0]!.humanReview.status).toBe("kept");
        expect(pending.questions[0]).not.toHaveProperty("state");
        expect(result.unresolvedOlderItems).toEqual([]);
        expect(result.roleMatches.map(item => item.source.id)).toEqual(["historical-deployment"]);
        expect({ input, state }).toEqual(original);
    });

    it("includes old work in the unresolved lane only with an independently supplied current open state", async () => {
        const { input, historicalContext, currentState } = fixture();
        const pending = historicalContext();
        const result = await createDynamicRetrievalProviderV0({
            metadata: currentState("open"),
        }).retrieve(input);

        expect(result.unresolvedOlderItems.map(item => item.source.id)).toEqual([
            "historical-deployment",
        ]);
        expect(historicalContext()).toEqual(pending);
    });

    it("does not close a human question when current source metadata reports resolved work", async () => {
        const { input, state, historicalContext, currentState } = fixture();
        const result = await createDynamicRetrievalProviderV0({
            metadata: currentState("resolved"),
        }).retrieve(input);

        expect(result.unresolvedOlderItems).toEqual([]);
        expect(result.roleMatches.map(item => item.source.id)).toEqual(["historical-deployment"]);
        expect(historicalContext().questions).toHaveLength(1);
        expect(state.reviews).toEqual({});
    });

    it("does not reuse a prior cutoff's open state as the current cutoff's state", async () => {
        const { input, historicalContext, currentState } = fixture();
        const result = await createDynamicRetrievalProviderV0({
            metadata: currentState("open", "2026-10-11T20:00:00Z"),
        }).retrieve(input);

        expect(result.unresolvedOlderItems).toEqual([]);
        expect(result.sourceRegistry).toEqual([]);
        expect(result.status).toBe("partial");
        expect(historicalContext().questions).toHaveLength(1);
    });

    it("a human addressed review closes the question without changing independently reported open work", async () => {
        const { input, state, historicalContext, currentState } = fixture();
        state.reviews["historical-deployment-question"] = {
            status: "addressed",
            reviewedAt: "2026-10-18T21:00:00Z",
            reviewedBy: "synthetic-founder",
            reason: "The historical question has been reviewed.",
        };
        const original = structuredClone(state);
        const result = await createDynamicRetrievalProviderV0({
            metadata: currentState("open"),
        }).retrieve(input);

        expect(historicalContext().questions).toEqual([]);
        expect(historicalContext().reviewedQuestionIds).toEqual(["historical-deployment-question"]);
        expect(result.unresolvedOlderItems).toHaveLength(1);
        expect(state).toEqual(original);
    });

    it("withholds a revoked historical source without inferring progress or destroying the saved question", async () => {
        const { input, state, historicalContext, currentState } = fixture();
        input.sourceCatalog[0]!.access = "revoked";
        input.sourceCatalog[0]!.excerpt = "";
        const result = await createDynamicRetrievalProviderV0({
            metadata: currentState("open"),
        }).retrieve(input);

        expect(historicalContext(false).questions).toEqual([]);
        expect(historicalContext(false).unavailableCount).toBe(1);
        expect(result.unresolvedOlderItems).toEqual([]);
        expect(result.sourceRegistry).toEqual([]);
        expect(state.questions).toHaveLength(1);
        expect(state.reviews).toEqual({});
    });
});
