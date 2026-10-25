/**
 * Picking from Google Drive in Add source names the folder it goes to, and
 * picking into a folder is uploading into it: a restricted folder takes edit
 * access, as /api/uploadDocument checks, or nothing is saved. A pick with no
 * folder (an older client) keeps the old placement.
 */
import type { NextResponse } from "next/server";

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));
jest.mock("~/server/services/connectors/workspace-guard", () => ({
    requireConnectorAdmin: jest.fn(),
    notConfiguredResponse: jest.fn(),
}));
jest.mock("~/server/services/connectors/config", () => ({
    isConnectorConfigured: () => true,
}));
jest.mock("~/server/services/connectors/connection-store", () => ({
    listConnectionsForCompany: jest.fn().mockResolvedValue([{ id: 7, status: "active" }]),
}));
jest.mock("~/server/services/connectors/google-drive/resolve-link", () => ({
    resolveDriveLink: jest.fn(),
}));
jest.mock("~/server/services/connectors/google-drive/store", () => ({
    addPickedItems: jest.fn(),
    listPickedItems: jest.fn().mockResolvedValue([]),
    removePickedItems: jest.fn(),
    resetSyncCursor: jest.fn(),
}));
jest.mock("~/server/services/folder-access", () => ({
    canEditFolder: jest.fn(),
}));

import { POST } from "~/app/api/connectors/[provider]/items/route";
import { addPickedItems } from "~/server/services/connectors/google-drive/store";
import { requireConnectorAdmin } from "~/server/services/connectors/workspace-guard";
import { canEditFolder } from "~/server/services/folder-access";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const ctx = makeWorkspaceContext({ role: "admin", userPk: BigInt(11) });
const deck = { fileId: "d1", kind: "file", name: "Board deck.pdf", mimeType: "application/pdf" };

function pick(body: Record<string, unknown>) {
    return POST(
        new Request("https://app.example.com/api/connectors/google-drive/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ provider: "google-drive" }) }
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireConnectorAdmin).mockResolvedValue({ ok: true, ctx });
});

it("saves the pick with the folder it goes to", async () => {
    jest.mocked(canEditFolder).mockResolvedValue(true);
    const res = await pick({ items: [deck], destination: "Deals/Acme/" });

    expect(res.status).toBe(200);
    expect(canEditFolder).toHaveBeenCalledWith(ctx, "Deals/Acme");
    expect(addPickedItems).toHaveBeenCalledWith(7, [{ ...deck, kind: "file" }], 11, "Deals/Acme");
});

it("refuses a folder the picker can't add to, and saves nothing", async () => {
    jest.mocked(canEditFolder).mockResolvedValue(false);
    const res = await pick({ items: [deck], destination: "Board" });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe(
        "You do not have edit access to this folder."
    );
    expect(addPickedItems).not.toHaveBeenCalled();
});

it("keeps the old placement for a pick that names no folder", async () => {
    const res = await pick({ items: [deck] });

    expect(res.status).toBe(200);
    expect(canEditFolder).not.toHaveBeenCalled();
    expect(addPickedItems).toHaveBeenCalledWith(7, expect.any(Array), 11, null);
});
