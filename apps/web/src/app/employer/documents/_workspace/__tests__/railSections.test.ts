import { buildFolderTree } from "~/lib/folders/path";

import {
    audienceLabel,
    moveOutcomeMessage,
    showsAudienceGlyph,
    sourceAudience,
    splitRailSections,
} from "../railSections";
import type { ItemAccessView, SourceAudience, WorkspaceSource } from "../types";

/**
 * ADR-014 §6: the rail answers "who can see this" by where a thing sits.
 * Top-level folders go to the section of their audience with their whole
 * subtree; loose files go one by one; old workspace-wide loose files stay
 * together under Workspace › Unfiled.
 */

const access = (audience: SourceAudience, extra: Partial<ItemAccessView> = {}): ItemAccessView => ({
    audience,
    ownAudience: audience !== "workspace",
    principalCount: audience === "private" ? 1 : audience === "shared" ? 3 : 0,
    canEdit: true,
    canManage: true,
    ...extra,
});

function src(
    id: string,
    folder: string,
    overrides: Partial<WorkspaceSource> = {}
): WorkspaceSource {
    return {
        id,
        documentId: Number(id.slice(1)),
        title: `${id}.pdf`,
        type: "doc",
        size: "",
        added: "",
        folder,
        tags: [],
        domain: "General",
        ...overrides,
    };
}

const FOLDER_AUDIENCE: Record<string, SourceAudience> = {
    Sales: "workspace",
    "Sales/Leads": "workspace",
    Mine: "private",
    Board: "shared",
};

function split(sources: WorkspaceSource[], folderPaths: string[]) {
    const tree = buildFolderTree(folderPaths, sources, s => s.folder);
    return splitRailSections(tree, path => FOLDER_AUDIENCE[path]);
}

describe("splitRailSections", () => {
    const sources = [
        src("d1", "Sales", { access: access("workspace") }),
        src("d2", "Sales/Leads", { access: access("workspace") }),
        src("d3", "Mine", { access: access("private", { ownAudience: false }) }),
        src("d4", "Board", { access: access("shared", { ownAudience: false }) }),
        src("d5", "Unfiled", { access: access("private") }),
        src("d6", "Unfiled", { access: access("shared") }),
        src("d7", "Unfiled", { access: access("workspace") }),
    ];
    const sections = split(sources, ["Sales", "Sales/Leads", "Mine", "Board", "Unfiled"]);

    it("files each top-level folder, subtree and all, under its audience", () => {
        expect(sections.workspace.folders.map(f => f.path)).toEqual(["Sales", "Unfiled"]);
        expect(sections.shared.folders.map(f => f.path)).toEqual(["Board"]);
        expect(sections.private.folders.map(f => f.path)).toEqual(["Mine"]);
        expect(sections.workspace.folders[0]!.children.map(c => c.path)).toEqual(["Sales/Leads"]);
    });

    it("files loose files one by one, keeping old workspace-wide ones under Unfiled", () => {
        expect(sections.private.items.map(s => s.id)).toEqual(["d5"]);
        expect(sections.shared.items.map(s => s.id)).toEqual(["d6"]);
        const unfiled = sections.workspace.folders.find(f => f.path === "Unfiled")!;
        expect(unfiled.items.map(s => s.id)).toEqual(["d7"]);
        expect(unfiled.totalItems).toBe(1);
    });

    it("counts every source a section holds, nested ones included", () => {
        expect(sections.workspace.count).toBe(3);
        expect(sections.shared.count).toBe(2);
        expect(sections.private.count).toBe(2);
    });

    it("drops an Unfiled with nothing everyone can see", () => {
        const only = split([src("d5", "Unfiled", { access: access("private") })], ["Unfiled"]);
        expect(only.workspace.folders).toEqual([]);
        expect(only.private.items.map(s => s.id)).toEqual(["d5"]);
    });

    it("files a folder the server did not describe where what is inside it goes", () => {
        // Finance is restricted and not shared with the caller; Finance/Q3 is.
        const tree = buildFolderTree(
            ["Finance/Q3"],
            [src("d8", "Finance/Q3", { access: access("shared", { ownAudience: false }) })],
            s => s.folder
        );
        const out = splitRailSections(tree, path => (path === "Finance/Q3" ? "shared" : undefined));
        expect(out.shared.folders.map(f => f.path)).toEqual(["Finance"]);
    });

    it("puts a staged upload in Private, where a new file lands", () => {
        expect(sourceAudience(src("s1", "Unfiled", { pending: true }))).toBe("private");
        expect(sourceAudience(src("d9", "Unfiled", { restricted: true }))).toBe("shared");
        expect(sourceAudience(src("d10", "Unfiled"))).toBe("workspace");
    });
});

describe("audienceLabel", () => {
    it("says who, in the words the rail and its tooltips use", () => {
        expect(audienceLabel(access("private"), "Acme")).toBe("Only you");
        expect(audienceLabel(access("shared"), "Acme")).toBe("Shared with 3");
        expect(audienceLabel(access("workspace"), "Acme")).toBe("Everyone at Acme");
        expect(audienceLabel(access("workspace"), null)).toBe("Everyone in the workspace");
        expect(audienceLabel(access("shared", { principalCount: 0 }), null)).toBe(
            "Shared with specific people"
        );
    });
});

describe("showsAudienceGlyph", () => {
    it("marks top-level rows and rows unlike their parent, never workspace-wide ones", () => {
        expect(showsAudienceGlyph(access("private"), true)).toBe(true);
        expect(showsAudienceGlyph(access("shared", { ownAudience: false }), false)).toBe(false);
        expect(showsAudienceGlyph(access("shared", { ownAudience: true }), false)).toBe(true);
        expect(showsAudienceGlyph(access("workspace"), true)).toBe(false);
        expect(showsAudienceGlyph(undefined, true)).toBe(false);
    });
});

describe("moveOutcomeMessage", () => {
    it("says what a move did to who can see the file", () => {
        expect(moveOutcomeMessage("inherits_folder", "Sales")).toBe(
            "Now visible to everyone who can open Sales"
        );
        expect(moveOutcomeMessage("made_private", "Unfiled")).toBe("Now private to you");
        expect(moveOutcomeMessage("unchanged", "Sales")).toBeNull();
        expect(moveOutcomeMessage(undefined, "Sales")).toBeNull();
    });
});
