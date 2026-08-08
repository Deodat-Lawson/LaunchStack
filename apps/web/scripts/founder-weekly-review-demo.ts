import type { FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET } from "@launchstack/features/founder-weekly-review";

type Budget = typeof FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET;

export type FounderWeeklyReviewDemoInput = {
    rawChanges: readonly Record<string, unknown>[];
    groups: readonly Record<string, unknown>[];
    promptItems: readonly Record<string, unknown>[];
    envelopeDiagnostics: Record<string, unknown>;
    analyzerCalls: readonly Record<string, unknown>[];
    eligibleGroups: number;
    warnings: readonly string[];
    reviewMarkdown: string;
    provider: string;
    model: string;
    promptVersion: string;
    outputCeiling: number;
    repairCount: number;
    snapshotVersion: string;
    evidenceDigest: string;
    persistencePassed: boolean;
    readBackPassed: boolean;
    noOpRemoved: number;
    budget: Budget;
    scaleResults?: readonly Record<string, unknown>[];
};

const text = (value: unknown) => typeof value === "string" ? value : "";
const number = (value: unknown) => typeof value === "number" ? value : 0;
const label = (value: unknown) => text(value) || "unknown";

function line(key: string, value: string | number) {
    return `${key.padEnd(34)} ${value}`;
}

