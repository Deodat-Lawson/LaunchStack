jest.mock("~/server/beta-apps", () => ({ requireBetaAppContext: jest.fn() }));
jest.mock("~/server/vantage/weekly-review-service", () => ({ weeklyReviewServices: jest.fn() }));
import { GET } from "~/app/api/vantage/reviews/[id]/status/route";
import { requireBetaAppContext } from "~/server/beta-apps";
import { weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
import { makeWorkspaceContext } from "../helpers/workspace-context";
const status = jest.fn();
const params = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) };
const get = () => GET(new Request("http://localhost/api/vantage/reviews/run/status"), params);
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireBetaAppContext).mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "member", companyId: 7n, authUserId: "owner" }),
    });
    jest.mocked(weeklyReviewServices).mockReturnValue({ repository: { status } } as never);
    status.mockResolvedValue({
        id: "run",
        status: "failed",
        failureRecord: { stage: "judge" },
        providerAttempts: [],
        providerAttemptsTruncated: false,
    });
});
it("reads sanitized owner status after failure without reopening report sources", async () => {
    expect((await get()).status).toBe(200);
    expect(status).toHaveBeenCalledWith(
        { companyId: "7", userId: "owner" },
        (await params.params).id
    );
});
it("preserves Beta and membership denial before repository access", async () => {
    jest.mocked(requireBetaAppContext).mockResolvedValue({
        success: false,
        response: Response.json({}, { status: 404 }) as never,
    });
    expect((await get()).status).toBe(404);
    expect(status).not.toHaveBeenCalled();
});
it("requires current read capability", async () => {
    jest.mocked(requireBetaAppContext).mockResolvedValue({
        success: true,
        data: { ...makeWorkspaceContext({ role: "member" }), can: () => false },
    });
    expect((await get()).status).toBe(403);
    expect(status).not.toHaveBeenCalled();
});
it("does not disclose whether a colleague's or another company's run exists", async () => {
    status.mockRejectedValue(new WeeklyReviewConflict("review_not_found", 404));
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "review_not_found" });
});
