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

export type EvidenceStatus =
    | "changed"
    | "shipped"
    | "planned";

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

function bound(value: string, max = MAX_EXCERPT) { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function preview(value: string) { return bound(value.replace(/\s+/g, " ").trim(), 900); }

function classifyDocumentChangeStatus(
    alignment: ChunkAlignment,
    changelog: string | null
): EvidenceStatus {
    const text = `${changelog ?? ""} ${
        alignment.currentChunk?.content ?? 
        alignment.previousChunk?.content ?? ""
    }`.toLowerCase();

    if (
        /\b(released|launched|shipped|rolled out|available now)\b/i.test(text)
    ) {
        return "shipped";
    }

    if (
        /\b(planned|upcoming|will|next|roadmap)\b/i.test(text)
    ) {
        return "planned";
    }

    return "changed";
}

export function buildDocumentChangeEvidence(pair: VersionPair, alignments: readonly ChunkAlignment[]): FounderWeeklyReviewEvidenceItem[] {
    return alignments.filter((alignment) => alignment.changeType !== "unchanged").map((alignment) => {
        const previous = alignment.previousChunk; const current = alignment.currentChunk;
        const previousId = previous?.chunkId.toString() ?? "none"; const currentId = current?.chunkId.toString() ?? "none";
        const sourceId = `document_change:doc:${pair.documentId}:v${pair.previousVersionId}:v${pair.currentVersionId}:chunk:${previousId}:${currentId}`;
        const excerpt = alignment.changeType === "modified"
            ? `Section modified. Before: ${preview(previous!.content)} After: ${preview(current!.content)}`
            : alignment.changeType === "added" ? `Section added: ${preview(current!.content)}` : `Section removed: ${preview(previous!.content)}`;
        const status = classifyDocumentChangeStatus(alignment, pair.currentChangelog);
        return { sourceType: "document_change", sourceId, title: pair.documentTitle,
            sourceTimestamp: pair.currentCreatedAt.toISOString(), excerpt: bound(excerpt), workspaceDeepLink: `/employer/documents/viewer?docId=${pair.documentId}`,
            metadata: { evidenceStatus: status, documentId: pair.documentId.toString(), previousVersionId: pair.previousVersionId, currentVersionId: pair.currentVersionId, previousVersionNumber: pair.previousVersionNumber, currentVersionNumber: pair.currentVersionNumber,
                previousChunkId: previous?.chunkId ?? null, currentChunkId: current?.chunkId ?? null, changeType: alignment.changeType, alignmentMethod: alignment.alignmentMethod,
                previousContentHash: previous?.contentHash ?? null, currentContentHash: current?.contentHash ?? null, structurePath: current?.structurePath ?? previous?.structurePath ?? null,
                userChangelog: pair.currentChangelog ? bound(pair.currentChangelog.replace(/\s+/g, " ").trim(), MAX_METADATA_TEXT) : null } };
    });
}
