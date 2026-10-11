/**
 * GET /api/workspace/activity — the Team tab's feed. Visibility filtering is
 * the foundation's (`listActivity`); these pin the route: its parameters
 * reach the query, bad ones are refused, and each row says whether its
 * target is still there to open.
 */

jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/recording-db").recordingDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));
jest.mock("~/server/sessions/access", () => ({
    readableSessionIds: jest.fn(async () => new Set<string>()),
}));

import { category, document } from "@launchstack/store/schema";
import { GET } from "~/app/api/workspace/activity/route";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { workspaceActivity, workspaceGroups } from "~/server/db/schema";
import { readableSessionIds } from "~/server/sessions/access";

import { fakeDb } from "../../helpers/fake-db";
import { recordingDb } from "../../helpers/recording-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;
const readable = readableSessionIds as jest.Mock;

const ME = makeWorkspaceContext({ role: "member", authUserId: "user-a" });

function row(over: Partial<Record<string, unknown>> & { id: number }) {
    return {
        companyId: 5n,
        actorUserId: "user-b",
        verb: "added",
        targetType: "document",
        targetId: "42",
        targetLabel: "Q3 plan.pdf",
        targetPath: "Finance",
        detail: null,
        createdAt: new Date("2026-10-10T12:00:00Z"),
        ...over,
    };
}

beforeEach(() => {
    recordingDb.reset();
    jest.clearAllMocks();
    gate.mockImplementation(gateFor(ME));
    readable.mockImplementation(async () => new Set<string>());
});

describe("GET /api/workspace/activity", () => {
    it("narrows to one person and pages from a cursor", async () => {
        fakeDb.onSelect(workspaceActivity, [row({ id: 49 })]);
        fakeDb.onSelect(document, [{ id: 42 }]);

        const res = await GET(
            jsonRequest("/api/workspace/activity?before=50&limit=10&actor=user-b", "GET")
        );

        expect(res.status).toBe(200);
        const [where] = recordingDb.wheres(workspaceActivity);
        expect(where!.sql).toMatch(/workspace_activity"\."company_id" = \$\d/);
        expect(where!.sql).toMatch(/workspace_activity"\."id" < \$\d/);
        expect(where!.sql).toMatch(/workspace_activity"\."actor_user_id" = \$\d/);
        expect(where!.params).toEqual([5n, 50, "user-b"]);
        const body = (await res.json()) as { entries: { id: number }[]; nextBefore: unknown };
        expect(body.entries.map(e => e.id)).toEqual([49]);
        expect(body.nextBefore).toBeNull();
    });

    it("reads the whole workspace without an actor or cursor", async () => {
        fakeDb.onSelect(workspaceActivity, []);

        const res = await GET(jsonRequest("/api/workspace/activity", "GET"));

        expect(res.status).toBe(200);
        const [where] = recordingDb.wheres(workspaceActivity);
        expect(where!.sql).not.toMatch(/actor_user_id/);
        expect(where!.params).toEqual([5n]);
        await expect(res.json()).resolves.toEqual({ entries: [], nextBefore: null });
    });

    it("says which rows can still be opened", async () => {
        fakeDb.onSelect(workspaceActivity, [
            row({ id: 6 }),
            row({
                id: 5,
                verb: "deleted",
                targetId: "43",
                targetLabel: "Old.pdf",
                detail: { wasWorkspace: true },
            }),
            row({
                id: 4,
                verb: "renamed",
                targetType: "folder",
                targetId: null,
                targetLabel: "Q3",
                targetPath: "Finance/Q3",
            }),
            row({
                id: 3,
                verb: "created_folder",
                targetType: "folder",
                targetId: null,
                targetLabel: "Board",
                targetPath: "Board",
            }),
            row({
                id: 2,
                verb: "created_group",
                targetType: "group",
                targetId: "9",
                targetLabel: "Sales",
                targetPath: null,
            }),
            row({
                id: 1,
                verb: "shared",
                targetType: "chat",
                targetId: "s1",
                targetLabel: "Pricing",
                targetPath: null,
            }),
        ]);
        // listActivity: visible documents, then documents that still exist;
        // then the feed's own existence check.
        fakeDb.onSelect(document, [{ id: 42 }], [{ id: 42 }], [{ id: 42 }]);
        fakeDb.onSelect(category, [{ name: "Finance/Q3" }]);
        fakeDb.onSelect(workspaceGroups, [{ id: 9 }]);
        readable.mockImplementation(async () => new Set(["s1"]));

        const res = await GET(jsonRequest("/api/workspace/activity", "GET"));

        const body = (await res.json()) as { entries: { id: number; openable: boolean }[] };
        expect(body.entries.map(e => [e.id, e.openable])).toEqual([
            [6, true],
            [5, false], // deleted
            [4, true],
            [3, false], // the folder is not there any more
            [2, true],
            [1, true],
        ]);
    });

    it("refuses a bad cursor or limit", async () => {
        for (const query of ["before=abc", "limit=0", "limit=500", "before=-3"]) {
            const res = await GET(jsonRequest(`/api/workspace/activity?${query}`, "GET"));
            expect(res.status).toBe(400);
        }
        expect(recordingDb.wheres(workspaceActivity)).toHaveLength(0);
    });

    it("needs documents.read", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ permissions: [] })));
        const res = await GET(jsonRequest("/api/workspace/activity", "GET"));
        expect(res.status).toBe(403);
    });
});
