import { createHash } from "node:crypto";

import type {
    DocumentChangeAuditSnapshot,
    FounderWeeklyReviewEvidenceItem,
    FounderWeeklyReviewEvidenceSnapshot,
    RawDocumentChangeSnapshot,
} from "./contracts";
import {
    DOCUMENT_CHANGE_GROUP_BUDGET,
    RAW_DOCUMENT_CHANGE_VERSION,
    buildRawDocumentChanges,
    groupRawDocumentChanges,
    type DocumentChangeGroup,
    type DocumentChangePairInput,
    type DocumentChangeProcessingWarning,
    type RawDocumentChange,
    type VersionChunk,
    type VersionPair,
} from "./document-change";

export const DOCUMENT_CHANGE_MATERIALITY_VERSION = "document-change-materiality/v1" as const;
export const DOCUMENT_CHANGE_AUDIT_VERSION = "document-change-audit/v1" as const;

export const DOCUMENT_CHANGE_CATEGORIES = [
    "ownership_change",
    "status_change",
    "deadline_change",
    "metric_change",
    "requirement_change",
    "risk_or_blocker_change",
    "scope_change",
    "priority_change",
    "uncertain",
    "editorial_rewrite",
] as const;

export type DocumentChangeCategory = (typeof DOCUMENT_CHANGE_CATEGORIES)[number];
export type DeterministicMaterialityConfidence = "strong" | "moderate" | "uncertain";

export type DeterministicMaterialityResult = {
    category: DocumentChangeCategory;
    priority: number;
    confidence: DeterministicMaterialityConfidence;
    signals: readonly string[];
};

export const DOCUMENT_CHANGE_FACTUAL_DELTA_VERSION = "document-change-factual-delta/v2" as const;

export const DOCUMENT_CHANGE_FACTUAL_DELTA_KINDS = [
    "ownership",
    "status",
    "deadline",
    "metric",
    "requirement",
    "negation",
    "risk_or_blocker",
    "scope",
    "priority",
] as const;

export type DocumentChangeFactualDeltaKind = (typeof DOCUMENT_CHANGE_FACTUAL_DELTA_KINDS)[number];
export type DocumentChangeFactualDelta = {
    kind: DocumentChangeFactualDeltaKind;
    previousValue?: string;
    currentValue?: string;
    relation: "changed" | "equivalent" | "unknown";
    confidence: "strong" | "moderate";
};

export type DocumentChangeFactualDeltaAssessment = {
    version: typeof DOCUMENT_CHANGE_FACTUAL_DELTA_VERSION;
    factualComparisons: readonly DocumentChangeFactualDelta[];
    confirmedFactualDeltas: readonly DocumentChangeFactualDelta[];
    equivalentFactualValues: readonly DocumentChangeFactualDelta[];
    possibleSignals: readonly DocumentChangeFactualDeltaKind[];
};

export type AnalyzedDocumentChangeGroup = {
    pair: VersionPair;
    group: DocumentChangeGroup;
    materiality: DeterministicMaterialityResult;
};

export type DeterministicMaterialChangeDiagnostics = {
    versionPairCount: number;
    alignedChunkCount: number;
    rawModifiedCount: number;
    rawAddedCount: number;
    rawRemovedCount: number;
    deterministicNoOpCount: number;
    groupCount: number;
    oversizedGroupSplitCount: number;
    selectedGroupCount: number;
    truncatedGroupCount: number;
    approximateChangedCharacters: number;
    groupsByMaterialityCategory: Record<DocumentChangeCategory, number>;
    groupsByDeterministicConfidence: Record<DeterministicMaterialityConfidence, number>;
    selectedGroupsByCategory: Record<DocumentChangeCategory, number>;
    truncatedGroupsByCategory: Record<DocumentChangeCategory, number>;
    rawAuditCount: number;
    condensedEvidenceCount: number;
    rawExcerptCharacters: number;
    condensedPromptFacingCharacters: number;
    estimatedReductionRatio: number;
};

export type DeterministicMaterialChangeResult = {
    rawChanges: readonly RawDocumentChange[];
    analyzedGroups: readonly AnalyzedDocumentChangeGroup[];
    selectedGroups: readonly AnalyzedDocumentChangeGroup[];
    items: readonly FounderWeeklyReviewEvidenceItem[];
    audit: DocumentChangeAuditSnapshot;
    warnings: readonly DocumentChangeProcessingWarning[];
    diagnostics: DeterministicMaterialChangeDiagnostics;
};

const CATEGORY_PRIORITY: Record<DocumentChangeCategory, number> = Object.fromEntries(
    DOCUMENT_CHANGE_CATEGORIES.map((category, index) => [category, index + 1])
) as Record<DocumentChangeCategory, number>;

export function documentChangeCategoryPriority(category: DocumentChangeCategory): number {
    return CATEGORY_PRIORITY[category];
}

