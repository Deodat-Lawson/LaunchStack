import { describe, expect, it } from "vitest";

import { diffVersions, type ChunkFingerprint } from "../src/index";

const chunk = (ordinal: number, contentHash: string): ChunkFingerprint => ({
    ordinal,
    contentHash,
});

describe("diffVersions", () => {
    it("reports identical versions as fully unchanged", () => {
        const version = [chunk(0, "a"), chunk(1, "b"), chunk(2, "c")];
        expect(diffVersions(version, version)).toEqual({
            added: [],
            removed: [],
            unchanged: [0, 1, 2],
            moved: [],
        });
    });

    it("reports additions and removals", () => {
        const result = diffVersions(
            [chunk(0, "a"), chunk(1, "b")],
            [chunk(0, "a"), chunk(1, "x"), chunk(2, "y")]
        );
        expect(result).toEqual({
            added: [1, 2],
            removed: [1],
            unchanged: [0],
            moved: [],
        });
    });

    it("reports a hash at a different ordinal as moved", () => {
        const result = diffVersions([chunk(0, "a"), chunk(1, "b")], [chunk(0, "b"), chunk(1, "a")]);
        expect(result).toEqual({
            added: [],
            removed: [],
            unchanged: [],
            moved: [
                { fromOrdinal: 0, toOrdinal: 1 },
                { fromOrdinal: 1, toOrdinal: 0 },
            ],
        });
    });

    it("prefers unchanged over moved when the same hash also stays in place", () => {
        const result = diffVersions([chunk(0, "a"), chunk(1, "a")], [chunk(0, "a"), chunk(5, "a")]);
        expect(result).toEqual({
            added: [],
            removed: [],
            unchanged: [0],
            moved: [{ fromOrdinal: 1, toOrdinal: 5 }],
        });
    });

    it("matches duplicate hashes with min(n, m) multiplicity", () => {
        // 3 copies of "dup" before, 2 after (both displaced) -> 2 moves + 1 removal.
        const result = diffVersions(
            [chunk(0, "dup"), chunk(1, "dup"), chunk(2, "dup"), chunk(3, "z")],
            [chunk(3, "z"), chunk(4, "dup"), chunk(5, "dup")]
        );
        expect(result).toEqual({
            added: [],
            removed: [2],
            unchanged: [3],
            moved: [
                { fromOrdinal: 0, toOrdinal: 4 },
                { fromOrdinal: 1, toOrdinal: 5 },
            ],
        });
    });

    it("matches duplicate hashes when the after side has more copies", () => {
        const result = diffVersions([chunk(0, "dup")], [chunk(1, "dup"), chunk(2, "dup")]);
        expect(result).toEqual({
            added: [2],
            removed: [],
            unchanged: [],
            moved: [{ fromOrdinal: 0, toOrdinal: 1 }],
        });
    });

    it("is independent of input array order", () => {
        const before = [chunk(0, "a"), chunk(1, "b"), chunk(2, "dup"), chunk(3, "dup")];
        const after = [chunk(0, "b"), chunk(1, "dup"), chunk(2, "c"), chunk(3, "dup")];
        const expected = diffVersions(before, after);
        expect(diffVersions([...before].reverse(), [...after].reverse())).toEqual(expected);
        expect(
            diffVersions(
                [before[2]!, before[0]!, before[3]!, before[1]!],
                [after[3]!, after[1]!, after[0]!, after[2]!]
            )
        ).toEqual(expected);
    });

    it("handles empty versions", () => {
        expect(diffVersions([], [])).toEqual({
            added: [],
            removed: [],
            unchanged: [],
            moved: [],
        });
        expect(diffVersions([], [chunk(0, "a")])).toEqual({
            added: [0],
            removed: [],
            unchanged: [],
            moved: [],
        });
        expect(diffVersions([chunk(0, "a")], [])).toEqual({
            added: [],
            removed: [0],
            unchanged: [],
            moved: [],
        });
    });

    it("throws on duplicate ordinals within one version", () => {
        expect(() => diffVersions([chunk(0, "a"), chunk(0, "b")], [])).toThrow(RangeError);
        expect(() => diffVersions([], [chunk(2, "a"), chunk(2, "a")])).toThrow(RangeError);
    });

    it("throws on non-integer ordinals", () => {
        expect(() => diffVersions([chunk(0.5, "a")], [])).toThrow(RangeError);
    });

    it("does not mutate its inputs", () => {
        const before = Object.freeze([Object.freeze(chunk(1, "b")), Object.freeze(chunk(0, "a"))]);
        const after = Object.freeze([Object.freeze(chunk(0, "b"))]);
        diffVersions(before, after);
        expect(before.map(c => c.ordinal)).toEqual([1, 0]);
    });
});
