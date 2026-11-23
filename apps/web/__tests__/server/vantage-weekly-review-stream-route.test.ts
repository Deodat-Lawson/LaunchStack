jest.mock("~/server/beta-apps", () => ({ requireBetaAppContext: jest.fn() }));
import { GET, POST } from "~/app/api/vantage/reviews/route";
import { generateWeeklyReview, weeklyReviewEnabled, weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import { reviewActor } from "~/app/api/vantage/reviews/_http";
import { WeeklyReviewConflict } from "~/server/vantage/weekly-review-types";
import type * as ReviewTypes from "~/server/vantage/weekly-review-types";
jest.mock("~/server/vantage/weekly-review-service", () => ({
    weeklyReviewEnabled: jest.fn(() => true),
    weeklyReviewServices: jest.fn(),
    generateWeeklyReview: jest.fn(),
    assertWeeklyReviewWeek: (week: string) => {
        if (week !== "2026-11-16")
            throw new (jest.requireActual<typeof ReviewTypes>(
                "~/server/vantage/weekly-review-types"
            ).WeeklyReviewConflict)("invalid_review_week", 400);
    },
}));
jest.mock("~/app/api/vantage/reviews/_http", () => ({
    ...jest.requireActual("~/app/api/vantage/reviews/_http"),
    reviewActor: jest.fn(),
}));
const generate = jest.mocked(generateWeeklyReview);
const request = (stream = false, weekStart = "2026-11-16") =>
    new Request("http://localhost/api/vantage/reviews", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "stable_key",
            ...(stream ? { Accept: "application/x-ndjson" } : {}),
        },
        body: JSON.stringify({ weekStart, expectedActiveId: null }),
    });
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(weeklyReviewEnabled).mockReturnValue(true);
    jest.mocked(reviewActor).mockResolvedValue({
        ok: true,
        actor: { companyId: "1", userId: "user" },
    } as never);
});
it("keeps JSON201 key and pointer", async () => {
    generate.mockResolvedValue({ id: "saved" } as never);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "saved" });
    expect(generate).toHaveBeenCalledWith(
        { companyId: "1", userId: "user" },
        { weekStart: "2026-11-16", expectedActiveId: null, key: "stable_key" }
    );
});
it("streams real callback stages then final result", async () => {
    generate.mockImplementation(async (_a, _b, stage) => {
        for (const value of ["gathering", "writing", "checking", "saving"] as const) stage?.(value);
        return { id: "saved" } as never;
    });
    const response = await POST(request(true));
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(
        (await response.text())
            .trim()
            .split("\n")
            .map(line => JSON.parse(line))
    ).toEqual([
        ...["gathering", "writing", "checking", "saving"].map(stage => ({ type: "stage", stage })),
        { type: "result", result: { id: "saved" } },
    ]);
});
it("streams stable errors with original status", async () => {
    generate.mockRejectedValue(new WeeklyReviewConflict("candidate_not_admitted", 409));
    const response = await POST(request(true));
    expect(JSON.parse((await response.text()).trim())).toEqual({
        type: "error",
        error: "candidate_not_admitted",
        status: 409,
    });
});
it("disconnect does not cancel or repeat generation", async () => {
    let finish!: (value: never) => void;
    let observer!: NonNullable<Parameters<typeof generateWeeklyReview>[2]>;
    generate.mockImplementation((_a, _b, stage) => {
        observer = stage!;
        return new Promise(resolve => {
            finish = resolve;
        });
    });
    const response = await POST(request(true));
    await response.body!.cancel();
    expect(() => observer("saving")).not.toThrow();
    finish({ id: "saved" } as never);
    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(1);
});
it("rejects Tuesday POST and supplied GET", async () => {
    expect((await POST(request(false, "2026-11-17"))).status).toBe(400);
    const response = await GET(
        new Request("http://localhost/api/vantage/reviews?weekStart=2026-11-17")
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_review_week" });
    expect(generate).not.toHaveBeenCalled();
    expect(weeklyReviewServices).not.toHaveBeenCalled();
});

it.each([false, true])("refuses generation with creation off (stream %s)", async stream => {
    jest.mocked(weeklyReviewEnabled).mockReturnValue(false);
    expect((await POST(request(stream))).status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
});
it("retains authorized history when creation is off", async () => {
    jest.mocked(weeklyReviewEnabled).mockReturnValue(false);
    const list = jest.fn().mockResolvedValue([{ id: "historical" }]);
    const active = jest.fn().mockResolvedValue("historical");
    jest.mocked(weeklyReviewServices).mockReturnValue({ repository: { list, active } } as never);
    const response = await GET(new Request("http://localhost/api/vantage/reviews?weekStart=2026-11-16"));
    expect(await response.json()).toEqual({ enabled: false, activeId: "historical", runs: [{ id: "historical" }] });
});
