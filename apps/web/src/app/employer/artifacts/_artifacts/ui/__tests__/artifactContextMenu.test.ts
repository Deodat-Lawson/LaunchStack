import { buildArtifactMenuItems, buildTrashedArtifactMenuItems } from "../artifactContextMenu";
import type { ArtifactSummary } from "../../lib/api";

const artifact: ArtifactSummary = {
    id: 3,
    title: "Pricing page",
    description: null,
    folder: "Marketing",
    artifactType: "html",
    sourceUrl: "https://claude.ai/public/artifacts/abc",
    importMethod: "paste",
    sizeBytes: 1200,
    contentHash: "x",
    starred: false,
    createdByUserId: "u1",
    updatedByUserId: null,
    deletedAt: null,
    openedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
};

function handlers() {
    return {
        onOpen: jest.fn(),
        onOpenInNewTab: jest.fn(),
        onToggleStar: jest.fn(),
        onDownload: jest.fn(),
        onCopyLink: jest.fn(),
        onCopySource: jest.fn(),
        onOpenOriginal: jest.fn(),
        folders: ["Marketing", "Engineering"],
        onMoveToFolder: jest.fn(),
        onTrash: jest.fn(),
    };
}

describe("artifact menu builders", () => {
    it("lists every verb for an active artifact, current folder checked, trash last", () => {
        const h = handlers();
        const items = buildArtifactMenuItems(artifact, h);
        expect(items.map(i => i.id)).toEqual([
            "title",
            "open",
            "open-tab",
            "star",
            "sep-share",
            "download",
            "copy-link",
            "copy-source",
            "open-original",
            "move",
            "sep-danger",
            "trash",
        ]);
        expect(items.find(i => i.id === "star")).toMatchObject({ label: "Star", checked: false });
        const move = items.find(i => i.id === "move");
        expect(move?.type === "submenu" ? move.items.map(i => i.id) : []).toEqual([
            "move-Engineering",
            "move-Marketing",
        ]);
        expect(move?.type === "submenu" ? move.items[1] : null).toMatchObject({
            checked: true,
            disabled: true,
        });
        const eng = move?.type === "submenu" ? move.items[0] : null;
        if (eng?.type === "item") eng.onSelect();
        expect(h.onMoveToFolder).toHaveBeenCalledWith("Engineering");
    });

    it("drops the verbs that do not apply: no open in the viewer, no original without a url", () => {
        const h = { ...handlers(), onOpen: undefined, onCopySource: undefined };
        const items = buildArtifactMenuItems({ ...artifact, sourceUrl: null, starred: true }, h);
        expect(items.find(i => i.id === "open")).toBeUndefined();
        expect(items.find(i => i.id === "copy-source")).toBeUndefined();
        expect(items.find(i => i.id === "open-original")).toBeUndefined();
        expect(items.find(i => i.id === "star")).toMatchObject({ label: "Unstar", checked: true });
    });

    it("offers the trash only restore and a permanent delete", () => {
        const onRestore = jest.fn();
        const onPurge = jest.fn();
        const items = buildTrashedArtifactMenuItems(artifact, { onRestore, onPurge });
        expect(items.map(i => i.id)).toEqual(["title", "restore", "sep-danger", "purge"]);
        expect(items.find(i => i.id === "purge")).toMatchObject({ danger: true });
    });
});