const CATEGORY_LABEL: Record<DocumentChangeCategory, string> = {
    ownership_change: "Ownership changed.",
    status_change: "Status changed.",
    deadline_change: "Deadline or date changed.",
    metric_change: "Metric changed.",
    requirement_change: "Requirement changed.",
    risk_or_blocker_change: "Risk or blocker changed.",
    scope_change: "Scope changed.",
    priority_change: "Priority changed.",
    uncertain: "Section changed.",
    editorial_rewrite: "Editorial formatting changed.",
};

const TEAM_TERMS = new Set([
    "product",
    "platform",
    "marketing",
    "sales",
    "engineering",
    "operations",
    "finance",
    "legal",
    "support",
]);
const STATUS_TERMS = [
    "planned",
    "launched",
    "shipped",
    "in progress",
    "active",
    "cancelled",
    "canceled",
    "completed",
    "paused",
];
const REQUIREMENT_TERMS = [
    "may",
    "must",
    "should",
    "optional",
    "required",
    "recommended",
    "mandatory",
];
const RISK_TERMS = [
    "risk",
    "risks",
    "blocker",
    "blockers",
    "blocked",
    "resolved",
    "unblocked",
    "at risk",
];
const PRIORITY_TERMS = [
    "p0",
    "p1",
    "p2",
    "p3",
    "deferred",
    "immediate",
    "low priority",
    "high priority",
    "critical",
];
const SCOPE_TERMS = [
    "us only",
    "global",
    "pilot customers",
    "all enterprise customers",
    "one team",
    "company-wide",
    "company wide",
];

function compareOrdinal(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareBigInt(a: bigint, b: bigint): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function bound(value: string, maximum: number): string {
    return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function copiedText(value: string, maximum = 480): string {
    return bound(value.replace(/\s+/g, " ").trim(), maximum);
}

function valuesMatching(value: string, expressions: readonly RegExp[]): string[] {
    const values = expressions.flatMap(expression =>
        [...value.matchAll(expression)].map(match => (match[1] ?? match[0]).toLocaleLowerCase())
    );
    return [...new Set(values)].sort(compareOrdinal);
}

function phraseValues(value: string, phrases: readonly string[]): string[] {
    const lower = value.toLocaleLowerCase();
    return phrases.filter(phrase =>
        new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i").test(lower)
    );
}

function changedValues(
    before: string,
    after: string,
    extract: (value: string) => readonly string[]
): boolean {
    const previous = [...extract(before)].sort(compareOrdinal);
    const current = [...extract(after)].sort(compareOrdinal);
    return (
        (previous.length > 0 || current.length > 0) &&
        JSON.stringify(previous) !== JSON.stringify(current)
    );
}

function ownershipValues(value: string): string[] {
    const explicit = valuesMatching(value, [
        /\bowner\s*:\s*([\p{L}\p{N}_ -]{1,80})/giu,
        /\b([\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+){0,3})\s+owns\b/giu,
        /\bowned\s+by\s+([\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+){0,3})/giu,
    ]);
    const trimmed = value.trim().toLocaleLowerCase();
    if (TEAM_TERMS.has(trimmed)) explicit.push(trimmed);
    return [...new Set(explicit)].sort(compareOrdinal);
}

function deadlineValues(value: string): string[] {
    return valuesMatching(value, [
        /\b(q[1-4])\b/giu,
        /\b(20\d{2})\b/gu,
        /\b((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*20\d{2})?)\b/giu,
        /\b(20\d{2}-\d{2}-\d{2})\b/gu,
    ]);
}

function metricValues(value: string): string[] {
    return valuesMatching(value, [
        /([$€£]\s*\d+(?:\.\d+)?\s*[kmb]?)/giu,
        /(\d+(?:\.\d+)?\s*%)/gu,
        /\b(\d+(?:\.\d+)?\s*(?:customers?|users?|accounts?|employees?|days?|weeks?|months?|revenue|arr|mrr))\b/giu,
    ]);
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort(compareOrdinal);
}

function canonicalDeadlineValues(value: string): string[] {
    const quarterAliases: Record<string, string> = {
        q1: "q1",
        first: "q1",
        q2: "q2",
        second: "q2",
        q3: "q3",
        third: "q3",
        q4: "q4",
        fourth: "q4",
    };
    const quarters = [
        ...value.matchAll(/\b(q[1-4])\b/giu),
        ...value.matchAll(/\b(first|second|third|fourth)[ -]quarter\b/giu),
    ].map(match => quarterAliases[match[1]!.toLocaleLowerCase()]!);
    return uniqueSorted([
        ...quarters,
        ...valuesMatching(value, [
            /\b(20\d{2})\b/gu,
            /\b((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*20\d{2})?)\b/giu,
            /\b(20\d{2}-\d{2}-\d{2})\b/gu,
        ]),
    ]);
}

const NUMBER_WORD_VALUES: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
};

function parseNumberWords(value: string): number | null {
    const tokens = value
        .toLocaleLowerCase()
        .split(/[\s-]+/)
        .filter(Boolean);
    if (
        tokens.length === 0 ||
        tokens.some(
            token =>
                !(token in NUMBER_WORD_VALUES) &&
                !["hundred", "thousand", "million", "billion", "and"].includes(token)
        )
    ) {
        return null;
    }
    let total = 0;
    let current = 0;
    for (const token of tokens) {
        if (token === "and") continue;
        if (token in NUMBER_WORD_VALUES) current += NUMBER_WORD_VALUES[token]!;
        else if (token === "hundred") current = Math.max(1, current) * 100;
        else {
            const scale =
                token === "thousand" ? 1_000 : token === "million" ? 1_000_000 : 1_000_000_000;
            total += Math.max(1, current) * scale;
            current = 0;
        }
    }
    return total + current;
}

function canonicalMetricValues(value: string): string[] {
    const result: string[] = [];
    const currencyCodes: Record<string, string> = { $: "usd", "€": "eur", "£": "gbp" };
    for (const match of value.matchAll(/([$€£])\s*(\d+(?:\.\d+)?)\s*([kmb])?\b/giu)) {
        const multiplier =
            match[3]?.toLocaleLowerCase() === "k"
                ? 1_000
                : match[3]?.toLocaleLowerCase() === "m"
                  ? 1_000_000
                  : match[3]?.toLocaleLowerCase() === "b"
                    ? 1_000_000_000
                    : 1;
        result.push(`${currencyCodes[match[1]!]!}:${Number(match[2]) * multiplier}`);
    }
    const numberWords =
        "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|and";
    const wordCurrency = new RegExp(
        `\\b((?:(?:${numberWords})[\\s-]+){1,8})(dollars?|euros?|pounds?)\\b`,
        "giu"
    );
    for (const match of value.matchAll(wordCurrency)) {
        const amount = parseNumberWords(match[1]!);
        const unit = match[2]!.toLocaleLowerCase().startsWith("dollar")
            ? "usd"
            : match[2]!.toLocaleLowerCase().startsWith("euro")
              ? "eur"
              : "gbp";
        if (amount !== null) result.push(`${unit}:${amount}`);
    }
    for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*%/gu))
        result.push(`percent:${Number(match[1])}`);
    for (const match of value.matchAll(
        /\b(\d+(?:\.\d+)?)\s*(customers?|users?|accounts?|employees?|days?|weeks?|months?|revenue|arr|mrr)\b/giu
    )) {
        result.push(`${match[2]!.toLocaleLowerCase().replace(/s$/, "")}:${Number(match[1])}`);
    }
    return uniqueSorted(result);
}

