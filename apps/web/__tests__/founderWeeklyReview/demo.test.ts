import { FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET } from "@launchstack/features/founder-weekly-review";
import { formatFounderWeeklyReviewDemo } from "../../scripts/founder-weekly-review-demo";

describe("Founder Weekly Review demo presentation", () => {
    it("formats a safe staged report from pipeline outputs", () => {
        const output = formatFounderWeeklyReviewDemo({
            rawChanges: [{ documentId: "1", previousVersionId: 1, currentVersionId: 2, alignmentMethod: "structure_path", previousStructureTitle: "Ownership", previousExcerpt: "Product owns telemetry.", currentExcerpt: "Platform owns telemetry.", changeType: "modified" }],
            groups: [{ structureTitle: "Ownership", category: "ownership_change" }],
            promptItems: [{ sourceType: "document_change", title: "Ownership", excerpt: "Ownership changed.", metadata: { category: "ownership_change" } }, { sourceType: "customer_feedback" }],
            envelopeDiagnostics: { selectedItemCount: 2, serializedCharacterCount: 100, estimatedTokenCount: 25, truncated: false },
            analyzerCalls: [], eligibleGroups: 0, warnings: [], reviewMarkdown: "# Founder Weekly Review\n\nConcise result.", provider: "kimi", model: "kimi-k2.6", promptVersion: "founder-weekly-review-generation/v2", outputCeiling: 2400, repairCount: 0, snapshotVersion: "founder-weekly-review-evidence/v2", evidenceDigest: "a".repeat(64), persistencePassed: true, readBackPassed: true, noOpRemoved: 0, budget: FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET,
        });
        expect(output).toContain("CHANGE PROCESSING");
        expect(output).toContain("IMMUTABLE EVIDENCE SNAPSHOT v2");
        expect(output).toContain("FINAL FOUNDER WEEKLY REVIEW");
        expect(output).toContain("Product owns telemetry.");
        expect(output).not.toContain("api-key");
        expect(output).not.toContain("provider response");
    });

    it("renders the configured budget rather than presentation literals", () => {
        const output = formatFounderWeeklyReviewDemo({
            rawChanges: [], groups: [], promptItems: [], envelopeDiagnostics: { selectedItemCount: 0, serializedCharacterCount: 0, estimatedTokenCount: 0, truncated: false }, analyzerCalls: [], eligibleGroups: 0, warnings: [], reviewMarkdown: "", provider: "kimi", model: "kimi-k2.6", promptVersion: "v2", outputCeiling: 2400, repairCount: 0, snapshotVersion: "v2", evidenceDigest: "a".repeat(64), persistencePassed: true, readBackPassed: true, noOpRemoved: 0, budget: FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET,
        });
        expect(output).toContain(`${FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.totalSerializedCharacters.toLocaleString()} chars`);
    });
});
