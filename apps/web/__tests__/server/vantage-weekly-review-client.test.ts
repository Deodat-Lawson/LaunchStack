import {
    readWeeklyReviewStream,
    weeklyReviewApi,
    VantageApiError,
} from "~/app/employer/tools/vantage/api";
function stream(text: string) {
    const bytes = new TextEncoder().encode(text);
    return new Response(
        new ReadableStream({
            start(c) {
                for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
                c.close();
            },
        })
    );
}
afterEach(() => jest.restoreAllMocks());
it("decodes split UTF-8, blank lines, CRLF, and a final unterminated record", async () => {
    const stages = jest.fn(),
        result = { id: "???" };
    await expect(
        readWeeklyReviewStream(
            stream(
                '\n{"type":"stage","stage":"gathering"}\r\n' +
                    JSON.stringify({ type: "result", result })
            ),
            stages
        )
    ).resolves.toEqual(result);
    expect(stages).toHaveBeenCalledWith("gathering");
});
it("preserves stable error/status", async () => {
    await expect(
        readWeeklyReviewStream(stream('{"type":"error","error":"stale_review","status":409}\n'))
    ).rejects.toMatchObject({ name: "VantageApiError", message: "stale_review", status: 409 });
});
it.each([
    '{"type":"stage","stage":"writing"}\n',
    "not json\n",
    '{"type":"stage","stage":"invented"}\n',
])("rejects incomplete or malformed stream %s", async text => {
    await expect(readWeeklyReviewStream(stream(text))).rejects.toBeInstanceOf(VantageApiError);
});
it("observer failures do not hide saved results", async () => {
    await expect(
        readWeeklyReviewStream(
            stream(
                '{"type":"stage","stage":"saving"}\n{"type":"result","result":{"id":"saved"}}\n'
            ),
            () => {
                throw Error("observer");
            }
        )
    ).resolves.toEqual({ id: "saved" });
});
it("sends exact key and expected pointer", async () => {
    const fetcher = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(stream('{"type":"result","result":{"id":"saved"}}\n'));
    await weeklyReviewApi.generate(
        { weekStart: "2026-11-16", expectedActiveId: "previous" },
        undefined,
        "stable_key"
    );
    expect(fetcher).toHaveBeenCalledWith(
        "/api/vantage/reviews",
        expect.objectContaining({
            body: JSON.stringify({ weekStart: "2026-11-16", expectedActiveId: "previous" }),
            headers: expect.objectContaining({
                Accept: "application/x-ndjson",
                "Idempotency-Key": "stable_key",
            }),
        })
    );
});

it.each([
    "null\n",
    '{"type":"error"}\n',
    '{"type":"error","error":"bad","status":200}\n',
    '{"type":"result","result":{"id":"saved"}}\n{"type":"stage","stage":"saving"}\n',
])("rejects invalid records or records after final result: %s", async text => {
    await expect(readWeeklyReviewStream(stream(text))).rejects.toMatchObject({
        name: "VantageApiError",
        message: "review_unavailable",
    });
});