function canonicalPhraseValues(
    value: string,
    phrases: readonly string[],
    aliases: Record<string, string> = {}
): string[] {
    return uniqueSorted(phraseValues(value, phrases).map(phrase => aliases[phrase] ?? phrase));
}

type FactualValueExtractor = (value: string) => readonly string[];

const FACTUAL_EXTRACTORS: ReadonlyArray<{
    kind: Exclude<DocumentChangeFactualDeltaKind, "negation">;
    extract: FactualValueExtractor;
}> = [
    { kind: "ownership", extract: ownershipValues },
    {
        kind: "status",
        extract: value => canonicalPhraseValues(value, STATUS_TERMS, { canceled: "cancelled" }),
    },
    { kind: "deadline", extract: canonicalDeadlineValues },
    { kind: "metric", extract: canonicalMetricValues },
    { kind: "requirement", extract: value => canonicalPhraseValues(value, REQUIREMENT_TERMS) },
    {
        kind: "risk_or_blocker",
        extract: value =>
            canonicalPhraseValues(value, RISK_TERMS, { risks: "risk", blockers: "blocker" }),
    },
    {
        kind: "scope",
        extract: value =>
            canonicalPhraseValues(value, SCOPE_TERMS, { "company wide": "company-wide" }),
    },
    { kind: "priority", extract: value => canonicalPhraseValues(value, PRIORITY_TERMS) },
];

const SIGNAL_KIND: Record<string, DocumentChangeFactualDeltaKind> = {
    ownership_subject_changed: "ownership",
    status_term_changed: "status",
    date_or_deadline_changed: "deadline",
    numeric_metric_changed: "metric",
    requirement_or_modality_changed: "requirement",
    negation_changed: "negation",
    risk_or_blocker_term_changed: "risk_or_blocker",
    scope_marker_changed: "scope",
    priority_marker_changed: "priority",
};

