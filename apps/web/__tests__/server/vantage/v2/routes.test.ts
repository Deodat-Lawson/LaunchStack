jest.mock("~/server/vantage/v2/access", () => ({
    vantageV2Actor: jest.fn(),
    vantageV2Error: jest.fn(() => Response.json({ error: "invalid_request" }, { status: 400 })),
}));
jest.mock("~/server/vantage/v2/service", () => ({
    vantageV2Repository: { get: jest.fn(), patch: jest.fn(), remove: jest.fn() },
    createVantageV2Plan: jest.fn(),
    approveVantageV2Plan: jest.fn(),
    actVantageV2Task: jest.fn(),
}));
jest.mock("~/server/vantage/v2/settings", () => ({
    getVantageV2Settings: jest.fn(),
    putVantageV2Settings: jest.fn(),
}));
import { vantageV2Actor } from "~/server/vantage/v2/access";
import { approveVantageV2Plan, vantageV2Repository } from "~/server/vantage/v2/service";
import { POST as approve } from "~/app/api/vantage/planning/reviews/[id]/plan/approve/route";
import { GET as read } from "~/app/api/vantage/planning/reviews/[id]/plan/route";
import { DELETE as remove } from "~/app/api/vantage/planning/tasks/[id]/route";
const params = { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) };
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(vantageV2Actor).mockResolvedValue({
        ok: true,
        actor: { companyId: "1", userId: "owner" },
    } as Awaited<ReturnType<typeof vantageV2Actor>>);
});
it("applies auth gate before all plan data access", async () => {
    jest.mocked(vantageV2Actor).mockResolvedValueOnce({
        ok: false,
        response: Response.json({ error: "denied" }, { status: 403 }),
    } as Awaited<ReturnType<typeof vantageV2Actor>>);
    expect((await read(new Request("http://localhost"), params)).status).toBe(403);
    expect(vantageV2Repository.get).not.toHaveBeenCalled();
});
it("requires exact version and sha256 approval payload", async () => {
    const response = await approve(
        new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ version: 1, hash: "wrong" }),
        }),
        params
    );
    expect(response.status).toBe(400);
    expect(approveVantageV2Plan).not.toHaveBeenCalled();
    expect(vantageV2Actor).toHaveBeenCalledWith(true);
});
it("rejects delete without expected task revision", async () => {
    const response = await remove(
        new Request("http://localhost", { method: "DELETE", body: "{}" }),
        params
    );
    expect(response.status).toBe(400);
    expect(vantageV2Repository.remove).not.toHaveBeenCalled();
});
it("does not allow unknown extra approval fields", async () => {
    const response = await approve(
        new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ version: 1, hash: "a".repeat(64), skipAuthority: true }),
        }),
        params
    );
    expect(response.status).toBe(400);
    expect(approveVantageV2Plan).not.toHaveBeenCalled();
});
