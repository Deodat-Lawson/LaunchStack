import { createHash } from "node:crypto";

import { z } from "zod";

import type {
    DocumentChangeAuditSnapshot,
    DocumentChangeMaterialityAnalysisSnapshot,
    FounderWeeklyReviewEvidenceItem,
} from "./contracts";
import type {
    DocumentChangeGroup,
    DocumentChangePairInput,
    DocumentChangeProcessingWarning,
    RawDocumentChange,
} from "./document-change";
import {
    DOCUMENT_CHANGE_CATEGORIES,
    DOCUMENT_CHANGE_MATERIALITY_VERSION,
    buildCondensedDocumentChangeEvidence,
    documentChangeCategoryPriority,
    documentChangeGroupSourceId,
    materializeDocumentChanges,
    selectMaterialDocumentChangeGroups,
    type AnalyzedDocumentChangeGroup,
    type DeterministicMaterialChangeResult,
    type DeterministicMaterialityConfidence,
    type DocumentChangeCategory,
} from "./document-change-materiality";

export const DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROMPT_VERSION =
    "document-change-materiality/v1" as const;
export const DOCUMENT_CHANGE_MATERIALITY_ANALYSIS_RESULT_VERSION =
    "document-change-materiality-result/v1" as const;
export const DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS = Object.freeze({
    callsPerReview: 4,
    concurrency: 2,
    rawChangesPerGroup: 16,
    canonicalInputCharacters: 8_000,
    excerptCharactersPerSide: 150,
    summaryCharacters: 320,
    keyPointCharacters: 240,
});

export const DocumentChangeMaterialityAnalysisResultSchema = z.object({
    disposition: z.enum(["material", "non_material", "uncertain"]),
    category: z.enum(DOCUMENT_CHANGE_CATEGORIES),
    summary: z.string().trim().min(1).max(DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.summaryCharacters),
    beforeKeyPoint: z.string().trim().min(1).max(DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.keyPointCharacters).optional(),
    afterKeyPoint: z.string().trim().min(1).max(DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.keyPointCharacters).optional(),
    confidence: z.number().min(0).max(1),
}).strict().superRefine((result, context) => {
    if (result.disposition === "uncertain" && result.category !== "uncertain") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Uncertain disposition requires uncertain category.", path: ["category"] });
    }
    if (result.disposition === "material" && result.category === "editorial_rewrite") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Material disposition cannot use editorial_rewrite.", path: ["category"] });
    }
});

export type DocumentChangeMaterialityAnalysisResult = z.infer<
    typeof DocumentChangeMaterialityAnalysisResultSchema
>;

export type DocumentChangeMaterialityAnalysisInput = {
    groupId: string;
    documentTitle?: string;
    structurePath?: string | null;
    structureTitle?: string | null;
    deterministicCategory: DocumentChangeCategory;
    deterministicConfidence: DeterministicMaterialityConfidence;
    deterministicSignals: readonly string[];
    changes: readonly {
        changeType: RawDocumentChange["changeType"];
        previousExcerpt?: string;
        currentExcerpt?: string;
        alignmentMethod: RawDocumentChange["alignmentMethod"];
    }[];
};

export type DocumentChangeMaterialityAnalyzerMetadata = {
    provider?: string;
    model?: string;
    promptVersion?: string;
};

export interface DocumentChangeMaterialityAnalyzer {
    analyze(input: DocumentChangeMaterialityAnalysisInput): Promise<{
        result: unknown;
        metadata?: DocumentChangeMaterialityAnalyzerMetadata;
    }>;
}

export class DocumentChangeMaterialityAnalyzerError extends Error {
    constructor(
        readonly code: "unavailable" | "timeout" | "invalid",
        message: string,
    ) {
        super(message);
        this.name = "DocumentChangeMaterialityAnalyzerError";
    }
}

export type DocumentChangeMaterialityEligibilityReason =
    | "uncertain_multi_change"
    | "uncertain_single_change"
    | "replacement_shaped"
    | "complex_multi_change"
    | "large_rewrite"
    | "moderate_signal"
    | "paraphrase_risk";

export type DocumentChangeMaterialityEligibility = {
    eligible: boolean;
    reason?: DocumentChangeMaterialityEligibilityReason;
    priority: number;
};