function comparison(
    change: RawDocumentChange,
    kind: DocumentChangeFactualDeltaKind,
    previous: readonly string[],
    current: readonly string[]
): DocumentChangeFactualDelta | null {
    if (previous.length === 0 && current.length === 0) return null;
    const previousValue = previous.join(" | ") || undefined;
    const currentValue = current.join(" | ") || undefined;
    if (
        change.changeType !== "modified" ||
        !change.previousChunk ||
        !change.currentChunk ||
        !previousValue ||
        !currentValue
    ) {
        return {
            kind,
            ...(previousValue ? { previousValue } : {}),
            ...(currentValue ? { currentValue } : {}),
            relation: "unknown",
            confidence: "moderate",
        };
    }
    return {
        kind,
        previousValue,
        currentValue,
        relation: previousValue === currentValue ? "equivalent" : "changed",
        confidence: "strong",
    };
}

/**
 * Separates business-token presence from a confirmed two-sided factual delta.
 * It is intentionally narrow: unknown values remain analyzer candidates rather than being normalized away.
 */
export function analyzeDocumentChangeFactualDeltas(
    group: DocumentChangeGroup,
    deterministicSignals: readonly string[] = []
): DocumentChangeFactualDeltaAssessment {
    const factualComparisons: DocumentChangeFactualDelta[] = [];
    for (const change of group.rawChanges) {
        const before = change.previousNormalizedContent ?? "";
        const after = change.currentNormalizedContent ?? "";
        for (const extractor of FACTUAL_EXTRACTORS) {
            const result = comparison(
                change,
                extractor.kind,
                extractor.extract(before),
                extractor.extract(after)
            );
            if (result) factualComparisons.push(result);
        }
        if (change.changeType === "modified" && change.previousChunk && change.currentChunk) {
            const negations = (value: string) =>
                phraseValues(value, ["not", "no", "never", "unavailable"]);
            const beforeNegated = negations(before).length > 0;
            const afterNegated = negations(after).length > 0;
            if (beforeNegated || afterNegated) {
                factualComparisons.push({
                    kind: "negation",
                    previousValue: beforeNegated ? "negated" : "affirmed",
                    currentValue: afterNegated ? "negated" : "affirmed",
                    relation: beforeNegated === afterNegated ? "equivalent" : "changed",
                    confidence: "strong",
                });
            }
        } else {
            const negations = phraseValues(`${before} ${after}`, [
                "not",
                "no",
                "never",
                "unavailable",
            ]);
            if (negations.length > 0) {
                factualComparisons.push({
                    kind: "negation",
                    ...(before ? { previousValue: negations.join(" | ") } : {}),
                    ...(after ? { currentValue: negations.join(" | ") } : {}),
                    relation: "unknown",
                    confidence: "moderate",
                });
            }
        }
    }
    const deduplicated = [
        ...new Map(
            factualComparisons.map(value => [
                [
                    value.kind,
                    value.previousValue ?? "",
                    value.currentValue ?? "",
                    value.relation,
                ].join(":"),
                value,
            ])
        ).values(),
    ].sort(
        (a, b) =>
            compareOrdinal(a.kind, b.kind) ||
            compareOrdinal(a.previousValue ?? "", b.previousValue ?? "") ||
            compareOrdinal(a.currentValue ?? "", b.currentValue ?? "") ||
            compareOrdinal(a.relation, b.relation)
    );
    const confirmedFactualDeltas = deduplicated.filter(value => value.relation === "changed");
    const equivalentFactualValues = deduplicated.filter(value => value.relation === "equivalent");
    const confirmedKinds = new Set(confirmedFactualDeltas.map(value => value.kind));
    const possibleSignals = uniqueSorted([
        ...deduplicated.filter(value => value.relation === "unknown").map(value => value.kind),
        ...deterministicSignals.flatMap(signal => {
            const kind = SIGNAL_KIND[signal];
            return kind && !confirmedKinds.has(kind) ? [kind] : [];
        }),
    ]) as DocumentChangeFactualDeltaKind[];
    return {
        version: DOCUMENT_CHANGE_FACTUAL_DELTA_VERSION,
        factualComparisons: deduplicated,
        confirmedFactualDeltas,
        equivalentFactualValues,
        possibleSignals,
    };
}

function punctuationOnlyEditorial(before: string, after: string): boolean {
    const stripBullet = (value: string) =>
        value
            .replace(/^\s*[-*+]\s+/gm, "")
            .replace(/\s+/g, " ")
            .trim();
    return before !== after && stripBullet(before) === stripBullet(after);
}

function addSignal(
    candidates: Map<DocumentChangeCategory, Set<string>>,
    category: DocumentChangeCategory,
    signal: string
): void {
    const signals = candidates.get(category) ?? new Set<string>();
    signals.add(signal);
    candidates.set(category, signals);
}

