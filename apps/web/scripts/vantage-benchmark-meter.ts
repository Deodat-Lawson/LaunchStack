/** Azure-only paid-pilot usage accounting. Costs are list-rate estimates, with invoice billing unverified. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
export type BenchmarkMeterConfig = {
    limitUsd: number;
    modelId: string;
    endpointUrl: string;
    pricingSource: string;
    pricingScope: string;
    cachedPromptUsdPerToken: number;
    cacheWriteUsdPerToken: number;
    promptUsdPerToken: number;
    completionUsdPerToken: number;
    contextTokens: number;
    maxOutputTokens: number;
    timeoutMs: number;
    persist: (snapshot: BenchmarkMeterSnapshot) => Promise<void>;
    priorLedger?: BenchmarkMeterSnapshot;
    /** First pilot ledger predates the binding. Every row is still re-priced and validated. */
    allowLegacyPriorLedger?: boolean;
};
export type BenchmarkMeterRecord = {
    id: string;
    model: string;
    inputTokenCeiling: number;
    outputTokenCeiling: number;
    projectedUsd: number;
    status: "reserved" | "sent" | "settled" | "unknown" | "released";
    generationId?: string;
    servedModel?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    settledListRateUsd?: number;
    globalShortListRateUsd?: number;
    httpStatus?: number;
    failure?: string;
    route?: "digest" | "exploration";
    workId?: string;
    durationMs?: number;
    continuedAfterCaseDeadline?: true;
};
export type BenchmarkMeterSnapshot = {
    limitUsd: number;
    settledListRateUsd: number;
    reservedUsd: number;
    projectedTotalUsd: number;
    billingBasis: "Azure list rates applied to native usage; invoice billing unverified";
    pricingSource: string;
    pricingScope: string;
    hold: string | null;
    records: BenchmarkMeterRecord[];
    configuration?: BenchmarkMeterBinding;
};
export type BenchmarkMeterBinding = {
    modelId: string;
    endpointSha256: string;
    promptUsdPerToken: number;
    completionUsdPerToken: number;
    cachedPromptUsdPerToken: number;
    cacheWriteUsdPerToken: number;
    contextTokens: number;
    maxOutputTokens: number;
    timeoutMs: number;
};
const amount = z.number().finite().nonnegative();
const tokenCount = amount.int().safe();
const recordSchema = z
    .object({
        id: z.string().min(1),
        model: z.string().min(1),
        inputTokenCeiling: tokenCount.positive(),
        outputTokenCeiling: tokenCount.positive(),
        projectedUsd: amount,
        status: z.enum(["reserved", "sent", "settled", "unknown", "released"]),
        generationId: z.string().optional(),
        servedModel: z.string().optional(),
        inputTokens: tokenCount.optional(),
        outputTokens: tokenCount.optional(),
        cachedInputTokens: tokenCount.optional(),
        cacheWriteTokens: tokenCount.optional(),
        reasoningTokens: tokenCount.optional(),
        settledListRateUsd: amount.optional(),
        globalShortListRateUsd: amount.optional(),
        httpStatus: tokenCount.optional(),
        failure: z.string().optional(),
        route: z.enum(["digest", "exploration"]).optional(),
        workId: z
            .string()
            .regex(/^sweep-[0-9]{3}$/)
            .optional(),
        durationMs: amount.optional(),
        continuedAfterCaseDeadline: z.literal(true).optional(),
    })
    .strict();
const bindingSchema = z
    .object({
        modelId: z.string(),
        endpointSha256: z.string().regex(/^[a-f0-9]{64}$/),
        promptUsdPerToken: amount,
        completionUsdPerToken: amount,
        cachedPromptUsdPerToken: amount,
        cacheWriteUsdPerToken: amount,
        contextTokens: tokenCount,
        maxOutputTokens: tokenCount,
        timeoutMs: tokenCount,
    })
    .strict();
const snapshotSchema = z
    .object({
        limitUsd: amount,
        settledListRateUsd: amount,
        reservedUsd: amount,
        projectedTotalUsd: amount,
        billingBasis: z.literal(
            "Azure list rates applied to native usage; invoice billing unverified"
        ),
        pricingSource: z.string(),
        pricingScope: z.string(),
        hold: z
            .enum([
                "usage_unresolved",
                "persistence_failed",
                "projected_budget_exceeded",
                "reservation_exceeded",
                "list_rate_budget_exceeded",
                "provider_error",
            ])
            .nullable(),
        records: z.array(recordSchema),
        configuration: bindingSchema.optional(),
    })
    .strict();
