import { describe, expect, it } from "vitest";

import type { FileSymbols, RepoMapEntry } from "../types";
import { buildRepoMap, renderRepoMap } from "./repo-map";

const file = (
    path: string,
    definitions: string[] = [],
    references: string[] = []
): FileSymbols => ({ path, definitions, references });

describe("buildRepoMap", () => {
    it("orders entries by rank descending, the referenced hub first", () => {
        const map = buildRepoMap([
            file("core.ts", ["coreFn"]),
            file("a.ts", ["aFn"], ["coreFn"]),
            file("b.ts", ["bFn"], ["coreFn"]),
            file("c.ts", ["cFn"], ["coreFn"]),
        ]);
        expect(map.entries[0]?.path).toBe("core.ts");
        const ranks = map.entries.map(e => e.rank);
        expect([...ranks].sort((x, y) => y - x)).toEqual(ranks);
    });

    it("breaks rank ties by path ascending", () => {
        const map = buildRepoMap([file("zeta.ts"), file("alpha.ts"), file("mid.ts")]);
        expect(map.entries.map(e => e.path)).toEqual(["alpha.ts", "mid.ts", "zeta.ts"]);
    });

    it("caps symbols per file at 8, ordered by global reference count then name", () => {
        const definitions = Array.from(
            { length: 10 },
            (_, i) => `n${String(i + 1).padStart(2, "0")}`
        );
        const map = buildRepoMap([
            file("lib.ts", definitions),
            file("r1.ts", [], ["n07"]),
            file("r2.ts", [], ["n07", "n05"]),
            file("r3.ts", [], ["n07", "n05", "n03"]),
        ]);
        const lib = map.entries.find(e => e.path === "lib.ts");
        expect(lib?.symbols).toEqual(["n07", "n05", "n03", "n01", "n02", "n04", "n06", "n08"]);
    });

    it("caps the entry list at 200 files", () => {
        const files = Array.from({ length: 210 }, (_, i) =>
            file(`f${String(i).padStart(3, "0")}.ts`, [`def${i}`])
        );
        const map = buildRepoMap(files);
        expect(map.entries).toHaveLength(200);
        // All ranks tie, so the path tie-break decides which 200 survive.
        expect(map.entries[0]?.path).toBe("f000.ts");
        expect(map.entries[199]?.path).toBe("f199.ts");
        expect(map.entries.some(e => e.path === "f200.ts")).toBe(false);
    });

    it("honours the maxChars option in the rendered map", () => {
        const files = Array.from({ length: 40 }, (_, i) =>
            file(`file-number-${String(i).padStart(2, "0")}.ts`, [`definition${i}`])
        );
        const map = buildRepoMap(files, { maxChars: 120 });
        expect(map.rendered.length).toBeLessThanOrEqual(
            120 + "… (map truncated at budget)".length + 1
        );
        expect(map.rendered).toContain("… (map truncated at budget)");
        expect(map.rendered).toContain("file-number-00.ts");
        expect(map.rendered).not.toContain("file-number-39.ts");
    });

    it("is deterministic: two builds are deep-equal and render identically", () => {
        const files = [
            file("core.ts", ["coreFn", "coreType"]),
            file("a.ts", ["aFn"], ["coreFn"]),
            file("b.ts", ["bFn"], ["coreFn", "coreType", "aFn"]),
        ];
        const first = buildRepoMap(files);
        const second = buildRepoMap(files);
        expect(second).toEqual(first);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });
});

describe("renderRepoMap", () => {
    const entries: RepoMapEntry[] = [
        { path: "aaa.ts", rank: 0.6, symbols: ["one", "two"] },
        { path: "bbb.ts", rank: 0.4, symbols: ["three"] },
    ];

    it("renders one block per file with indented symbols", () => {
        expect(renderRepoMap(entries, 10_000)).toBe("aaa.ts\n  one, two\nbbb.ts\n  three");
    });

    it("renders a bare path line for a file without symbols", () => {
        expect(renderRepoMap([{ path: "plain.ts", rank: 1, symbols: [] }], 10_000)).toBe(
            "plain.ts"
        );
    });

    it("truncates on a whole-file boundary with the marker", () => {
        // First block is "aaa.ts\n  one, two\n" (18 chars); the second block
        // does not fit in 25, so it must be dropped entirely.
        expect(renderRepoMap(entries, 25)).toBe("aaa.ts\n  one, two\n… (map truncated at budget)");
    });

    it("renders nothing (and no marker) when not even the first block fits", () => {
        expect(renderRepoMap(entries, 3)).toBe("");
    });

    it("renders an empty entry list as an empty string", () => {
        expect(renderRepoMap([], 100)).toBe("");
    });
});
