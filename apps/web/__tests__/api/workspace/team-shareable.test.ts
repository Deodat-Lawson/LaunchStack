/**
 * GET /api/workspace/team/shareable — what the "Share something…" picker
 * offers: folders the caller manages (same rule as the Share dialog), files a
 * manage grant hands them, and their own chats.
 */

jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));

import { category } from "@launchstack/store/schema";
import { GET } from "~/app/api/workspace/team/shareable/route";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { DocumentScope } from "~/lib/authz/scope-types";
import {
    documentGrants,
    folderGrants,
    folderSettings,
    workspaceGroupMembers,
    workspaceSessions,
} from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;

function as(role: string, scope?: DocumentScope) {
    gate.mockImplementation(
        gateFor(makeWorkspaceContext({ role, authUserId: "user-a", userPk: 7n, scope }))
    );
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    fakeDb.onSelect(workspaceGroupMembers, [{ groupId: 3n }]);
    fakeDb.onSelect(category, [
        { id: 1, name: "Private" },
        { id: 2, name: "Private/Notes" },
        { id: 3, name: "Open" },
        { id: 4, name: "Team" },
        { id: 5, name: "Unfiled" },
    ]);
    fakeDb.onSelect(folderSettings, [{ categoryId: 1 }, { categoryId: 4 }]);
    fakeDb.onSelect(folderGrants, [
        { categoryId: 1, principalType: "user", principalId: "7", level: "manage" },
        { categoryId: 4, principalType: "group", principalId: "3", level: "view" },
    ]);
    fakeDb.onSelect(documentGrants, [
        { id: 42, title: "Mine.pdf", category: "Open" },
        { id: 43, title: "Hidden.pdf", category: "Secret" },
    ]);
    fakeDb.onSelect(workspaceSessions, [{ id: "s1", title: "Pricing" }]);
});

describe("GET /api/workspace/team/shareable", () => {
    it("offers what a Member manages: their private folder and its subfolder, their files, their chats", async () => {
        as("member", {
            kind: "except",
            deniedCategories: ["Secret"],
            deniedDocumentIds: [],
            allowedDocumentIds: [],
        });

        const res = await GET();

        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: { type: string; name: string }[] };
        expect(body.items.map(i => `${i.type}:${i.name}`)).toEqual([
            "folder:Private",
            "folder:Private/Notes",
            "document:Mine.pdf",
            "chat:Pricing",
        ]);
    });

    it("lets folders.manage manage workspace-wide folders but not someone else's private one", async () => {
        as("admin");

        const body = (await (await GET()).json()) as { items: { type: string; name: string }[] };

        expect(body.items.filter(i => i.type === "folder").map(i => i.name)).toEqual([
            "Open",
            "Private",
            "Private/Notes",
        ]);
    });
});
