/**
 * Folders are paths. These pin the rules every consumer relies on: how a typed
 * or stored value normalizes, what counts as inside a folder, how a rename
 * rewrites a prefix, what a folder may be called, and how a flat list of
 * paths and sources becomes the tree the rail draws.
 */

import {
    UNFILED_FOLDER,
    buildFolderTree,
    compareFolderPaths,
    displayFolderPath,
    expandFolderPaths,
    folderAncestors,
    folderDepth,
    folderLeafName,
    folderParentPath,
    isFolderDescendant,
    isFolderOrDescendant,
    joinFolderPath,
    normalizeFolderPath,
    replaceFolderPrefix,
    validateFolderName,
    validateFolderPath,
} from "~/lib/folders/path";

describe("normalizeFolderPath", () => {
    it("trims segments, drops empties, and treats nothing as Unfiled", () => {
        expect(normalizeFolderPath(" Contracts / 2026 ")).toBe("Contracts/2026");
        expect(normalizeFolderPath("a//b/")).toBe("a/b");
        expect(normalizeFolderPath("")).toBe(UNFILED_FOLDER);
        expect(normalizeFolderPath(null)).toBe(UNFILED_FOLDER);
        expect(normalizeFolderPath("   ")).toBe(UNFILED_FOLDER);
    });

    it("joins parts that may themselves be paths", () => {
        expect(joinFolderPath("Contracts", "2026/Globex")).toBe("Contracts/2026/Globex");
        expect(joinFolderPath(null, "HR")).toBe("HR");
        expect(joinFolderPath(null, "")).toBe(UNFILED_FOLDER);
    });
});

describe("structure", () => {
    it("reads leaf, parent, depth, and ancestors off the path", () => {
        expect(folderLeafName("Contracts/2026/Globex")).toBe("Globex");
        expect(folderLeafName("")).toBe(UNFILED_FOLDER);
        expect(folderParentPath("Contracts/2026/Globex")).toBe("Contracts/2026");
        expect(folderParentPath("Contracts")).toBeNull();
        expect(folderDepth("Contracts")).toBe(0);
        expect(folderDepth("Contracts/2026/Globex")).toBe(2);
        expect(folderAncestors("Contracts/2026/Globex")).toEqual(["Contracts", "Contracts/2026"]);
        expect(folderAncestors("Contracts")).toEqual([]);
        expect(displayFolderPath("Contracts/2026")).toBe("Contracts / 2026");
    });

    it("tells a folder inside another from one that merely shares a prefix", () => {
        expect(isFolderOrDescendant("Contracts/2026", "Contracts")).toBe(true);
        expect(isFolderOrDescendant("Contracts", "Contracts")).toBe(true);
        expect(isFolderOrDescendant("Contracts2", "Contracts")).toBe(false);
        expect(isFolderDescendant("Contracts", "Contracts")).toBe(false);
        expect(isFolderDescendant("Contracts/2026/Globex", "Contracts")).toBe(true);
    });

    it("rewrites only the leading prefix", () => {
        expect(replaceFolderPrefix("A/B/C", "A/B", "X")).toBe("X/C");
        expect(replaceFolderPrefix("A/B", "A/B", "X/Y")).toBe("X/Y");
        expect(replaceFolderPrefix("A/BC", "A/B", "X")).toBe("A/BC");
        expect(replaceFolderPrefix("Other", "A", "X")).toBe("Other");
    });
});

describe("validation", () => {
    it("accepts ordinary names and nested paths", () => {
        expect(validateFolderName("Fundraising Q1")).toBeNull();
        expect(validateFolderPath("Contracts/2026/Globex")).toBeNull();
    });

    it("rejects separators, blanks, and over-long names", () => {
        expect(validateFolderName("")).toMatch(/required/);
        expect(validateFolderName("a/b")).toMatch(/can't contain/);
        expect(validateFolderName("x".repeat(81))).toMatch(/too long/);
    });

    it("reserves Unfiled and bounds depth", () => {
        expect(validateFolderPath("Unfiled")).toMatch(/can't be created/);
        expect(validateFolderPath("Unfiled/Drafts")).toMatch(/nested under/);
        expect(validateFolderPath(Array.from({ length: 9 }, (_, i) => `l${i}`).join("/"))).toMatch(
            /at most 8 deep/
        );
    });
});

describe("ordering and expansion", () => {
    it("adds every ancestor once and sorts Unfiled last", () => {
        expect(
            expandFolderPaths(["Contracts/2026/Globex", "Unfiled", "HR", "Vendors/2026", ""])
        ).toEqual([
            "Contracts",
            "Contracts/2026",
            "Contracts/2026/Globex",
            "HR",
            "Vendors",
            "Vendors/2026",
            "Unfiled",
        ]);
    });

    it("keeps a subtree contiguous when two folders differ only by case", () => {
        const paths = expandFolderPaths(["Contracts/2026", "contracts/2027", "Contracts/2025"]);
        const upper = paths.filter(p => p.startsWith("Contracts"));
        const first = paths.indexOf(upper[0]!);
        expect(paths.slice(first, first + upper.length)).toEqual(upper);
    });

    it("compares segment by segment, numerically aware", () => {
        expect(["Q10", "Q2", "Q1"].sort(compareFolderPaths)).toEqual(["Q1", "Q2", "Q10"]);
        expect(compareFolderPaths("A", "A/B")).toBeLessThan(0);
        expect(compareFolderPaths("Unfiled", "Zeta")).toBeGreaterThan(0);
    });
});

describe("buildFolderTree", () => {
    const items = [
        { id: "d1", folder: "Contracts" },
        { id: "d2", folder: "Contracts/2026" },
        { id: "d3", folder: "" },
    ];
    const folderOf = (item: { folder: string }) => item.folder;

    it("nests subfolders under their parent and counts the subtree", () => {
        const tree = buildFolderTree(["Engineering"], items, folderOf);
        expect(tree.items).toEqual([]);
        expect(tree.children.map(n => n.path)).toEqual(["Contracts", "Engineering", "Unfiled"]);
        const contracts = tree.children[0]!;
        expect(contracts.items.map(i => i.id)).toEqual(["d1"]);
        expect(contracts.children.map(n => n.path)).toEqual(["Contracts/2026"]);
        expect(contracts.totalItems).toBe(2);
        expect(contracts.children[0]!.depth).toBe(1);
        expect(tree.children[1]!.totalItems).toBe(0);
    });

    it("scopes to a folder's subtree", () => {
        const tree = buildFolderTree(["Engineering"], items, folderOf, { root: "Contracts" });
        expect(tree.items.map(i => i.id)).toEqual(["d1"]);
        expect(tree.children.map(n => n.path)).toEqual(["Contracts/2026"]);
    });

    it("prunes folders with nothing in them when asked", () => {
        const tree = buildFolderTree(["Engineering"], items, folderOf, { pruneEmpty: true });
        expect(tree.children.map(n => n.path)).toEqual(["Contracts", "Unfiled"]);
    });
});