const nonnegative = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number =>
    nonnegative(value) && Number.isSafeInteger(value);
const upwardUsd = (value: number) => Math.ceil(value * 1e9) / 1e9;
export function createBenchmarkMeter(config: BenchmarkMeterConfig) {
    if (
        !nonnegative(config.limitUsd) ||
        config.limitUsd > 15 ||
        config.limitUsd === 0 ||
        !config.modelId ||
        !nonnegative(config.promptUsdPerToken) ||
        !nonnegative(config.completionUsdPerToken) ||
        !nonnegative(config.cachedPromptUsdPerToken) ||
        !nonnegative(config.cacheWriteUsdPerToken) ||
        !config.pricingSource ||
        !config.pricingScope ||
        !integer(config.contextTokens) ||
        !integer(config.maxOutputTokens) ||
        config.maxOutputTokens < 1 ||
        config.maxOutputTokens > 6000 ||
        config.contextTokens <= config.maxOutputTokens ||
        !integer(config.timeoutMs) ||
        config.timeoutMs < 1 ||
        config.timeoutMs > 150000
    )
        throw new Error("benchmark_meter_config_invalid");
    const endpoint = new URL(config.endpointUrl);
    if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash ||
        !endpoint.hostname.endsWith(".openai.azure.com") ||
        !endpoint.pathname.endsWith("/chat/completions")
    )
        throw new Error("benchmark_meter_endpoint_config_invalid");
    const responsesEndpoint = new URL(endpoint.href.replace(/\/chat\/completions$/, "/responses"));
    const configuration: BenchmarkMeterBinding = {
        modelId: config.modelId,
        endpointSha256: createHash("sha256").update(endpoint.href).digest("hex"),
        promptUsdPerToken: config.promptUsdPerToken,
        completionUsdPerToken: config.completionUsdPerToken,
        cachedPromptUsdPerToken: config.cachedPromptUsdPerToken,
        cacheWriteUsdPerToken: config.cacheWriteUsdPerToken,
        contextTokens: config.contextTokens,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
    };
    const prior =
        config.priorLedger === undefined ? undefined : snapshotSchema.parse(config.priorLedger);
    const records: BenchmarkMeterRecord[] = prior ? structuredClone(prior.records) : [];
    const context = new AsyncLocalStorage<string>();
    const workContext = new AsyncLocalStorage<string>();
    let hold: string | null = prior?.hold ?? null;
    const pending = new Set<Promise<unknown>>();
    function tracked<T>(promise: Promise<T>): Promise<T> {
        pending.add(promise);
        promise.finally(() => pending.delete(promise)).catch(() => {});
        return promise;
    }
    let persistence: Promise<void> = Promise.resolve();
    function snapshot(): BenchmarkMeterSnapshot {
        const settledListRateUsd = upwardUsd(
            records.reduce((sum, row) => sum + (row.settledListRateUsd ?? 0), 0)
        );
        const reservedUsd = upwardUsd(
            records
                .filter(
                    row =>
                        ["reserved", "sent", "unknown"].includes(row.status) &&
                        row.settledListRateUsd === undefined
                )
                .reduce((sum, row) => sum + row.projectedUsd, 0)
        );
        return {
            limitUsd: config.limitUsd,
            settledListRateUsd,
            reservedUsd,
            projectedTotalUsd: upwardUsd(settledListRateUsd + reservedUsd),
            hold,
            billingBasis: "Azure list rates applied to native usage; invoice billing unverified",
            pricingSource: config.pricingSource,
            pricingScope: config.pricingScope,
            records: structuredClone(records),
            configuration,
        };
    }
    if (prior) {
        const matches = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
        const valid =
            prior.limitUsd === config.limitUsd &&
            prior.pricingSource === config.pricingSource &&
            prior.pricingScope === config.pricingScope &&
            (prior.configuration
                ? JSON.stringify(bindingSchema.parse(prior.configuration)) ===
                  JSON.stringify(bindingSchema.parse(configuration))
                : config.allowLegacyPriorLedger === true) &&
            new Set(records.map(row => row.id)).size === records.length &&
            records.every(row => {
                if (
                    row.model !== config.modelId ||
                    row.outputTokenCeiling !== config.maxOutputTokens ||
                    row.inputTokenCeiling + row.outputTokenCeiling > config.contextTokens ||
                    !matches(
                        row.projectedUsd,
                        upwardUsd(
                            row.inputTokenCeiling *
                                Math.max(config.promptUsdPerToken, config.cacheWriteUsdPerToken) +
                                row.outputTokenCeiling * config.completionUsdPerToken
                        )
                    )
                )
                    return false;
                if (row.status !== "settled") return row.settledListRateUsd === undefined;
                if (
                    row.inputTokens === undefined ||
                    row.outputTokens === undefined ||
                    row.settledListRateUsd === undefined
                )
                    return false;
                const cached = row.cachedInputTokens ?? 0,
                    writes = row.cacheWriteTokens ?? 0;
                return (
                    cached + writes <= row.inputTokens &&
                    matches(
                        row.settledListRateUsd,
                        upwardUsd(
                            (row.inputTokens - cached - writes) * config.promptUsdPerToken +
                                cached * config.cachedPromptUsdPerToken +
                                writes * config.cacheWriteUsdPerToken +
                                row.outputTokens * config.completionUsdPerToken
                        )
                    )
                );
            });
        const current = snapshot();
        if (
            !valid ||
            !matches(current.settledListRateUsd, prior.settledListRateUsd) ||
            !matches(current.reservedUsd, prior.reservedUsd) ||
            !matches(current.projectedTotalUsd, prior.projectedTotalUsd)
        )
            throw new Error("benchmark_meter_prior_ledger_invalid");
        if (current.projectedTotalUsd > config.limitUsd && (!hold || hold === "usage_unresolved"))
            hold = "projected_budget_exceeded";
        if (
            records.some(
                row =>
                    row.status === "settled" &&
                    ((row.settledListRateUsd ?? 0) > row.projectedUsd + 1e-9 ||
                        (row.inputTokens ?? 0) > row.inputTokenCeiling ||
                        (row.outputTokens ?? 0) > row.outputTokenCeiling)
            ) &&
            (!hold || hold === "usage_unresolved")
        )
            hold = "reservation_exceeded";
        if (records.some(row => row.status === "sent")) {
            for (const row of records)
                if (row.status === "sent") {
                    row.status = "unknown";
                    row.failure = "usage_unresolved";
                }
            hold ??= "usage_unresolved";
        }
        if (
            records.some(row => row.status === "unknown" && !row.continuedAfterCaseDeadline) &&
            !hold
        )
            hold = "usage_unresolved";
    }
    async function drainPending() {
        while (pending.size) await Promise.allSettled([...pending]);
    }
    async function clearCaseDeadlineHold(confirmation: {
        terminalCode: "topic_exploration_failed:timeout";
    }) {
        if (
            confirmation?.terminalCode !== "topic_exploration_failed:timeout" ||
            hold !== "usage_unresolved" ||
            snapshot().projectedTotalUsd > config.limitUsd ||
            pending.size ||
            records.some(
                row =>
                    row.status === "sent" ||
                    row.status === "reserved" ||
                    (row.status === "unknown" &&
                        !row.continuedAfterCaseDeadline &&
                        row.httpStatus !== undefined &&
                        (row.httpStatus < 200 || row.httpStatus >= 300))
            ) ||
            !records.some(row => row.status === "unknown" && !row.continuedAfterCaseDeadline)
        )
            throw new Error("benchmark_meter_case_deadline_clear_denied");
        for (const row of records)
            if (row.status === "unknown") row.continuedAfterCaseDeadline = true;
        hold = null;
        await persist();
    }
    function assertCanDispatch() {
        if (hold) throw new Error("benchmark_meter_hold:" + hold);
    }
    async function persist() {
        const value = snapshot();
        const write = persistence.then(() => config.persist(value));
        persistence = write.catch(() => {});
        try {
            await write;
        } catch {
            hold = "persistence_failed";
            throw new Error("benchmark_meter_hold:persistence_failed");
        }
    }
    async function reserveBatch(inputTokenCeilings: readonly number[]) {
        assertCanDispatch();
        if (
            !inputTokenCeilings.length ||
            inputTokenCeilings.some(
                tokens =>
                    !integer(tokens) ||
                    tokens < 1 ||
                    tokens + config.maxOutputTokens > config.contextTokens
            )
        )
            throw new Error("benchmark_meter_context_exceeded");
        const batch = inputTokenCeilings.map(inputTokenCeiling => ({
            id: randomUUID(),
            model: config.modelId,
            inputTokenCeiling,
            outputTokenCeiling: config.maxOutputTokens,
            projectedUsd: upwardUsd(
                inputTokenCeiling *
                    Math.max(config.promptUsdPerToken, config.cacheWriteUsdPerToken) +
                    config.maxOutputTokens * config.completionUsdPerToken
            ),
            status: "reserved" as const,
        }));
        if (
            upwardUsd(
                snapshot().projectedTotalUsd + batch.reduce((sum, row) => sum + row.projectedUsd, 0)
            ) > config.limitUsd
        ) {
            hold = "projected_budget_exceeded";
            await persist();
            throw new Error("benchmark_meter_projected_budget_exceeded");
        }
        records.push(...batch);
        await persist();
        return batch.map(row => row.id);
    }
    async function releaseUnused(ids?: readonly string[]) {
        for (const row of records)
            if (row.status === "reserved" && (!ids || ids.includes(row.id)))
                row.status = "released";
        await persist();
    }
    async function withReservation<T>(id: string, work: () => Promise<T>): Promise<T> {
        const row = records.find(item => item.id === id);
        if (!row || row.status !== "reserved")
            throw new Error("benchmark_meter_reservation_invalid");
        return context.run(id, work);
    }
    function wrapFetch(baseFetch: typeof fetch): typeof fetch {
        const dispatch: typeof fetch = async (input, init) => {
            assertCanDispatch();
            const url = new URL(
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url
            );
            if (url.href !== endpoint.href && url.href !== responsesEndpoint.href)
                throw new Error("benchmark_meter_endpoint_denied");
            const responses = url.href === responsesEndpoint.href;
            const method = init?.method ?? (input instanceof Request ? input.method : "GET");
            if (method.toUpperCase() !== "POST" || typeof init?.body !== "string")
                throw new Error("benchmark_meter_request_invalid");
            const body = JSON.parse(init.body) as Record<string, unknown>;
            if (
                body.model !== config.modelId ||
                body.models !== undefined ||
                body.stream === true ||
                (responses
                    ? !(typeof body.input === "string" || Array.isArray(body.input))
                    : !Array.isArray(body.messages))
            )
                throw new Error("benchmark_meter_model_or_stream_denied");
            const messages = (
                responses ? (Array.isArray(body.input) ? body.input : []) : body.messages
            ) as { content?: unknown }[];
            for (const message of messages) {
                if (
                    message.content !== undefined &&
                    message.content !== null &&
                    typeof message.content !== "string" &&
                    !(
                        Array.isArray(message.content) &&
                        message.content.every(
                            part =>
                                part &&
                                ["text", "input_text", "output_text"].includes(part.type) &&
                                typeof part.text === "string"
                        )
                    )
                )
                    throw new Error("benchmark_meter_nontext_denied");
            }
            for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"])
                if (
                    body[key] !== undefined &&
                    (!integer(body[key]) || body[key] > config.maxOutputTokens || body[key] < 1)
                )
                    throw new Error("benchmark_meter_output_cap_exceeded");
            const requestedOutput = Number(
                body.max_output_tokens ??
                    body.max_completion_tokens ??
                    body.max_tokens ??
                    config.maxOutputTokens
            );
            if (responses) {
                body.max_output_tokens = requestedOutput;
                delete body.max_tokens;
                delete body.max_completion_tokens;
            } else if (body.max_completion_tokens !== undefined) {
                body.max_completion_tokens = requestedOutput;
                delete body.max_tokens;
            } else body.max_tokens = requestedOutput;
            body.stream = false;
            if (
                body.provider !== undefined ||
                body.plugins !== undefined ||
                body.web_search_options !== undefined ||
                (Array.isArray(body.tools) &&
                    body.tools.some(
                        tool => !tool || (tool as { type?: string }).type !== "function"
                    )) ||
                (body.n !== undefined && body.n !== 1)
            )
                throw new Error("benchmark_meter_extra_billing_denied");
            const serialized = JSON.stringify(body);
            // UTF-8 bytes upper-bound ordinary text tokens. Reserve extra protocol framing per message/tool.
            const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
            const ceiling =
                Buffer.byteLength(serialized, "utf8") + 1024 + 256 * (messages.length + toolCount);
            if (ceiling + config.maxOutputTokens > config.contextTokens)
                throw new Error("benchmark_meter_context_exceeded");
            const reservedId = context.getStore() ?? (await reserveBatch([ceiling]))[0]!;
            assertCanDispatch();
            const row = records.find(item => item.id === reservedId);
            if (!row || row.status !== "reserved" || ceiling > row.inputTokenCeiling)
                throw new Error("benchmark_meter_reservation_invalid");
            row.status = "sent";
            row.route = responses ? "exploration" : "digest";
            const workId = workContext.getStore();
            if (workId) row.workId = workId;
            const dispatchedAt = performance.now();
            await persist();
            const signal = AbortSignal.any([
                AbortSignal.timeout(config.timeoutMs),
                ...(init.signal ? [init.signal] : []),
            ]);
            let onAbort: (() => void) | undefined;
            const deadline = new Promise<never>((_, reject) => {
                onAbort = () => reject(new Error("usage_unresolved"));
                signal.addEventListener("abort", onAbort, { once: true });
                if (signal.aborted) onAbort();
            });
            try {
                signal.throwIfAborted();
                const response = await Promise.race([
                    tracked(
                        baseFetch(input, {
                            ...init,
                            body: serialized,
                            signal,
                            redirect: "error",
                        })
                    ),
                    deadline,
                ]);
                row.httpStatus = response.status;
                let json: Record<string, unknown>;
                try {
                    json = (await Promise.race([
                        tracked(response.clone().json()),
                        deadline,
                    ])) as Record<string, unknown>;
                } catch {
                    throw new Error("usage_missing");
                }
                if (typeof json.id === "string") row.generationId = json.id;
                if (typeof json.model === "string") row.servedModel = json.model;
                const usage = json.usage as Record<string, unknown> | undefined;
                const inputTokens = responses ? usage?.input_tokens : usage?.prompt_tokens;
                const outputTokens = responses ? usage?.output_tokens : usage?.completion_tokens;
                if (!usage || !integer(inputTokens) || !integer(outputTokens))
                    throw new Error("usage_missing");
                row.inputTokens = inputTokens;
                row.outputTokens = outputTokens;
                const prompt = (
                    responses ? usage.input_tokens_details : usage.prompt_tokens_details
                ) as Record<string, unknown> | undefined;
                const completion = (
                    responses ? usage.output_tokens_details : usage.completion_tokens_details
                ) as Record<string, unknown> | undefined;
                if (integer(prompt?.cached_tokens)) row.cachedInputTokens = prompt.cached_tokens;
                if (integer(prompt?.cache_write_tokens))
                    row.cacheWriteTokens = prompt.cache_write_tokens;
                const cached = row.cachedInputTokens ?? 0,
                    writes = row.cacheWriteTokens ?? 0;
                if (cached + writes > row.inputTokens) throw new Error("usage_invalid");
                row.settledListRateUsd = upwardUsd(
                    (row.inputTokens - cached - writes) * config.promptUsdPerToken +
                        cached * config.cachedPromptUsdPerToken +
                        writes * config.cacheWriteUsdPerToken +
                        row.outputTokens * config.completionUsdPerToken
                );
                row.globalShortListRateUsd = upwardUsd(
                    ((row.inputTokens - cached - writes) * 0.1 +
                        cached * 0.01 +
                        writes * 0.125 +
                        row.outputTokens * 0.5) /
                        1e6
                );
                if (integer(completion?.reasoning_tokens))
                    row.reasoningTokens = completion.reasoning_tokens;
                row.status = "settled";
                row.durationMs = performance.now() - dispatchedAt;
                if (!response.ok) hold = "provider_error";
                else if (
                    row.settledListRateUsd > row.projectedUsd + 1e-9 ||
                    row.inputTokens > row.inputTokenCeiling ||
                    row.outputTokens > row.outputTokenCeiling
                )
                    hold = "reservation_exceeded";
                else if (snapshot().settledListRateUsd > config.limitUsd)
                    hold = "list_rate_budget_exceeded";
                await persist();
                if (hold) throw new Error("benchmark_meter_hold:" + hold);
                return response;
            } catch {
                if (row.status !== "settled") {
                    row.status = "unknown";
                    row.durationMs = performance.now() - dispatchedAt;
                    row.failure = "usage_unresolved";
                    hold = "usage_unresolved";
                    await persist();
                }
                throw new Error("benchmark_meter_hold:" + (hold ?? "usage_unresolved"));
            } finally {
                if (onAbort) signal.removeEventListener("abort", onAbort);
            }
        };
        return (input, init) => tracked(dispatch(input, init));
    }
    return {
        snapshot,
        reserveBatch,
        withReservation,
        withWork<T>(id: string, work: () => Promise<T>) {
            if (!/^sweep-[0-9]{3}$/.test(id)) throw new Error("benchmark_meter_work_id_invalid");
            return workContext.run(id, work);
        },
        releaseUnused,
        assertCanDispatch,
        wrapFetch,
        drainPending,
        clearCaseDeadlineHold,
    };
}
