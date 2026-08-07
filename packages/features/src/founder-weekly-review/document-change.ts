import { createHash } from "node:crypto";
import type { FounderWeeklyReviewEvidenceItem } from "./contracts";

export type DocumentVersionForComparison = {
    documentId: bigint;
    documentTitle: string;
    documentCategory: string | null;
    versionId: number;
    versionNumber: number;
    createdAt: Date;
    changelog: string | null;
};

export type VersionPair = {
    documentId: bigint;
    documentTitle: string;
    documentCategory: string | null;
    previousVersionId: number;
    previousVersionNumber: number;
    previousCreatedAt: Date;
    currentVersionId: number;
    currentVersionNumber: number;
    currentCreatedAt: Date;
    currentChangelog: string | null;
};

export type VersionChunk = {
    chunkId: number;
    content: string;
    contentHash: string | null;
    structureId: bigint | null;
    structurePath: string | null;
    structureTitle: string | null;
    structureOrdering: number | null;
    pageNumber: number | null;
    lineStart: number | null;
    lineEnd: number | null;
    documentId: bigint;
    versionId: bigint;
};

export type ChunkAlignment = {
    changeType: "added" | "removed" | "modified" | "unchanged";
    previousChunk?: VersionChunk;
    currentChunk?: VersionChunk;
    alignmentMethod: "content_hash" | "structure_path" | "section_title" | "structural_position" | "text_similarity" | "unmatched";
    similarityScore?: number;
};

export const RAW_DOCUMENT_CHANGE_VERSION = "raw-document-change/v1" as const;
export const DOCUMENT_CHANGE_GROUPING_VERSION = "document-change-grouping/v1" as const;
export const DOCUMENT_CHANGE_GROUP_BUDGET = Object.freeze({
    rawChangesPerGroup: 16,
    groupsPerVersionPair: 8,
    groupsPerDocument: 8,
    groupsPerReview: 24,
});

export type RawDocumentChange = {
    rawChangeId: string;
    changeType: Exclude<ChunkAlignment["changeType"], "unchanged">;
    alignmentMethod: ChunkAlignment["alignmentMethod"];
    similarityScore?: number;
    previousChunk?: VersionChunk;
    currentChunk?: VersionChunk;
    previousNormalizedContent?: string;
    currentNormalizedContent?: string;
};

export type DocumentChangeGroup = {
    groupId: string;
    documentId: bigint;
    previousVersionId: number;
    currentVersionId: number;
    structurePath?: string | null;
    structureTitle?: string | null;
    splitOrdinal: number;
    rawChanges: readonly RawDocumentChange[];
};

export type DocumentChangeProcessingWarning = {
    code: "materiality_group_too_large" | "document_change_budget_truncated";
    message: string;
};

export type DocumentChangeCondensationDiagnostics = {
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
};

export type DocumentChangePairInput = {
    pair: VersionPair;
    alignments: readonly ChunkAlignment[];
};

export type DocumentChangeCondensationResult = {
    rawChanges: readonly RawDocumentChange[];
    groups: readonly DocumentChangeGroup[];
    selectedGroups: readonly DocumentChangeGroup[];
    warnings: readonly DocumentChangeProcessingWarning[];
    diagnostics: DocumentChangeCondensationDiagnostics;
};

const MAX_EXCERPT = 4000;
const MAX_METADATA_TEXT = 512;
const MIN_TEXT_SIMILARITY_CHARACTERS = 20;
const MIN_TEXT_SIMILARITY_TOKENS = 3;

const compareVersions = (a: DocumentVersionForComparison, b: DocumentVersionForComparison) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.versionNumber - b.versionNumber || a.versionId - b.versionId;
const normalize = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim().toLocaleLowerCase() || null;
const validContentHash = (value: string | null): value is string => value !== null && /^[a-f0-9]{64}$/i.test(value);
const compareChunks = (a: VersionChunk, b: VersionChunk) =>
    (a.structurePath ?? "").localeCompare(b.structurePath ?? "") ||
    (a.pageNumber ?? -1) - (b.pageNumber ?? -1) ||
    (a.lineStart ?? -1) - (b.lineStart ?? -1) ||
    (a.structureOrdering ?? -1) - (b.structureOrdering ?? -1) || a.chunkId - b.chunkId;