export type DocumentChangeMaterialityAnalyzerDiagnostics = {
    eligibleGroupCount: number;
    selectedAnalysisCount: number;
    skippedByCallBudgetCount: number;
    inputTruncatedCount: number;
    succeededAnalysisCount: number;
    failedAnalysisCount: number;
    materialCount: number;
    nonMaterialCount: number;
    uncertainCount: number;
};

export type AnalyzedMaterialChangeResult = DeterministicMaterialChangeResult & {
    analyzerDiagnostics: DocumentChangeMaterialityAnalyzerDiagnostics;
};

type AnalysisCandidate = {
    analyzed: AnalyzedDocumentChangeGroup;
    eligibility: DocumentChangeMaterialityEligibility;
};

type SuccessfulAnalysis = {
    analyzed: AnalyzedDocumentChangeGroup;
    input: DocumentChangeMaterialityAnalysisInput;
    inputDigest: string;
    inputTruncated: boolean;
    result: DocumentChangeMaterialityAnalysisResult;
    metadata: DocumentChangeMaterialityAnalyzerMetadata;
};

const SIMPLE_BYPASS_SIGNALS = new Set([
    "ownership_subject_changed",
    "status_term_changed",
    "date_or_deadline_changed",
    "numeric_metric_changed",
    "requirement_or_modality_changed",
    "negation_changed",
    "priority_marker_changed",
]);

