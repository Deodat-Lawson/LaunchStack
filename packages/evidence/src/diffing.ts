/**
 * Version content diffing by chunk content hash (ADR-005 §1).
 *
 * Two immutable versions of a source are compared through their chunk
 * fingerprints (ordinal + content hash). The diff is deterministic and
 * independent of input array order; only ordinals decide positions.
 */

/** One chunk of a version: its position and its content hash. */
export interface ChunkFingerprint {
    /** Position of the chunk within its version. Unique per version. */
    ordinal: number;
    contentHash: string;
}

/** A chunk whose content is unchanged but whose position moved. */
export interface ChunkMove {
    fromOrdinal: number;
    toOrdinal: number;
}

/**
 * Diff result. `unchanged` lists ordinals whose hash is identical at the
 * same position in both versions; `moved` pairs equal hashes at different
 * positions; `removed`/`added` are the leftovers on each side.
 */
export interface VersionDiff {
    added: number[];
    removed: number[];
    unchanged: number[];
    moved: ChunkMove[];
}

function indexByHash(chunks: readonly ChunkFingerprint[], side: string): Map<string, number[]> {
    const byHash = new Map<string, number[]>();
    const seenOrdinals = new Set<number>();
    for (const chunk of chunks) {
        if (!Number.isInteger(chunk.ordinal)) {
            throw new RangeError(
                `Chunk ordinals must be integers; got ${chunk.ordinal} in "${side}"`
            );
        }
        if (seenOrdinals.has(chunk.ordinal)) {
            throw new RangeError(`Duplicate ordinal ${chunk.ordinal} in "${side}" version`);
        }
        seenOrdinals.add(chunk.ordinal);
        const ordinals = byHash.get(chunk.contentHash);
        if (ordinals) ordinals.push(chunk.ordinal);
        else byHash.set(chunk.contentHash, [chunk.ordinal]);
    }
    return byHash;
}

const ascending = (a: number, b: number): number => a - b;

/**
 * Diffs two versions by content hash. Per hash: identical ordinals on both
 * sides are `unchanged`; the remaining occurrences are paired in ascending
 * ordinal order into `moved` (n copies before, m after → min(n, m) pairs);
 * unpaired leftovers become `removed` (before side) or `added` (after side).
 * Output arrays are sorted ascending, so the result is order-independent of
 * the inputs. Throws `RangeError` when either version repeats an ordinal —
 * ordinals are positions and cannot recur within one version.
 */
export function diffVersions(
    before: readonly ChunkFingerprint[],
    after: readonly ChunkFingerprint[]
): VersionDiff {
    const beforeByHash = indexByHash(before, "before");
    const afterByHash = indexByHash(after, "after");

    const added: number[] = [];
    const removed: number[] = [];
    const unchanged: number[] = [];
    const moved: ChunkMove[] = [];

    const hashes = new Set([...beforeByHash.keys(), ...afterByHash.keys()]);
    for (const hash of hashes) {
        const beforeOrdinals = (beforeByHash.get(hash) ?? []).sort(ascending);
        const afterOrdinals = (afterByHash.get(hash) ?? []).sort(ascending);
        const beforeSet = new Set(beforeOrdinals);
        const afterSet = new Set(afterOrdinals);

        unchanged.push(...beforeOrdinals.filter(o => afterSet.has(o)));

        const restBefore = beforeOrdinals.filter(o => !afterSet.has(o));
        const restAfter = afterOrdinals.filter(o => !beforeSet.has(o));
        const pairCount = Math.min(restBefore.length, restAfter.length);
        for (let i = 0; i < pairCount; i++) {
            moved.push({ fromOrdinal: restBefore[i]!, toOrdinal: restAfter[i]! });
        }
        removed.push(...restBefore.slice(pairCount));
        added.push(...restAfter.slice(pairCount));
    }

    added.sort(ascending);
    removed.sort(ascending);
    unchanged.sort(ascending);
    moved.sort((a, b) => a.fromOrdinal - b.fromOrdinal);
    return { added, removed, unchanged, moved };
}