/** Conservative token-pattern nomination; absence of a signal remains uncertain. */
export function analyzeDocumentChangeGroup(
    group: DocumentChangeGroup
): DeterministicMaterialityResult {
    const candidates = new Map<DocumentChangeCategory, Set<string>>();
    let editorialOnly = group.rawChanges.length > 0;
    for (const change of group.rawChanges) {
        const before = change.previousNormalizedContent ?? "";
        const after = change.currentNormalizedContent ?? "";
        if (changedValues(before, after, ownershipValues))
            addSignal(candidates, "ownership_change", "ownership_subject_changed");
        if (changedValues(before, after, value => phraseValues(value, STATUS_TERMS)))
            addSignal(candidates, "status_change", "status_term_changed");
        if (changedValues(before, after, deadlineValues))
            addSignal(candidates, "deadline_change", "date_or_deadline_changed");
        if (changedValues(before, after, metricValues))
            addSignal(candidates, "metric_change", "numeric_metric_changed");
        if (changedValues(before, after, value => phraseValues(value, REQUIREMENT_TERMS)))
            addSignal(candidates, "requirement_change", "requirement_or_modality_changed");
        if (changedValues(before, after, value => phraseValues(value, RISK_TERMS)))
            addSignal(candidates, "risk_or_blocker_change", "risk_or_blocker_term_changed");
        if (changedValues(before, after, value => phraseValues(value, SCOPE_TERMS)))
            addSignal(candidates, "scope_change", "scope_marker_changed");
        if (changedValues(before, after, value => phraseValues(value, PRIORITY_TERMS)))
            addSignal(candidates, "priority_change", "priority_marker_changed");
        if (
            changedValues(before, after, value =>
                phraseValues(value, ["not", "no", "never", "unavailable"])
            )
        ) {
            addSignal(candidates, "requirement_change", "negation_changed");
        }
        editorialOnly =
            editorialOnly &&
            change.changeType === "modified" &&
            punctuationOnlyEditorial(before, after);
    }
    const category =
        [...candidates.keys()].sort((a, b) => CATEGORY_PRIORITY[a] - CATEGORY_PRIORITY[b])[0] ??
        (editorialOnly ? "editorial_rewrite" : "uncertain");
    const signals =
        candidates.size > 0
            ? [...candidates.entries()]
                  .sort(([a], [b]) => CATEGORY_PRIORITY[a] - CATEGORY_PRIORITY[b])
                  .flatMap(([, categorySignals]) => [...categorySignals].sort(compareOrdinal))
            : [
                  category === "editorial_rewrite"
                      ? "markdown_bullet_marker_changed"
                      : "no_strong_deterministic_signal",
              ];
    const confidence: DeterministicMaterialityConfidence =
        category === "uncertain"
            ? "uncertain"
            : category === "editorial_rewrite" ||
                (signals.includes("ownership_subject_changed") &&
                    group.rawChanges.every(change => {
                        const before =
                            change.previousNormalizedContent?.trim().toLocaleLowerCase() ?? "";
                        const after =
                            change.currentNormalizedContent?.trim().toLocaleLowerCase() ?? "";
                        return TEAM_TERMS.has(before) && TEAM_TERMS.has(after);
                    }))
              ? "moderate"
              : "strong";
    return { category, priority: CATEGORY_PRIORITY[category], confidence, signals };
}

function confidenceRank(value: DeterministicMaterialityConfidence): number {
    return value === "strong" ? 0 : value === "moderate" ? 1 : 2;
}

function structuralKey(group: DocumentChangeGroup): string {
    const first = group.rawChanges[0]!;
    const chunk = first.currentChunk ?? first.previousChunk!;
    return [
        chunk.structureOrdering ?? "",
        chunk.pageNumber ?? "",
        chunk.lineStart ?? "",
        group.structurePath ?? "",
        group.groupId,
    ].join(":");
}

function compareSelectionPriority(
    a: AnalyzedDocumentChangeGroup,
    b: AnalyzedDocumentChangeGroup
): number {
    return (
        a.materiality.priority - b.materiality.priority ||
        confidenceRank(a.materiality.confidence) - confidenceRank(b.materiality.confidence) ||
        b.pair.currentCreatedAt.getTime() - a.pair.currentCreatedAt.getTime() ||
        a.group.splitOrdinal - b.group.splitOrdinal ||
        compareOrdinal(structuralKey(a.group), structuralKey(b.group))
    );
}

function compareFinalOrder(a: AnalyzedDocumentChangeGroup, b: AnalyzedDocumentChangeGroup): number {
    return (
        a.pair.currentCreatedAt.getTime() - b.pair.currentCreatedAt.getTime() ||
        compareBigInt(a.group.documentId, b.group.documentId) ||
        a.group.previousVersionId - b.group.previousVersionId ||
        a.group.currentVersionId - b.group.currentVersionId ||
        compareOrdinal(structuralKey(a.group), structuralKey(b.group))
    );
}