function compareOrdinal(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function changedCharacters(group: DocumentChangeGroup): number {
    return group.rawChanges.reduce((total, change) => total
        + (change.previousNormalizedContent?.length ?? 0)
        + (change.currentNormalizedContent?.length ?? 0), 0);
}

function tokenSet(value: string): Set<string> {
    return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function lexicalSimilarity(change: RawDocumentChange): number {
    const previous = tokenSet(change.previousNormalizedContent ?? "");
    const current = tokenSet(change.currentNormalizedContent ?? "");
    if (previous.size === 0 && current.size === 0) return 1;
    const intersection = [...previous].filter(token => current.has(token)).length;
    const union = new Set([...previous, ...current]).size;
    return union === 0 ? 1 : intersection / union;
}

function isStrongDeterministicBypass(analyzed: AnalyzedDocumentChangeGroup): boolean {
    const { group, materiality } = analyzed;
    if (group.rawChanges.length !== 1 || group.rawChanges[0]!.changeType !== "modified") return false;
    if (changedCharacters(group) > 700 || materiality.category === "uncertain" || materiality.category === "editorial_rewrite") return false;
    return materiality.signals.length > 0
        && materiality.signals.every(signal => SIMPLE_BYPASS_SIGNALS.has(signal));
}

/** Pure semantic-risk gate. It intentionally does not use embeddings or changelog text. */
export function shouldAnalyzeDocumentChangeGroup(
    analyzed: AnalyzedDocumentChangeGroup,
): DocumentChangeMaterialityEligibility {
    if (isStrongDeterministicBypass(analyzed)) return { eligible: false, priority: Number.MAX_SAFE_INTEGER };
    const { group, materiality } = analyzed;
    if (materiality.category === "uncertain" && group.rawChanges.length > 1) {
        return { eligible: true, reason: "uncertain_multi_change", priority: 1 };
    }
    if (materiality.category === "uncertain") {
        return { eligible: true, reason: "uncertain_single_change", priority: 2 };
    }
    const types = new Set(group.rawChanges.map(change => change.changeType));
    if (types.has("added") && types.has("removed")) {
        return { eligible: true, reason: "replacement_shaped", priority: 3 };
    }
    if (group.rawChanges.length > 1) {
        return { eligible: true, reason: "complex_multi_change", priority: 4 };
    }
    if (changedCharacters(group) >= 1_200) {
        return { eligible: true, reason: "large_rewrite", priority: 4 };
    }
    if (materiality.confidence === "moderate") {
        return { eligible: true, reason: "moderate_signal", priority: 4 };
    }
    const only = group.rawChanges[0];
    if (only?.changeType === "modified" && changedCharacters(group) >= 240 && lexicalSimilarity(only) < 0.45) {
        return { eligible: true, reason: "paraphrase_risk", priority: 5 };
    }
    return { eligible: false, priority: Number.MAX_SAFE_INTEGER };
}

function stableCandidateOrder(a: AnalysisCandidate, b: AnalysisCandidate): number {
    return a.eligibility.priority - b.eligibility.priority
        || b.analyzed.pair.currentCreatedAt.getTime() - a.analyzed.pair.currentCreatedAt.getTime()
        || compareOrdinal(a.analyzed.group.structurePath ?? a.analyzed.group.structureTitle ?? "", b.analyzed.group.structurePath ?? b.analyzed.group.structureTitle ?? "")
        || compareOrdinal(a.analyzed.group.groupId, b.analyzed.group.groupId);
}

/** Selects at most four calls, round-robin across documents inside each eligibility tier. */
export function selectDocumentChangeGroupsForMaterialityAnalysis(
    groups: readonly AnalyzedDocumentChangeGroup[],
): { selected: AnalyzedDocumentChangeGroup[]; skipped: AnalyzedDocumentChangeGroup[] } {
    const candidates = groups
        .map(analyzed => ({ analyzed, eligibility: shouldAnalyzeDocumentChangeGroup(analyzed) }))
        .filter((candidate): candidate is AnalysisCandidate => candidate.eligibility.eligible)
        .sort(stableCandidateOrder);
    const selected: AnalyzedDocumentChangeGroup[] = [];
    const selectedIds = new Set<string>();
    for (const priority of [...new Set(candidates.map(candidate => candidate.eligibility.priority))].sort((a, b) => a - b)) {
        const tier = candidates.filter(candidate => candidate.eligibility.priority === priority);
        const byDocument = new Map<string, AnalysisCandidate[]>();
        for (const candidate of tier) {
            const key = candidate.analyzed.group.documentId.toString();
            const values = byDocument.get(key) ?? [];
            values.push(candidate);
            byDocument.set(key, values);
        }
        const documents = [...byDocument.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
        let progress = true;
        while (progress && selected.length < DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.callsPerReview) {
            progress = false;
            for (const documentId of documents) {
                const candidate = byDocument.get(documentId)!.find(value => !selectedIds.has(value.analyzed.group.groupId));
                if (!candidate) continue;
                selected.push(candidate.analyzed);
                selectedIds.add(candidate.analyzed.group.groupId);
                progress = true;
                if (selected.length >= DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.callsPerReview) break;
            }
        }
        if (selected.length >= DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.callsPerReview) break;
    }
    return {
        selected,
        skipped: candidates.filter(candidate => !selectedIds.has(candidate.analyzed.group.groupId)).map(candidate => candidate.analyzed),
    };
}

function compactExcerpt(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.excerptCharactersPerSide
        ? normalized
        : `${normalized.slice(0, DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.excerptCharactersPerSide - 1)}…`;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => compareOrdinal(a, b))
            .map(([key, entry]) => [key, canonicalize(entry)]));
    }
    return value;
}

export function buildDocumentChangeMaterialityAnalysisInput(analyzed: AnalyzedDocumentChangeGroup): {
    input: DocumentChangeMaterialityAnalysisInput;
    inputDigest: string;
    canonicalCharacterCount: number;
    truncated: boolean;
} {
    const changes = analyzed.group.rawChanges
        .slice(0, DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.rawChangesPerGroup)
        .map(change => ({
            changeType: change.changeType,
            ...(compactExcerpt(change.previousChunk?.content) ? { previousExcerpt: compactExcerpt(change.previousChunk?.content) } : {}),
            ...(compactExcerpt(change.currentChunk?.content) ? { currentExcerpt: compactExcerpt(change.currentChunk?.content) } : {}),
            alignmentMethod: change.alignmentMethod,
        }));
    const input: DocumentChangeMaterialityAnalysisInput = {
        groupId: analyzed.group.groupId,
        documentTitle: analyzed.pair.documentTitle.slice(0, 256),
        structurePath: analyzed.group.structurePath?.slice(0, 256) ?? null,
        structureTitle: analyzed.group.structureTitle?.slice(0, 256) ?? null,
        deterministicCategory: analyzed.materiality.category,
        deterministicConfidence: analyzed.materiality.confidence,
        deterministicSignals: analyzed.materiality.signals.slice(0, 20),
        changes,
    };
    const canonical = JSON.stringify(canonicalize(input));
    if (canonical.length > DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.canonicalInputCharacters) {
        throw new Error("Bounded document-change materiality input exceeded its invariant limit.");
    }
    return {
        input,
        inputDigest: createHash("sha256").update(canonical, "utf8").digest("hex"),
        canonicalCharacterCount: canonical.length,
        truncated: analyzed.group.rawChanges.length > changes.length
            || analyzed.group.rawChanges.some(change =>
                (change.previousChunk?.content.replace(/\s+/g, " ").trim().length ?? 0) > DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.excerptCharactersPerSide
                || (change.currentChunk?.content.replace(/\s+/g, " ").trim().length ?? 0) > DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.excerptCharactersPerSide),
    };
}

