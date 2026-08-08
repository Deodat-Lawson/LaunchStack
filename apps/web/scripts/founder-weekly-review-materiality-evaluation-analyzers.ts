import type {
    DocumentChangeMaterialityAnalysisInput,
    DocumentChangeMaterialityAnalyzer,
} from "@launchstack/features/founder-weekly-review";

function words(value: string): Set<string> {
    const aliases: Record<string, string> = {
        owned: "owns",
        ownership: "owns",
        third: "q3",
        quarter: "q3",
        remains: "remain",
        still: "remain",
        expected: "planned",
        expect: "planned",
    };
    return new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter(token => !["the", "a", "an", "is", "are", "by", "during", "we"].includes(token))
        .map(token => aliases[token] ?? token));
}

function overlap(previous: string, current: string): number {
    const left = words(previous);
    const right = words(current);
    const union = new Set([...left, ...right]);
    return union.size === 0 ? 1 : [...left].filter(token => right.has(token)).length / union.size;
}

/**
 * Offline fixture analyzer for plumbing evaluation only. It uses no scenario IDs
 * or ground truth and is intentionally imperfect; it is not a quality claim.
 */
export class OfflineFixtureDocumentChangeMaterialityAnalyzer implements DocumentChangeMaterialityAnalyzer {
    async analyze(input: DocumentChangeMaterialityAnalysisInput) {
        const combined = input.changes.map(change => ({
            previous: change.previousExcerpt ?? "",
            current: change.currentExcerpt ?? "",
        }));
        const averageOverlap = combined.length === 0 ? 0 : combined.reduce(
            (total, change) => total + overlap(change.previous, change.current), 0,
        ) / combined.length;
        const replacement = input.changes.some(change => change.changeType === "added")
            && input.changes.some(change => change.changeType === "removed");
        const deterministicCategory = input.deterministicAssessment.category;
        const result = deterministicCategory !== "uncertain" && deterministicCategory !== "editorial_rewrite"
            ? {
                disposition: "material" as const,
                category: deterministicCategory,
                summary: "The supplied fragments contain a deterministic factual change.",
                confidence: 0.86,
            }
            : !replacement && averageOverlap >= 0.45
                ? {
                    disposition: "non_material" as const,
                    category: "editorial_rewrite" as const,
                    summary: "The supplied fragments appear to preserve the same business meaning.",
                    confidence: 0.78,
                }
                : {
                    disposition: "uncertain" as const,
                    category: "uncertain" as const,
                    summary: "The bounded fragments do not support a confident semantic disposition.",
                    confidence: 0.45,
                };
        return {
            result,
            metadata: {
                provider: "offline-fixture",
                model: "semantic-overlap-v1",
                promptVersion: "document-change-materiality/v1",
            },
        };
    }
}
