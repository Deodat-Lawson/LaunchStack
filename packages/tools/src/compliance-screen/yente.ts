/**
 * OpenSanctions `yente` adapter — the open-source matcher behind
 * api.opensanctions.org, self-hostable in compose. POST /match/{scope} with
 * a Company query; each result carries a score, topics and datasets.
 */
import type { ComplianceScreenProvider, ScreenFlag, ScreenQuery, ScreenResult } from "./types";

interface YenteResult {
    id: string;
    caption?: string;
    score?: number;
    match?: boolean;
    datasets?: string[];
    properties?: { topics?: string[]; name?: string[] };
}

interface YenteResponse {
    responses?: Record<string, { results?: YenteResult[] }>;
}

export interface YenteProviderOptions {
    baseUrl: string;
    apiKey?: string;
    /** Match scope / dataset (default "default"). */
    scope?: string;
    /** Minimum score to keep (default 0.5). */
    threshold?: number;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

export function createYenteProvider(options: YenteProviderOptions): ComplianceScreenProvider {
    const base = options.baseUrl.replace(/\/+$/, "");
    const scope = options.scope ?? "default";
    const threshold = options.threshold ?? 0.5;
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 10_000;

    return {
        name: "opensanctions-yente",
        async screen(query: ScreenQuery, context = {}): Promise<ScreenResult> {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const onAbort = () => controller.abort();
            context.signal?.addEventListener("abort", onAbort, { once: true });
            try {
                const properties: Record<string, string[]> = { name: [query.name] };
                if (query.country) properties.country = [query.country.toLowerCase()];
                const response = await fetchImpl(`${base}/match/${encodeURIComponent(scope)}`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        accept: "application/json",
                        ...(options.apiKey ? { authorization: `ApiKey ${options.apiKey}` } : {}),
                    },
                    body: JSON.stringify({ queries: { q: { schema: "Company", properties } } }),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(
                        `yente ${response.status}: ${(await response.text()).slice(0, 200)}`
                    );
                }
                const data = (await response.json()) as YenteResponse;
                const results = data.responses?.q?.results ?? [];
                const flags: ScreenFlag[] = results
                    .filter(r => (r.score ?? 0) >= threshold)
                    .map(r => ({
                        entityId: r.id,
                        matchedName: r.caption ?? r.properties?.name?.[0] ?? r.id,
                        score: Math.max(0, Math.min(1, r.score ?? 0)),
                        topics: r.properties?.topics ?? [],
                        datasets: r.datasets ?? [],
                        url: `https://www.opensanctions.org/entities/${encodeURIComponent(r.id)}/`,
                    }));
                return {
                    provider: "opensanctions-yente",
                    checkedAt: new Date().toISOString(),
                    flags,
                };
            } finally {
                clearTimeout(timer);
                context.signal?.removeEventListener("abort", onAbort);
            }
        },
    };
}
