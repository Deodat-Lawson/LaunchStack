/**
 * The pure halves of draft access (ADR-014, `~/server/mindmap/access`): who
 * sees a draft, what level they hold, and when a move would show it to
 * someone new. The routes run against Postgres in
 * `__tests__/api/mindmaps-access.integration.test.ts`.
 */

jest.mock("~/server/db", () => ({ db: {} }));

import { PgDialect } from "drizzle-orm/pg-core";

import { builtinRolePermissions } from "~/lib/authz/permissions";
import { SCOPE_EVERYTHING, type DocumentScope } from "~/lib/authz/scope-types";
import {
    draftAccessFrom,
    draftAudienceIds,
    draftVisibilityWhere,
    draftVisibleTo,
    moveWidensDraft,
} from "~/server/mindmap/access";
import type { AudienceMember, FolderFact, ItemAccess } from "~/server/workspace/item-access";

const FINANCE_DENIED: DocumentScope = {
    kind: "except",
    deniedCategories: ["Finance"],
    allowedCategories: ["Finance/Shared"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

const GUEST_ONLY_SALES: DocumentScope = {
    kind: "only",
    allowedCategories: ["Sales"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

describe("draftVisibleTo", () => {
    const reader = (scope: DocumentScope) => ({ authUserId: "bea", scope });

    it("keeps an Unfiled draft to whoever made it, whatever their scope", () => {
        const loose = { folder: "Unfiled", createdByUserId: "ada" };
        expect(draftVisibleTo(reader(SCOPE_EVERYTHING), loose)).toBe(false);
        expect(draftVisibleTo({ authUserId: "ada", scope: SCOPE_EVERYTHING }, loose)).toBe(true);
    });

    it("follows the folder's scope, nearest restriction first", () => {
        const at = (folder: string) => ({ folder, createdByUserId: "ada" });
        expect(draftVisibleTo(reader(FINANCE_DENIED), at("Finance"))).toBe(false);
        expect(draftVisibleTo(reader(FINANCE_DENIED), at("Finance/Q3"))).toBe(false);
        expect(draftVisibleTo(reader(FINANCE_DENIED), at("Finance/Shared"))).toBe(true);
        expect(draftVisibleTo(reader(FINANCE_DENIED), at("Team"))).toBe(true);
        expect(draftVisibleTo(reader(GUEST_ONLY_SALES), at("Team"))).toBe(false);
        expect(draftVisibleTo(reader(GUEST_ONLY_SALES), at("Sales"))).toBe(true);
    });

    it("always shows its maker their own draft, even in a folder they lost", () => {
        const mine = { folder: "Finance", createdByUserId: "bea" };
        expect(draftVisibleTo(reader(FINANCE_DENIED), mine)).toBe(true);
    });
});

describe("draftAccessFrom", () => {
    const folder = (over: Partial<ItemAccess> = {}): ItemAccess => ({
        visible: true,
        level: "view",
        audience: "shared",
        governingPath: "Deals",
        ownAudience: true,
        principalCount: 3,
        ...over,
    });

    it("gives an Unfiled draft to its maker at manage and to nobody else", () => {
        const loose = { folder: "Unfiled", createdByUserId: "ada" };
        expect(draftAccessFrom(loose, folder(), "ada")).toMatchObject({
            visible: true,
            level: "manage",
            audience: "private",
        });
        expect(draftAccessFrom(loose, folder({ level: "manage" }), "bea")).toMatchObject({
            visible: false,
            level: null,
        });
    });

    it("takes the folder's audience and level, never one of its own", () => {
        const filed = { folder: "Deals", createdByUserId: "ada" };
        expect(draftAccessFrom(filed, folder(), "bea")).toMatchObject({
            visible: true,
            level: "view",
            audience: "shared",
            ownAudience: false,
        });
        expect(
            draftAccessFrom(filed, folder({ visible: false, level: null }), "bea")
        ).toMatchObject({ visible: false, level: null });
    });

    it("raises its maker to manage", () => {
        const filed = { folder: "Deals", createdByUserId: "ada" };
        expect(
            draftAccessFrom(filed, folder({ visible: false, level: null }), "ada")
        ).toMatchObject({ visible: true, level: "manage", audience: "shared" });
    });
});

describe("draftAudienceIds", () => {
    const member = (userId: string, role = "member"): AudienceMember => ({
        userId,
        role,
        groupIds: new Set(),
        permissions: builtinRolePermissions(role)!,
    });
    const people = [member("1", "owner"), member("2"), member("3"), member("4", "guest")];
    const workspaceWide: FolderFact[] = [
        { path: "Team", categoryId: 1, restricted: false, grants: [] },
    ];
    const restricted: FolderFact[] = [
        {
            path: "Deals",
            categoryId: 2,
            restricted: true,
            grants: [
                { principalType: "user", principalId: "1", level: "manage" },
                { principalType: "user", principalId: "2", level: "edit" },
            ],
        },
    ];

    it("is everyone but guests in a workspace-wide folder", () => {
        expect([...draftAudienceIds(people, workspaceWide, "1")].sort()).toEqual(["1", "2", "3"]);
    });

    it("is the people granted on a restricted folder, plus the draft's maker", () => {
        expect([...draftAudienceIds(people, restricted, "3")].sort()).toEqual(["1", "2", "3"]);
        expect([...draftAudienceIds(people, restricted, null)].sort()).toEqual(["1", "2"]);
    });

    it("is only the maker in Unfiled", () => {
        expect([...draftAudienceIds(people, null, "3")]).toEqual(["3"]);
        expect(draftAudienceIds(people, null, null).size).toBe(0);
    });
});

describe("moveWidensDraft", () => {
    const set = (...ids: string[]) => new Set(ids);

    it("allows any move that shows it to nobody new", () => {
        expect(
            moveWidensDraft(
                {
                    before: set("1", "2", "3"),
                    after: set("1", "2"),
                    beforeByFolder: set("1", "2", "3"),
                },
                "2"
            )
        ).toBe(false);
    });

    it("lets someone file a draft only they could see (Drive's rule)", () => {
        // Their own Unfiled draft: no folder let anyone in.
        expect(
            moveWidensDraft(
                { before: set("2"), after: set("1", "2", "3"), beforeByFolder: set() },
                "2"
            )
        ).toBe(false);
        // Their own private folder.
        expect(
            moveWidensDraft(
                { before: set("2"), after: set("1", "2", "3"), beforeByFolder: set("2") },
                "2"
            )
        ).toBe(false);
    });

    it("refuses to widen a draft whose folder let others in, its maker included", () => {
        // Ada made it; the folder is Ada's and Bea's. Neither may publish it by moving it.
        const shared = {
            before: set("1", "2"),
            after: set("1", "2", "3"),
            beforeByFolder: set("1", "2"),
        };
        expect(moveWidensDraft(shared, "2")).toBe(true);
        expect(moveWidensDraft(shared, "1")).toBe(true);
    });
});

describe("draftVisibilityWhere", () => {
    const render = (scope: DocumentScope) =>
        new PgDialect().sqlToQuery(
            draftVisibilityWhere({ companyId: BigInt(5), authUserId: "bea", scope })
        );

    it("lists a reader's own drafts and the filed ones their scope opens — never others' Unfiled", () => {
        const everything = render(SCOPE_EVERYTHING);
        expect(everything.sql).toContain('"created_by_user_id" = $2');
        expect(everything.sql).toContain('"folder" <> $3');
        expect(everything.params).toEqual([BigInt(5), "bea", "Unfiled"]);

        const scoped = render(FINANCE_DENIED);
        expect(scoped.sql).toContain("CASE WHEN");
        expect(scoped.params).toEqual(
            expect.arrayContaining(["Finance", "Finance/%", "Finance/Shared", "Finance/Shared/%"])
        );
    });
});
