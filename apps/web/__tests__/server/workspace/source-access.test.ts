/**
 * The rail's Workspace / Shared / Private sections, worked out for a whole
 * list from one read of the facts (ADR-014 §6). Pure: the same rules as the
 * per-item checks (`folderAccessFrom`, `documentAccessFrom`), so a label can
 * never promise what a write path then refuses.
 */

import { builtinRolePermissions, type Permission } from "~/lib/authz/permissions";
import type { AccessSubject, GrantFact } from "~/server/workspace/item-access";
import {
    accessViewOf,
    classifyDocuments,
    classifyFolders,
    lineageFrom,
    type DocumentAccessFacts,
    type FolderAccessFacts,
} from "~/server/workspace/source-access";

function subject(role: string, userPk = "7", groups: string[] = []): AccessSubject {
    return {
        userPk,
        role,
        groupIds: new Set(groups),
        permissions: builtinRolePermissions(role) ?? new Set<Permission>(),
    };
}

const grant = (type: string, id: string, level = "view"): GrantFact => ({
    principalType: type,
    principalId: id,
    level,
});

/**
 * Sales           workspace-wide
 * Sales/Leads     a subfolder Ada (7) made: inherits, she manages it
 * Mine            private to Ada
 * Mine/Drafts     inherits Mine
 * Board           restricted: Ada can view, the Finance group can edit
 * Board/Minutes   restricted on its own, to Bob (9) only
 */
const FOLDERS: FolderAccessFacts = {
    idByPath: new Map([
        ["Sales", 1],
        ["Sales/Leads", 2],
        ["Mine", 3],
        ["Mine/Drafts", 4],
        ["Board", 5],
        ["Board/Minutes", 6],
    ]),
    restrictedIds: new Set([3, 5, 6]),
    grantsByFolder: new Map([
        [2, [grant("user", "7", "manage")]],
        [3, [grant("user", "7", "manage")]],
        [5, [grant("user", "7", "view"), grant("group", "g-fin", "edit")]],
        [6, [grant("user", "9", "manage")]],
    ]),
};

describe("lineageFrom", () => {
    it("reads a folder and its ancestors deepest first, like loadFolderLineage", () => {
        expect(lineageFrom("Mine/Drafts", FOLDERS).map(f => [f.path, f.restricted])).toEqual([
            ["Mine/Drafts", false],
            ["Mine", true],
        ]);
    });

    it("treats a folder with no row (only implied by its files) as unrestricted", () => {
        expect(lineageFrom("Imported/2026", FOLDERS)).toEqual([
            { path: "Imported/2026", categoryId: null, restricted: false, grants: [] },
            { path: "Imported", categoryId: null, restricted: false, grants: [] },
        ]);
    });
});

describe("classifyFolders — the caller's view of every folder at once", () => {
    const ada = subject("member", "7");
    const views = new Map(
        [...classifyFolders(FOLDERS.idByPath.keys(), FOLDERS, ada)].map(([path, access]) => [
            path,
            accessViewOf(access),
        ])
    );

    it("puts a workspace-wide folder under Workspace, editable by a member", () => {
        expect(views.get("Sales")).toEqual({
            audience: "workspace",
            ownAudience: false,
            governingPath: null,
            principalCount: 0,
            canEdit: true,
            canManage: false,
        });
    });

    it("lets the creator of a workspace subfolder manage it", () => {
        expect(views.get("Sales/Leads")).toMatchObject({
            audience: "workspace",
            canEdit: true,
            canManage: true,
        });
    });

    it("puts a folder only Ada can see under Private, and its child with it", () => {
        expect(views.get("Mine")).toMatchObject({
            audience: "private",
            ownAudience: true,
            governingPath: "Mine",
            canManage: true,
        });
        expect(views.get("Mine/Drafts")).toMatchObject({
            audience: "private",
            ownAudience: false,
            governingPath: "Mine",
        });
    });

    it("puts a folder shared with Ada under Shared, at the level she was given", () => {
        expect(views.get("Board")).toMatchObject({
            audience: "shared",
            ownAudience: true,
            principalCount: 2,
            canEdit: false,
            canManage: false,
        });
    });

    it("lets a group grant raise a member to edit", () => {
        const fin = accessViewOf(
            classifyFolders(["Board"], FOLDERS, subject("member", "8", ["g-fin"])).get("Board")!
        );
        expect(fin).toMatchObject({ audience: "shared", canEdit: true });
    });

    it("gives an Admin nothing past a restriction (no bypass)", () => {
        const admin = classifyFolders(["Mine"], FOLDERS, subject("admin", "1")).get("Mine")!;
        expect(admin.visible).toBe(false);
        expect(accessViewOf(admin)).toMatchObject({ canEdit: false, canManage: false });
    });

    it("answers a nested restriction from the nearest one, not the parent's", () => {
        const bob = classifyFolders(["Board/Minutes"], FOLDERS, subject("member", "9"));
        expect(accessViewOf(bob.get("Board/Minutes")!)).toMatchObject({
            audience: "private",
            ownAudience: true,
            governingPath: "Board/Minutes",
            canManage: true,
        });
    });
});

describe("classifyDocuments — loose files and filed ones", () => {
    const DOCS: DocumentAccessFacts = {
        restrictedIds: new Set([10, 11]),
        grantsByDocument: new Map([
            // Ada's new loose file: private to her.
            [10, [grant("user", "7", "manage")]],
            // A loose file Ada shared with Bob.
            [11, [grant("user", "7", "manage"), grant("user", "9", "view")]],
            // A file in Sales Ada uploaded: inherits, with her manage grant.
            [12, [grant("user", "7", "manage")]],
        ]),
    };
    const docs = [
        { id: 10, category: "Unfiled" },
        { id: 11, category: null },
        { id: 12, category: "Sales" },
        { id: 13, category: "Unfiled" },
        { id: 14, category: "Mine/Drafts" },
    ];

    it("sorts each file into its section from the caller's point of view", () => {
        const ada = classifyDocuments(docs, DOCS, FOLDERS, subject("member", "7"));
        const audience = (id: number) => ada.get(id)?.audience;
        expect(audience(10)).toBe("private");
        expect(audience(11)).toBe("shared");
        expect(audience(12)).toBe("workspace");
        // A legacy loose file, from before private-by-default: still everyone's.
        expect(audience(13)).toBe("workspace");
        expect(audience(14)).toBe("private");
    });

    it("says which files set their own audience and which inherit", () => {
        const ada = classifyDocuments(docs, DOCS, FOLDERS, subject("member", "7"));
        expect(ada.get(10)?.ownAudience).toBe(true);
        expect(ada.get(12)?.ownAudience).toBe(false);
        expect(ada.get(14)).toMatchObject({ ownAudience: false, governingPath: "Mine" });
    });

    it("gives a file grant's level on top of the folder's, never visibility on its own", () => {
        const ada = classifyDocuments(docs, DOCS, FOLDERS, subject("member", "7"));
        expect(accessViewOf(ada.get(12)!)).toMatchObject({ canEdit: true, canManage: true });
    });

    it("shows Bob a file shared with him as Shared and view-only", () => {
        const bob = classifyDocuments(docs, DOCS, FOLDERS, subject("member", "9"));
        expect(accessViewOf(bob.get(11)!)).toMatchObject({
            audience: "shared",
            canEdit: false,
            canManage: false,
        });
        expect(bob.get(10)?.visible).toBe(false);
    });
});