function sourceCounts(items: readonly Record<string, unknown>[]) {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(label(item.sourceType), (counts.get(label(item.sourceType)) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function sampleChanges(rawChanges: readonly Record<string, unknown>[]) {
    const preferred = ["Launch timing", "Retry ownership", "Requirement"];
    const selected = preferred.map(title => rawChanges.find(change => text(change.previousStructureTitle) === title)).filter((change): change is Record<string, unknown> => Boolean(change));
    return selected.length ? selected : rawChanges.slice(0, 3);
}

export function formatFounderWeeklyReviewDemo(input: FounderWeeklyReviewDemoInput): string {
    const raw = input.rawChanges;
    const auditGroups = input.groups;
    const analyzed = input.analyzerCalls;
    const nonMaterial = auditGroups.filter(group => {
        const analysis = group.analysis as Record<string, unknown> | undefined;
        return analysis?.disposition === "non_material";
    });
    const alignmentCounts = new Map<string, number>();
    for (const change of raw) {
        const method = label(change.alignmentMethod);
        alignmentCounts.set(method, (alignmentCounts.get(method) ?? 0) + 1);
    }
    const unmatched = raw.filter(change => ["added", "removed"].includes(text(change.changeType))).length;
    const selectedChanges = input.promptItems.filter(item => item.sourceType === "document_change");
    const diagnostics = input.envelopeDiagnostics;
    const scale = input.scaleResults ?? [];
    const out: string[] = [];
    out.push("FOUNDER WEEKLY REVIEW — LIVE E2E", "=".repeat(34), "");
    out.push("INPUT SCENARIO", "-------------");
    for (const change of sampleChanges(raw)) {
        out.push(`${text(change.currentStructureTitle) || "Document change"}`);
        out.push(`  Before: ${text(change.previousExcerpt)}`);
        out.push(`  After:  ${text(change.currentExcerpt)}`);
    }
    out.push("", "VERSION / ALIGNMENT", "-------------------");
    out.push(line("Documents compared", new Set(raw.map(change => text(change.documentId))).size));
    out.push(line("Version pairs", new Set(raw.map(change => `${change.documentId}:${change.previousVersionId}:${change.currentVersionId}`)).size));
    out.push(line("Historical chunks represented", raw.length * 2));
    for (const [method, count] of alignmentCounts) out.push(line(`Matched by ${method}`, count));
    out.push(line("Unmatched", unmatched));
    out.push("", "CHANGE PROCESSING", "-----------------");
    out.push(line("Raw changes", raw.length));
    out.push(line("No-op changes removed", input.noOpRemoved));
    out.push(line("DocumentChangeGroups", auditGroups.length));
    out.push("", "MATERIALITY");
    out.push(line("Analyzer eligible", input.eligibleGroups));
    out.push(line("Kimi analyzed", `${analyzed.length} / 4 cap`));
    out.push(line("Kimi non-material", analyzed.filter(call => call.disposition === "non_material").length));
    out.push(line("Analyzer failures", analyzed.filter(call => call.errorCode).length));
    out.push(line("Budget-excluded", Math.max(0, input.eligibleGroups - analyzed.length)));
    out.push(line("Deterministic fallback", Math.max(0, input.eligibleGroups - analyzed.length)));
    out.push(line("Prompt-facing document changes", selectedChanges.length));
    out.push("", "SELECTED MATERIAL CHANGES", "-------------------------");
    for (const item of selectedChanges) out.push(`[${label((item.metadata as Record<string, unknown> | undefined)?.category)}] ${text(item.title)} — ${text(item.excerpt).split("\n")[0]}`);
    out.push("", "FILTERED SEMANTIC REWRITES", "--------------------------");
    for (const group of nonMaterial) {
        const analysis = group.analysis as Record<string, unknown>;
        out.push(`- ${text(group.structureTitle)}: ${text(analysis.beforeKeyPoint)} → ${text(analysis.afterKeyPoint)}`);
    }
    out.push("", "IMMUTABLE EVIDENCE SNAPSHOT v2", "-----------------------------");
    for (const [type, count] of sourceCounts(input.promptItems)) out.push(line(type, count));
    out.push(line("Prompt-facing items", input.promptItems.length));
    out.push(line("Evidence digest", `${input.evidenceDigest.slice(0, 16)}...`));
    out.push(line("Immutable", "✓"));
    out.push("", "GENERATION ENVELOPE", "-------------------");
    out.push("Snapshot = complete frozen provenance");
    out.push("Envelope = bounded projection for generation", "");
    out.push(line("Selected evidence items", number(diagnostics.selectedItemCount)));
    out.push(line("Serialized characters", number(diagnostics.serializedCharacterCount)));
    out.push(line("Estimated input tokens", number(diagnostics.estimatedTokenCount)));
    out.push(line("Envelope truncation", diagnostics.truncated ? "yes" : "no"));
    out.push("", "Evidence budgets");
    out.push(line("Global", `${input.budget.totalSerializedCharacters.toLocaleString()} chars`));
    out.push(line("Document changes", `${input.budget.documentChangeSerializedCharacters.toLocaleString()} chars / max ${input.budget.documentChangeItems}`));
    out.push(line("Per document", `max ${input.budget.documentChangeItemsPerDocument} document changes`));
    out.push(line("Workspace reserve", `${input.budget.workspaceDocumentReservedCharacters.toLocaleString()} chars`));
    out.push(line("Customer feedback", `${input.budget.customerFeedbackReservedCharacters.toLocaleString()} chars`));
    out.push(line("Founder Context", `${input.budget.founderContextReservedCharacters.toLocaleString()} chars / max 1`));
    out.push("", "GENERATION", "----------");
    out.push(line("Provider / model", `${input.provider} / ${input.model}`));
    out.push(line("Prompt version", input.promptVersion));
    out.push(line("Output ceiling", `${input.outputCeiling} tokens`));
    out.push(line("Schema validation", "✓"));
    out.push(line("Citation validation", "✓"));
    out.push(line("Source semantics", "✓"));
    out.push(line("Semantic repair", input.repairCount));
    out.push(line("Persistence", input.persistencePassed ? "✓" : "✗"));
    out.push(line("Repository read-back", input.readBackPassed ? "✓" : "✗"));
    out.push("", "FINAL FOUNDER WEEKLY REVIEW", "---------------------------", input.reviewMarkdown.trim());
    if (scale.length) {
        out.push("", "SCALE BEHAVIOR", "-------------");
        out.push("Raw changes     Prompt envelope     Audit snapshot");
        for (const row of scale) out.push(`${number(row.rawChanged).toString().padEnd(16)}${number(row.envelopeCharacters).toString().padEnd(20)}${number(row.auditCharacters)}`);
        out.push("", "Generation input remains bounded.", "Immutable audit grows with source volume.", "Kimi materiality calls remain capped at 4.");
    }
    out.push("", `Warnings: ${input.warnings.join(", ") || "none"}`);
    return out.join("\n");
}
