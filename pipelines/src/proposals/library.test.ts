import { describe, expect, it } from "vitest";

import { formatLibraryBlock, matchLibrary } from "./library";
import { similarity, slugKey, tokens, wordCount } from "./text";
import type { LibraryItemRecord } from "./types";

function item(id: string, question: string, tags: string[] = [], uses = 0): LibraryItemRecord {
    return {
        id,
        companyId: 1n,
        question,
        answer: `Answer for ${question}`,
        tags,
        evidence: [],
        sourceApplicationId: null,
        sourceSectionKey: null,
        uses,
        createdByUserId: "u",
        createdAt: new Date(0),
        updatedAt: null,
    };
}

describe("text helpers", () => {
    it("counts words and slugs headings", () => {
        expect(wordCount("  one two\nthree ")).toBe(3);
        expect(wordCount(null)).toBe(0);
        expect(slugKey("Organizational Capacity & Experience")).toBe(
            "organizational-capacity-experience"
        );
        expect(slugKey("!!!")).toBe("section");
    });

    it("tokenizes content words with light stemming", () => {
        expect(tokens("Describe the programs you delivered to participants")).toEqual([
            "program",
            "deliver",
            "participant",
        ]);
        expect(similarity("", "x")).toBe(0);
    });
});

describe("matchLibrary", () => {
    const items = [
        item("mission", "Describe your organization's mission and history"),
        item("budget", "Provide a project budget and budget narrative", ["budget", "finance"]),
        item("evaluation", "How will you evaluate the outcomes of the project?", [], 4),
        item("evaluation-2", "How will you measure outcomes and evaluate results?", [], 1),
    ];

    it("finds answers to the same question and leaves unrelated ones out", () => {
        const matches = matchLibrary(
            "Describe the mission and history of your organization",
            items
        );
        expect(matches.map(m => m.item.id)).toEqual(["mission"]);
    });

    it("ranks by overlap, then by how often an answer was reused", () => {
        const matches = matchLibrary("How will you evaluate outcomes?", items);
        expect(matches.map(m => m.item.id)).toEqual(["evaluation", "evaluation-2"]);
    });

    it("matches on tags a person added", () => {
        const matches = matchLibrary("What are your finances?", items);
        expect(matches.map(m => m.item.id)).toEqual(["budget"]);
    });

    it("formats matches for a prompt, and says so when there are none", () => {
        expect(formatLibraryBlock([])).toContain("no saved answers");
        const block = formatLibraryBlock(matchLibrary("mission and history", items));
        expect(block).toContain("Saved answer 1");
        expect(block).toContain("Answer for Describe");
    });
});
