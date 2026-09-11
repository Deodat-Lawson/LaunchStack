jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { GET } from "~/app/api/workspace/audit/route";
import { workspaceAuditEvents } from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;

function event(id: number, action = "member.invited") {
    return {
        id,
        action,
        actorUserId: "user-a",
        actorName: "Ann",
        actorEmail: "ann@example.com",
        targetType: "invitation",
        targetId: String(id),
        detail: { email: "x@example.com" },
        createdAt: new Date(Date.UTC(2026, 0, id)),
    };
}

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
});

describe("GET /api/workspace/audit", () => {
    it("pages with a keyset cursor on id", async () => {
        fakeDb.onSelect(workspaceAuditEvents, [event(30), event(29), event(28)], [event(28)]);

        const first = await GET(new Request("http://localhost/api/workspace/audit?limit=2"));
        expect(first.status).toBe(200);
        const page1 = (await first.json()) as {
            events: { id: number; actor: unknown }[];
            nextCursor: string | null;
        };
        expect(page1.events.map(e => e.id)).toEqual([30, 29]);
        expect(page1.nextCursor).toBe("29");
        expect(page1.events[0]?.actor).toEqual({
            authUserId: "user-a",
            name: "Ann",
            email: "ann@example.com",
        });

        const second = await GET(
            new Request("http://localhost/api/workspace/audit?limit=2&cursor=29")
        );
        const page2 = (await second.json()) as {
            events: { id: number }[];
            nextCursor: string | null;
        };
        expect(page2.events.map(e => e.id)).toEqual([28]);
        expect(page2.nextCursor).toBeNull();
    });

    it("rejects a limit above 200 and a malformed cursor", async () => {
        expect(
            (await GET(new Request("http://localhost/api/workspace/audit?limit=201"))).status
        ).toBe(400);
        expect(
            (await GET(new Request("http://localhost/api/workspace/audit?cursor=abc"))).status
        ).toBe(400);
    });

    it("exports the same filter as CSV", async () => {
        fakeDb.onSelect(workspaceAuditEvents, [event(2), event(1, "group.created")]);

        const res = await GET(new Request("http://localhost/api/workspace/audit?format=csv"));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/csv");
        expect(res.headers.get("content-disposition")).toBe('attachment; filename="audit.csv"');
        const lines = (await res.text()).trim().split("\r\n");
        expect(lines[0]).toBe(
            "id,createdAt,action,actorName,actorEmail,actorUserId,targetType,targetId,detail"
        );
        expect(lines).toHaveLength(3);
        expect(lines[1]).toContain(
            ',member.invited,Ann,ann@example.com,user-a,invitation,2,"{""email"":""x@example.com""}"'
        );
    });

    it("requires audit.view", async () => {
        gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "member" })));
        const res = await GET(new Request("http://localhost/api/workspace/audit"));
        expect(res.status).toBe(403);
    });
});