function digest(parts: readonly (string | number | null)[]): string {
    return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
}

function compareOrdinal(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareBigInt(a: bigint, b: bigint): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Select only adjacent pairs whose current version is in the reporting period. */
export function selectVersionPairsForReportingPeriod(
    versions: readonly DocumentVersionForComparison[], startInclusive: Date, endExclusive: Date
): VersionPair[] {
    const byDocument = new Map<string, DocumentVersionForComparison[]>();
    for (const version of versions) {
        if (version.createdAt >= endExclusive) continue;
        const key = version.documentId.toString();
        const group = byDocument.get(key) ?? [];
        group.push(version); byDocument.set(key, group);
    }
    const pairs: VersionPair[] = [];
    for (const group of byDocument.values()) {
        const ordered = [...group].sort(compareVersions);
        for (let index = 0; index < ordered.length; index++) {
            const current = ordered[index]!;
            if (current.createdAt < startInclusive) continue;
            const previous = ordered[index - 1];
            if (!previous) continue; // First-ever version is an added baseline, not an invented diff.
            pairs.push({ documentId: current.documentId, documentTitle: current.documentTitle, documentCategory: current.documentCategory,
                previousVersionId: previous.versionId, previousVersionNumber: previous.versionNumber, previousCreatedAt: previous.createdAt,
                currentVersionId: current.versionId, currentVersionNumber: current.versionNumber, currentCreatedAt: current.createdAt,
                currentChangelog: current.changelog });
        }
    }
    return pairs.sort((a, b) => a.currentCreatedAt.getTime() - b.currentCreatedAt.getTime() || a.currentVersionNumber - b.currentVersionNumber || a.currentVersionId - b.currentVersionId);
}

function bestMatch(previous: VersionChunk, candidates: VersionChunk[], used: Set<string>, key: (chunk: VersionChunk) => string | null, requireUnique = false, predicate: (candidate: VersionChunk) => boolean = () => true): VersionChunk | undefined {
    const value = key(previous); if (!value) return undefined;
    const matches = candidates.filter((candidate) => !used.has(candidate.chunkId.toString()) && key(candidate) === value && predicate(candidate)).sort(compareChunks);
    return requireUnique && matches.length !== 1 ? undefined : matches[0];
}

function textSimilarity(left: string, right: string): number {
    const tokens = (value: string) => new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
    const a = tokens(left); const b = tokens(right);
    if (left.trim().length < MIN_TEXT_SIMILARITY_CHARACTERS || right.trim().length < MIN_TEXT_SIMILARITY_CHARACTERS || a.size < MIN_TEXT_SIMILARITY_TOKENS || b.size < MIN_TEXT_SIMILARITY_TOKENS) return 0;
    let intersection = 0; for (const token of a) if (b.has(token)) intersection++;
    return intersection / (a.size + b.size - intersection);
}

function bestTextMatch(previous: VersionChunk, candidates: VersionChunk[], used: Set<string>): { chunk: VersionChunk; score: number } | undefined {
    const ranked = candidates.filter((candidate) => !used.has(candidate.chunkId.toString())).sort(compareChunks).slice(0, 200)
        .map((chunk) => ({ chunk, score: textSimilarity(previous.content, chunk.content) }))
        .filter((candidate) => candidate.score >= 0.35)
        .sort((a, b) => b.score - a.score || compareChunks(a.chunk, b.chunk));
    return ranked[0];
}

/** Deterministic one-to-one alignment without embeddings or model calls. */
export function alignVersionChunks(previousChunks: readonly VersionChunk[], currentChunks: readonly VersionChunk[]): ChunkAlignment[] {
    const previous = [...previousChunks].sort(compareChunks); const current = [...currentChunks].sort(compareChunks);
    const used = new Set<string>(); const results: ChunkAlignment[] = [];
    const strategies: Array<{ method: ChunkAlignment["alignmentMethod"]; key: (chunk: VersionChunk) => string | null; requireUnique?: boolean; predicate?: (previous: VersionChunk, current: VersionChunk) => boolean }> = [
        { method: "content_hash", key: (c) => validContentHash(c.contentHash) ? c.contentHash.toLocaleLowerCase() : null, predicate: (previous, candidate) => previous.content === candidate.content },
        { method: "structure_path", key: (c) => normalize(c.structurePath), requireUnique: true },
        { method: "section_title", key: (c) => normalize(c.structureTitle), requireUnique: true },
        { method: "structural_position", key: (c) => {
            const path = normalize(c.structurePath);
            return path && c.pageNumber !== null && c.structureOrdering !== null ? `${path}|${c.pageNumber}|${c.lineStart ?? ""}|${c.structureOrdering}` : null;
        } },
    ];
    for (const oldChunk of previous) {
        let match: VersionChunk | undefined; let method: ChunkAlignment["alignmentMethod"] = "unmatched";
        for (const strategy of strategies) {
            match = bestMatch(oldChunk, current, used, strategy.key, strategy.requireUnique, (candidate) => strategy.predicate?.(oldChunk, candidate) ?? true);
            if (match) { method = strategy.method; break; }
        }
        if (!match) {
            const textMatch = bestTextMatch(oldChunk, current, used);
            if (textMatch) { match = textMatch.chunk; method = "text_similarity"; }
        }
        if (!match) { results.push({ changeType: "removed", previousChunk: oldChunk, alignmentMethod: "unmatched" }); continue; }
        used.add(match.chunkId.toString());
        const score = method === "text_similarity" ? textSimilarity(oldChunk.content, match.content) : undefined;
        results.push({ changeType: oldChunk.content === match.content ? "unchanged" : "modified", previousChunk: oldChunk, currentChunk: match, alignmentMethod: method, ...(score === undefined ? {} : { similarityScore: score }) });
    }
    for (const chunk of current) if (!used.has(chunk.chunkId.toString())) results.push({ changeType: "added", currentChunk: chunk, alignmentMethod: "unmatched" });
    return results.sort((a, b) => compareChunks(a.currentChunk ?? a.previousChunk!, b.currentChunk ?? b.previousChunk!));
}

/** Conservative normalization used only to remove deterministic formatting no-ops. */
export function normalizeDocumentChangeContent(value: string): string {
    return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function rawChangeContentIdentity(chunk: VersionChunk | undefined): string | null {
    return chunk ? digest([chunk.contentHash, chunk.content]) : null;
}

function compareRawChanges(a: RawDocumentChange, b: RawDocumentChange): number {
    const aChunk = a.currentChunk ?? a.previousChunk!;
    const bChunk = b.currentChunk ?? b.previousChunk!;
    return (aChunk.structureOrdering ?? Number.MAX_SAFE_INTEGER) - (bChunk.structureOrdering ?? Number.MAX_SAFE_INTEGER)
        || (aChunk.pageNumber ?? Number.MAX_SAFE_INTEGER) - (bChunk.pageNumber ?? Number.MAX_SAFE_INTEGER)
        || (aChunk.lineStart ?? Number.MAX_SAFE_INTEGER) - (bChunk.lineStart ?? Number.MAX_SAFE_INTEGER)
        || compareOrdinal(aChunk.structurePath ?? "", bChunk.structurePath ?? "")
        || (a.previousChunk?.chunkId ?? -1) - (b.previousChunk?.chunkId ?? -1)
        || (a.currentChunk?.chunkId ?? -1) - (b.currentChunk?.chunkId ?? -1)
        || compareOrdinal(a.rawChangeId, b.rawChangeId);
}

/** Converts alignments into stable raw records and drops normalized-equal modifications. */
export function buildRawDocumentChanges(
    pair: VersionPair,
    alignments: readonly ChunkAlignment[]
): { rawChanges: RawDocumentChange[]; deterministicNoOpCount: number } {
    const rawChanges: RawDocumentChange[] = [];
    let deterministicNoOpCount = 0;
    for (const alignment of alignments) {
        if (alignment.changeType === "unchanged") continue;
        const previousNormalizedContent = alignment.previousChunk
            ? normalizeDocumentChangeContent(alignment.previousChunk.content)
            : undefined;
        const currentNormalizedContent = alignment.currentChunk
            ? normalizeDocumentChangeContent(alignment.currentChunk.content)
            : undefined;
        if (
            alignment.changeType === "modified"
            && previousNormalizedContent === currentNormalizedContent
        ) {
            deterministicNoOpCount++;
            continue;
        }
        const rawChangeId = `raw_document_change:${digest([
            RAW_DOCUMENT_CHANGE_VERSION,
            pair.documentId.toString(),
            pair.previousVersionId,
            pair.currentVersionId,
            alignment.changeType,
            alignment.previousChunk?.chunkId ?? null,
            alignment.currentChunk?.chunkId ?? null,
            alignment.alignmentMethod,
            rawChangeContentIdentity(alignment.previousChunk),
            rawChangeContentIdentity(alignment.currentChunk),
        ])}`;
        rawChanges.push({
            rawChangeId,
            changeType: alignment.changeType,
            alignmentMethod: alignment.alignmentMethod,
            ...(alignment.similarityScore === undefined ? {} : { similarityScore: alignment.similarityScore }),
            ...(alignment.previousChunk ? { previousChunk: alignment.previousChunk, previousNormalizedContent } : {}),
            ...(alignment.currentChunk ? { currentChunk: alignment.currentChunk, currentNormalizedContent } : {}),
        });
    }
    return { rawChanges: rawChanges.sort(compareRawChanges), deterministicNoOpCount };
}

function normalizedSectionValues(change: RawDocumentChange, field: "structurePath" | "structureTitle"): string[] {
    return [...new Set([change.previousChunk?.[field], change.currentChunk?.[field]].map(normalize).filter((value): value is string => value !== null))].sort(compareOrdinal);
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
    return left.some(value => right.includes(value));
}

function hasKnownSection(change: RawDocumentChange): boolean {
    return normalizedSectionValues(change, "structurePath").length > 0
        || normalizedSectionValues(change, "structureTitle").length > 0;
}

function structurallyProximate(left: RawDocumentChange, right: RawDocumentChange): boolean {
    const a = left.currentChunk ?? left.previousChunk!;
    const b = right.currentChunk ?? right.previousChunk!;
    if (a.structureOrdering !== null && b.structureOrdering !== null && Math.abs(a.structureOrdering - b.structureOrdering) <= 1) {
        return true;
    }
    if (a.pageNumber !== null && b.pageNumber !== null && Math.abs(a.pageNumber - b.pageNumber) <= 1) {
        if (a.pageNumber !== b.pageNumber) return true;
        if (a.lineEnd !== null && b.lineStart !== null && b.lineStart - a.lineEnd <= 2) return true;
        if (b.lineEnd !== null && a.lineStart !== null && a.lineStart - b.lineEnd <= 2) return true;
    }
    return false;
}

function shouldGroup(left: RawDocumentChange, right: RawDocumentChange): boolean {
    const leftPaths = normalizedSectionValues(left, "structurePath");
    const rightPaths = normalizedSectionValues(right, "structurePath");
    if (intersects(leftPaths, rightPaths)) return true;
    if (leftPaths.length > 0 && rightPaths.length > 0) return false;
    const leftTitles = normalizedSectionValues(left, "structureTitle");
    const rightTitles = normalizedSectionValues(right, "structureTitle");
    if (intersects(leftTitles, rightTitles)) return true;
    // Proximity is only a fallback when neither record has a known section. This
    // prevents an unlabelled record from transitively bridging two named sections.
    if (hasKnownSection(left) || hasKnownSection(right)) return false;
    return structurallyProximate(left, right);
}

function canonicalSectionKey(changes: readonly RawDocumentChange[]): string {
    const paths = [...new Set(changes.flatMap(change => normalizedSectionValues(change, "structurePath")))].sort(compareOrdinal);
    const titles = [...new Set(changes.flatMap(change => normalizedSectionValues(change, "structureTitle")))].sort(compareOrdinal);
    if (paths.length > 0) return `path:${paths.join("|")}`;
    if (titles.length > 0) return `title:${titles.join("|")}`;
    const first = changes[0]!.currentChunk ?? changes[0]!.previousChunk!;
    return `position:${first.structureOrdering ?? ""}:${first.pageNumber ?? ""}:${first.lineStart ?? ""}`;
}

function preferredStructureValue(changes: readonly RawDocumentChange[], field: "structurePath" | "structureTitle"): string | null {
    const values = changes.flatMap(change => [change.currentChunk?.[field], change.previousChunk?.[field]])
        .filter((value): value is string => Boolean(value?.trim()));
    return values.sort(compareOrdinal)[0] ?? null;
}

function makeGroup(
    pair: VersionPair,
    naturalGroup: readonly RawDocumentChange[],
    rawChanges: readonly RawDocumentChange[],
    splitOrdinal: number
): DocumentChangeGroup {
    const sectionKey = canonicalSectionKey(naturalGroup);
    return {
        groupId: `document_change_group:${digest([
            DOCUMENT_CHANGE_GROUPING_VERSION,
            pair.documentId.toString(),
            pair.previousVersionId,
            pair.currentVersionId,
            sectionKey,
            ...rawChanges.map(change => change.rawChangeId),
            splitOrdinal,
        ])}`,
        documentId: pair.documentId,
        previousVersionId: pair.previousVersionId,
        currentVersionId: pair.currentVersionId,
        structurePath: preferredStructureValue(naturalGroup, "structurePath"),
        structureTitle: preferredStructureValue(naturalGroup, "structureTitle"),
        splitOrdinal,
        rawChanges,
    };
}

function compareGroups(a: DocumentChangeGroup, b: DocumentChangeGroup): number {
    const aFirst = a.rawChanges[0]!;
    const bFirst = b.rawChanges[0]!;
    return compareBigInt(a.documentId, b.documentId)
        || a.currentVersionId - b.currentVersionId
        || a.previousVersionId - b.previousVersionId
        || compareRawChanges(aFirst, bFirst)
        || a.splitOrdinal - b.splitOrdinal
        || compareOrdinal(a.groupId, b.groupId);
}

/** Groups changed records within one immutable document version pair. */
export function groupRawDocumentChanges(
    pair: VersionPair,
    input: readonly RawDocumentChange[]
): { groups: DocumentChangeGroup[]; oversizedGroupSplitCount: number; warnings: DocumentChangeProcessingWarning[] } {
    const rawChanges = [...input].sort(compareRawChanges);
    const parents = rawChanges.map((_, index) => index);
    const find = (index: number): number => {
        while (parents[index] !== index) {
            parents[index] = parents[parents[index]!]!;
            index = parents[index]!;
        }
        return index;
    };
    const union = (left: number, right: number) => {
        const a = find(left); const b = find(right);
        if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
    };
    for (let left = 0; left < rawChanges.length; left++) {
        for (let right = left + 1; right < rawChanges.length; right++) {
            if (shouldGroup(rawChanges[left]!, rawChanges[right]!)) union(left, right);
        }
    }
    const components = new Map<number, RawDocumentChange[]>();
    rawChanges.forEach((change, index) => {
        const root = find(index);
        const component = components.get(root) ?? [];
        component.push(change); components.set(root, component);
    });
    const naturalGroups = [...components.values()].map(group => group.sort(compareRawChanges))
        .sort((a, b) => compareRawChanges(a[0]!, b[0]!));
    const groups: DocumentChangeGroup[] = [];
    let oversizedGroupSplitCount = 0;
    for (const naturalGroup of naturalGroups) {
        const windowCount = Math.ceil(naturalGroup.length / DOCUMENT_CHANGE_GROUP_BUDGET.rawChangesPerGroup);
        if (windowCount > 1) oversizedGroupSplitCount += windowCount - 1;
        for (let splitOrdinal = 0; splitOrdinal < windowCount; splitOrdinal++) {
            const start = splitOrdinal * DOCUMENT_CHANGE_GROUP_BUDGET.rawChangesPerGroup;
            const window = naturalGroup.slice(start, start + DOCUMENT_CHANGE_GROUP_BUDGET.rawChangesPerGroup);
            groups.push(makeGroup(pair, naturalGroup, window, splitOrdinal));
        }
    }
    return {
        groups: groups.sort(compareGroups),
        oversizedGroupSplitCount,
        warnings: oversizedGroupSplitCount > 0 ? [{
            code: "materiality_group_too_large",
            message: "One or more document-change groups exceeded the raw-change limit and were split into deterministic windows.",
        }] : [],
    };
}

function pairKey(group: Pick<DocumentChangeGroup, "previousVersionId" | "currentVersionId">): string {
    return `${group.previousVersionId}:${group.currentVersionId}`;
}

function sectionSelectionKey(group: DocumentChangeGroup): string {
    return `${group.structurePath ?? ""}|${group.structureTitle ?? ""}`;
}

/** Neutral structural budget: documents, then version pairs, then distinct sections. */
export function selectDocumentChangeGroups(input: readonly DocumentChangeGroup[]): {
    selectedGroups: DocumentChangeGroup[];
    truncatedGroupCount: number;
    warnings: DocumentChangeProcessingWarning[];
} {
    const ordered = [...input].sort(compareGroups);
    const byDocument = new Map<string, Map<string, DocumentChangeGroup[]>>();
    for (const group of ordered) {
        const documentKey = group.documentId.toString();
        const pairs = byDocument.get(documentKey) ?? new Map<string, DocumentChangeGroup[]>();
        const key = pairKey(group);
        const pairGroups = pairs.get(key) ?? [];
        pairGroups.push(group); pairs.set(key, pairGroups); byDocument.set(documentKey, pairs);
    }
    for (const pairs of byDocument.values()) {
        for (const [key, groups] of pairs) {
            pairs.set(key, groups.sort((a, b) =>
                a.splitOrdinal - b.splitOrdinal
                || compareOrdinal(sectionSelectionKey(a), sectionSelectionKey(b))
                || compareGroups(a, b)));
        }
    }
    const documents = [...byDocument.entries()].sort(([a], [b]) => compareBigInt(BigInt(a), BigInt(b)));
    const documentCounts = new Map<string, number>();
    const pairCounts = new Map<string, number>();
    const pairCursors = new Map<string, number>();
    const selectedGroups: DocumentChangeGroup[] = [];
    let madeProgress = true;
    while (selectedGroups.length < DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerReview && madeProgress) {
        madeProgress = false;
        for (const [documentId, pairs] of documents) {
            if ((documentCounts.get(documentId) ?? 0) >= DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerDocument) continue;
            const pairEntries = [...pairs.entries()].sort(([, a], [, b]) => compareGroups(a[0]!, b[0]!));
            const start = pairCursors.get(documentId) ?? 0;
            for (let offset = 0; offset < pairEntries.length; offset++) {
                const pairIndex = (start + offset) % pairEntries.length;
                const [key, groups] = pairEntries[pairIndex]!;
                const countKey = `${documentId}:${key}`;
                const count = pairCounts.get(countKey) ?? 0;
                if (count >= DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerVersionPair || !groups[count]) continue;
                selectedGroups.push(groups[count]!);
                documentCounts.set(documentId, (documentCounts.get(documentId) ?? 0) + 1);
                pairCounts.set(countKey, count + 1);
                pairCursors.set(documentId, (pairIndex + 1) % pairEntries.length);
                madeProgress = true;
                break;
            }
            if (selectedGroups.length >= DOCUMENT_CHANGE_GROUP_BUDGET.groupsPerReview) break;
        }
    }
    const truncatedGroupCount = ordered.length - selectedGroups.length;
    return {
        selectedGroups: selectedGroups.sort(compareGroups),
        truncatedGroupCount,
        warnings: truncatedGroupCount > 0 ? [{
            code: "document_change_budget_truncated",
            message: "Document-change groups were truncated to deterministic structural limits.",
        }] : [],
    };
}

/** Complete pure condensation boundary used before current evidence compatibility projection. */
export function condenseDocumentChanges(inputs: readonly DocumentChangePairInput[]): DocumentChangeCondensationResult {
    const rawChanges: RawDocumentChange[] = [];
    const groups: DocumentChangeGroup[] = [];
    const warnings: DocumentChangeProcessingWarning[] = [];
    let deterministicNoOpCount = 0;
    let oversizedGroupSplitCount = 0;
    for (const { pair, alignments } of [...inputs].sort((a, b) =>
        compareBigInt(a.pair.documentId, b.pair.documentId)
        || a.pair.currentCreatedAt.getTime() - b.pair.currentCreatedAt.getTime()
        || a.pair.currentVersionId - b.pair.currentVersionId)) {
        const raw = buildRawDocumentChanges(pair, alignments);
        const grouped = groupRawDocumentChanges(pair, raw.rawChanges);
        rawChanges.push(...raw.rawChanges);
        groups.push(...grouped.groups);
        deterministicNoOpCount += raw.deterministicNoOpCount;
        oversizedGroupSplitCount += grouped.oversizedGroupSplitCount;
        warnings.push(...grouped.warnings);
    }
    const selected = selectDocumentChangeGroups(groups);
    warnings.push(...selected.warnings);
    const counts = (type: RawDocumentChange["changeType"]) => rawChanges.filter(change => change.changeType === type).length;
    return {
        rawChanges: rawChanges.sort(compareRawChanges),
        groups: groups.sort(compareGroups),
        selectedGroups: selected.selectedGroups,
        warnings: [...new Map(warnings.map(item => [item.code, item])).values()],
        diagnostics: {
            versionPairCount: inputs.length,
            alignedChunkCount: inputs.reduce((total, input) => total + input.alignments.length, 0),
            rawModifiedCount: counts("modified"),
            rawAddedCount: counts("added"),
            rawRemovedCount: counts("removed"),
            deterministicNoOpCount,
            groupCount: groups.length,
            oversizedGroupSplitCount,
            selectedGroupCount: selected.selectedGroups.length,
            truncatedGroupCount: selected.truncatedGroupCount,
            approximateChangedCharacters: rawChanges.reduce((total, change) =>
                total + (change.previousChunk?.content.length ?? 0) + (change.currentChunk?.content.length ?? 0), 0),
        },
    };
}

function bound(value: string, max = MAX_EXCERPT) { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function preview(value: string) { return bound(value.replace(/\s+/g, " ").trim(), 900); }

function buildRawChangeEvidence(pair: VersionPair, alignment: RawDocumentChange): FounderWeeklyReviewEvidenceItem {
    const previous = alignment.previousChunk; const current = alignment.currentChunk;
    const previousId = previous?.chunkId.toString() ?? "none"; const currentId = current?.chunkId.toString() ?? "none";
    const sourceId = `document_change:doc:${pair.documentId}:v${pair.previousVersionId}:v${pair.currentVersionId}:chunk:${previousId}:${currentId}`;
    const excerpt = alignment.changeType === "modified"
        ? `Section modified. Before: ${preview(previous!.content)} After: ${preview(current!.content)}`
        : alignment.changeType === "added" ? `Section added: ${preview(current!.content)}` : `Section removed: ${preview(previous!.content)}`;
    return { sourceType: "document_change", sourceId, title: pair.documentTitle,
        sourceTimestamp: pair.currentCreatedAt.toISOString(), excerpt: bound(excerpt), workspaceDeepLink: `/employer/documents/viewer?docId=${pair.documentId}`,
        metadata: { documentId: pair.documentId.toString(), previousVersionId: pair.previousVersionId, currentVersionId: pair.currentVersionId, previousVersionNumber: pair.previousVersionNumber, currentVersionNumber: pair.currentVersionNumber,
            previousChunkId: previous?.chunkId ?? null, currentChunkId: current?.chunkId ?? null, changeType: alignment.changeType, alignmentMethod: alignment.alignmentMethod,
            previousContentHash: previous?.contentHash ?? null, currentContentHash: current?.contentHash ?? null, structurePath: current?.structurePath ?? previous?.structurePath ?? null,
            userChangelog: pair.currentChangelog ? bound(pair.currentChangelog.replace(/\s+/g, " ").trim(), MAX_METADATA_TEXT) : null } };
}

/** Compatibility projection: one existing-format evidence item per selected structural group. */
export function buildDocumentChangeGroupEvidence(pair: VersionPair, group: DocumentChangeGroup): FounderWeeklyReviewEvidenceItem {
    return buildRawChangeEvidence(pair, group.rawChanges[0]!);
}

export function buildDocumentChangeEvidence(pair: VersionPair, alignments: readonly ChunkAlignment[]): FounderWeeklyReviewEvidenceItem[] {
    const condensed = condenseDocumentChanges([{ pair, alignments }]);
    return condensed.selectedGroups.map(group => buildDocumentChangeGroupEvidence(pair, group));
}
