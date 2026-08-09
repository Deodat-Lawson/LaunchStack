import { FounderWeeklyReviewEvidenceSnapshotSchema } from "@launchstack/features/founder-weekly-review";

const period = { start: "2026-02-16", end: "2026-02-28" };
const make = (items: unknown[]) => FounderWeeklyReviewEvidenceSnapshotSchema.parse({
  schemaVersion: "founder-weekly-review-evidence/v1",
  capturedAt: "2026-03-01T00:00:00.000Z",
  reportingPeriod: period,
  workspaceTimezone: "UTC",
  items,
  sourceWarnings: [],
});

export const syntheticFounderWeeklyReviewFixtures = {
  partial: make([
    { sourceType: "document_change", sourceId: "synthetic:doc:release", title: "Release notes", sourceTimestamp: "2026-02-20T12:00:00.000Z", excerpt: "Export filtering was released.", metadata: { fixture: "synthetic-v1" } },
    { sourceType: "founder_context", sourceId: "synthetic:context:priority", title: "Founder context", excerpt: "Prioritize onboarding reliability.", metadata: { fixture: "synthetic-v1" } },
  ]),
  full: make([
    { sourceType: "document_change", sourceId: "synthetic:doc:release", title: "Release notes", sourceTimestamp: "2026-02-20T12:00:00.000Z", excerpt: "Export filtering was released.", metadata: { fixture: "synthetic-v1" } },
    { sourceType: "customer_feedback", sourceId: "synthetic:feedback:export", title: "Customer feedback", sourceTimestamp: "2026-02-21T12:00:00.000Z", excerpt: "A customer requested saved export filters.", metadata: { fixture: "synthetic-v1" } },
    { sourceType: "founder_context", sourceId: "synthetic:context:priority", title: "Founder context", excerpt: "Prioritize onboarding reliability.", metadata: { fixture: "synthetic-v1" } },
  ]),
  empty: make([]),
} as const;
