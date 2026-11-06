import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createMeteredFetch, type MeteredFetchOptions } from "./metered-transport";
import { initializeRequestLedger, inspectRequestLedger, PHASE_A_CASES } from "./request-ledger";
const H = "a".repeat(64),
    endpoint = "https://synthetic-provider.invalid/openai/v1/chat/completions";
const messages = [{ role: "user", content: "Synthetic source only." }];
const body = JSON.stringify({ model: "gpt-6-luna", messages, max_completion_tokens: 2400 });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
const responseBody = {
    id: "synthetic-completion",
    model: "gpt-6-luna-test-revision",
    choices: [{ message: { content: "A synthetic response." } }],
    usage: {
        prompt_tokens: 17,
        completion_tokens: 9,
        total_tokens: 26,
        completion_tokens_details: { reasoning_tokens: 3 },
        prompt_tokens_details: { cached_tokens: 4 },
    },
};
async function fixture(overrides: Partial<MeteredFetchOptions> = {}) {
    const root = await mkdtemp(join(tmpdir(), "vantage-metered-test-"));
    roots.push(root);
    const ledgerDirectory = join(root, "ledger");
    await initializeRequestLedger(ledgerDirectory, { runId: "synthetic-meter", frozenSpecHash: H });
    const fetchImpl = vi.fn(
        async () =>
            new Response(JSON.stringify(responseBody), {
                status: 200,
                headers: {
                    "x-request-id": "request-unit-1",
                    authorization: "NEVER-SAVE-RESPONSE-HEADER",
                },
            })
    );
    const options: MeteredFetchOptions = {
        ledgerDirectory,
        metadata: {
            intentId: "synthetic-gen-1",
            phase: "A",
            caseId: PHASE_A_CASES[0],
            kind: "initial-generation",
            modelId: "gpt-6-luna",
            modelConfigHash: H,
            inputHash: H,
            promptHash: sha(JSON.stringify(messages)),
        },
        expectedUrl: endpoint,
        expectedModelId: "gpt-6-luna",
        requestPath: join(root, "request.json"),
        responsePath: join(root, "response.json"),
        expectedRequestHash: sha(body),
        sanitize: text => text.replaceAll("FAKE-SECRET", "[redacted]"),
        fetchImpl,
        ...overrides,
    };
    return { root, fetchImpl, options, fetch: createMeteredFetch(options) };
}
afterEach(async () => {
    for (const root of roots.splice(0)) {
        if (
            !resolve(root)
                .toLowerCase()
                .startsWith((resolve(tmpdir()) + sep + "vantage-metered-test-").toLowerCase())
        )
            throw new Error("Unsafe test cleanup path");
        await rm(root, { recursive: true, force: true });
    }
});
const request = () => ({
    method: "POST",
    body,
    headers: { authorization: "Bearer FAKE-SECRET", "api-key": "FAKE-SECRET" },
    redirect: "follow" as const,
});