export function selectMaterialDocumentChangeGroups(input: readonly AnalyzedDocumentChangeGroup[]): {
    selectedGroups: AnalyzedDocumentChangeGroup[];
    truncatedGroups: AnalyzedDocumentChangeGroup[];
    warnings: DocumentChangeProcessingWarning[];
} {
    const byDocument = new Map<string, AnalyzedDocumentChangeGroup[]>();
    for (const analyzed of input) {
        const key = analyzed.group.documentId.toString();
        const groups = byDocument.get(key) ?? [];
        groups.push(analyzed);
        byDocument.set(key, groups);
    }
    const documents = [...byDocument.entries()].sort(([a], [b]) =>
        compareBigInt(BigInt(a), BigInt(b))
    );
    for (const [, groups] of documents) groups.sort(compareSelectionPriority);
    const selectedGroups: AnalyzedDocumentChangeGroup[] = [];
    const selectedIds = new Set<string>();
    const documentCounts = new Map<string, number>();
    const pairCounts = new Map<string, number>();
    let madeProgress = true;
    while (selectedGroups.length < DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerReview && madeProgress) {
        madeProgress = false;
        for (const [documentId, groups] of documents) {
            if (
                (documentCounts.get(documentId) ?? 0) >=
                DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerDocument
            )
                continue;
            const candidate = groups.find(analyzed => {
                if (selectedIds.has(analyzed.group.groupId)) return false;
                const key = `${documentId}:${analyzed.group.previousVersionId}:${analyzed.group.currentVersionId}`;
                return (
                    (pairCounts.get(key) ?? 0) < DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerVersionPair
                );
            });
            if (!candidate) continue;
            const pair = `${documentId}:${candidate.group.previousVersionId}:${candidate.group.currentVersionId}`;
            selectedGroups.push(candidate);
            selectedIds.add(candidate.group.groupId);
            documentCounts.set(documentId, (documentCounts.get(documentId) ?? 0) + 1);
            pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
            madeProgress = true;
            if (selectedGroups.length >= DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerReview) break;
        }
    }
    const truncatedGroups = input
        .filter(analyzed => !selectedIds.has(analyzed.group.groupId))
        .sort(compareFinalOrder);
    return {
        selectedGroups: selectedGroups.sort(compareFinalOrder),
        truncatedGroups,
        warnings:
            truncatedGroups.length > 0
                ? [
                      {
                          code: "document_change_budget_truncated",
                          message:
                              "Document-change groups were truncated to deterministic materiality-aware structural limits.",
                      },
                  ]
                : [],
    };
}

export function documentChangeGroupSourceId(group: DocumentChangeGroup): string {
    return `document_change:group:${group.groupId.replace(/^document_change_group:/, "")}`;
}

/** Resolves a condensed citation through the frozen v2 group to every raw source record. */
export function resolveDocumentChangeEvidenceAudit(
    snapshot: FounderWeeklyReviewEvidenceSnapshot,
    sourceId: string
): {
    group: DocumentChangeAuditSnapshot["groups"][number];
    rawChanges: RawDocumentChangeSnapshot[];
} | null {
    if (snapshot.schemaVersion !== "founder-weekly-review-evidence/v2") return null;
    const group = snapshot.documentChangeAudit.groups.find(
        candidate => candidate.evidenceSourceId === sourceId
    );
    if (!group) return null;
    const byId = new Map(
        snapshot.documentChangeAudit.rawChanges.map(change => [change.rawChangeId, change])
    );
    const rawChanges = group.rawChangeIds.map(rawChangeId => byId.get(rawChangeId));
    return rawChanges.some(change => !change)
        ? null
        : { group, rawChanges: rawChanges as RawDocumentChangeSnapshot[] };
}

function copiedList(
    changes: readonly RawDocumentChange[],
    side: "previousChunk" | "currentChunk"
): string | null {
    const values = changes
        .map(change => change[side]?.content)
        .filter((value): value is string => Boolean(value?.trim()));
    if (values.length === 0) return null;
    let result = "";
    for (const value of values) {
        const line = `- ${copiedText(value, 220)}`;
        if (`${result}${result ? "\n" : ""}${line}`.length > 480) break;
        result += `${result ? "\n" : ""}${line}`;
    }
    return result || `- ${copiedText(values[0]!, 476)}`;
}

