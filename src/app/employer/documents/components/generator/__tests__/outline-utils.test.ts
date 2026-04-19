import {
    findItem,
    findParent,
    deleteItem,
    saveEdit,
    addChild,
    getVisibleItems,
    getItemStyles,
} from "../outline-utils";
import type { OutlineItem } from "../OutlinePanel";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeTree(): OutlineItem[] {
    return [
        {
            id: "1",
            title: "Introduction",
            level: 1,
            children: [
                { id: "1.1", title: "Background", level: 2 },
                {
                    id: "1.2",
                    title: "Motivation",
                    level: 2,
                    children: [
                        { id: "1.2.1", title: "Problem Statement", level: 3 },
                    ],
                },
            ],
        },
        {
            id: "2",
            title: "Methods",
            level: 1,
            children: [
                { id: "2.1", title: "Design", level: 2 },
            ],
        },
        { id: "3", title: "Conclusion", level: 1 },
    ];
}

// ---------------------------------------------------------------------------
// findItem
// ---------------------------------------------------------------------------

describe("findItem", () => {
    const tree = makeTree();

    it("finds a root-level item", () => {
        const item = findItem(tree, "2");
        expect(item).not.toBeNull();
        expect(item!.title).toBe("Methods");
    });

    it("finds a depth-1 child", () => {
        const item = findItem(tree, "1.1");
        expect(item).not.toBeNull();
        expect(item!.title).toBe("Background");
    });

    it("finds a depth-2 child", () => {
        const item = findItem(tree, "1.2.1");
        expect(item).not.toBeNull();
        expect(item!.title).toBe("Problem Statement");
    });

    it("returns null for a missing ID", () => {
        expect(findItem(tree, "999")).toBeNull();
    });

    it("returns null for an empty tree", () => {
        expect(findItem([], "1")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// findParent
// ---------------------------------------------------------------------------

describe("findParent", () => {
    const tree = makeTree();

    it("finds the parent of a depth-1 child", () => {
        const parent = findParent(tree, "1.1");
        expect(parent).not.toBeNull();
        expect(parent!.id).toBe("1");
    });

    it("finds the parent of a depth-2 child", () => {
        const parent = findParent(tree, "1.2.1");
        expect(parent).not.toBeNull();
        expect(parent!.id).toBe("1.2");
    });

    it("returns null for a root-level item (no parent)", () => {
        expect(findParent(tree, "1")).toBeNull();
    });

    it("returns null for a missing ID", () => {
        expect(findParent(tree, "999")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// deleteItem
// ---------------------------------------------------------------------------

describe("deleteItem", () => {
    it("removes a root-level item", () => {
        const tree = makeTree();
        const result = deleteItem(tree, "3");
        expect(result).toHaveLength(2);
        expect(findItem(result, "3")).toBeNull();
    });

    it("removes a nested item and preserves siblings", () => {
        const tree = makeTree();
        const result = deleteItem(tree, "1.1");
        // Parent "1" should still exist with 1 child
        const parent = findItem(result, "1");
        expect(parent).not.toBeNull();
        expect(parent!.children).toHaveLength(1);
        expect(parent!.children![0]!.id).toBe("1.2");
    });

    it("removes a deeply nested item", () => {
        const tree = makeTree();
        const result = deleteItem(tree, "1.2.1");
        const parent = findItem(result, "1.2");
        expect(parent).not.toBeNull();
        // children array is empty (or missing)
        expect(parent!.children?.length ?? 0).toBe(0);
    });

    it("returns the same tree when ID does not exist", () => {
        const tree = makeTree();
        const result = deleteItem(tree, "nonexistent");
        expect(result).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// saveEdit
// ---------------------------------------------------------------------------

describe("saveEdit", () => {
    it("updates a root-level item title", () => {
        const tree = makeTree();
        const result = saveEdit(tree, "2", "Methodology");
        expect(findItem(result, "2")!.title).toBe("Methodology");
    });

    it("updates a nested item title", () => {
        const tree = makeTree();
        const result = saveEdit(tree, "1.2.1", "Hypothesis");
        expect(findItem(result, "1.2.1")!.title).toBe("Hypothesis");
    });

    it("does not modify other items", () => {
        const tree = makeTree();
        const result = saveEdit(tree, "2", "New Title");
        expect(findItem(result, "1")!.title).toBe("Introduction");
        expect(findItem(result, "3")!.title).toBe("Conclusion");
    });
});

// ---------------------------------------------------------------------------
// addChild
// ---------------------------------------------------------------------------

describe("addChild", () => {
    it("adds a child to a root-level item", () => {
        const tree = makeTree();
        const child: OutlineItem = { id: "2.new", title: "New Sub", level: 2 };
        const result = addChild(tree, "2", child);
        const parent = findItem(result, "2");
        expect(parent!.children).toHaveLength(2);
        expect(parent!.children![1]!.title).toBe("New Sub");
    });

    it("adds a child to an item with no existing children", () => {
        const tree = makeTree();
        const child: OutlineItem = { id: "3.1", title: "Summary", level: 2 };
        const result = addChild(tree, "3", child);
        const parent = findItem(result, "3");
        expect(parent!.children).toHaveLength(1);
        expect(parent!.children![0]!.title).toBe("Summary");
    });
});

// ---------------------------------------------------------------------------
// getVisibleItems
// ---------------------------------------------------------------------------

describe("getVisibleItems", () => {
    it("returns only root IDs when nothing is expanded", () => {
        const tree = makeTree();
        const result = getVisibleItems(tree, new Set());
        expect(result).toEqual(["1", "2", "3"]);
    });

    it("includes children of expanded items", () => {
        const tree = makeTree();
        const result = getVisibleItems(tree, new Set(["1"]));
        expect(result).toEqual(["1", "1.1", "1.2", "2", "3"]);
    });

    it("includes deeply nested items when ancestors are expanded", () => {
        const tree = makeTree();
        const result = getVisibleItems(tree, new Set(["1", "1.2"]));
        expect(result).toEqual(["1", "1.1", "1.2", "1.2.1", "2", "3"]);
    });

    it("returns empty array for empty tree", () => {
        expect(getVisibleItems([], new Set())).toEqual([]);
    });

    it("expanding a leaf has no effect", () => {
        const tree = makeTree();
        const result = getVisibleItems(tree, new Set(["3"]));
        expect(result).toEqual(["1", "2", "3"]);
    });
});

// ---------------------------------------------------------------------------
// getItemStyles
// ---------------------------------------------------------------------------

describe("getItemStyles", () => {
    it("returns semibold for level 1", () => {
        const styles = getItemStyles(1);
        expect(styles.textClass).toContain("font-semibold");
        expect(styles.showIcon).toBe(true);
    });

    it("returns medium for level 2", () => {
        const styles = getItemStyles(2);
        expect(styles.textClass).toContain("font-medium");
        expect(styles.showIcon).toBe(true);
    });

    it("returns muted-foreground for level 3+", () => {
        const styles = getItemStyles(3);
        expect(styles.textClass).toContain("text-muted-foreground");
        expect(styles.showIcon).toBe(false);
    });

    it("returns muted-foreground for deep levels", () => {
        const styles = getItemStyles(5);
        expect(styles.textClass).toContain("text-muted-foreground");
        expect(styles.showIcon).toBe(false);
    });
});
