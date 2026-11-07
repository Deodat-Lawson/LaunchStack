/** What every provider adapter shares: one JSON request helper and the text tidying. */

import { reportUsage } from "@launchstack/llm";

import type { RequestOptions, SearchProviderId } from "../types";

/** What one answered request is billed as: a search, or `units` pages read. */
export interface Billing {
    provider: SearchProviderId;
    kind: "web_search" | "web_contents";
    units: number;
}

/** One search on `provider`. */
export const searchBilling = (provider: SearchProviderId): Billing => ({
    provider,
    kind: "web_search",
    units: 1,
});

/**
 * The request, as JSON. Each request the engine answers is counted against
 * the current unit of work (`reportUsage`, a no-op outside one); a refused
 * request counts nothing.
 */
export async function requestJson(
    url: string,
    init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: unknown },
    options: RequestOptions,
    vendor: string,
    billing: Billing
): Promise<unknown> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const response = await (options.fetchImpl ?? fetch)(url, {
        method: init.method,
        headers: {
            Accept: "application/json",
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        // The status only: a vendor's error body is not shown to a model.
        throw new Error(`${vendor} search failed (HTTP ${response.status})`);
    }
    // Search keys are always the deployment's: no workspace brings its own.
    reportUsage({
        kind: billing.kind,
        calls: billing.units,
        modelId: billing.provider,
        owner: "deployment",
        inputTokens: 0,
        outputTokens: 0,
    });
    return response.json();
}

/** Whitespace collapsed and cut to `chars`, with an ellipsis when cut. */
export function clip(text: string, chars: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > chars ? `${flat.slice(0, chars)}…` : flat;
}

/** Tags out of a snippet (Brave marks query words with <strong>), entities decoded. */
export function stripTags(html: string): string {
    return html
        .replace(/<[^>]*>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

/** A result's title, or its URL when the provider gave none. */
export function titleOf(title: string | undefined, url: string): string {
    // An empty title falls back too, which `??` would not do.
    const trimmed = title?.trim();
    if (trimmed) return trimmed;
    return url;
}

/** Host without `www.`, or null for something that isn't a URL. */
export function domainOf(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return null;
    }
}

/** Items that have a non-empty `url`, as the narrowed type. */
export function withUrl<T extends { url?: unknown }>(
    items: readonly T[] | undefined
): Array<T & { url: string }> {
    return (items ?? []).filter(
        (item): item is T & { url: string } => typeof item?.url === "string" && item.url.length > 0
    );
}
