const MAX_EXCERPT = 4000;
const MAX_METADATA_TEXT = 512;
const MIN_TEXT_SIMILARITY_CHARACTERS = 20;
const MIN_TEXT_SIMILARITY_TOKENS = 3;
const compareVersions = (a, b) => a.createdAt.getTime() - b.createdAt.getTime() ||
    a.versionNumber - b.versionNumber ||
    a.versionId - b.versionId;
// Empty-after-trim collapses to null as well, so this cannot be `??`.
const normalize = (value) => {
    const collapsed = value?.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    return collapsed === undefined || collapsed === "" ? null : collapsed;
};
const validContentHash = (value) => value !== null && /^[a-f0-9]{64}$/i.test(value);
const compareChunks = (a, b) => (a.structurePath ?? "").localeCompare(b.structurePath ?? "") ||
    (a.pageNumber ?? -1) - (b.pageNumber ?? -1) ||
    (a.lineStart ?? -1) - (b.lineStart ?? -1) ||
    (a.structureOrdering ?? -1) - (b.structureOrdering ?? -1) ||
    a.chunkId - b.chunkId;
/** Select only adjacent pairs whose current version is in the reporting period. */
export function selectVersionPairsForReportingPeriod(versions, startInclusive, endExclusive) {
    const byDocument = new Map();
    for (const version of versions) {
        if (version.createdAt >= endExclusive)
            continue;
        const key = version.documentId.toString();
        const group = byDocument.get(key) ?? [];
        group.push(version);
        byDocument.set(key, group);
    }
    const pairs = [];
    for (const group of byDocument.values()) {
        const ordered = [...group].sort(compareVersions);
        for (let index = 0; index < ordered.length; index++) {
            const current = ordered[index];
            if (current.createdAt < startInclusive)
                continue;
            const previous = ordered[index - 1];
            if (!previous)
                continue; // First-ever version is an added baseline, not an invented diff.
            pairs.push({
                documentId: current.documentId,
                documentTitle: current.documentTitle,
                documentCategory: current.documentCategory,
                previousVersionId: previous.versionId,
                previousVersionNumber: previous.versionNumber,
                previousCreatedAt: previous.createdAt,
                currentVersionId: current.versionId,
                currentVersionNumber: current.versionNumber,
                currentCreatedAt: current.createdAt,
                currentChangelog: current.changelog,
            });
        }
    }
    return pairs.sort((a, b) => a.currentCreatedAt.getTime() - b.currentCreatedAt.getTime() ||
        a.currentVersionNumber - b.currentVersionNumber ||
        a.currentVersionId - b.currentVersionId);
}
function bestMatch(previous, candidates, used, key, requireUnique = false, predicate = () => true) {
    const value = key(previous);
    if (!value)
        return undefined;
    const matches = candidates
        .filter(candidate => !used.has(candidate.chunkId.toString()) &&
        key(candidate) === value &&
        predicate(candidate))
        .sort(compareChunks);
    return requireUnique && matches.length !== 1 ? undefined : matches[0];
}
function textSimilarity(left, right) {
    const tokens = (value) => new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
    const a = tokens(left);
    const b = tokens(right);
    if (left.trim().length < MIN_TEXT_SIMILARITY_CHARACTERS ||
        right.trim().length < MIN_TEXT_SIMILARITY_CHARACTERS ||
        a.size < MIN_TEXT_SIMILARITY_TOKENS ||
        b.size < MIN_TEXT_SIMILARITY_TOKENS)
        return 0;
    let intersection = 0;
    for (const token of a)
        if (b.has(token))
            intersection++;
    return intersection / (a.size + b.size - intersection);
}
function bestTextMatch(previous, candidates, used) {
    const ranked = candidates
        .filter(candidate => !used.has(candidate.chunkId.toString()))
        .sort(compareChunks)
        .slice(0, 200)
        .map(chunk => ({ chunk, score: textSimilarity(previous.content, chunk.content) }))
        .filter(candidate => candidate.score >= 0.35)
        .sort((a, b) => b.score - a.score || compareChunks(a.chunk, b.chunk));
    return ranked[0];
}
/** Deterministic one-to-one alignment without embeddings or model calls. */
export function alignVersionChunks(previousChunks, currentChunks) {
    const previous = [...previousChunks].sort(compareChunks);
    const current = [...currentChunks].sort(compareChunks);
    const used = new Set();
    const results = [];
    const strategies = [
        {
            method: "content_hash",
            key: c => (validContentHash(c.contentHash) ? c.contentHash.toLocaleLowerCase() : null),
            predicate: (previous, candidate) => previous.content === candidate.content,
        },
        { method: "structure_path", key: c => normalize(c.structurePath), requireUnique: true },
        { method: "section_title", key: c => normalize(c.structureTitle), requireUnique: true },
        {
            method: "structural_position",
            key: c => {
                const path = normalize(c.structurePath);
                return path && c.pageNumber !== null && c.structureOrdering !== null
                    ? `${path}|${c.pageNumber}|${c.lineStart ?? ""}|${c.structureOrdering}`
                    : null;
            },
        },
    ];
    for (const oldChunk of previous) {
        let match;
        let method = "unmatched";
        for (const strategy of strategies) {
            match = bestMatch(oldChunk, current, used, strategy.key, strategy.requireUnique, candidate => strategy.predicate?.(oldChunk, candidate) ?? true);
            if (match) {
                method = strategy.method;
                break;
            }
        }
        if (!match) {
            const textMatch = bestTextMatch(oldChunk, current, used);
            if (textMatch) {
                match = textMatch.chunk;
                method = "text_similarity";
            }
        }
        if (!match) {
            results.push({
                changeType: "removed",
                previousChunk: oldChunk,
                alignmentMethod: "unmatched",
            });
            continue;
        }
        used.add(match.chunkId.toString());
        const score = method === "text_similarity"
            ? textSimilarity(oldChunk.content, match.content)
            : undefined;
        results.push({
            changeType: oldChunk.content === match.content ? "unchanged" : "modified",
            previousChunk: oldChunk,
            currentChunk: match,
            alignmentMethod: method,
            ...(score === undefined ? {} : { similarityScore: score }),
        });
    }
    for (const chunk of current)
        if (!used.has(chunk.chunkId.toString()))
            results.push({
                changeType: "added",
                currentChunk: chunk,
                alignmentMethod: "unmatched",
            });
    return results.sort((a, b) => compareChunks(a.currentChunk ?? a.previousChunk, b.currentChunk ?? b.previousChunk));
}
function bound(value, max = MAX_EXCERPT) {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
function preview(value) {
    return bound(value.replace(/\s+/g, " ").trim(), 900);
}
export function buildDocumentChangeEvidence(pair, alignments) {
    return alignments
        .filter(alignment => alignment.changeType !== "unchanged")
        .map(alignment => {
        const previous = alignment.previousChunk;
        const current = alignment.currentChunk;
        const previousId = previous?.chunkId.toString() ?? "none";
        const currentId = current?.chunkId.toString() ?? "none";
        const sourceId = `document_change:doc:${pair.documentId}:v${pair.previousVersionId}:v${pair.currentVersionId}:chunk:${previousId}:${currentId}`;
        const excerpt = alignment.changeType === "modified"
            ? `Section modified. Before: ${preview(previous.content)} After: ${preview(current.content)}`
            : alignment.changeType === "added"
                ? `Section added: ${preview(current.content)}`
                : `Section removed: ${preview(previous.content)}`;
        return {
            sourceType: "document_change",
            sourceId,
            title: pair.documentTitle,
            sourceTimestamp: pair.currentCreatedAt.toISOString(),
            excerpt: bound(excerpt),
            workspaceDeepLink: `/employer/documents/viewer?docId=${pair.documentId}`,
            metadata: {
                documentId: pair.documentId.toString(),
                previousVersionId: pair.previousVersionId,
                currentVersionId: pair.currentVersionId,
                previousVersionNumber: pair.previousVersionNumber,
                currentVersionNumber: pair.currentVersionNumber,
                previousChunkId: previous?.chunkId ?? null,
                currentChunkId: current?.chunkId ?? null,
                changeType: alignment.changeType,
                alignmentMethod: alignment.alignmentMethod,
                previousContentHash: previous?.contentHash ?? null,
                currentContentHash: current?.contentHash ?? null,
                structurePath: current?.structurePath ?? previous?.structurePath ?? null,
                userChangelog: pair.currentChangelog
                    ? bound(pair.currentChangelog.replace(/\s+/g, " ").trim(), MAX_METADATA_TEXT)
                    : null,
            },
        };
    });
}
//# sourceMappingURL=document-change.js.map