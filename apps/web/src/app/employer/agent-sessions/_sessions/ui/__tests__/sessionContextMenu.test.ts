import { buildSessionMenuItems } from "../sessionContextMenu";
import type { AgentSessionItem } from "../../lib/api";

const base: AgentSessionItem = {
    sourceId: "claude-code:abc",
    tool: "claude-code",
    title: "Fix the reranker",
    preview: null,
    projectSlug: "launchstack",
    projectPath: "/Users/me/LaunchStack",
    gitBranch: "main",
    bytes: 1024,
    modifiedAt: "2026-09-01T00:00:00Z",
    relativePath: "projects/x/abc.jsonl",
    archived: false,
    active: false,
    imported: null,
};

const handlers = () => ({
    onImport: jest.fn(),
    onOpen: jest.fn(),
    onContinue: jest.fn(),
    onCopyPath: jest.fn(),
    onCopyId: jest.fn(),
    onRemoveImport: jest.fn(),
    busy: false,
});

describe("session menu builder", () => {
    it("lets a new session be imported and its ids copied, nothing more", () => {
        const items = buildSessionMenuItems(base, handlers());
        expect(items.map(i => i.id)).toEqual(["title", "import", "sep-copy", "copy-path", "copy-id"]);
        expect(items.find(i => i.id === "import")).toMatchObject({ label: "Import" });
    });

    it("opens, continues, refreshes and removes an imported session", () => {
        const h = handlers();
        const items = buildSessionMenuItems(
            { ...base, imported: { documentId: 9, syncedAt: null, stale: true } },
            h
        );
        expect(items.map(i => i.id)).toEqual([
            "title",
            "open",
            "continue",
            "import",
            "sep-copy",
            "copy-path",
            "copy-id",
            "sep-danger",
            "remove",
        ]);
        expect(items.find(i => i.id === "import")).toMatchObject({ label: "Update the import" });
        const fresh = buildSessionMenuItems(
            { ...base, imported: { documentId: 9, syncedAt: null, stale: false } },
            h
        );
        expect(fresh.find(i => i.id === "import")).toMatchObject({ label: "Re-import" });
    });

    it("holds the import while one is running, and skips the path when there is none", () => {
        const items = buildSessionMenuItems({ ...base, projectPath: null }, { ...handlers(), busy: true });
        expect(items.find(i => i.id === "import")).toMatchObject({
            disabled: true,
            disabledReason: "An import is already running.",
        });
        expect(items.find(i => i.id === "copy-path")).toBeUndefined();
    });
});
