/** @jest-environment node */
import { createBenchmarkMeter } from "../../scripts/vantage-benchmark-meter";
const endpoint = "https://fixture.openai.azure.com/openai/v1/chat/completions";
const config = () => ({
    limitUsd: 15,
    modelId: "gpt-6-luna",
    endpointUrl: endpoint,
    pricingSource:
        "https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/",
    pricingScope: "Global Standard short context list rate fixture",
    promptUsdPerToken: 0.1 / 1e6,
    cachedPromptUsdPerToken: 0.01 / 1e6,
    cacheWriteUsdPerToken: 0.125 / 1e6,
    completionUsdPerToken: 0.5 / 1e6,
    contextTokens: 1000000,
    maxOutputTokens: 6000,
    timeoutMs: 1000,
    persist: jest.fn(async () => {}),
});
const request = () => ({
    method: "POST",
    body: JSON.stringify({
        model: "gpt-6-luna",
        messages: [{ role: "user", content: "Synthetic text" }],
        max_tokens: 6000,
    }),
});
const completion = () =>
    new Response(
        JSON.stringify({
            id: "azure-fixture",
            model: "gpt-6-luna",
            usage: {
                prompt_tokens: 20,
                completion_tokens: 10,
                prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 4 },
                completion_tokens_details: { reasoning_tokens: 3 },
            },
            choices: [],
        }),
        { headers: { "content-type": "application/json" } }
    );
