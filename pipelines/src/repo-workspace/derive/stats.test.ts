import { describe, expect, it } from "vitest";

import type { WorkspaceFile } from "../types";
import { computeRepoStats, renderRepoStats } from "./stats";

const wf = (path: string, size: number): WorkspaceFile => ({ path, size });

describe("computeRepoStats", () => {
    it("aggregates languages by extension, case-insensitively", () => {
        const stats = computeRepoStats([
            wf("src/a.ts", 100),
            wf("src/b.TSX", 50),
            wf("tool.py", 30),
            wf("notes.md", 20),
        ]);
        expect(stats.languages).toEqual([
            { language: "TypeScript", files: 2, bytes: 150 },
            { language: "Python", files: 1, bytes: 30 },
            { language: "Markdown", files: 1, bytes: 20 },
        ]);
    });

    it("buckets unknown extensions and extension-less files as Other", () => {
        const stats = computeRepoStats([wf("Makefile", 10), wf("data.weird", 5), wf("LICENSE", 7)]);
        expect(stats.languages).toEqual([{ language: "Other", files: 3, bytes: 22 }]);
    });

    it("aggregates top-level directories, with '.' for root files", () => {
        const stats = computeRepoStats([
            wf("root.txt", 10),
            wf("src/a.ts", 100),
            wf("src/deep/nested/b.ts", 50),
            wf("docs/guide.md", 5),
        ]);
        expect(stats.largestDirectories).toEqual([
            { path: "src", files: 2, bytes: 150 },
            { path: ".", files: 1, bytes: 10 },
            { path: "docs", files: 1, bytes: 5 },
        ]);
    });

    it("sorts by bytes descending, then name ascending on ties", () => {
        const stats = computeRepoStats([
            wf("zzz/a.ts", 100),
            wf("aaa/b.py", 100),
            wf("mmm/c.go", 200),
        ]);
        expect(stats.largestDirectories.map(d => d.path)).toEqual(["mmm", "aaa", "zzz"]);
        expect(stats.languages.map(l => l.language)).toEqual(["Go", "Python", "TypeScript"]);
    });

    it("caps languages at 10, keeping the largest by bytes", () => {
        const extensions = [
            ".ts",
            ".py",
            ".go",
            ".java",
            ".kt",
            ".rs",
            ".rb",
            ".php",
            ".cs",
            ".swift",
            ".scala",
            ".sql",
        ];
        const files = extensions.map((ext, i) => wf(`f${i}${ext}`, (extensions.length - i) * 10));
        const stats = computeRepoStats(files);
        expect(stats.languages).toHaveLength(10);
        // The two smallest (.scala at 20, .sql at 10) fall off the list.
        expect(stats.languages.some(l => l.language === "Scala")).toBe(false);
        expect(stats.languages.some(l => l.language === "SQL")).toBe(false);
        expect(stats.languages[0]).toEqual({ language: "TypeScript", files: 1, bytes: 120 });
    });

    it("caps directories at 8, keeping the largest by bytes", () => {
        const files = Array.from({ length: 10 }, (_, i) => wf(`dir${i}/file.ts`, (10 - i) * 10));
        const stats = computeRepoStats(files);
        expect(stats.largestDirectories).toHaveLength(8);
        expect(stats.largestDirectories[0]?.path).toBe("dir0");
        const kept = stats.largestDirectories.map(d => d.path);
        expect(kept).not.toContain("dir8");
        expect(kept).not.toContain("dir9");
    });

    it("totals files and bytes over everything, past the display caps", () => {
        const files = Array.from({ length: 15 }, (_, i) => wf(`d${i}/f${i}.ts`, 3));
        const stats = computeRepoStats(files);
        expect(stats.totalFiles).toBe(15);
        expect(stats.totalBytes).toBe(45);
    });

    it("handles an empty listing", () => {
        expect(computeRepoStats([])).toEqual({
            totalFiles: 0,
            totalBytes: 0,
            languages: [],
            largestDirectories: [],
        });
    });
});

describe("renderRepoStats", () => {
    it("renders the three expected lines", () => {
        const stats = computeRepoStats([
            wf("src/a.ts", 1024),
            wf("src/b.ts", 1024),
            wf("readme.md", 2048),
        ]);
        expect(renderRepoStats(stats)).toBe(
            [
                "Files: 3 · 4 KiB",
                "Languages: Markdown (1 files), TypeScript (2 files)",
                "Largest directories: ./ (1 files), src/ (2 files)",
            ].join("\n")
        );
    });

    it("renders placeholders for an empty repo", () => {
        expect(renderRepoStats(computeRepoStats([]))).toBe(
            ["Files: 0 · 0 KiB", "Languages: none detected", "Largest directories: flat"].join("\n")
        );
    });
});
