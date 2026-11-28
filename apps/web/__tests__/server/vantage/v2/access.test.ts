jest.mock("~/app/api/vantage/reviews/_http", () => ({
    reviewActor: jest.fn(),
    reviewError: jest.fn(),
}));
jest.mock("~/server/vantage/v2/enabled", () => ({ vantageV2Enabled: jest.fn() }));
import { reviewActor } from "~/app/api/vantage/reviews/_http";
import { vantageV2Enabled } from "~/server/vantage/v2/enabled";
import { vantageV2Actor, vantageV2Error } from "~/server/vantage/v2/access";
import { z } from "zod";
const authenticated = {
    ok: true,
    actor: { companyId: "1", userId: "owner" },
    ctx: { can: () => true },
} as unknown as Extract<Awaited<ReturnType<typeof reviewActor>>, { ok: true }>;
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(reviewActor).mockResolvedValue(authenticated);
    jest.mocked(vantageV2Enabled).mockReturnValue(true);
});
it("uses existing Beta and capability actor guard for reads and mutations", async () => {
    expect(await vantageV2Actor()).toBe(authenticated);
    expect(reviewActor).toHaveBeenLastCalledWith(false);
    await vantageV2Actor(true);
    expect(reviewActor).toHaveBeenLastCalledWith(true);
});
it("keeps feature off opaque after successful V1 authentication", async () => {
    jest.mocked(vantageV2Enabled).mockReturnValue(false);
    const response = await vantageV2Actor();
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.response.status).toBe(404);
});
it("does not expose personal settings or a roster to an edit-only member", async () => {
    jest.mocked(reviewActor).mockResolvedValue({
        ...authenticated,
        ctx: { ...authenticated.ctx, can: () => false },
    });
    const response = await vantageV2Actor(true);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.response.status).toBe(403);
});
it("preserves Beta/capability denial without invoking later flag", async () => {
    const denied = {
        ok: false,
        response: Response.json({ error: "denied" }, { status: 403 }),
    } as Awaited<ReturnType<typeof reviewActor>>;
    jest.mocked(reviewActor).mockResolvedValue(denied);
    expect(await vantageV2Actor()).toBe(denied);
    expect(vantageV2Enabled).not.toHaveBeenCalled();
});
it("returns bounded invalid input error without schema details", async () => {
    const invalid = z.string().safeParse(1);
    if (invalid.success) throw Error("expected rejection");
    const response = vantageV2Error(invalid.error);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
});