/** One bounded group-level item containing only deterministic labels and copied source spans. */
export function buildCondensedDocumentChangeEvidence(
    pair: VersionPair,
    group: DocumentChangeGroup,
    materiality: DeterministicMaterialityResult
): FounderWeeklyReviewEvidenceItem {
    const before = copiedList(group.rawChanges, "previousChunk");
    const after = copiedList(group.rawChanges, "currentChunk");
    const fragmentLabel =
        group.rawChanges.length === 1
            ? ""
            : ` Section changed across ${group.rawChanges.length} source fragments.`;
    const sections = [
        `${CATEGORY_LABEL[materiality.category]}${fragmentLabel}`,
        ...(before ? [`Before:\n${before}`] : []),
        ...(after ? [`After:\n${after}`] : []),
    ];
    const section = group.structureTitle ?? group.structurePath;
    const firstChunk = group.rawChanges[0]!.currentChunk ?? group.rawChanges[0]!.previousChunk!;
    return {
        sourceType: "document_change",
        sourceId: documentChangeGroupSourceId(group),
        title: bound(section ? `${pair.documentTitle} — ${section}` : pair.documentTitle, 512),
        sourceTimestamp: pair.currentCreatedAt.toISOString(),
        excerpt: bound(sections.join("\n\n"), 1800),
        workspaceDeepLink: `/employer/documents/viewer?docId=${pair.documentId}`,
        metadata: {
            documentId: pair.documentId.toString(),
            groupId: group.groupId,
            category: materiality.category,
            materialityMethod: "deterministic",
            materialityConfidence: materiality.confidence,
            materialityVersion: DOCUMENT_CHANGE_MATERIALITY_VERSION,
            previousVersionId: pair.previousVersionId,
            currentVersionId: pair.currentVersionId,
            previousVersionNumber: pair.previousVersionNumber,
            currentVersionNumber: pair.currentVersionNumber,
            structurePath: group.structurePath ?? null,
            structureTitle: group.structureTitle ?? null,
            structureOrdering: firstChunk.structureOrdering,
            pageNumber: firstChunk.pageNumber,
            lineStart: firstChunk.lineStart,
            rawChangeCount: group.rawChanges.length,
        },
    };
}

function hashContent(chunk: VersionChunk | undefined): string | null {
    return chunk ? createHash("sha256").update(chunk.content, "utf8").digest("hex") : null;
}

function rawSnapshot(pair: VersionPair, change: RawDocumentChange): RawDocumentChangeSnapshot {
    const previous = change.previousChunk;
    const current = change.currentChunk;
    return {
        rawChangeId: change.rawChangeId,
        changeType: change.changeType,
        alignmentMethod: change.alignmentMethod,
        ...(change.similarityScore === undefined
            ? {}
            : { similarityScore: change.similarityScore }),
        documentId: pair.documentId.toString(),
        previousVersionId: pair.previousVersionId,
        currentVersionId: pair.currentVersionId,
        previousChunkId: previous?.chunkId ?? null,
        currentChunkId: current?.chunkId ?? null,
        previousExcerpt: previous ? bound(previous.content, 600) : null,
        currentExcerpt: current ? bound(current.content, 600) : null,
        previousHash: hashContent(previous),
        currentHash: hashContent(current),
        previousStructurePath: previous?.structurePath ? bound(previous.structurePath, 512) : null,
        currentStructurePath: current?.structurePath ? bound(current.structurePath, 512) : null,
        previousStructureTitle: previous?.structureTitle
            ? bound(previous.structureTitle, 512)
            : null,
        currentStructureTitle: current?.structureTitle ? bound(current.structureTitle, 512) : null,
        previousPageNumber: previous?.pageNumber ?? null,
        currentPageNumber: current?.pageNumber ?? null,
        previousLineStart: previous?.lineStart ?? null,
        previousLineEnd: previous?.lineEnd ?? null,
        currentLineStart: current?.lineStart ?? null,
        currentLineEnd: current?.lineEnd ?? null,
        processingVersion: RAW_DOCUMENT_CHANGE_VERSION,
    };
}

function emptyCategoryCounts(): Record<DocumentChangeCategory, number> {
    return Object.fromEntries(DOCUMENT_CHANGE_CATEGORIES.map(category => [category, 0])) as Record<
        DocumentChangeCategory,
        number
    >;
}

function categoryCounts(
    groups: readonly AnalyzedDocumentChangeGroup[]
): Record<DocumentChangeCategory, number> {
    const counts = emptyCategoryCounts();
    for (const group of groups) counts[group.materiality.category]++;
    return counts;
}

function confidenceCounts(
    groups: readonly AnalyzedDocumentChangeGroup[]
): Record<DeterministicMaterialityConfidence, number> {
    const counts = { strong: 0, moderate: 0, uncertain: 0 };
    for (const group of groups) counts[group.materiality.confidence]++;
    return counts;
}

