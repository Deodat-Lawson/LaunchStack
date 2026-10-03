/**
 * ADR-014's access rules as pure functions: who may see, edit and manage a
 * folder or a document, and how the rail should label it. No database — the
 * loaders are thin, and every decision lives in these functions.
 */

import { builtinRolePermissions, type Permission } from "~/lib/authz/permissions";
import {
    audienceOf,
    canDeleteAtLevel,
    countAudience,
    documentAccessFrom,
    folderAccessFrom,
    type AccessSubject,
    type FolderFact,
    type GrantFact,
} from "~/server/workspace/item-access";

function subject(role: string, userPk = "7", groups: string[] = []): AccessSubject {
    return {
        userPk,
        role,
        groupIds: new Set(groups),
        permissions: builtinRolePermissions(role) ?? new Set<Permission>(),
    };
}

const user = (id: string, level = "manage"): GrantFact => ({
    principalType: "user",
    principalId: id,
    level,
});

/** Lineage deepest first, as `loadFolderLineage` returns it. */
function lineage(...folders: Partial<FolderFact>[]): FolderFact[] {
    return folders.map((f, i) => ({
        path: f.path ?? `F${i}`,
        categoryId: f.categoryId ?? i + 1,
        restricted: f.restricted ?? false,
        grants: f.grants ?? [],
    }));
}

describe("folderAccessFrom — workspace-wide folders", () => {
    const open = lineage({ path: "Sales" });

    it("gives members edit, viewers view, admins manage, by role", () => {
        expect(folderAccessFrom(open, subject("member")).level).toBe("edit");
        expect(folderAccessFrom(open, subject("viewer")).level).toBe("view");
        expect(folderAccessFrom(open, subject("admin")).level).toBe("manage");
        expect(folderAccessFrom(open, subject("member")).audience).toBe("workspace");
    });

    it("keeps guests out of anything not granted to them", () => {
        expect(folderAccessFrom(open, subject("guest")).visible).toBe(false);
    });

    it("lets a grant raise a member to manage (the creator of a subfolder)", () => {
        const withGrant = lineage({ path: "Sales/Leads", grants: [user("7")] }, { path: "Sales" });
        expect(folderAccessFrom(withGrant, subject("member")).level).toBe("manage");
    });
});

describe("folderAccessFrom — private and shared folders", () => {
    const privateToSeven = lineage({ path: "Plans", restricted: true, grants: [user("7")] });

    it("shows a private folder only to its owner, as private", () => {
        const owner = folderAccessFrom(privateToSeven, subject("member", "7"));
        expect(owner).toMatchObject({
            visible: true,
            level: "manage",
            audience: "private",
            ownAudience: true,
        });
        expect(folderAccessFrom(privateToSeven, subject("member", "8")).visible).toBe(false);
    });

    it("gives Owners and Admins no way past a restriction (private means private)", () => {
        expect(folderAccessFrom(privateToSeven, subject("owner", "1")).visible).toBe(false);
        expect(folderAccessFrom(privateToSeven, subject("admin", "2")).visible).toBe(false);
    });

    it("labels a folder shared with someone else as shared", () => {
        const shared = lineage({
            path: "Plans",
            restricted: true,
            grants: [user("7"), user("8", "view")],
        });
        expect(folderAccessFrom(shared, subject("member", "7")).audience).toBe("shared");
        expect(folderAccessFrom(shared, subject("member", "8"))).toMatchObject({
            visible: true,
            level: "view",
            audience: "shared",
        });
    });

    it("lets a subfolder inherit its parent's restriction", () => {
        const child = lineage(
            { path: "Plans/Q3" },
            { path: "Plans", restricted: true, grants: [user("7")] }
        );
        expect(folderAccessFrom(child, subject("member", "7"))).toMatchObject({
            visible: true,
            audience: "private",
            ownAudience: false,
            governingPath: "Plans",
        });
        expect(folderAccessFrom(child, subject("member", "8")).visible).toBe(false);
    });

    it("lets the nearest restricted folder decide (a granted child in a closed parent)", () => {
        const child = lineage(
            { path: "Board/Shared", restricted: true, grants: [user("8", "view")] },
            { path: "Board", restricted: true, grants: [user("7")] }
        );
        expect(folderAccessFrom(child, subject("member", "8")).visible).toBe(true);
        // The parent's owner is not on the child's list.
        expect(folderAccessFrom(child, subject("member", "7")).visible).toBe(false);
    });

    it("never turns a view grant into edit", () => {
        const viewOnly = lineage({ path: "Plans", restricted: true, grants: [user("8", "view")] });
        expect(folderAccessFrom(viewOnly, subject("admin", "8")).level).toBe("view");
    });

    it("reaches people through their groups and their role", () => {
        const viaGroup = lineage({
            path: "Finance",
            restricted: true,
            grants: [{ principalType: "group", principalId: "3", level: "edit" }],
        });
        expect(folderAccessFrom(viaGroup, subject("member", "9", ["3"])).level).toBe("edit");
        expect(folderAccessFrom(viaGroup, subject("member", "9", ["4"])).visible).toBe(false);

        const viaRole = lineage({
            path: "Finance",
            restricted: true,
            grants: [{ principalType: "role", principalId: "admin", level: "manage" }],
        });
        expect(folderAccessFrom(viaRole, subject("admin", "2")).level).toBe("manage");
        expect(folderAccessFrom(viaRole, subject("member", "2")).visible).toBe(false);
    });
});

