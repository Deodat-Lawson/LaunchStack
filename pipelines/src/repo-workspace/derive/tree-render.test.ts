import { describe, expect, it } from "vitest";

import { renderTree } from "./tree-render";

describe("renderTree", () => {
    it("renders a small tree exactly, directories before files", () => {
        const rendered = renderTree(["src/app.ts", "src/lib/util.ts", "readme.md"]);
        expect(rendered).toBe(
            [
                "./",
                "├── src/",
                "│   ├── lib/",
                "│   │   └── util.ts",
                "│   └── app.ts",
                "└── readme.md",
            ].join("\n")
        );
    });

    it("sorts directories first, then files, each alphabetically", () => {
        const rendered = renderTree(["b.txt", "z/x.txt", "a/x.txt", "a.txt"]);
        const lines = rendered.split("\n");
        expect(lines).toEqual([
            "./",
            "├── a/",
            "│   └── x.txt",
            "├── z/",
            "│   └── x.txt",
            "├── a.txt",
            "└── b.txt",
        ]);
    });

    it("is independent of input order", () => {
        const sorted = renderTree(["a/one.txt", "a/two.txt", "b/three.txt"]);
        const shuffled = renderTree(["b/three.txt", "a/two.txt", "a/one.txt"]);
        expect(shuffled).toBe(sorted);
    });

    it("cuts at the depth limit with an ellipsis marker", () => {
        const rendered = renderTree(["a/b/c/d.txt"], { maxDepth: 2 });
        expect(rendered).toBe(["./", "└── a/", "    └── b/", "        └── …"].join("\n"));
        expect(rendered).not.toContain("c/");
        expect(rendered).not.toContain("d.txt");
    });

    it("truncates at the character budget with the marker", () => {
        const rendered = renderTree(["aaaa.txt", "bbbb.txt", "cccc.txt", "dddd.txt"], {
            maxChars: 30,
        });
        const lines = rendered.split("\n");
        expect(lines[lines.length - 1]).toBe("… (tree truncated at budget)");
        expect(rendered).toContain("aaaa.txt");
        expect(rendered).toContain("bbbb.txt");
        expect(rendered).not.toContain("cccc.txt");
        expect(rendered).not.toContain("dddd.txt");
    });

    it("uses the provided root label", () => {
        const rendered = renderTree(["a.txt"], { rootLabel: "repo" });
        expect(rendered).toBe("repo/\n└── a.txt");
    });

    it("renders only the root line for an empty path list", () => {
        expect(renderTree([])).toBe("./");
    });

    it("handles deep nesting inside the default depth budget", () => {
        const rendered = renderTree(["one/two/three/four/leaf.txt", "one/sibling.txt"]);
        expect(rendered).toBe(
            [
                "./",
                "└── one/",
                "    ├── two/",
                "    │   └── three/",
                "    │       └── four/",
                "    │           └── leaf.txt",
                "    └── sibling.txt",
            ].join("\n")
        );
    });
});
