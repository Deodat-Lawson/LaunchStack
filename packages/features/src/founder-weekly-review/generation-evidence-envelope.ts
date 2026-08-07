import type {
    FounderWeeklyReviewEvidenceItem,
    FounderWeeklyReviewEvidenceSnapshot,
} from "./contracts";

export const FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION =
    "founder-weekly-review-evidence-envelope/v1" as const;

export const FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET = Object.freeze({
    totalSerializedCharacters: 72_000,
    founderContextReservedCharacters: 4_000,
    workspaceDocumentReservedCharacters: 24_000,
    customerFeedbackReservedCharacters: 24_000,
    documentChangeSerializedCharacters: 14_000,
    documentChangeItems: 24,
    documentChangeItemsPerDocument: 8,
    estimatedCharactersPerToken: 4,
});

const SOURCE_TYPES = [
    "workspace_document",
    "document_change",
    "customer_feedback",
    "github_activity",
    "manual_note",
    "founder_context",
    "other",
] as const satisfies readonly FounderWeeklyReviewEvidenceItem["sourceType"][];

type SourceType = FounderWeeklyReviewEvidenceItem["sourceType"];
type MetadataValue = FounderWeeklyReviewEvidenceItem["metadata"][string];

export type FounderWeeklyReviewPromptEvidenceItem = Pick<
    FounderWeeklyReviewEvidenceItem,
    "sourceId" | "sourceType" | "title" | "excerpt"
> & {
    sourceTimestamp: string | null;
    metadata: Record<string, MetadataValue>;
};

export type GenerationEvidenceEnvelopeDiagnostics = {
    originalItemCount: number;
    selectedItemCount: number;
    excludedItemCount: number;
    selectedBySourceType: Record<SourceType, number>;
    excludedBySourceType: Record<SourceType, number>;
    serializedCharacterCount: number;
    estimatedTokenCount: number;
    truncated: boolean;
};

export type GenerationEvidenceEnvelope = {
    version: typeof FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION;
    items: FounderWeeklyReviewPromptEvidenceItem[];
    diagnostics: GenerationEvidenceEnvelopeDiagnostics;
};

export class FounderWeeklyReviewGenerationEvidenceBudgetError extends Error {
    readonly code = "generation_evidence_budget_exceeded";

    constructor(
        message = "Founder Weekly Review generation evidence exceeded its deterministic context budget."
    ) {
        super(message);
        this.name = "FounderWeeklyReviewGenerationEvidenceBudgetError";
    }
}

const PROMPT_METADATA_ALLOWLIST: Record<SourceType, readonly string[]> = {
    document_change: [
        "changeType",
        "previousVersionNumber",
        "currentVersionNumber",
        "structurePath",
        "alignmentMethod",
        "userChangelog",
    ],
    customer_feedback: ["versionNumber", "documentCategory", "pageNumber"],
    workspace_document: ["retrievalReason", "similarityScore"],
    founder_context: ["provenance"],
    github_activity: [],
    manual_note: [],
    other: [],
};

