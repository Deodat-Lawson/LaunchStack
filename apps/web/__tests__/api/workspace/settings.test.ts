jest.mock("~/server/db", () => ({
    db: jest.requireActual("../../helpers/fake-db").fakeDb.db,
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: jest.fn(),
}));

import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { GET, PATCH } from "~/app/api/workspace/settings/route";
import { workspaceAuditEvents, workspaceSettings } from "~/server/db/schema";

import { fakeDb } from "../../helpers/fake-db";
import { makeWorkspaceContext } from "../../helpers/workspace-context";
import { gateFor, jsonRequest } from "./_setup";

const gate = requireWorkspacePermission as jest.Mock;

beforeEach(() => {
    fakeDb.reset();
    jest.clearAllMocks();
    gate.mockImplementation(gateFor(makeWorkspaceContext({ role: "owner" })));
});

describe("/api/workspace/settings", () => {
    it("returns defaults when the workspace has no row", async () => {
        const res = await GET();
        await expect(res.json()).resolves.toEqual({
            joinPolicy: "approval",
            auditRetentionDays: null,
        });
    });

    it("creates the row on first change and audits what changed", async () => {
        const res = await PATCH(
            jsonRequest("/api/workspace/settings", "PATCH", { joinPolicy: "open" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ joinPolicy: "open", auditRetentionDays: null });
        expect(fakeDb.insertedInto(workspaceSettings)).toEqual([
            { companyId: 5n, joinPolicy: "open", auditRetentionDays: null },
        ]);
        expect(fakeDb.insertedInto(workspaceAuditEvents)).toEqual([
            expect.objectContaining({
                action: "settings.changed",
                detail: { changes: { joinPolicy: { from: "approval", to: "open" } } },
            }),
        ]);
    });

    it("rejects an unknown join policy and an empty patch", async () => {
        expect(
            (await PATCH(jsonRequest("/api/workspace/settings", "PATCH", { joinPolicy: "anyone" })))
                .status
        ).toBe(400);
        expect((await PATCH(jsonRequest("/api/workspace/settings", "PATCH", {}))).status).toBe(400);
    });
});