describe("actual HTTP-boundary metering with synthetic fetch only", () => {
    it("meters exactly one HTTP dispatch, forces manual redirect and preserves the original SDK response", async () => {
        const f = await fixture(),
            original = request();
        const response = await f.fetch(endpoint, original);
        expect(await response.json()).toEqual(responseBody);
        expect(f.fetchImpl).toHaveBeenCalledOnce();
        const args = f.fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit];
        expect(args[1].redirect).toBe("manual");
        expect(args[1].headers).toEqual(original.headers);
        expect((await inspectRequestLedger(f.options.ledgerDirectory)).counts).toMatchObject({
            consumedSlots: 1,
            confirmedProviderResponses: 1,
        });
        const saved = JSON.parse(await readFile(f.options.responsePath, "utf8"));
        expect(saved).toMatchObject({
            httpStatus: 200,
            providerRequestId: "request-unit-1",
            responseModel: "gpt-6-luna-test-revision",
            usage: {
                inputTokens: 17,
                outputTokens: 9,
                totalTokens: 26,
                reasoningTokens: 3,
                cachedInputTokens: 4,
            },
            costUsd: null,
            costBasis: null,
            captureError: null,
        });
        expect(JSON.parse(saved.body)).toEqual(responseBody);
    });
    it("never serializes request/response headers, secrets or the endpoint", async () => {
        const f = await fixture();
        await f.fetch(endpoint, request());
        const artifacts =
            (await readFile(f.options.requestPath, "utf8")) +
            (await readFile(f.options.responsePath, "utf8")) +
            JSON.stringify(await inspectRequestLedger(f.options.ledgerDirectory));
        expect(artifacts).not.toContain("FAKE-SECRET");
        expect(artifacts).not.toContain("authorization");
        expect(artifacts).not.toContain("NEVER-SAVE-RESPONSE-HEADER");
        expect(artifacts).not.toContain(endpoint);
        expect(JSON.parse(await readFile(f.options.requestPath, "utf8"))).toMatchObject({
            requestBodyHash: sha(body),
            promptHash: sha(JSON.stringify(messages)),
            body,
        });
    });
    it.each(["url", "model", "messages", "request-hash", "method", "body-type"])(
        "rejects changed %s before any request or admission",
        async change => {
            const f = await fixture();
            let url = endpoint;
            const init: RequestInit = request();
            if (change === "url") url = "https://unapproved.invalid/model";
            if (change === "model") init.body = JSON.stringify({ model: "other-model", messages });
            if (change === "messages")
                init.body = JSON.stringify({
                    model: "gpt-6-luna",
                    messages: [{ role: "user", content: "Changed" }],
                });
            if (change === "request-hash")
                init.body = JSON.stringify({
                    model: "gpt-6-luna",
                    messages,
                    max_completion_tokens: 2401,
                });
            if (change === "method") init.method = "GET";
            if (change === "body-type") init.body = new URLSearchParams({ value: "synthetic" });
            await expect(f.fetch(url, init)).rejects.toThrow("Metered transport:");
            expect(f.fetchImpl).not.toHaveBeenCalled();
            expect(
                (await inspectRequestLedger(f.options.ledgerDirectory)).counts.consumedSlots
            ).toBe(0);
        }
    );
    it("rejects SDK automatic retry after a 400 while recording its raw failure body", async () => {
        const errorBody = {
            error: {
                code: "synthetic-validation",
                message: "Bad structured output request FAKE-SECRET",
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(errorBody), {
                    status: 400,
                    headers: { "apim-request-id": "synthetic-400" },
                })
        );
        const f = await fixture({ fetchImpl });
        const response = await f.fetch(endpoint, request());
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(errorBody);
        await expect(f.fetch(endpoint, request())).rejects.toThrow("automatic retry");
        expect(fetchImpl).toHaveBeenCalledOnce();
        const ledger = await inspectRequestLedger(f.options.ledgerDirectory);
        expect(ledger.state.records[0]).toMatchObject({
            status: "failed",
            receipt: { httpStatus: 400, providerRequestId: "synthetic-400" },
        });
        const capture = JSON.parse(await readFile(f.options.responsePath, "utf8"));
        expect(capture.body).toContain("[redacted]");
        expect(capture.body).not.toContain("FAKE-SECRET");
    });
    it("retains non-JSON provider text unchanged apart from sanitization", async () => {
        const f = await fixture({
            fetchImpl: vi.fn(
                async () => new Response("synthetic invalid-json FAKE-SECRET", { status: 502 })
            ),
        });
        const response = await f.fetch(endpoint, request());
        expect(await response.text()).toBe("synthetic invalid-json FAKE-SECRET");
        const capture = JSON.parse(await readFile(f.options.responsePath, "utf8"));
        expect(capture.body).toBe("synthetic invalid-json [redacted]");
        expect(capture.usage).toBeNull();
    });
    it("captures redirects without following or dispatching twice", async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(null, { status: 307, headers: { location: "https://other.invalid" } })
        );
        const f = await fixture({ fetchImpl });
        expect((await f.fetch(endpoint, request())).status).toBe(307);
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(
            (await inspectRequestLedger(f.options.ledgerDirectory)).state.records[0]?.status
        ).toBe("failed");
    });
    it("fails before dispatch if an artifact already exists and never overwrites it", async () => {
        const f = await fixture();
        await writeFile(f.options.responsePath, "old preserved response");
        await expect(f.fetch(endpoint, request())).rejects.toThrow("reserved");
        expect(await readFile(f.options.responsePath, "utf8")).toBe("old preserved response");
        expect(f.fetchImpl).not.toHaveBeenCalled();
        expect((await inspectRequestLedger(f.options.ledgerDirectory)).counts.consumedSlots).toBe(
            0
        );
    });
    it("cannot bypass a consumed initial slot by constructing a new wrapper", async () => {
        const f = await fixture();
        await f.fetch(endpoint, request());
        const other = createMeteredFetch({
            ...f.options,
            requestPath: join(f.root, "second-request.json"),
            responsePath: join(f.root, "second-response.json"),
        });
        await expect(other(endpoint, request())).rejects.toThrow("already consumed");
        expect(f.fetchImpl).toHaveBeenCalledOnce();
    });
    it("records a thrown network attempt without leaking its endpoint or secret exception", async () => {
        const f = await fixture({
            fetchImpl: vi.fn(async () => {
                throw new Error(`network failure ${endpoint} FAKE-SECRET`);
            }),
        });
        await expect(f.fetch(endpoint, request())).rejects.toThrow("provider HTTP request failed");
        const ledger = await inspectRequestLedger(f.options.ledgerDirectory);
        expect(ledger.counts).toMatchObject({ consumedSlots: 1, confirmedProviderResponses: 0 });
        const capture = await readFile(f.options.responsePath, "utf8");
        expect(capture).not.toContain(endpoint);
        expect(capture).not.toContain("FAKE-SECRET");
        expect(JSON.parse(capture).captureError).toBe("transport-error");
    });
    it("records the receipt but stops if response cloning fails", async () => {
        const response = new Response(JSON.stringify(responseBody), { status: 200 });
        vi.spyOn(response, "clone").mockImplementation(() => {
            throw new Error("secret internal clone error");
        });
        const f = await fixture({ fetchImpl: vi.fn(async () => response) });
        await expect(f.fetch(endpoint, request())).rejects.toThrow("response capture failed");
        expect(
            (await inspectRequestLedger(f.options.ledgerDirectory)).counts
                .confirmedProviderResponses
        ).toBe(1);
        expect(JSON.parse(await readFile(f.options.responsePath, "utf8")).captureError).toBe(
            "response-body-unavailable"
        );
    });
    it("pins factory metadata rather than accepting caller mutation after creation", async () => {
        const f = await fixture();
        f.options.metadata.promptHash = "b".repeat(64);
        f.options.expectedModelId = "other-model";
        expect((await f.fetch(endpoint, request())).status).toBe(200);
    });
});
