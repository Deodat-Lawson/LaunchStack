import {
    executeVantageTask,
    type TaskExecutionClaim,
    type TaskExecutionPorts,
} from "~/server/vantage/v2/execute";
import { fetchWithProviderRetry } from "../../../../../../packages/llm/src/provider-retry";

const result = {
    summary: "Draft",
    claims: [{ text: "Fact", refs: ["frozen:1"] }],
    unknowns: [],
    disposition: "ready_for_review",
};
const call = (name: string, args: unknown = {}) => ({ id: name, name, arguments: args });
function fixture() {
    const claim: TaskExecutionClaim = {
        taskId: "task",
        planId: "plan",
        reviewId: "review",
        companyId: "1",
        ownerId: "owner",
        claimToken: "fence",
        attemptId: "attempt",
        planVersion: 1,
        planHash: "hash",
        deadlineAt: Date.now() + 180_000,
        instructions: "Do work",
        personaRole: "analyst",
    };
    const ports: TaskExecutionPorts = {
        authorize: jest.fn(async () => undefined),
        refs: ["frozen:1"],
        readBrief: jest.fn(async () => ({ topics: [] })),
        readExcerpt: jest.fn(async () => "Exact excerpt"),
        model: jest.fn(() => ({
            respond: jest.fn(async () => ({
                text: "",
                toolCalls: [call("submit_result", result)],
            })),
        })),
        beforeAttempt: jest.fn(async () => jest.fn(async () => undefined)),
        commit: jest.fn(async () => undefined),
        fail: jest.fn(async () => undefined),
    };
    return { claim, ports };
}

test("only two frozen read tools and typed submission are advertised", async () => {
    const { claim, ports } = fixture();
    const respond = jest.fn(async input => {
        expect(input.tools.map((tool: { name: string }) => tool.name)).toEqual([
            "read_accepted_brief",
            "read_frozen_excerpt",
            "submit_result",
        ]);
        return {
            text: "",
            toolCalls: [call("send_email", { body: "bad" }), call("submit_result", result)],
        };
    });
    ports.model = () => ({ respond });
    expect((await executeVantageTask(claim, ports)).status).toBe("submitted");
    expect(ports.commit).toHaveBeenCalledWith(claim, result);
});

test("rejects refs outside frozen registry before exposing text or committing", async () => {
    const { claim, ports } = fixture();
    ports.model = () => ({
        respond: async () => ({
            text: "",
            toolCalls: [
                call("read_frozen_excerpt", { ref: "other" }),
                call("submit_result", { ...result, claims: [{ text: "Fact", refs: ["other"] }] }),
            ],
        }),
    });
    expect(await executeVantageTask(claim, ports)).toEqual({
        status: "failed",
        reason: "task_result_refs_invalid",
    });
    expect(ports.readExcerpt).not.toHaveBeenCalled();
    expect(ports.commit).not.toHaveBeenCalled();
});

test("exposes exact ref IDs on authorized reads and gives invalid submissions bounded feedback", async () => {
    const { claim, ports } = fixture();
    ports.model = turn => ({
        respond: async ({ transcript, tools }) => {
            const definition = tools.find(tool => tool.name === "submit_result");
            expect(JSON.stringify(definition?.jsonSchema)).toContain('"claims"');
            const outputs = transcript.filter(item => item.role === "tool");
            if (turn === 1) {
                return {
                    text: "",
                    toolCalls: [
                        call("read_accepted_brief"),
                        call("read_frozen_excerpt", { ref: "frozen:1" }),
                    ],
                };
            }
            expect(outputs[0]?.content).toBe('{"frozenRefs":["frozen:1"],"brief":{"topics":[]}}');
            expect(outputs[1]?.content).toBe('{"ref":"frozen:1","text":"Exact excerpt"}');
            if (turn === 2) {
                return {
                    text: "",
                    toolCalls: [
                        call("submit_result", {
                            ...result,
                            claims: [{ text: "Fact", refs: ["wrong"] }],
                        }),
                    ],
                };
            }
            expect(outputs[2]).toMatchObject({
                isError: true,
                content: expect.stringContaining("Use exact refs returned by"),
            });
            expect(ports.commit).not.toHaveBeenCalled();
            return { text: "", toolCalls: [call("submit_result", result)] };
        },
    });
    expect(await executeVantageTask(claim, ports)).toEqual({ status: "submitted", turns: 3 });
    expect(ports.commit).toHaveBeenCalledWith(claim, result);
});

