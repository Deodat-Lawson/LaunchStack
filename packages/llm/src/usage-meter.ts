/**
 * Counting what every model call used.
 *
 * The provider reports usage on each chat completion: in the JSON body, or in
 * the last event of a stream when `stream_options.include_usage` is set
 * (LangChain's adapter sets it whenever it streams). This module reads that
 * report as the response passes through the shared `fetch`
 * (endpoint-fetch.ts) and hands it to whoever the current unit of work says
 * should hear about it. The host puts a {@link ChatUsageRecorder} on the chat
 * scope (`runWithChatModelsScope`), so a feature package that makes a call
 * never learns it was counted, and cannot forget to be.
 *
 * Counting never changes a response and never fails a request. A body that
 * does not parse, a provider that reports nothing, or a stream cut short is
 * simply not counted.
 */

import type { ReadableStreamReadResult } from "node:stream/web";

import { getChatModelsScope } from "./chat-scope";
import type { ChatModelPricing } from "./types";

type Fetch = typeof globalThis.fetch;

/** One model call, as the provider reported it. */
export interface ChatUsageEvent {
    /** The chat route that served the call; `auxiliary` for ingestion's own models. */
    route?: string;
    /** The id the call was configured with. For operators; never shown on screen. */
    modelId?: string;
    /** Whose endpoint answered: the deployment's, or one a workspace brought. */
    owner: "deployment" | "workspace";
    inputTokens: number;
    /** Reasoning tokens included. */
    outputTokens: number;
    /** The part of `outputTokens` spent reasoning, when the provider breaks it out. */
    reasoningTokens?: number;
    /** The part of `inputTokens` served from the provider's prompt cache. */
    cachedInputTokens?: number;
    /** US dollars, when the model declares pricing. */
    costUsd?: number;
}

/** Where a unit of work's usage goes. Must not throw; it runs on the response path. */
export interface ChatUsageRecorder {
    record(event: ChatUsageEvent): void;
}

/** What the transport knows about a call before it is made. */
export interface UsageMeterContext {
    route?: string;
    modelId?: string;
    pricing?: ChatModelPricing;
    owner?: "deployment" | "workspace";
    /**
     * Captured where the model was resolved, the same moment its configuration
     * was chosen. Without one, the recorder is read from the scope the request
     * is made in.
     */
    recorder?: ChatUsageRecorder;
}

export interface ReportedUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
}

function toCount(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
}

/**
 * A provider's `usage` block, or null when it reported none. Reads the
 * chat-completions names first and the responses-style names second; a
 * missing breakdown stays absent rather than becoming zero.
 */
export function readReportedUsage(usage: unknown): ReportedUsage | null {
    const block = record(usage);
    if (!block) return null;
    const inputTokens = toCount(block.prompt_tokens) ?? toCount(block.input_tokens);
    const outputTokens = toCount(block.completion_tokens) ?? toCount(block.output_tokens);
    if (inputTokens === undefined && outputTokens === undefined) return null;
    const output = record(block.completion_tokens_details) ?? record(block.output_tokens_details);
    const input = record(block.prompt_tokens_details) ?? record(block.input_tokens_details);
    const reasoningTokens = toCount(output?.reasoning_tokens);
    const cachedInputTokens = toCount(input?.cached_tokens);
    return {
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
        ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    };
}

/** What `usage` cost at `pricing`, in US dollars. Cached input bills at its own rate. */
export function priceUsage(usage: ReportedUsage, pricing: ChatModelPricing): number {
    const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
    const fresh = usage.inputTokens - cached;
    return (
        (fresh * pricing.input +
            cached * (pricing.cachedInput ?? pricing.input) +
            usage.outputTokens * pricing.output) /
        1_000_000
    );
}

/** Called with the usage a response reported and the model id the provider says served it. */
type UsageReport = (usage: ReportedUsage, servedModel?: string) => void;

