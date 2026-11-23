import { NextResponse } from "next/server";
import { requireBetaAppContext } from "~/server/beta-apps";
import { reviewActor } from "~/app/api/vantage/reviews/_http";
jest.mock("~/server/beta-apps", () => ({ requireBetaAppContext: jest.fn() }));

test.each([false, true])("Beta refusal applies to review read and mutation (mutate %s)", async mutate => {
    const response = NextResponse.json({ code: "beta_apps_off" }, { status: 403 });
    jest.mocked(requireBetaAppContext).mockResolvedValue({ success: false, response });
    expect(await reviewActor(mutate)).toEqual({ ok: false, response });
});
test.each([false, true])("Beta access still requires capability (mutate %s)", async mutate => {
    jest.mocked(requireBetaAppContext).mockResolvedValue({ success: true, data: { can: () => false } } as never);
    const result = await reviewActor(mutate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
});
