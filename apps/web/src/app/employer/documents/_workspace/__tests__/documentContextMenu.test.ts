import { buildDocumentMenuItems, buildVersionMenuItems } from "../documentContextMenu";
import type { WorkspaceSource } from "../types";

const doc: WorkspaceSource = {
    id: "d1",
    documentId: 1,
    title: "Vendor MSA",
    type: "doc",
    size: "",
    added: "",
    folder: "Legal",
    tags: [],
    domain: "General",
};

const handlers = () => ({
    onAskAbout: jest.fn(),
    onRename: jest.fn(),
    onOpenInNewTab: jest.fn(),
    onDownload: jest.fn(),
    onCopyLink: jest.fn(),
    onShowVersions: jest.fn(),
    onShowNotes: jest.fn(),
    onRestrictAccess: jest.fn(),
    onDelete: jest.fn(),
});

describe("document menu builders", () => {
    it("offers a persisted document every verb, danger last", () => {
        const h = handlers();
        const items = buildDocumentMenuItems(
            doc,
            { isMindmap: false, askable: true, persisted: true, originalUrl: "https://x/y.pdf" },
            h
        );
        expect(items.map(i => i.id)).toEqual([
            "title",
            "ask",
            "rename",
            "open-tab",
            "download",
            "copy-link",
            "sep-panels",
            "versions",
            "notes",
            "access",
            "sep-danger",
            "delete",
        ]);
        expect(items.find(i => i.id === "delete")).toMatchObject({
            danger: true,
            label: "Delete…",
        });
        expect(items.find(i => i.id === "access")).toMatchObject({ label: "Restrict access…" });
    });

    it("holds back what an indexing source cannot do yet, and what a mindmap has no file for", () => {
        const items = buildDocumentMenuItems(
            { ...doc, documentId: undefined },
            { isMindmap: false, askable: true, persisted: false, originalUrl: null },
            handlers()
        );
        expect(items.find(i => i.id === "rename")).toMatchObject({
            disabled: true,
            disabledReason: "This source is still being indexed.",
        });
        expect(items.find(i => i.id === "download")).toMatchObject({ disabled: true });

        const map = buildDocumentMenuItems(
            { ...doc, type: "mindmap", citability: "none" },
            { isMindmap: true, askable: false, persisted: true, originalUrl: null },
            handlers()
        );
        expect(map.find(i => i.id === "open-tab")).toBeUndefined();
        expect(map.find(i => i.id === "download")).toBeUndefined();
        expect(map.find(i => i.id === "ask")).toMatchObject({ disabled: true });
        expect(map.find(i => i.id === "versions")).toMatchObject({ label: "Revision history" });
        expect(map.find(i => i.id === "delete")).toMatchObject({ label: "Move to trash…" });
    });

    it("lets an old version be previewed, downloaded and restored, but not the current one", () => {
        const h = { onPreview: jest.fn(), onRestore: jest.fn(), onDownload: jest.fn() };
        const old = buildVersionMenuItems(
            { versionNumber: 2, isCurrent: false },
            { reverting: false },
            h
        );
        expect(old[0]).toMatchObject({ label: "v2" });
        expect(old.find(i => i.id === "restore")).toMatchObject({ disabled: false });
        const current = buildVersionMenuItems(
            { versionNumber: 3, isCurrent: true },
            { reverting: false },
            h
        );
        expect(current[0]).toMatchObject({ label: "v3 (current)" });
        expect(current.find(i => i.id === "preview")).toMatchObject({ disabled: true });
        expect(current.find(i => i.id === "restore")).toMatchObject({ disabled: true });
    });
});