/** Builds selected condensed evidence plus a complete immutable-audit-ready projection. */
export function materializeDocumentChanges(
    inputs: readonly DocumentChangePairInput[]
): DeterministicMaterialChangeResult {
    const rawChanges: RawDocumentChange[] = [];
    const analyzedGroups: AnalyzedDocumentChangeGroup[] = [];
    const warnings: DocumentChangeProcessingWarning[] = [];
    let deterministicNoOpCount = 0;
    let oversizedGroupSplitCount = 0;
    const orderedInputs = [...inputs].sort(
        (a, b) =>
            compareBigInt(a.pair.documentId, b.pair.documentId) ||
            a.pair.currentCreatedAt.getTime() - b.pair.currentCreatedAt.getTime() ||
            a.pair.currentVersionId - b.pair.currentVersionId
    );
    for (const { pair, alignments } of orderedInputs) {
        const raw = buildRawDocumentChanges(pair, alignments);
        const grouped = groupRawDocumentChanges(pair, raw.rawChanges);
        rawChanges.push(...raw.rawChanges);
        deterministicNoOpCount += raw.deterministicNoOpCount;
        oversizedGroupSplitCount += grouped.oversizedGroupSplitCount;
        warnings.push(...grouped.warnings);
        analyzedGroups.push(
            ...grouped.groups.map(group => ({
                pair,
                group,
                materiality: analyzeDocumentChangeGroup(group),
            }))
        );
    }
    const selection = selectMaterialDocumentChangeGroups(analyzedGroups);
    warnings.push(...selection.warnings);
    const items = selection.selectedGroups.map(({ pair, group, materiality }) =>
        buildCondensedDocumentChangeEvidence(pair, group, materiality)
    );
    const selectedIds = new Set(selection.selectedGroups.map(({ group }) => group.groupId));
    const rawAuditById = new Map<string, RawDocumentChangeSnapshot>();
    for (const analyzed of analyzedGroups) {
        for (const change of analyzed.group.rawChanges) {
            if (!rawAuditById.has(change.rawChangeId))
                rawAuditById.set(change.rawChangeId, rawSnapshot(analyzed.pair, change));
        }
    }
    const audit: DocumentChangeAuditSnapshot = {
        schemaVersion: DOCUMENT_CHANGE_AUDIT_VERSION,
        rawChanges: [...rawAuditById.values()].sort((a, b) =>
            compareOrdinal(a.rawChangeId, b.rawChangeId)
        ),
        groups: [...analyzedGroups].sort(compareFinalOrder).map(({ group, materiality }) => ({
            groupId: group.groupId,
            evidenceSourceId: selectedIds.has(group.groupId)
                ? documentChangeGroupSourceId(group)
                : null,
            documentId: group.documentId.toString(),
            previousVersionId: group.previousVersionId,
            currentVersionId: group.currentVersionId,
            structurePath: group.structurePath ?? null,
            structureTitle: group.structureTitle ?? null,
            splitOrdinal: group.splitOrdinal,
            rawChangeIds: group.rawChanges.map(change => change.rawChangeId),
            category: materiality.category,
            priority: materiality.priority,
            confidence: materiality.confidence,
            signals: [...materiality.signals],
            materialityMethod: "deterministic",
            materialityVersion: DOCUMENT_CHANGE_MATERIALITY_VERSION,
        })),
    };
    const count = (type: RawDocumentChange["changeType"]) =>
        rawChanges.filter(change => change.changeType === type).length;
    const rawExcerptCharacters = audit.rawChanges.reduce(
        (total, change) =>
            total + (change.previousExcerpt?.length ?? 0) + (change.currentExcerpt?.length ?? 0),
        0
    );
    const condensedPromptFacingCharacters = items.reduce(
        (total, item) => total + item.excerpt.length,
        0
    );
    return {
        rawChanges,
        analyzedGroups: [...analyzedGroups].sort(compareFinalOrder),
        selectedGroups: selection.selectedGroups,
        items,
        audit,
        warnings: [...new Map(warnings.map(item => [item.code, item])).values()],
        diagnostics: {
            versionPairCount: inputs.length,
            alignedChunkCount: inputs.reduce((total, input) => total + input.alignments.length, 0),
            rawModifiedCount: count("modified"),
            rawAddedCount: count("added"),
            rawRemovedCount: count("removed"),
            deterministicNoOpCount,
            groupCount: analyzedGroups.length,
            oversizedGroupSplitCount,
            selectedGroupCount: selection.selectedGroups.length,
            truncatedGroupCount: selection.truncatedGroups.length,
            approximateChangedCharacters: rawChanges.reduce(
                (total, change) =>
                    total +
                    (change.previousChunk?.content.length ?? 0) +
                    (change.currentChunk?.content.length ?? 0),
                0
            ),
            groupsByMaterialityCategory: categoryCounts(analyzedGroups),
            groupsByDeterministicConfidence: confidenceCounts(analyzedGroups),
            selectedGroupsByCategory: categoryCounts(selection.selectedGroups),
            truncatedGroupsByCategory: categoryCounts(selection.truncatedGroups),
            rawAuditCount: audit.rawChanges.length,
            condensedEvidenceCount: items.length,
            rawExcerptCharacters,
            condensedPromptFacingCharacters,
            estimatedReductionRatio:
                rawExcerptCharacters === 0
                    ? 1
                    : Number(
                          (
                              rawExcerptCharacters / Math.max(1, condensedPromptFacingCharacters)
                          ).toFixed(3)
                      ),
        },
    };
}