function confidenceFromAnalysis(value: number): DeterministicMaterialityConfidence {
    return value >= 0.8 ? "strong" : value >= 0.55 ? "moderate" : "uncertain";
}

function effectiveAnalyzedGroup(success: SuccessfulAnalysis): AnalyzedDocumentChangeGroup | null {
    if (success.result.disposition === "non_material") return null;
    const category = success.result.disposition === "uncertain" ? "uncertain" : success.result.category;
    return {
        ...success.analyzed,
        materiality: {
            category,
            priority: documentChangeCategoryPriority(category),
            confidence: success.result.disposition === "uncertain" ? "uncertain" : confidenceFromAnalysis(success.result.confidence),
            signals: success.result.disposition === "uncertain"
                ? ["semantic_analysis_uncertain"]
                : ["semantic_analysis_material"],
        },
    };
}

function normalizedCopied(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function verifiedKeyPoint(value: string | undefined, changes: readonly RawDocumentChange[], side: "previousChunk" | "currentChunk"): string | undefined {
    if (!value) return undefined;
    const candidate = normalizedCopied(value);
    return changes.some(change => normalizedCopied(change[side]?.content ?? "").includes(candidate)) ? value : undefined;
}

function firstCopiedSpan(changes: readonly RawDocumentChange[], side: "previousChunk" | "currentChunk"): string | undefined {
    const value = changes.map(change => change[side]?.content).find(content => content?.trim());
    if (!value) return undefined;
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length <= 240 ? compact : `${compact.slice(0, 239)}…`;
}

function buildAnalyzerEvidence(success: SuccessfulAnalysis, effective: AnalyzedDocumentChangeGroup): FounderWeeklyReviewEvidenceItem {
    const deterministic = buildCondensedDocumentChangeEvidence(effective.pair, effective.group, effective.materiality);
    const before = verifiedKeyPoint(success.result.beforeKeyPoint, effective.group.rawChanges, "previousChunk")
        ?? firstCopiedSpan(effective.group.rawChanges, "previousChunk");
    const after = verifiedKeyPoint(success.result.afterKeyPoint, effective.group.rawChanges, "currentChunk")
        ?? firstCopiedSpan(effective.group.rawChanges, "currentChunk");
    const excerpt = [
        success.result.summary,
        ...(before ? [`Before: “${before}”`] : []),
        ...(after ? [`After: “${after}”`] : []),
    ].join("\n\n").slice(0, 1800);
    return {
        ...deterministic,
        excerpt,
        metadata: {
            ...deterministic.metadata,
            category: effective.materiality.category,
            materialityMethod: "llm",
            materialityConfidence: success.result.confidence,
            materialityVersion: DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROMPT_VERSION,
        },
    };
}

function analysisSnapshot(success: SuccessfulAnalysis): DocumentChangeMaterialityAnalysisSnapshot {
    return {
        disposition: success.result.disposition,
        category: success.result.category,
        confidence: success.result.confidence,
        summary: success.result.summary,
        ...(success.result.beforeKeyPoint ? { beforeKeyPoint: verifiedKeyPoint(success.result.beforeKeyPoint, success.analyzed.group.rawChanges, "previousChunk") } : {}),
        ...(success.result.afterKeyPoint ? { afterKeyPoint: verifiedKeyPoint(success.result.afterKeyPoint, success.analyzed.group.rawChanges, "currentChunk") } : {}),
        analysisMethod: "llm",
        analysisPromptVersion: success.metadata.promptVersion ?? DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROMPT_VERSION,
        ...(success.metadata.provider ? { analysisProvider: success.metadata.provider.slice(0, 128) } : {}),
        ...(success.metadata.model ? { analysisModel: success.metadata.model.slice(0, 256) } : {}),
        analysisInputDigest: success.inputDigest,
        analysisResultSchemaVersion: DOCUMENT_CHANGE_MATERIALITY_ANALYSIS_RESULT_VERSION,
    };
}

function warning(code: DocumentChangeProcessingWarning["code"], message: string): DocumentChangeProcessingWarning {
    return { code, message };
}

async function executeBounded<T, R>(values: readonly T[], concurrency: number, task: (value: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(values.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (next < values.length) {
            const index = next++;
            try {
                results[index] = { status: "fulfilled", value: await task(values[index]!) };
            } catch (reason) {
                results[index] = { status: "rejected", reason };
            }
        }
    }));
    return results;
}

