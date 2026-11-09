import { DecisionSchema, TopicPatchSchema } from "~/app/api/vantage/_schemas";

jest.mock("@launchstack/pipelines/vantage", () => ({
    VANTAGE_COMMITMENT_STATUSES: ["open", "done", "missed", "dropped"],
    VANTAGE_EVIDENCE_KINDS: ["note", "interview", "link", "task", "claim", "document"],
    VANTAGE_VISIBILITIES: ["private", "shared"],
    isIsoDate: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s),
}));

test("a topic patch requires its observed version", () => {
    expect(TopicPatchSchema.safeParse({ status: "kept" }).success).toBe(false);
    expect(TopicPatchSchema.safeParse({ status: "kept", expectedContentVersion: 1 }).success).toBe(
        true
    );
    expect(TopicPatchSchema.safeParse({ status: "kept", expectedContentVersion: 0 }).success).toBe(
        false
    );
});
test("a human action requires a real acceptance test and decision version", () => {
    const input = {
        expectedContentVersion: 1,
        decision: "Run a test",
        commitment: { title: "Trial", owner: "Alice", dueOn: "2026-11-20", test: null },
    };
    expect(DecisionSchema.safeParse(input).success).toBe(false);
    expect(
        DecisionSchema.safeParse({
            ...input,
            commitment: { ...input.commitment, test: "Five customers complete the trial" },
        }).success
    ).toBe(true);
    expect(DecisionSchema.safeParse({ ...input, expectedContentVersion: undefined }).success).toBe(
        false
    );
});

test("client retry retains its exact request key, and changed version gets a different key", async () => {
    const { webcrypto } = await import("node:crypto");
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
    const previous = globalThis.fetch;
    const calls: RequestInit[] = [];
    globalThis.fetch = jest.fn(async (_url, init) => {
        calls.push(init!);
        return { ok: true, text: async () => JSON.stringify({ topic: { id: "t" } }) } as Response;
    });
    try {
        const { vantageApi } = await import("~/app/employer/tools/vantage/api");
        const input = { expectedContentVersion: 1, decision: "Investigate", commitment: null };
        await vantageApi.decide("t", input);
        await vantageApi.decide("t", input);
        await vantageApi.decide("t", { ...input, expectedContentVersion: 2 });
        const keys = calls.map(call => (call.headers as Record<string, string>)["Idempotency-Key"]);
        expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
        expect(keys[1]).toBe(keys[0]);
        expect(keys[2]).not.toBe(keys[0]);
    } finally {
        globalThis.fetch = previous;
    }
});
