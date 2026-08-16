jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
}));
jest.mock("@launchstack/core/llm", () => ({
    invokeStructured: jest.fn(),
}));

import { invokeStructured } from "@launchstack/core/llm";
import type {
    FounderWeeklyReviewEvidenceSnapshot,
    FounderWeeklyReviewV2Payload,
} from "@launchstack/features/founder-weekly-review";
import {
    FOUNDER_WEEKLY_REVIEW_EVALUATION_MAX_OUTPUT_TOKENS,
    gradePersistedFounderWeeklyReview,
} from "~/server/founder-weekly-review/evaluation-adapter";
import { resolveConfiguredChatModel } from "~/lib/models";

const mockResolveConfiguredChatModel = resolveConfiguredChatModel as jest.Mock;
const mockInvokeStructured = invokeStructured as jest.Mock;

const snapshot: FounderWeeklyReviewEvidenceSnapshot = {
    schemaVersion: "founder-weekly-review-evidence/v2",
    capturedAt: "2026-02-28T00:00:00.000Z",
    reportingPeriod: { start: "2026-02-01", end: "2026-02-28" },
    workspaceTimezone: "UTC",
    items: [],
    sourceWarnings: [],
    documentChangeAudit: {
        schemaVersion: "document-change-audit/v1",
        rawChanges: [],
        groups: [],
    },
};

const review: FounderWeeklyReviewV2Payload = {
    schemaVersion: "founder-weekly-review/v2",
    sections: {
        whatChanged: noEvidence(),
        whatShipped: noEvidence(),
        whatCustomersSaid: noEvidence(),
        currentBlockers: noEvidence(),
        nextPriorities: noEvidence(),
    },
};

function noEvidence() {
    return {
        state: "no_evidence" as const,
        noEvidence: {
            code: "no_relevant_evidence",
            message: "No evidence.",
            cta: "Add evidence.",
        },
    };
}

describe("configured Founder Weekly Review semantic grader", () => {
    it("grades the persisted payload through the provider-neutral seam", async () => {
        mockResolveConfiguredChatModel.mockReturnValue({
            route: "default",
            name: "configured-chat",
            modelId: "configured-model",
        });
        mockInvokeStructured.mockResolvedValue({
            overallScore: 0.8,
            dimensions: {
                groundedness: 0.8,
                materiality: 0.8,
                temporalAccuracy: 0.8,
                synthesisQuality: 0.8,
                actionability: 0.8,
            },
            findings: [],
            summary: "The persisted review is appropriately bounded.",
        });

        await expect(gradePersistedFounderWeeklyReview(snapshot, review)).resolves.toMatchObject({
            result: {
                schemaVersion: "founder-weekly-review-semantic-evaluation/v1",
                overallScore: 0.8,
            },
            metadata: {
                provider: "configured-chat",
                model: "configured-model",
            },
        });
        expect(mockResolveConfiguredChatModel).toHaveBeenCalledWith({
            route: "default",
            timeoutMs: 30_000,
            maxOutputTokens: FOUNDER_WEEKLY_REVIEW_EVALUATION_MAX_OUTPUT_TOKENS,
        });
        expect(mockInvokeStructured).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(mockInvokeStructured.mock.calls[0])).toContain(
            "founder-weekly-review-evidence/v2"
        );
    });
});