function compareOrdinal(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
function metadataText(item: FounderWeeklyReviewEvidenceItem, key: string): string {
    const value = item.metadata[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function similarityScore(item: FounderWeeklyReviewEvidenceItem): number {
    const value = item.metadata.similarityScore;
    return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/** Stable source-specific ordering that does not depend on snapshot input order. */
function compareEvidenceItems(
    a: FounderWeeklyReviewEvidenceItem,
    b: FounderWeeklyReviewEvidenceItem
): number {
    const timestamp = compareOrdinal(a.sourceTimestamp ?? "", b.sourceTimestamp ?? "");
    if (timestamp !== 0) return timestamp;
    const sourceType = compareOrdinal(a.sourceType, b.sourceType);
    if (sourceType !== 0) return sourceType;
    if (a.sourceType === "workspace_document" && b.sourceType === "workspace_document") {
        const similarity = similarityScore(b) - similarityScore(a);
        if (Number.isFinite(similarity) && similarity !== 0) return similarity;
    }
    if (a.sourceType === "document_change" && b.sourceType === "document_change") {
        for (const key of [
            "documentId",
            "previousVersionId",
            "currentVersionId",
            "structurePath",
        ] as const) {
            const compared = compareOrdinal(metadataText(a, key), metadataText(b, key));
            if (compared !== 0) return compared;
        }
    }
    return compareOrdinal(a.sourceId, b.sourceId);
}

function allowlistedMetadata(item: FounderWeeklyReviewEvidenceItem): Record<string, MetadataValue> {
    const metadata: Record<string, MetadataValue> = {};
    for (const key of PROMPT_METADATA_ALLOWLIST[item.sourceType]) {
        const value = item.metadata[key];
        if (value !== undefined) metadata[key] = value;
    }
    return metadata;
}

export function buildFounderWeeklyReviewPromptEvidenceItem(
    item: FounderWeeklyReviewEvidenceItem
): FounderWeeklyReviewPromptEvidenceItem {
    return {
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        title: item.title,
        sourceTimestamp: item.sourceTimestamp ?? null,
        excerpt: item.excerpt,
        metadata: allowlistedMetadata(item),
    };
}

function serializedItemsLength(items: readonly FounderWeeklyReviewPromptEvidenceItem[]): number {
    return JSON.stringify(items).length;
}
function canAppendWithin(
    selected: readonly FounderWeeklyReviewPromptEvidenceItem[],
    candidate: FounderWeeklyReviewPromptEvidenceItem,
    limit: number
): boolean {
    return serializedItemsLength([...selected, candidate]) <= limit;
}
function sourceCounts(items: readonly { sourceType: SourceType }[]): Record<SourceType, number> {
    const counts = Object.fromEntries(SOURCE_TYPES.map(sourceType => [sourceType, 0])) as Record<
        SourceType,
        number
    >;
    for (const item of items) counts[item.sourceType]++;
    return counts;
}
function subtractCounts(
    total: Record<SourceType, number>,
    selected: Record<SourceType, number>
): Record<SourceType, number> {
    return Object.fromEntries(
        SOURCE_TYPES.map(sourceType => [sourceType, total[sourceType] - selected[sourceType]])
    ) as Record<SourceType, number>;
}

function dedupeAndOrder(
    items: readonly FounderWeeklyReviewEvidenceItem[]
): FounderWeeklyReviewEvidenceItem[] {
    const ordered = [...items].sort(
        (a, b) =>
            compareEvidenceItems(a, b) ||
            compareOrdinal(
                JSON.stringify(buildFounderWeeklyReviewPromptEvidenceItem(a)),
                JSON.stringify(buildFounderWeeklyReviewPromptEvidenceItem(b))
            )
    );
    const bySourceId = new Map<string, FounderWeeklyReviewEvidenceItem>();
    for (const item of ordered)
        if (!bySourceId.has(item.sourceId)) bySourceId.set(item.sourceId, item);
    return [...bySourceId.values()];
}

function selectReserved(
    candidates: readonly FounderWeeklyReviewEvidenceItem[],
    limit: number
): { selected: FounderWeeklyReviewEvidenceItem[]; excluded: FounderWeeklyReviewEvidenceItem[] } {
    const selected: FounderWeeklyReviewEvidenceItem[] = [];
    const projected: FounderWeeklyReviewPromptEvidenceItem[] = [];
    const excluded: FounderWeeklyReviewEvidenceItem[] = [];
    for (const item of candidates) {
        const promptItem = buildFounderWeeklyReviewPromptEvidenceItem(item);
        if (canAppendWithin(projected, promptItem, limit)) {
            selected.push(item);
            projected.push(promptItem);
        } else excluded.push(item);
    }
    return { selected, excluded };
}

function documentKey(item: FounderWeeklyReviewEvidenceItem): string {
    return (
        metadataText(item, "documentId") ||
        /^document_change:doc:([^:]+)/.exec(item.sourceId)?.[1] ||
        item.sourceId
    );
}

function selectDocumentChanges(
    candidates: readonly FounderWeeklyReviewEvidenceItem[]
): FounderWeeklyReviewEvidenceItem[] {
    const byDocument = new Map<string, FounderWeeklyReviewEvidenceItem[]>();
    for (const item of candidates) {
        const key = documentKey(item);
        const group = byDocument.get(key) ?? [];
        group.push(item);
        byDocument.set(key, group);
    }
    const documents = [...byDocument.entries()].sort(([a], [b]) => compareOrdinal(a, b));
    const selected: FounderWeeklyReviewEvidenceItem[] = [];
    const projected: FounderWeeklyReviewPromptEvidenceItem[] = [];
    for (
        let round = 0;
        round < FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeItemsPerDocument;
        round++
    ) {
        for (const [, items] of documents) {
            if (
                selected.length >=
                FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeItems
            )
                return selected;
            const item = items[round];
            if (!item) continue;
            const promptItem = buildFounderWeeklyReviewPromptEvidenceItem(item);
            if (
                !canAppendWithin(
                    projected,
                    promptItem,
                    FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeSerializedCharacters
                )
            )
                continue;
            selected.push(item);
            projected.push(promptItem);
        }
    }
    return selected;
}

/** Builds a bounded prompt projection without mutating the immutable snapshot. */
export function buildGenerationEvidenceEnvelope(
    snapshot: FounderWeeklyReviewEvidenceSnapshot
): GenerationEvidenceEnvelope {
    const ordered = dedupeAndOrder(snapshot.items);
    const founder = ordered.filter(item => item.sourceType === "founder_context");
    const workspace = ordered.filter(item => item.sourceType === "workspace_document");
    const feedback = ordered.filter(item => item.sourceType === "customer_feedback");
    const documentChanges = ordered.filter(item => item.sourceType === "document_change");
    const selectedOriginal: FounderWeeklyReviewEvidenceItem[] = founder.slice(0, 1);
    const reservedWorkspace = selectReserved(
        workspace,
        FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.workspaceDocumentReservedCharacters
    );
    const reservedFeedback = selectReserved(
        feedback,
        FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.customerFeedbackReservedCharacters
    );
    selectedOriginal.push(
        ...reservedWorkspace.selected,
        ...reservedFeedback.selected,
        ...selectDocumentChanges(documentChanges)
    );
    const selectedIds = new Set(selectedOriginal.map(item => item.sourceId));
    const sharedCandidates = ordered.filter(
        item =>
            item.sourceType !== "document_change" &&
            item.sourceType !== "founder_context" &&
            !selectedIds.has(item.sourceId)
    );
    for (const item of sharedCandidates) {
        const candidateItems = [...selectedOriginal, item]
            .sort(compareEvidenceItems)
            .map(buildFounderWeeklyReviewPromptEvidenceItem);
        if (
            serializedItemsLength(candidateItems) >
            FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.totalSerializedCharacters
        )
            continue;
        selectedOriginal.push(item);
        selectedIds.add(item.sourceId);
    }
    const items = selectedOriginal
        .sort(compareEvidenceItems)
        .map(buildFounderWeeklyReviewPromptEvidenceItem);
    const serializedCharacterCount = serializedItemsLength(items);
    const selectedBySourceType = sourceCounts(items);
    const diagnostics: GenerationEvidenceEnvelopeDiagnostics = {
        originalItemCount: snapshot.items.length,
        selectedItemCount: items.length,
        excludedItemCount: snapshot.items.length - items.length,
        selectedBySourceType,
        excludedBySourceType: subtractCounts(sourceCounts(snapshot.items), selectedBySourceType),
        serializedCharacterCount,
        estimatedTokenCount: Math.ceil(
            serializedCharacterCount /
                FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.estimatedCharactersPerToken
        ),
        truncated: items.length !== snapshot.items.length,
    };
    const envelope: GenerationEvidenceEnvelope = {
        version: FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION,
        items,
        diagnostics,
    };
    assertGenerationEvidenceEnvelopeWithinBudget(envelope);
    return envelope;
}

/** Local invariant check used immediately before prompt serialization/provider invocation. */
export function assertGenerationEvidenceEnvelopeWithinBudget(
    envelope: GenerationEvidenceEnvelope
): void {
    const actualCharacters = serializedItemsLength(envelope.items);
    const documentChanges = envelope.items.filter(item => item.sourceType === "document_change");
    const founderContexts = envelope.items.filter(item => item.sourceType === "founder_context");
    const perDocument = new Map<string, number>();
    for (const item of documentChanges) {
        const key =
            typeof item.metadata.documentId === "string" ||
            typeof item.metadata.documentId === "number"
                ? String(item.metadata.documentId)
                : (/^document_change:doc:([^:]+)/.exec(item.sourceId)?.[1] ?? item.sourceId);
        perDocument.set(key, (perDocument.get(key) ?? 0) + 1);
    }
    const invalid =
        envelope.version !== FOUNDER_WEEKLY_REVIEW_EVIDENCE_ENVELOPE_VERSION ||
        actualCharacters !== envelope.diagnostics.serializedCharacterCount ||
        actualCharacters >
            FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.totalSerializedCharacters ||
        founderContexts.length > 1 ||
        founderContexts.some(
            item =>
                item.excerpt.length >
                FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.founderContextReservedCharacters
        ) ||
        documentChanges.length >
            FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeItems ||
        serializedItemsLength(documentChanges) >
            FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeSerializedCharacters ||
        [...perDocument.values()].some(
            count =>
                count >
                FOUNDER_WEEKLY_REVIEW_GENERATION_EVIDENCE_BUDGET.documentChangeItemsPerDocument
        );
    if (invalid) throw new FounderWeeklyReviewGenerationEvidenceBudgetError();
}
