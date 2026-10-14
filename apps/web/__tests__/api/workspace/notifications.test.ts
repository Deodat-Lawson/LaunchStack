/**
 * The inbox routes (ADR-014): the caller reads and clears their own inbox and
 * nobody else's. The predicates are rendered through the real dialect, so
 * "recipient-only" is checked on the SQL a request would send.
 */

jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/recording-db").recordingDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(),
}));
jest.mock("~/server/sessions/access", () => ({
    readableSessionIds: jest.fn(async () => new Set<string>()),
}));

import { NextResponse } from "next/server";

import { category, document } from "@launchstack/store/schema";
import { GET } from "~/app/api/workspace/notifications/route";
import { POST as READ } from "~/app/api/workspace/notifications/read/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { workspaceNotifications } from "~/server/db/schema";
import { readableSessionIds } from "~/server/sessions/access";

import { fakeDb } from "../../helpers/fake-db";
import { recordingDb } from "../../helpers/recording-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { jsonRequest } from "./_setup";

const context = requireWorkspaceContext as jest.Mock;
const readable = readableSessionIds as jest.Mock;

const ME = makeWorkspaceContext({ role: "member", authUserId: "user-a", companyId: 5n });

function row(over: Partial<Record<string, unknown>> & { id: number }) {
    return {
        companyId: 5n,
        recipientUserId: "user-a",
        actorUserId: "user-b",
        kind: "shared",
        targetType: "document",
        targetId: "42",
        targetLabel: "Q3 plan.pdf",
        detail: { level: "view", via: "direct" },
        createdAt: new Date("2026-10-10T12:00:00Z"),
        readAt: null,
        ...over,
    };
}

beforeEach(() => {
    recordingDb.reset();
    jest.clearAllMocks();
    context.mockImplementation(async () => ({ success: true, data: ME }));
    readable.mockImplementation(async () => new Set<string>());
});

describe("GET /api/workspace/notifications", () => {
    it("lists the caller's own entries, newest first, with the unread count", async () => {
        fakeDb.onSelect(
            workspaceNotifications,
            [
                row({ id: 3 }),
                row({
                    id: 2,
                    targetType: "folder",
                    targetId: "7",
                    targetLabel: "Finance",
                    detail: { level: "edit", via: "group", groupName: "Sales", path: "Finance" },
                    readAt: new Date("2026-10-10T13:00:00Z"),
                }),
                row({ id: 1, targetType: "chat", targetId: "s1", targetLabel: "Pricing" }),
            ],
            [{ n: 2 }]
        );
        fakeDb.onSelect(document, [{ id: 42 }]);
        fakeDb.onSelect(category, [{ id: 7, name: "Finance" }]);
        readable.mockImplementation(async () => new Set(["s1"]));

        const res = await GET(jsonRequest("/api/workspace/notifications", "GET"));

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            entries: { id: number; read: boolean; targetType: string; detail: unknown }[];
            unread: number;
        };
        expect(body.entries.map(e => [e.id, e.targetType, e.read])).toEqual([
            [3, "document", false],
            [2, "folder", true],
            [1, "chat", false],
        ]);
        expect(body.entries[1]!.detail).toEqual({
            level: "edit",
            via: "group",
            groupName: "Sales",
            path: "Finance",
        });
        expect(body.unread).toBe(2);

        // Both reads of the inbox name the caller as the recipient, in this workspace.
        const wheres = recordingDb.wheres(workspaceNotifications);
        expect(wheres).toHaveLength(2);
        for (const where of wheres) {
            expect(where.sql).toMatch(/"recipient_user_id" = \$\d/);
            expect(where.sql).toMatch(/"company_id" = \$\d/);
            expect(where.params).toEqual(expect.arrayContaining(["user-a", 5n]));
            expect(where.params).not.toContain("user-b");
        }
    });

    it("drops what the caller can no longer open, and does not count it as unread", async () => {
        fakeDb.onSelect(
            workspaceNotifications,
            [row({ id: 2 }), row({ id: 1, targetId: "43", targetLabel: "Gone.pdf" })],
            [{ n: 2 }]
        );
        fakeDb.onSelect(document, [{ id: 42 }]);

        const res = await GET(jsonRequest("/api/workspace/notifications", "GET"));

        const body = (await res.json()) as { entries: { id: number }[]; unread: number };
        expect(body.entries.map(e => e.id)).toEqual([2]);
        expect(body.unread).toBe(1);
    });

    it("passes the auth failure through", async () => {
        context.mockImplementation(async () => ({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        }));
        const res = await GET(jsonRequest("/api/workspace/notifications", "GET"));
        expect(res.status).toBe(401);
    });
});

describe("POST /api/workspace/notifications/read", () => {
    it("marks the given entries read, only in the caller's inbox", async () => {
        const res = await READ(
            jsonRequest("/api/workspace/notifications/read", "POST", { ids: [4, 5] })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ success: true });
        const updates = fakeDb.updatesOf(workspaceNotifications);
        expect(updates).toHaveLength(1);
        expect(updates[0]!.readAt).toBeInstanceOf(Date);

        const [where] = recordingDb.wheres(workspaceNotifications, "update");
        expect(where!.sql).toMatch(/"recipient_user_id" = \$\d/);
        expect(where!.sql).toMatch(/"read_at" is null/);
        expect(where!.sql).toMatch(/"id" in \(\$\d, \$\d\)/);
        expect(where!.params).toEqual(expect.arrayContaining(["user-a", 5n, 4, 5]));
    });

    it("marks everything read when no ids are given", async () => {
        const res = await READ(
            new Request("http://localhost/api/workspace/notifications/read", { method: "POST" })
        );

        expect(res.status).toBe(200);
        const [where] = recordingDb.wheres(workspaceNotifications, "update");
        expect(where!.sql).toMatch(/"recipient_user_id" = \$\d/);
        expect(where!.sql).not.toMatch(/"id" in/);
    });

    it("rejects ids that are not positive integers", async () => {
        const res = await READ(
            jsonRequest("/api/workspace/notifications/read", "POST", { ids: ["all"] })
        );
        expect(res.status).toBe(400);
        expect(fakeDb.updates).toHaveLength(0);
    });
});
