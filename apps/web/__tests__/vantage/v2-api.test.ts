import { v2Api, type V2Plan, type V2Task } from "~/app/employer/tools/vantage/v2-api";

const originalFetch = global.fetch;
afterEach(() => {
    global.fetch = originalFetch;
});

test("whole-plan approval sends only the exact version and hash", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock;
    await v2Api.approve({ reviewId: "review/id", version: 7, hash: "exact-hash" } as V2Plan);
    expect(fetchMock).toHaveBeenCalledWith(
        "/api/vantage/planning/reviews/review%2Fid/plan/approve",
        expect.objectContaining({
            method: "POST",
            cache: "no-store",
            body: JSON.stringify({ version: 7, hash: "exact-hash" }),
        })
    );
});

test("task actions bind the expected version and manual completion notes", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock;
    await v2Api.action({ id: "task/id", version: 4 } as V2Task, "complete", "Reviewed manually");
    expect(fetchMock).toHaveBeenCalledWith(
        "/api/vantage/planning/tasks/task%2Fid/action",
        expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
                action: "complete",
                expectedVersion: 4,
                result: "Reviewed manually",
            }),
        })
    );
});