/** Optional semantic pass. Omit the analyzer to preserve the exact deterministic-v1 result. */
export async function materializeDocumentChangesWithAnalyzer(
    inputs: readonly DocumentChangePairInput[],
    analyzer?: DocumentChangeMaterialityAnalyzer,
): Promise<AnalyzedMaterialChangeResult> {
    const deterministic = materializeDocumentChanges(inputs);
    const emptyDiagnostics: DocumentChangeMaterialityAnalyzerDiagnostics = {
        eligibleGroupCount: 0,
        selectedAnalysisCount: 0,
        skippedByCallBudgetCount: 0,
        inputTruncatedCount: 0,
        succeededAnalysisCount: 0,
        failedAnalysisCount: 0,
        materialCount: 0,
        nonMaterialCount: 0,
        uncertainCount: 0,
    };
    if (!analyzer) return { ...deterministic, analyzerDiagnostics: emptyDiagnostics };

    const eligible = deterministic.analyzedGroups.filter(group => shouldAnalyzeDocumentChangeGroup(group).eligible);
    const analysisSelection = selectDocumentChangeGroupsForMaterialityAnalysis(deterministic.analyzedGroups);
    const prepared = analysisSelection.selected.map(analyzed => ({ analyzed, ...buildDocumentChangeMaterialityAnalysisInput(analyzed) }));
    const warnings: DocumentChangeProcessingWarning[] = [...deterministic.warnings];
    if (analysisSelection.skipped.length > 0 || prepared.some(value => value.truncated)) {
        warnings.push(warning("materiality_analysis_budget_truncated", "Optional materiality analysis used bounded call or input capacity; remaining groups used deterministic fallback."));
    }
    const settled = await executeBounded(prepared, DOCUMENT_CHANGE_MATERIALITY_ANALYZER_LIMITS.concurrency, async preparedInput => {
        const response = await analyzer.analyze(preparedInput.input);
        const result = DocumentChangeMaterialityAnalysisResultSchema.parse(response.result);
        return {
            analyzed: preparedInput.analyzed,
            input: preparedInput.input,
            inputDigest: preparedInput.inputDigest,
            inputTruncated: preparedInput.truncated,
            result,
            metadata: response.metadata ?? {},
        } satisfies SuccessfulAnalysis;
    });
    const successes: SuccessfulAnalysis[] = [];
    let invalid = false;
    let timeout = false;
    let unavailable = false;
    for (const result of settled) {
        if (result.status === "fulfilled") successes.push(result.value);
        else if (result.reason instanceof z.ZodError) invalid = true;
        else if (result.reason instanceof DocumentChangeMaterialityAnalyzerError && result.reason.code === "invalid") invalid = true;
        else if (result.reason instanceof DocumentChangeMaterialityAnalyzerError && result.reason.code === "timeout") timeout = true;
        else if (result.reason instanceof DocumentChangeMaterialityAnalyzerError && result.reason.code === "unavailable") unavailable = true;
        else unavailable = true;
    }
    if (invalid) warnings.push(warning("materiality_result_invalid", "An optional materiality result failed strict validation; deterministic evidence was retained."));
    if (timeout) warnings.push(warning("materiality_analysis_timeout", "Optional materiality analysis timed out; deterministic evidence was retained."));
    if (unavailable) warnings.push(warning("materiality_analyzer_unavailable", "Optional materiality analysis was unavailable; deterministic evidence was retained."));
    if (settled.some(result => result.status === "rejected")) {
        warnings.push(warning("materiality_analysis_partial", "Optional materiality analysis was partial; failed groups used deterministic fallback."));
    }

    const successByGroup = new Map(successes.map(success => [success.analyzed.group.groupId, success]));
    const effectiveGroups = deterministic.analyzedGroups.flatMap(analyzed => {
        const success = successByGroup.get(analyzed.group.groupId);
        if (!success) return [analyzed];
        const effective = effectiveAnalyzedGroup(success);
        return effective ? [effective] : [];
    });
    const selection = selectMaterialDocumentChangeGroups(effectiveGroups);
    warnings.push(...selection.warnings);
    const selectedIds = new Set(selection.selectedGroups.map(group => group.group.groupId));
    const items = selection.selectedGroups.map(effective => {
        const success = successByGroup.get(effective.group.groupId);
        return success?.result.disposition === "material"
            ? buildAnalyzerEvidence(success, effective)
            : buildCondensedDocumentChangeEvidence(effective.pair, effective.group, effective.materiality);
    });
    const audit: DocumentChangeAuditSnapshot = {
        ...deterministic.audit,
        groups: deterministic.audit.groups.map(group => ({
            ...group,
            evidenceSourceId: selectedIds.has(group.groupId) ? documentChangeGroupSourceId(
                deterministic.analyzedGroups.find(candidate => candidate.group.groupId === group.groupId)!.group,
            ) : null,
            ...(successByGroup.has(group.groupId) ? { analysis: analysisSnapshot(successByGroup.get(group.groupId)!) } : {}),
        })),
    };
    const selectedGroups = selection.selectedGroups;
    const rawExcerptCharacters = audit.rawChanges.reduce((total, change) =>
        total + (change.previousExcerpt?.length ?? 0) + (change.currentExcerpt?.length ?? 0), 0);
    const condensedPromptFacingCharacters = items.reduce((total, item) => total + item.excerpt.length, 0);
    const materialCount = successes.filter(success => success.result.disposition === "material").length;
    const nonMaterialCount = successes.filter(success => success.result.disposition === "non_material").length;
    const uncertainCount = successes.filter(success => success.result.disposition === "uncertain").length;
    return {
        ...deterministic,
        selectedGroups,
        items,
        audit,
        warnings: [...new Map(warnings.map(value => [value.code, value])).values()],
        diagnostics: {
            ...deterministic.diagnostics,
            selectedGroupCount: selectedGroups.length,
            truncatedGroupCount: effectiveGroups.length - selectedGroups.length,
            selectedGroupsByCategory: Object.fromEntries(DOCUMENT_CHANGE_CATEGORIES.map(category => [category,
                selectedGroups.filter(group => group.materiality.category === category).length])) as Record<DocumentChangeCategory, number>,
            truncatedGroupsByCategory: Object.fromEntries(DOCUMENT_CHANGE_CATEGORIES.map(category => [category,
                effectiveGroups.filter(group => !selectedIds.has(group.group.groupId) && group.materiality.category === category).length])) as Record<DocumentChangeCategory, number>,
            condensedEvidenceCount: items.length,
            rawExcerptCharacters,
            condensedPromptFacingCharacters,
            estimatedReductionRatio: rawExcerptCharacters === 0 ? 1 : Number((rawExcerptCharacters / Math.max(1, condensedPromptFacingCharacters)).toFixed(3)),
        },
        analyzerDiagnostics: {
            eligibleGroupCount: eligible.length,
            selectedAnalysisCount: prepared.length,
            skippedByCallBudgetCount: analysisSelection.skipped.length,
            inputTruncatedCount: prepared.filter(value => value.truncated).length,
            succeededAnalysisCount: successes.length,
            failedAnalysisCount: settled.length - successes.length,
            materialCount,
            nonMaterialCount,
            uncertainCount,
        },
    };
}