it("records native tokens and labels settled list-rate cost with invoice billing unverified", async () => {
    const c = config(),
        meter = createBenchmarkMeter(c);
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => completion());
    const result = await meter.wrapFetch(send)(endpoint, request());
    expect((await result.json()).id).toBe("azure-fixture");
    expect(meter.snapshot()).toMatchObject({
        settledListRateUsd: 0.00000692,
        reservedUsd: 0,
        hold: null,
        billingBasis: "Azure list rates applied to native usage; invoice billing unverified",
    });
    expect(meter.snapshot().records[0]).toMatchObject({
        generationId: "azure-fixture",
        inputTokens: 20,
        outputTokens: 10,
        cachedInputTokens: 2,
        cacheWriteTokens: 4,
        reasoningTokens: 3,
        status: "settled",
    });
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ stream: false, max_tokens: 6000 });
    expect(body).not.toHaveProperty("provider");
    expect(send.mock.calls[0]![1]?.redirect).toBe("error");
    expect(c.persist).toHaveBeenCalledTimes(3);
});
it("binds interleaved paid requests to independent sweep work", async () => {
    const meter = createBenchmarkMeter(config());
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => completion());
    const invoke = meter.wrapFetch(send);
    await Promise.all([
        meter.withWork("sweep-001", () => invoke(endpoint, request())),
        meter.withWork("sweep-002", () => invoke(endpoint, request())),
    ]);
    expect(meter.snapshot().records.map(row => row.workId)).toEqual(["sweep-001", "sweep-002"]);
    expect(meter.snapshot().records.every(row => row.status === "settled")).toBe(true);
});
it("rejects a batch above the approved projection before any dispatch", async () => {
    const meter = createBenchmarkMeter({ ...config(), limitUsd: 0.005 });
    await expect(meter.reserveBatch([100, 100])).rejects.toThrow("projected_budget_exceeded");
    expect(meter.snapshot().records).toHaveLength(0);
});
it("consumes a batch ticket once and releases unused capacity", async () => {
    const meter = createBenchmarkMeter(config());
    const ids = await meter.reserveBatch([10000, 10000]);
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => completion());
    await meter.withReservation(ids[0]!, () => meter.wrapFetch(send)(endpoint, request()));
    await expect(meter.withReservation(ids[0]!, async () => {})).rejects.toThrow(
        "reservation_invalid"
    );
    await meter.releaseUnused();
    expect(meter.snapshot().reservedUsd).toBe(0);
});
it("missing usage holds future dispatch and preserves unknown exposure", async () => {
    const meter = createBenchmarkMeter(config());
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(
        async () => new Response(JSON.stringify({ id: "unknown" }))
    );
    const fetch = meter.wrapFetch(send);
    await expect(fetch(endpoint, request())).rejects.toThrow("usage_unresolved");
    expect(meter.snapshot().reservedUsd).toBeGreaterThan(0);
    await expect(fetch(endpoint, request())).rejects.toThrow("usage_unresolved");
    expect(send).toHaveBeenCalledTimes(1);
});
it("transport failure prevents retries", async () => {
    const meter = createBenchmarkMeter(config());
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => {
        throw Error("network");
    });
    const fetch = meter.wrapFetch(send);
    await expect(fetch(endpoint, request())).rejects.toThrow("usage_unresolved");
    await expect(fetch(endpoint, request())).rejects.toThrow("usage_unresolved");
    expect(send).toHaveBeenCalledTimes(1);
});
it.each([
    "https://other.openai.azure.com/openai/v1/chat/completions",
    "https://fixture.openai.azure.com/openai/v1/embeddings",
    endpoint + "?api-version=changed",
])("denies an unselected endpoint %s", async url => {
    const meter = createBenchmarkMeter(config());
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    await expect(meter.wrapFetch(send)(url, request())).rejects.toThrow("endpoint_denied");
    expect(send).not.toHaveBeenCalled();
});
it("rejects different deployment, output cap and context excess before sending", async () => {
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    const body = JSON.parse(request().body);
    body.model = "another";
    await expect(
        createBenchmarkMeter(config()).wrapFetch(send)(endpoint, {
            method: "POST",
            body: JSON.stringify(body),
        })
    ).rejects.toThrow("model_or_stream_denied");
    body.model = "gpt-6-luna";
    body.max_tokens = 6001;
    await expect(
        createBenchmarkMeter(config()).wrapFetch(send)(endpoint, {
            method: "POST",
            body: JSON.stringify(body),
        })
    ).rejects.toThrow("output_cap_exceeded");
    await expect(
        createBenchmarkMeter({ ...config(), contextTokens: 7000 }).wrapFetch(send)(
            endpoint,
            request()
        )
    ).rejects.toThrow("context_exceeded");
    expect(send).not.toHaveBeenCalled();
});
it("persistence failure prevents dispatch", async () => {
    const meter = createBenchmarkMeter({
        ...config(),
        persist: async () => {
            throw Error("disk");
        },
    });
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    await expect(meter.wrapFetch(send)(endpoint, request())).rejects.toThrow("persistence_failed");
    expect(send).not.toHaveBeenCalled();
});
it("all concurrent reservations count toward the ceiling", async () => {
    const meter = createBenchmarkMeter({ ...config(), limitUsd: 0.005 });
    let finish!: (response: Response) => void;
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(
        () =>
            new Promise<Response>(resolve => {
                finish = resolve;
            })
    );
    const fetch = meter.wrapFetch(send);
    const first = fetch(endpoint, request());
    for (let index = 0; index < 10 && !send.mock.calls.length; index++) await Promise.resolve();
    await expect(fetch(endpoint, request())).rejects.toThrow("projected_budget_exceeded");
    finish(completion());
    await expect(first).rejects.toThrow("projected_budget_exceeded");
    expect(meter.snapshot().records[0]?.status).toBe("settled");
    expect(send).toHaveBeenCalledTimes(1);
});
it("meters Azure Responses input/output tokens and preserves high reasoning configuration", async () => {
    const meter = createBenchmarkMeter(config());
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "resp-fixture",
                    model: "gpt-6-luna",
                    usage: {
                        input_tokens: 100,
                        output_tokens: 30,
                        input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
                        output_tokens_details: { reasoning_tokens: 20 },
                    },
                    output: [],
                })
            )
    );
    await meter.wrapFetch(send)(endpoint.replace("/chat/completions", "/responses"), {
        method: "POST",
        body: JSON.stringify({
            model: "gpt-6-luna",
            input: [{ role: "user", content: [{ type: "input_text", text: "Synthetic" }] }],
            reasoning: { effort: "high" },
            max_output_tokens: 6000,
            store: false,
        }),
    });
    expect(meter.snapshot().records[0]).toMatchObject({
        inputTokens: 100,
        outputTokens: 30,
        cachedInputTokens: 40,
        cacheWriteTokens: 10,
        reasoningTokens: 20,
    });
    expect(JSON.parse(send.mock.calls[0]![1]!.body as string)).toMatchObject({
        reasoning: { effort: "high" },
        max_output_tokens: 6000,
        store: false,
    });
});
it("blocks server tools and multi-completion billing", async () => {
    const meter = createBenchmarkMeter(config());
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    const body = JSON.parse(request().body);
    body.tools = [{ type: "web_search" }];
    await expect(
        meter.wrapFetch(send)(endpoint, { method: "POST", body: JSON.stringify(body) })
    ).rejects.toThrow("extra_billing_denied");
    expect(send).not.toHaveBeenCalled();
});
it("fences a transport which ignores abort and holds its exposure", async () => {
    const meter = createBenchmarkMeter({ ...config(), timeoutMs: 5 });
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() => new Promise(() => {}));
    await expect(meter.wrapFetch(send)(endpoint, request())).rejects.toThrow("usage_unresolved");
    expect(meter.snapshot().records[0]?.status).toBe("unknown");
    expect(meter.snapshot().reservedUsd).toBeGreaterThan(0);
});
async function unresolvedLedger() {
    const meter = createBenchmarkMeter(config());
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => {
        throw Error("fixture interrupted");
    });
    await expect(meter.wrapFetch(send)(endpoint, request())).rejects.toThrow("usage_unresolved");
    await meter.drainPending();
    return meter.snapshot();
}
it("restores an unknown reservation and permits a verified next case without releasing exposure", async () => {
    const prior = await unresolvedLedger();
    const meter = createBenchmarkMeter({ ...config(), priorLedger: prior });
    expect(meter.snapshot().reservedUsd).toBe(prior.reservedUsd);
    await expect(meter.reserveBatch([100])).rejects.toThrow("usage_unresolved");
    await meter.drainPending();
    await meter.clearCaseDeadlineHold({ terminalCode: "topic_exploration_failed:timeout" });
    expect(meter.snapshot()).toMatchObject({ hold: null, reservedUsd: prior.reservedUsd });
    expect(meter.snapshot().records[0]).toMatchObject({
        id: prior.records[0]!.id,
        status: "unknown",
        continuedAfterCaseDeadline: true,
    });
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => completion());
    await meter.wrapFetch(send)(endpoint, request());
    expect(meter.snapshot().records).toHaveLength(2);
    expect(meter.snapshot().reservedUsd).toBe(prior.reservedUsd);
});
it("accepts the first legacy archive only explicitly and validates all recorded exposure", async () => {
    const prior = await unresolvedLedger();
    delete prior.configuration;
    expect(() => createBenchmarkMeter({ ...config(), priorLedger: prior })).toThrow(
        "prior_ledger_invalid"
    );
    const restored = createBenchmarkMeter({
        ...config(),
        priorLedger: prior,
        allowLegacyPriorLedger: true,
    });
    expect(restored.snapshot().reservedUsd).toBe(prior.reservedUsd);
    const altered = structuredClone(prior);
    altered.records[0]!.projectedUsd = 0;
    expect(() =>
        createBenchmarkMeter({ ...config(), priorLedger: altered, allowLegacyPriorLedger: true })
    ).toThrow("prior_ledger_invalid");
});
it("rejects restoring a different deployment, rate, endpoint, cap or aggregate", async () => {
    const prior = await unresolvedLedger();
    expect(() =>
        createBenchmarkMeter({ ...config(), modelId: "other", priorLedger: prior })
    ).toThrow("prior_ledger_invalid");
    expect(() =>
        createBenchmarkMeter({ ...config(), promptUsdPerToken: 0.9 / 1e6, priorLedger: prior })
    ).toThrow("prior_ledger_invalid");
    expect(() =>
        createBenchmarkMeter({
            ...config(),
            endpointUrl: endpoint.replace("fixture.", "another."),
            priorLedger: prior,
        })
    ).toThrow("prior_ledger_invalid");
    expect(() => createBenchmarkMeter({ ...config(), limitUsd: 14, priorLedger: prior })).toThrow(
        "prior_ledger_invalid"
    );
    expect(() =>
        createBenchmarkMeter({ ...config(), priorLedger: { ...prior, reservedUsd: 0 } })
    ).toThrow("prior_ledger_invalid");
});
it("does not clear a deadline hold while the original transport remains in flight", async () => {
    const meter = createBenchmarkMeter({ ...config(), timeoutMs: 5 });
    let finish!: (value: Response) => void;
    const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>(
        () =>
            new Promise(resolve => {
                finish = resolve;
            })
    );
    await expect(meter.wrapFetch(send)(endpoint, request())).rejects.toThrow("usage_unresolved");
    await expect(
        meter.clearCaseDeadlineHold({ terminalCode: "topic_exploration_failed:timeout" })
    ).rejects.toThrow("case_deadline_clear_denied");
    finish(completion());
    await meter.drainPending();
    await meter.clearCaseDeadlineHold({ terminalCode: "topic_exploration_failed:timeout" });
    expect(meter.snapshot().reservedUsd).toBeGreaterThan(0);
});
it("never clears a projection or persistence hold", async () => {
    const projected = createBenchmarkMeter({ ...config(), limitUsd: 0.005 });
    await expect(projected.reserveBatch([100, 100])).rejects.toThrow("projected_budget_exceeded");
    await expect(
        projected.clearCaseDeadlineHold({ terminalCode: "topic_exploration_failed:timeout" })
    ).rejects.toThrow("case_deadline_clear_denied");
    const disk = createBenchmarkMeter({
        ...config(),
        persist: async () => {
            throw Error("disk");
        },
    });
    await expect(disk.reserveBatch([100])).rejects.toThrow("persistence_failed");
    await expect(
        disk.clearCaseDeadlineHold({ terminalCode: "topic_exploration_failed:timeout" })
    ).rejects.toThrow("case_deadline_clear_denied");
});
it("records route and elapsed time without request contents", async () => {
    const meter = createBenchmarkMeter(config());
    await meter.wrapFetch(
        jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => completion())
    )(endpoint, request());
    expect(meter.snapshot().records[0]).toMatchObject({
        route: "digest",
        durationMs: expect.any(Number),
    });
    expect(JSON.stringify(meter.snapshot())).not.toContain("Synthetic text");
});
it("restores sticky provider holds and refuses verified-deadline clearing above the cap", async () => {
    const prior = await unresolvedLedger();
    const provider = createBenchmarkMeter({
        ...config(),
        priorLedger: { ...prior, hold: "provider_error" },
    });
    await expect(
        provider.clearCaseDeadlineHold({ terminalCode: "topic_exploration_failed:timeout" })
    ).rejects.toThrow("case_deadline_clear_denied");
    const aboveCap = { ...prior, limitUsd: 0.001 };
    const capped = createBenchmarkMeter({ ...config(), limitUsd: 0.001, priorLedger: aboveCap });
    await expect(
        capped.clearCaseDeadlineHold({ terminalCode: "topic_exploration_failed:timeout" })
    ).rejects.toThrow("case_deadline_clear_denied");
    expect(capped.snapshot().hold).toBe("projected_budget_exceeded");
});
it("settled legacy usage is re-priced before accepting its old ledger", async () => {
    const old = createBenchmarkMeter(config());
    await old.wrapFetch(
        jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => completion())
    )(endpoint, request());
    const prior = old.snapshot();
    delete prior.configuration;
    expect(() =>
        createBenchmarkMeter({ ...config(), priorLedger: prior, allowLegacyPriorLedger: true })
    ).not.toThrow();
    prior.records[0]!.settledListRateUsd = 0;
    expect(() =>
        createBenchmarkMeter({ ...config(), priorLedger: prior, allowLegacyPriorLedger: true })
    ).toThrow("prior_ledger_invalid");
});