/** Matches an SSE event that carries a usage object, not `"usage": null`. */
const USAGE_IN_EVENT = /"usage"\s*:\s*\{/;

/**
 * A stream that passes every byte through untouched and keeps the last usage
 * report it saw. It is reported when the stream ends, or when the reader
 * cancels it (by then the provider has usually sent nothing to report).
 */
function meterStream(response: Response, report: UsageReport): Response {
    const body = response.body;
    if (!body) return response;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let last: ReportedUsage | null = null;
    let model: string | undefined;
    let finished = false;

    const scan = (text: string) => {
        pending += text;
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            if (line.startsWith("data:") && USAGE_IN_EVENT.test(line)) {
                try {
                    const event = record(JSON.parse(line.slice(5)) as unknown);
                    const usage = readReportedUsage(event?.usage);
                    if (usage) {
                        last = usage;
                        model = typeof event?.model === "string" ? event.model : model;
                    }
                } catch {
                    // Not JSON after all; the stream is still the caller's to read.
                }
            }
            newline = pending.indexOf("\n");
        }
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        scan(`${decoder.decode()}\n`);
        if (last) report(last, model);
    };

    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
                chunk = await reader.read();
            } catch (error) {
                finish();
                controller.error(error);
                return;
            }
            if (chunk.done) {
                finish();
                controller.close();
                return;
            }
            controller.enqueue(chunk.value);
            scan(decoder.decode(chunk.value, { stream: true }));
        },
        cancel(reason) {
            finish();
            return reader.cancel(reason);
        },
    });

    const headers = new Headers(response.headers);
    for (const name of ["content-length", "content-encoding", "transfer-encoding"]) {
        headers.delete(name);
    }
    return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

/**
 * `response` with its usage report read on the way through. A JSON body is
 * read from a clone; an event stream is passed through a scanner. Anything
 * else comes back untouched.
 */
export function meterChatResponse(response: Response, report: UsageReport): Response {
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) return meterStream(response, report);
    if (type.includes("json")) {
        response
            .clone()
            .json()
            .then(
                (body: unknown) => {
                    const json = record(body);
                    const usage = readReportedUsage(json?.usage);
                    if (usage)
                        report(usage, typeof json?.model === "string" ? json.model : undefined);
                },
                () => undefined
            );
    }
    return response;
}

const CHAT_COMPLETIONS = /\/chat\/completions\/?$/;

function urlOf(input: Parameters<Fetch>[0]): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

/**
 * The recorder a request made here should report to, and a function that
 * meters its response — or null when nobody is listening, so an unscoped
 * call costs nothing extra.
 */
export function prepareUsageMeter(
    input: Parameters<Fetch>[0],
    meter: UsageMeterContext | undefined
): ((response: Response) => Response) | null {
    const recorder = meter?.recorder ?? getChatModelsScope()?.usage;
    if (!recorder || !CHAT_COMPLETIONS.test(urlOf(input))) return null;
    return response =>
        meterChatResponse(response, (usage, servedModel) => {
            // The configured id when the transport knows it; a shared client
            // that builds its own requests only learns it from the answer.
            const modelId = meter?.modelId ?? servedModel;
            try {
                recorder.record({
                    ...(meter?.route ? { route: meter.route } : {}),
                    ...(modelId ? { modelId } : {}),
                    owner: meter?.owner ?? "deployment",
                    ...usage,
                    ...(meter?.pricing ? { costUsd: priceUsage(usage, meter.pricing) } : {}),
                });
            } catch (error) {
                console.warn("[llm] usage recorder failed:", error);
            }
        });
}

/**
 * A `fetch` that only counts usage, for OpenAI SDK clients outside the chat
 * transport (ingestion's table summaries, image descriptions and entity
 * extraction on the deployment's own auxiliary settings). It changes nothing
 * about the request or the response.
 */
export function createUsageMeteringFetch(meter: UsageMeterContext, baseFetch?: Fetch): Fetch {
    return async (input, init) => {
        const metered = prepareUsageMeter(input, meter);
        const response = await (baseFetch ?? globalThis.fetch)(input, init);
        return metered && response.ok ? metered(response) : response;
    };
}
