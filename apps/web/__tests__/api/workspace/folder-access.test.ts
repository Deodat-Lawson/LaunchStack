jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));

import { category } from "@launchstack/store/schema";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { GET, PUT } from "~/app/api/workspace/folders/[categoryId]/access/route";
import {
    folderGrants,
    folderSettings,
    userCompanyMemberships,
    workspaceAuditEvents,
} from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest, params } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;

const FINANCE = { id: 3, name: "Finance" };

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
});

describe("PUT /api/workspace/folders/[categoryId]/access", () => {
    it("diffs the grant set into the right audit actions and writes", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner", userPk: 7n })));
        fakeDb.onSelect(category, [FINANCE]);
        fakeDb.onSelect(folderSettings, []);
        fakeDb.onSelect(folderGrants, [
            { id: 1, principalType: "user", principalId: "8", level: "view" },
            { id: 2, principalType: "group", principalId: "2", level: "edit" },
        ]);
        fakeDb.onSelect(userCompanyMemberships, [{ userId: 8n, role: "member", status: "active" }]);

        const res = await PUT(
            jsonRequest("/api/workspace/folders/3/access", "PUT", {
                visibility: "restricted",
                grants: [
                    { principalType: "user", principalId: "8", level: "edit" },
                    { principalType: "role", principalId: "Member", level: "view" },
                ],
            }),
            params({ categoryId: "3" })
        );

        expect(res.status).toBe(200);
        expect(fakeDb.insertedInto(workspaceAuditEvents).map(e => e.action)).toEqual([
            "folder.visibility_changed",
            "folder.grant_added",
            "folder.grant_changed",
            "folder.grant_removed",
        ]);
        expect(fakeDb.insertedInto(folderSettings)).toEqual([
            expect.objectContaining({ categoryId: 3n, visibility: "restricted" }),
        ]);
        expect(fakeDb.insertedInto(folderGrants)).toEqual([
            expect.objectContaining({
                principalType: "role",
                principalId: "member",
                level: "view",
            }),
        ]);
        expect(fakeDb.updatesOf(folderGrants)).toEqual([{ level: "edit" }]);
        expect(fakeDb.deletesOf(folderGrants)).toBe(1);
        await expect(res.json()).resolves.toMatchObject({ folder: FINANCE });
    });

    it("rejects a principal that is not an active member", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
        fakeDb.onSelect(category, [FINANCE]);
        fakeDb.onSelect(userCompanyMemberships, []);

        const res = await PUT(
            jsonRequest("/api/workspace/folders/3/access", "PUT", {
                visibility: "restricted",
                grants: [{ principalType: "user", principalId: "99", level: "view" }],
            }),
            params({ categoryId: "3" })
        );

        expect(res.status).toBe(400);
        expect(fakeDb.inserts).toHaveLength(0);
    });

    it("answers 403 for a member without folders.manage or a manage grant", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "member", userPk: 7n })));
        fakeDb.onSelect(category, [FINANCE]);
        fakeDb.onSelect(folderGrants, [
            { id: 1, principalType: "user", principalId: "7", level: "edit" },
        ]);

        const res = await PUT(
            jsonRequest("/api/workspace/folders/3/access", "PUT", {
                visibility: "workspace",
                grants: [],
            }),
            params({ categoryId: "3" })
        );

        expect(res.status).toBe(403);
    });

    it("stops a grant-managed member from removing their own manage access", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "member", userPk: 7n })));
        fakeDb.onSelect(category, [FINANCE]);
        fakeDb.onSelect(folderGrants, [
            { id: 1, principalType: "user", principalId: "7", level: "manage" },
        ]);
        fakeDb.onSelect(userCompanyMemberships, [{ userId: 8n, role: "member", status: "active" }]);

        const res = await PUT(
            jsonRequest("/api/workspace/folders/3/access", "PUT", {
                visibility: "restricted",
                grants: [{ principalType: "user", principalId: "8", level: "manage" }],
            }),
            params({ categoryId: "3" })
        );

        expect(res.status).toBe(403);
        expect(fakeDb.deletes).toHaveLength(0);
    });
});

describe("GET /api/workspace/folders/[categoryId]/access", () => {
    it("answers 404 for a folder outside the caller's scope", async () => {
        gate.mockImplementation(
            gateFor(
                makeWorkspaceContext({
                    role: "member",
                    scope: {
                        kind: "only",
                        allowedCategories: ["Other"],
                        deniedDocumentIds: [],
                        allowedDocumentIds: [],
                    },
                })
            )
        );
        fakeDb.onSelect(category, [FINANCE]);

        const res = await GET(
            jsonRequest("/api/workspace/folders/3/access", "GET"),
            params({ categoryId: "3" })
        );

        expect(res.status).toBe(404);
    });

    it("counts the real audience of a restricted folder", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner", userPk: 7n })));
        fakeDb.onSelect(category, [FINANCE]);
        fakeDb.onSelect(folderSettings, [{ visibility: "restricted" }]);
        fakeDb.onSelect(folderGrants, [
            { id: 1, principalType: "user", principalId: "8", level: "view" },
        ]);
        fakeDb.onSelect(userCompanyMemberships, [
            { userId: 7n, role: "owner", status: "active" },
            { userId: 8n, role: "member", status: "active" },
            { userId: 9n, role: "guest", status: "active" },
            { userId: 10n, role: "viewer", status: "active" },
        ]);

        const res = await GET(
            jsonRequest("/api/workspace/folders/3/access", "GET"),
            params({ categoryId: "3" })
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            visibility: string;
            audienceCount: number;
            canManage: boolean;
            grants: { principalName: string; level: string }[];
        };
        // The owner (folders.manage) and the granted member; not the guest or the viewer.
        expect(body).toMatchObject({ visibility: "restricted", audienceCount: 2, canManage: true });
        expect(body.grants).toEqual([
            {
                id: 1,
                principalType: "user",
                principalId: "8",
                principalName: "Former member",
                level: "view",
            },
        ]);
    });
});