test("authority failure during a read is fatal, never another model turn", async () => {
    const { claim, ports } = fixture();
    let revoked = false;
    ports.authorize = async () => {
        if (revoked) throw new Error("private diagnostic");
    };
    ports.readBrief = async () => {
        revoked = true;
        return "secret";
    };
    const respond = jest.fn(async () => ({ text: "", toolCalls: [call("read_accepted_brief")] }));
    ports.model = () => ({ respond });
    expect(await executeVantageTask(claim, ports)).toEqual({
        status: "failed",
        reason: "task_authority_revoked",
    });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(ports.commit).not.toHaveBeenCalled();
});

test("six model turns and ten tool calls are hard ceilings", async () => {
    const { claim, ports } = fixture();
    const respond = jest.fn(async () => ({ text: "", toolCalls: [] }));
    ports.model = () => ({ respond });
    await executeVantageTask(claim, ports);
    expect(respond).toHaveBeenCalledTimes(6);
    const other = fixture();
    const reads = Array.from({ length: 8 }, (_, i) => ({
        ...call("read_accepted_brief"),
        id: String(i),
    }));
    const reading = jest.fn(async () => ({ text: "", toolCalls: reads }));
    other.ports.model = () => ({ respond: reading });
    await executeVantageTask(other.claim, other.ports);
    expect(other.ports.readBrief).toHaveBeenCalledTimes(10);
    expect(reading).toHaveBeenCalledTimes(2);
    expect(other.ports.commit).not.toHaveBeenCalled();
});

test("revocation at the conditional commit records a blocked authority outcome", async () => {
    const { claim, ports } = fixture();
    let revoked = false;
    ports.authorize = async () => {
        if (revoked) throw new Error("revoked");
    };
    ports.commit = async () => {
        revoked = true;
        throw new Error("fence rejected");
    };
    expect(await executeVantageTask(claim, ports)).toEqual({
        status: "failed",
        reason: "task_authority_revoked",
    });
    expect(ports.fail).toHaveBeenCalledWith(claim, "task_authority_revoked");
});

test("timeout from claim blocks provider and result commit", async () => {
    const { claim, ports } = fixture();
    claim.deadlineAt = Date.now() - 1;
    expect(await executeVantageTask(claim, ports)).toEqual({
        status: "failed",
        reason: "task_deadline",
    });
    expect(ports.model).not.toHaveBeenCalled();
    expect(ports.commit).not.toHaveBeenCalled();
});

test("physical retries journal each send and stop at live revocation", async () => {
    const { claim, ports } = fixture();
    const settle = jest.fn(async () => undefined);
    ports.beforeAttempt = jest.fn(async () => settle);
    let revoked = false;
    ports.authorize = async () => {
        if (revoked) throw new Error("revoked");
    };
    const send = jest.fn(async () => {
        revoked = true;
        return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    });
    ports.model = (_turn, retry) => ({
        respond: async () => {
            await fetchWithProviderRetry(
                "https://provider.invalid",
                { body: JSON.stringify({ messages: [] }) },
                send as typeof fetch,
                retry
            );
            return { text: "", toolCalls: [call("submit_result", result)] };
        },
    });
    expect((await executeVantageTask(claim, ports)).reason).toBe("task_authority_revoked");
    expect(send).toHaveBeenCalledTimes(1);
    expect(ports.beforeAttempt).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ statusClass: "rate_limited" }));
});

test("429 and 503 physical retries use existing three-send maximum", async () => {
    const { claim, ports } = fixture();
    const settle = jest.fn(async () => undefined);
    ports.beforeAttempt = jest.fn(async () => settle);
    const send = jest.fn(
        async () => new Response("{}", { status: 503, headers: { "retry-after": "0" } })
    );
    ports.model = (_turn, retry) => ({
        respond: async () => {
            await fetchWithProviderRetry(
                "https://provider.invalid",
                { body: JSON.stringify({ messages: [] }) },
                send as typeof fetch,
                retry
            );
            throw new Error("provider unavailable");
        },
    });
    await executeVantageTask(claim, ports);
    expect(send).toHaveBeenCalledTimes(3);
    expect(ports.beforeAttempt).toHaveBeenCalledTimes(3);
    expect(settle).toHaveBeenCalledTimes(3);
});