describe("documentAccessFrom", () => {
    const openFolder = folderAccessFrom(lineage({ path: "Sales" }), subject("member", "8"));

    it("lets a restricted document's own grants decide, folder aside", () => {
        const mine = { restricted: true, grants: [user("7")] };
        expect(documentAccessFrom(mine, openFolder, subject("member", "8")).visible).toBe(false);
        expect(
            documentAccessFrom(
                mine,
                folderAccessFrom(lineage({ path: "Sales" }), subject("member", "7")),
                subject("member", "7")
            )
        ).toMatchObject({ visible: true, audience: "private", ownAudience: true });
    });

    it("follows the folder when unrestricted, and a grant can raise the level", () => {
        const plain = { restricted: false, grants: [] };
        expect(documentAccessFrom(plain, openFolder, subject("member", "8")).level).toBe("edit");

        const viewer = subject("viewer", "8");
        const viewerFolder = folderAccessFrom(lineage({ path: "Sales" }), viewer);
        expect(documentAccessFrom(plain, viewerFolder, viewer).level).toBe("view");
        expect(
            documentAccessFrom(
                { restricted: false, grants: [user("8", "edit")] },
                viewerFolder,
                viewer
            ).level
        ).toBe("edit");
    });

    it("opens a file to someone added to it, even inside a folder that keeps them out", () => {
        const closed = folderAccessFrom(
            lineage({ path: "Board", restricted: true, grants: [user("7")] }),
            subject("member", "8")
        );
        // "Same as Board", plus Ben: Ben opens this one file, at the level given.
        expect(
            documentAccessFrom(
                { restricted: false, grants: [user("8", "view")] },
                closed,
                subject("member", "8")
            )
        ).toMatchObject({ visible: true, level: "view" });
        expect(
            documentAccessFrom({ restricted: false, grants: [] }, closed, subject("member", "8"))
                .visible
        ).toBe(false);
    });
});

describe("audienceOf", () => {
    it("is private only when the caller is the one principal", () => {
        const me = subject("member", "7");
        expect(audienceOf(false, [], me)).toBe("workspace");
        expect(audienceOf(true, [user("7")], me)).toBe("private");
        expect(audienceOf(true, [user("8")], me)).toBe("shared");
        expect(
            audienceOf(
                true,
                [user("7"), { principalType: "role", principalId: "admin", level: "manage" }],
                me
            )
        ).toBe("shared");
    });
});

describe("canDeleteAtLevel", () => {
    it("lets whoever manages a file delete it, and an editor only with documents.delete", () => {
        const member = builtinRolePermissions("member") ?? new Set<Permission>();
        const admin = builtinRolePermissions("admin") ?? new Set<Permission>();
        expect(canDeleteAtLevel("manage", member)).toBe(true);
        expect(canDeleteAtLevel("edit", member)).toBe(false);
        expect(canDeleteAtLevel("edit", admin)).toBe(true);
        expect(canDeleteAtLevel("view", admin)).toBe(false);
        expect(canDeleteAtLevel(null, admin)).toBe(false);
    });
});

describe("countAudience", () => {
    const member = (userId: string, role = "member", groups: string[] = []) => ({
        userId,
        role,
        groupIds: new Set(groups),
        permissions: builtinRolePermissions(role) ?? new Set<Permission>(),
    });
    const team = [member("7"), member("8"), member("9", "admin"), member("10", "guest")];

    it("counts an inheriting subfolder by its parent's list, plus anyone added to it", () => {
        const child = lineage(
            { path: "Q4/Pricing", grants: [user("8", "view")] },
            { path: "Q4", restricted: true, grants: [user("7")] }
        );
        // Ada (7) through the parent, Ben (8) added here; not the admin, not the guest.
        expect(countAudience(team, child)).toBe(2);
    });

    it("counts a file inside a private folder as private, not workspace-wide", () => {
        const inside = lineage(
            { path: "Q4/Pricing" },
            { path: "Q4", restricted: true, grants: [user("7")] }
        );
        expect(countAudience(team, inside, { restricted: false, grants: [] })).toBe(1);
    });
});
