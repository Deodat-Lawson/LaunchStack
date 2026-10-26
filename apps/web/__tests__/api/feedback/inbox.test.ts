/**
 * The workspace inbox keeps feedback rows ("the team replied to your
 * report") for the person who filed the report, and only while it exists —
 * before, every unknown target type was read as a chat id and dropped.
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

import { document } from "@launchstack/store/schema";
import { GET } from "~/app/api/workspace/notifications/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { feedbackReports, workspaceNotifications } from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { recordingDb } from "../../helpers/recording-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const ME = makeWorkspaceContext({ role: "member", authUserId: "auth-ada", companyId: 5n });

function row(over: Partial<Record<string, unknown>> & { id: number }) {
    return {
        companyId: 5n,
        recipientUserId: "auth-ada",
        actorUserId: "auth-ops",
        kind: "feedback",
        targetType: "feedback",
        targetId: "42",
        targetLabel: "Upload fails",
        detail: { event: "reply" },
        createdAt: new Date("2026-10-25T12:00:00Z"),
        readAt: null,
        ...over,
    };
}

beforeEach(() => {
    recordingDb.reset();
    jest.clearAllMocks();
    jest.mocked(requireWorkspaceContext).mockResolvedValue({ success: true, data: ME });
});

it("keeps feedback rows for reports the reader filed, and drops the rest", async () => {
    fakeDb.onSelect(
        workspaceNotifications,
        [
            row({ id: 4, detail: { event: "status", status: "done" } }),
            row({ id: 3, targetId: "43", targetLabel: "Gone" }),
            row({ id: 2, kind: "shared", targetType: "document", targetId: "7" }),
            row({ id: 1, kind: "mystery", targetType: "widget", targetId: "1" }),
        ],
        [{ n: 4 }]
    );
    fakeDb.onSelect(feedbackReports, [{ id: 42 }]);
    fakeDb.onSelect(document, [{ id: 7 }]);

    const res = await GET(new Request("http://localhost/api/workspace/notifications"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
        entries: { id: number; targetType: string; targetId: string; detail: unknown }[];
        unread: number;
    };
    expect(body.entries.map(e => [e.id, e.targetType, e.targetId])).toEqual([
        [4, "feedback", "42"],
        [2, "document", "7"],
    ]);
    expect(body.entries[0]!.detail).toEqual({ event: "status", status: "done" });
    expect(body.unread).toBe(2);

    // The report check names the reader as its reporter.
    const [where] = recordingDb.wheres(feedbackReports);
    expect(where!.sql).toMatch(/"reporter_user_id" = \$\d/);
    expect(where!.params).toEqual(expect.arrayContaining(["auth-ada", 42, 43]));
});

it("asks nothing about feedback when the inbox holds none", async () => {
    fakeDb.onSelect(
        workspaceNotifications,
        [row({ id: 2, kind: "shared", targetType: "document", targetId: "7" })],
        [{ n: 1 }]
    );
    fakeDb.onSelect(document, [{ id: 7 }]);

    await GET(new Request("http://localhost/api/workspace/notifications"));

    expect(recordingDb.wheres(feedbackReports)).toHaveLength(0);
});
