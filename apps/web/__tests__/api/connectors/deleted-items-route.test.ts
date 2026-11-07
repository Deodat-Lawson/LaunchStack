/**
 * "Sync again" for a synced file deleted here: DELETE
 * /api/connectors/[provider]/deleted forgets the record on one of this
 * workspace's connections, so the next sync imports the file again. A Drive
 * file picked on its own is never forgotten here (picking it again is how it
 * returns), Drive's cursor is reset so an idle feed can't skip the run, and
 * only connector admins may do it.
 */
import type { NextResponse } from "next/server";

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));
jest.mock("~/server/services/connectors/workspace-guard", () => ({
    requireConnectorAdmin: jest.fn(),
}));
jest.mock("~/server/services/connectors/connection-store", () => ({
    listConnectionsForCompany: jest.fn(),
}));
jest.mock("~/server/services/connectors/google-drive/store", () => ({
    resetSyncCursor: jest.fn(),
}));
jest.mock("~/server/services/connectors/deleted-items", () => ({
    // The real rule: a Drive file picked on its own is never listed.
    isListableDriveRow: (row: { pickedRootId: string | null; sourceId: string }) =>
        row.pickedRootId !== row.sourceId,
    listDeletedItems: jest.fn(),
    forgetDeletedItems: jest.fn(),
}));

import { DELETE } from "~/app/api/connectors/[provider]/deleted/route";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import {
    forgetDeletedItems,
    listDeletedItems,
    type DeletedItemRow,
} from "~/server/services/connectors/deleted-items";
import { resetSyncCursor } from "~/server/services/connectors/google-drive/store";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const ctx = makeWorkspaceContext({ role: "admin", userPk: BigInt(11) });

function row(sourceId: string, pickedRootId: string | null): DeletedItemRow {
    return {
        connectionId: 7,
        sourceId,
        pickedRootId,
        title: sourceId,
        deletedByUserPk: 11,
        deletedAt: new Date("2026-11-07T00:00:00Z"),
    };
}

function restore(provider: string, body: Record<string, unknown>) {
    return DELETE(
        new Request(`https://app.example.com/api/connectors/${provider}/deleted`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ provider }) }
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireConnectorAdmin).mockResolvedValue({ ok: true, ctx });
    jest.mocked(listConnectionsForCompany).mockResolvedValue([
        { id: 7, status: "active" },
    ] as never);
    jest.mocked(listDeletedItems).mockResolvedValue([
        row("tpl-1", "templates"),
        row("tpl-2", "templates"),
        // Picked on its own: never listed, never forgotten here.
        row("deck", "deck"),
    ]);
    jest.mocked(forgetDeletedItems).mockImplementation(async (_id, target) =>
        Promise.resolve(target.sourceIds.length)
    );
});

it("forgets the named Drive file and resets the cursor", async () => {
    const res = await restore("google-drive", { connectionId: "7", sourceIds: ["tpl-1"] });

    expect(res.status).toBe(200);
    expect(forgetDeletedItems).toHaveBeenCalledWith(7, { sourceIds: ["tpl-1"] });
    expect(resetSyncCursor).toHaveBeenCalledWith(7);
    const payload = (await res.json()) as { data: { restored: number }; message: string };
    expect(payload.data.restored).toBe(1);
    expect(payload.message).toBe("1 file will come back on the next sync.");
});

it("forgets everything listed for 'all', but never a file's own pick", async () => {
    await restore("google-drive", { connectionId: "7", all: true });

    expect(forgetDeletedItems).toHaveBeenCalledWith(7, { sourceIds: ["tpl-1", "tpl-2"] });
});

it("ignores a named file that isn't listed, and leaves the cursor alone", async () => {
    const res = await restore("google-drive", { connectionId: "7", sourceIds: ["deck"] });

    expect(res.status).toBe(200);
    expect(forgetDeletedItems).toHaveBeenCalledWith(7, { sourceIds: [] });
    expect(resetSyncCursor).not.toHaveBeenCalled();
});

it("forgets Notion pages without touching Drive's cursor", async () => {
    jest.mocked(listDeletedItems).mockResolvedValue([row("page-1", null)]);
    const res = await restore("notion", { connectionId: "7", sourceIds: ["page-1"] });

    expect(res.status).toBe(200);
    expect(listConnectionsForCompany).toHaveBeenCalledWith(ctx.companyId, "notion");
    expect(forgetDeletedItems).toHaveBeenCalledWith(7, { sourceIds: ["page-1"] });
    expect(resetSyncCursor).not.toHaveBeenCalled();
});

it("refuses a connection that isn't this workspace's", async () => {
    const res = await restore("notion", { connectionId: "99", all: true });

    expect(res.status).toBe(404);
    expect(forgetDeletedItems).not.toHaveBeenCalled();
});

it("refuses other providers and bad bodies", async () => {
    expect((await restore("gmail", { connectionId: "7", all: true })).status).toBe(400);
    expect((await restore("notion", { connectionId: "7" })).status).toBe(400);
    expect(forgetDeletedItems).not.toHaveBeenCalled();
});

it("is for connector admins only", async () => {
    const { NextResponse } = await import("next/server");
    jest.mocked(requireConnectorAdmin).mockResolvedValue({
        ok: false,
        response: NextResponse.json({ success: false }, { status: 403 }),
    });
    const res = await restore("google-drive", { connectionId: "7", all: true });

    expect(res.status).toBe(403);
    expect(forgetDeletedItems).not.toHaveBeenCalled();
});
