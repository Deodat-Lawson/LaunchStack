import { evaluateGeneratedFounderWeeklyReview } from "@launchstack/features/founder-weekly-review/benchmarks";
import { FounderWeeklyReviewEvidenceSnapshotSchema } from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewV2PayloadSchema } from "@launchstack/features/founder-weekly-review";

import type { FounderWeeklyReviewGenerateFn } from "@launchstack/features/founder-weekly-review";

describe("Founder Weekly Review evaluation pipeline", () => {
  const fakeEvidenceSnapshot = FounderWeeklyReviewEvidenceSnapshotSchema.parse({
    schemaVersion: "founder-weekly-review-evidence/v1",
    capturedAt: "2026-07-13T00:00:00.000Z",
    reportingPeriod: {
        start: "2026-07-06",
        end: "2026-07-12",
    },
    workspaceTimezone: "UTC",
    items: [
      {
        sourceType: "document_change",
        sourceId: "doc:release",
        title: "Release notes",
        sourceTimestamp: "2026-07-10T00:00:00.000Z",
        excerpt: "Export shipped.",
        metadata: {},
      },
      {
        sourceType: "customer_feedback",
        sourceId: "feedback:export",
        title: "Customer feedback",
        sourceTimestamp: "2026-07-11T00:00:00.000Z",
        excerpt: "Customers requested export support.",
        metadata: {},
      },
    ],
    sourceWarnings: [],
  });

  const fakeReport = FounderWeeklyReviewV2PayloadSchema.parse({
    schemaVersion: "founder-weekly-review/v2",
    sections: {
      whatChanged: {
        state: "no_evidence",
        noEvidence: {
          code: "no_changes",
          message: "No changes were reported.",
          cta: "Discuss recent updates.",
        },
      },
      whatShipped: {
        state: "evidence",
        items: [
          {
            kind: "observed_fact",
            text: "Export shipped.",
            sourceIds: ["doc:release"],
            confidence: 0.8,
          },
        ],
      },
      whatCustomersSaid: {
        state: "evidence",
        items: [
          {
            kind: "observed_fact",
            text: "Customers requested export support.",
            sourceIds: ["feedback:export"],
            confidence: 0.8,
          },
        ],
      },
      currentBlockers: {
        state: "no_evidence",
        noEvidence: {
          code: "no_blockers",
          message: "No blockers were reported.",
          cta: "Reach out if blockers appear.",
        },
      },
      nextPriorities: {
        state: "no_evidence",
        noEvidence: {
          code: "no_priorities",
          message: "No next priorities were specified.",
          cta: "Discuss upcoming priorities.",
        },
      },
    },
  });
  it("runs deterministic evaluation and LLM grading with structured output", async () => {
    const mockGrader: FounderWeeklyReviewGenerateFn = async (input) => {
      expect(input.schemaName).toBe("founder_weekly_review_grader");
      expect(input.prompt).toContain("Evidence:");
      expect(input.prompt).toContain("Report:");
      expect(input.system).toContain("groundedness");

      return {
        object: {
          overallScore: 0.8,
          dimensions: {
            groundedness: 0.9,
            materiality: 0.8,
            temporalAccuracy: 0.7,
            synthesisQuality: 0.75,
            actionability: 0.85,
          },
          findings: [],
          summary: "Looks good",
        },
        metadata: {
          provider: "mock",
          model: "mock-model",
        },
      };
    };

    const result = await evaluateGeneratedFounderWeeklyReview(
      fakeEvidenceSnapshot,
      fakeReport,
      mockGrader
    );

    expect(result.deterministic).toBeDefined();
    expect(result.llmGrader?.overallScore).toBe(0.8);
    expect(result.llmGrader?.metadata?.provider).toBe("mock");
  });

  it("rejects malformed LLM grader output", async () => {
    const badGrader: FounderWeeklyReviewGenerateFn = async () => ({
      overallScore: 5,
    } as any);

    await expect(
      evaluateGeneratedFounderWeeklyReview(
        fakeEvidenceSnapshot,
        fakeReport,
        badGrader
      )
    ).rejects.toThrow();
  });
});