import { PATCH, POST } from "../../src/app/api/vantage/reviews/context/topics/route";
import { weeklyReviewServices } from "../../src/server/vantage/weekly-review-service";
jest.mock("../../src/server/vantage/weekly-review-service", () => ({
    weeklyReviewServices: jest.fn(),
}));
jest.mock("../../src/app/api/vantage/reviews/_http", () => ({
    reviewActor: jest.fn(async () => ({ ok: true, actor: { companyId: "5", userId: "owner" } })),
    reviewError: (error: { status: number; code: string }) =>
        new Response(JSON.stringify({ error: error.code }), { status: error.status || 503 }),
}));
const body = {
    title: "Release",
    openQuestions: [],
    decisionChangers: [],
    keywords: [],
    people: [],
    metrics: [],
    status: "active",
    watches: ["1"],
};
const request = (value: unknown) =>
    new Request("http://localhost/api/vantage/reviews/context/topics", {
        method: "POST",
        body: JSON.stringify(value),
    });
function setup(canMutate: boolean, rows: unknown[]) {
    const query = jest.fn().mockResolvedValue(rows);
    (weeklyReviewServices as jest.Mock).mockReturnValue({
        authority: {
            withReadableDocuments: async (
                _actor: unknown,
                read: (query: unknown, documents: unknown, actor: unknown) => unknown
            ) => read(query, [{ id: "1" }], { companyId: "5", userId: "owner", canMutate }),
        },
    });
    return query;
}
test("fresh edit revocation prevents writes", async () => {
    const query = setup(false, []);
    expect((await POST(request(body))).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
});
test("denied watches fail before writes", async () => {
    const query = setup(true, []);
    expect((await POST(request({ ...body, watches: ["99"] }))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
});
test("stale CAS prevents replacing watches", async () => {
    const query = setup(true, []);
    expect(
        (
            await PATCH(
                request({
                    ...body,
                    id: "11111111-1111-4111-8111-111111111111",
                    expectedRevision: 2,
                })
            )
        ).status
    ).toBe(409);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toContain("owner");
    expect(query.mock.calls[0]?.[1]).toContain(2);
});
