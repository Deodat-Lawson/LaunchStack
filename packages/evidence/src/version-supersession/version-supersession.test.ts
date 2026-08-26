import { describe, expect, it } from "vitest";

import {
    isSuperseded,
    resolveCurrentVersion,
    supersessionChain,
    type SourceVersionMeta,
} from "../index";

const v1: SourceVersionMeta = {
    versionId: 10,
    versionNumber: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
};
const v2: SourceVersionMeta = {
    versionId: 20,
    versionNumber: 2,
    createdAt: "2026-02-01T00:00:00.000Z",
};
const v3: SourceVersionMeta = {
    versionId: 30,
    versionNumber: 3,
    createdAt: "2026-03-01T00:00:00.000Z",
};

describe("resolveCurrentVersion", () => {
    it("returns null for an empty list", () => {
        expect(resolveCurrentVersion([])).toBeNull();
        expect(resolveCurrentVersion([], 10)).toBeNull();
    });

    it("uses the highest versionNumber without a pointer", () => {
        expect(resolveCurrentVersion([v2, v1, v3])).toBe(v3);
        expect(resolveCurrentVersion([v1, v2, v3], null)).toBe(v3);
        expect(resolveCurrentVersion([v1, v2, v3], undefined)).toBe(v3);
    });

    it("lets a matching explicit pointer win over a higher versionNumber", () => {
        expect(resolveCurrentVersion([v1, v2, v3], v1.versionId)).toBe(v1);
    });

    it("falls back to highest versionNumber when the pointer matches nothing", () => {
        expect(resolveCurrentVersion([v1, v2], 999)).toBe(v2);
    });

    it("breaks versionNumber ties by higher versionId", () => {
        const tieA = { ...v2, versionId: 21 };
        const tieB = { ...v2, versionId: 22 };
        expect(resolveCurrentVersion([tieB, tieA])).toBe(tieB);
        expect(resolveCurrentVersion([tieA, tieB])).toBe(tieB);
    });
});

describe("isSuperseded", () => {
    it("marks older versions superseded and the current one not", () => {
        expect(isSuperseded([v1, v2, v3], v1.versionId)).toBe(true);
        expect(isSuperseded([v1, v2, v3], v2.versionId)).toBe(true);
        expect(isSuperseded([v1, v2, v3], v3.versionId)).toBe(false);
    });

    it("respects an explicit current pointer", () => {
        expect(isSuperseded([v1, v2, v3], v3.versionId, v1.versionId)).toBe(true);
        expect(isSuperseded([v1, v2, v3], v1.versionId, v1.versionId)).toBe(false);
    });

    it("treats unknown version ids as not superseded", () => {
        expect(isSuperseded([v1, v2], 999)).toBe(false);
        expect(isSuperseded([], 999)).toBe(false);
    });
});

describe("supersessionChain", () => {
    it("orders oldest to newest by versionNumber", () => {
        expect(supersessionChain([v3, v1, v2])).toEqual([v1, v2, v3]);
    });

    it("breaks versionNumber ties by versionId and does not mutate input", () => {
        const tieA = { ...v2, versionId: 21 };
        const tieB = { ...v2, versionId: 22 };
        const input = [tieB, v1, tieA];
        const frozen = Object.freeze(input);
        expect(supersessionChain(frozen)).toEqual([v1, tieA, tieB]);
        expect(input).toEqual([tieB, v1, tieA]);
    });

    it("returns an empty array for an empty history", () => {
        expect(supersessionChain([])).toEqual([]);
    });
});
