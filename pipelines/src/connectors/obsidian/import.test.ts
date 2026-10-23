import { describe, expect, it } from "vitest";

import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "../types";
import { importObsidianNotes } from "./import";
import { isVaultNotePath, noteFolder } from "./paths";
import { normalizeObsidianMarkdown, parseNote, renderNote } from "./vault";

function memorySink(): KnowledgeSink & { items: Map<string, KnowledgeItem> } {
    const items = new Map<string, KnowledgeItem>();
    let nextId = 1;
    return {
        items,
        async lastSyncedHash(item: DiscoveredKnowledgeItem) {
            return items.get(item.sourceId)?.contentHash ?? null;
        },
        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            const revised = items.has(item.sourceId);
            items.set(item.sourceId, item);
            return {
                sourceId: item.sourceId,
                documentId: nextId,
                versionId: nextId++,
                jobId: null,
                revised,
            };
        },
    };
}

describe("isVaultNotePath", () => {
    it("takes Markdown notes and leaves Obsidian's own state out", () => {
        expect(isVaultNotePath("Projects/Launch plan.md")).toBe(true);
        expect(isVaultNotePath("Daily/2026-10-22.MD")).toBe(true);
        expect(isVaultNotePath(".obsidian/workspace.json")).toBe(false);
        expect(isVaultNotePath(".obsidian/snippets/readme.md")).toBe(false);
        expect(isVaultNotePath(".trash/old.md")).toBe(false);
        expect(isVaultNotePath("Attachments/diagram.png")).toBe(false);
        expect(isVaultNotePath("Drawings/board.excalidraw.md")).toBe(false);
        expect(isVaultNotePath("tools/node_modules/pkg/README.md")).toBe(false);
    });

    it("knows which folder a note sits in", () => {
        expect(noteFolder("Projects/Q4/Plan.md")).toBe("Projects/Q4");
        expect(noteFolder("Inbox.md")).toBe("");
        expect(noteFolder("\\Projects\\Plan.md")).toBe("Projects");
    });
});

describe("parseNote", () => {
    it("reads the frontmatter subset notes use", () => {
        const { frontmatter, body } = parseNote(
            [
                "---",
                "title: Launch plan",
                "tags: [connectors, q4]",
                "aliases:",
                "  - Plan",
                "  - The plan",
                'status: "in progress"',
                "---",
                "Body here.",
            ].join("\n")
        );

        expect(frontmatter).toEqual({
            title: "Launch plan",
            tags: ["connectors", "q4"],
            aliases: ["Plan", "The plan"],
            status: "in progress",
        });
        expect(body).toBe("Body here.");
    });

    it("leaves a note without frontmatter alone", () => {
        expect(parseNote("Just text\n---\nnot frontmatter")).toEqual({
            frontmatter: {},
            body: "Just text\n---\nnot frontmatter",
        });
    });
});

describe("normalizeObsidianMarkdown", () => {
    it("turns wikilinks and embeds into readable text", () => {
        const out = normalizeObsidianMarkdown(
            "See [[Roadmap]], [[Roadmap#Q4|the Q4 part]] and [[Hiring#Engineers]].\n" +
                "![[diagram.png]]\n![[Meeting notes]]\n[[Spec.md]]"
        );
        expect(out).toBe(
            "See Roadmap, the Q4 part and Hiring › Engineers.\n" +
                "[media: diagram.png]\n[embedded note: Meeting notes]\nSpec"
        );
    });

    it("drops comments and block ids, but keeps fenced code as written", () => {
        const out = normalizeObsidianMarkdown(
            "Keep this. %%private%%\nA line ^abc-123\n```\n[[not a link]] %%kept%%\n```\nEnd"
        );
        expect(out).toContain("Keep this. ");
        expect(out).not.toContain("private");
        expect(out).toContain("A line\n");
        expect(out).toContain("```\n[[not a link]] ");
        expect(out).toContain("End");
    });
});

describe("renderNote", () => {
    it("puts the title, provenance and properties above the body", () => {
        const rendered = renderNote({
            path: "Projects/plan.md",
            vaultName: "Work",
            text: "---\ntags: project alpha\naliases: Launch Plan\nowner: Ada\n---\nShip it with [[Roadmap]].",
        });

        expect(rendered.title).toBe("plan");
        expect(rendered.tags).toEqual(["project", "alpha"]);
        expect(rendered.markdown).toContain("# plan");
        expect(rendered.markdown).toContain('From the Obsidian vault "Work" · Projects/plan.md');
        expect(rendered.markdown).toContain("- **Tags:** project, alpha");
        expect(rendered.markdown).toContain("- **Aliases:** Launch Plan");
        expect(rendered.markdown).toContain("- **owner:** Ada");
        expect(rendered.markdown).toContain("Ship it with Roadmap.");
    });
});

describe("importObsidianNotes", () => {
    const notes = [
        { path: "Inbox.md", text: "First thought" },
        { path: "Projects/Plan.md", text: "---\ntitle: The plan\n---\nDo it" },
        { path: ".obsidian/app.md", text: "settings" },
        { path: "Empty.md", text: "   \n" },
    ];

    it("stores notes and reports what it left out", async () => {
        const sink = memorySink();
        const report = await importObsidianNotes({ vaultName: "Work", notes, sink });

        expect(report.stored.map(item => item.sourceId).sort()).toEqual([
            "Inbox.md",
            "Projects/Plan.md",
        ]);
        expect(report.skipped).toEqual(
            expect.arrayContaining([
                { sourceId: ".obsidian/app.md", reason: "excluded" },
                { sourceId: "Empty.md", reason: "empty" },
            ])
        );
        const plan = sink.items.get("Projects/Plan.md")!;
        expect(plan.title).toBe("The plan");
        expect(plan.metadata).toMatchObject({
            extension: ".md",
            obsidianVault: "Work",
            obsidianPath: "Projects/Plan.md",
            obsidianFolder: "Projects",
        });
        expect(plan.content).toContain("# The plan");
    });

    it("re-imports only what changed", async () => {
        const sink = memorySink();
        await importObsidianNotes({ vaultName: "Work", notes, sink });

        const report = await importObsidianNotes({
            vaultName: "Work",
            notes: [
                { path: "Inbox.md", text: "First thought" },
                { path: "Projects/Plan.md", text: "---\ntitle: The plan\n---\nDo it today" },
            ],
            sink,
        });

        expect(report.stored).toEqual([
            expect.objectContaining({ sourceId: "Projects/Plan.md", revised: true }),
        ]);
        expect(report.skipped).toEqual([{ sourceId: "Inbox.md", reason: "unchanged" }]);
    });

    it("skips a note over the size limit", async () => {
        const report = await importObsidianNotes({
            vaultName: "Work",
            notes: [{ path: "Big.md", text: "x".repeat(200) }],
            sink: memorySink(),
            maxNoteBytes: 100,
        });

        expect(report.skipped).toEqual([
            expect.objectContaining({ sourceId: "Big.md", reason: "too-large" }),
        ]);
    });

    it("records a failing store without stopping the batch", async () => {
        const sink = memorySink();
        const failing: KnowledgeSink = {
            lastSyncedHash: item => sink.lastSyncedHash!(item),
            async store(item) {
                if (item.sourceId === "Inbox.md") throw new Error("disk full");
                return sink.store(item);
            },
        };

        const report = await importObsidianNotes({ vaultName: "Work", notes, sink: failing });

        expect(report.failed).toEqual([{ sourceId: "Inbox.md", error: "Error: disk full" }]);
        expect(report.stored).toHaveLength(1);
    });
});
