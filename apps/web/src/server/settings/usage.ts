/**
 * Usage and costs — the ledger and the model meter, aggregated for one screen.
 *
 * The balance half reads `token_accounts`, `token_transactions` and
 * `token_usage_daily`: what the features that debit have charged, in unified
 * tokens. Its cost figure is an estimate from a price the workspace sets
 * itself, because the ledger knows nothing about invoices.
 *
 * The model half reads `ai_usage_daily`: every model call, embedding request
 * and paid web search made for the workspace, whichever feature made it, with
 * the provider's own counts, priced at what the operator declared for each
 * model (see docs/chat-models.md) or at list price (embeddings, search). Its
 * totals are chat-token equivalents (~/server/ai-usage/weights), so a cheap
 * embedding and an expensive search are compared by what they cost, not by
 * raw token counts. Routes, never model ids, reach the page.
 *
 * Per-person use is the meter's too (`ai_usage_daily.user_id`), but it is
 * read with the allowances it is measured against: ~/server/ai-usage/members.
 * The ledger half stays per company.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { configuredWebSearchProvider } from "@launchstack/tools/web-research";

import { AI_USAGE_GROUPS, usageGroupOf, type AiUsageGroup } from "~/lib/ai-usage";
import {
    standardChatPrice,
    weighUsage,
    webUnitPrice,
    type ChatPrice,
} from "~/server/ai-usage/weights";
import { db } from "~/server/db";
import {
    aiUsageDaily,
    tokenAccounts,
    tokenTransactions,
    tokenUsageDaily,
} from "~/server/db/schema";
import { ensureTokenAccount } from "~/lib/credits";

import { readWorkspaceSetting } from "./store";

export interface UsageDay {
    /** ISO date. */
    date: string;
    /** Tokens by service on that day. */
    services: Record<string, number>;
    total: number;
}

export interface UsageByService {
    service: string;
    tokens: number;
    operations: number;
}

/** Chat usage by route (default, fast, reasoning, vision) — never by model id. */
export interface UsageByRoute {
    route: string;
    tokens: number;
    calls: number;
}

export interface RecentTransaction {
    id: number;
    type: string;
    amount: number;
    balanceAfter: number;
    service: string | null;
    description: string | null;
    /** `description` as message data (`settings.server.ledger`), when it is one the app writes. */
    descriptionCopy: LedgerCopy | null;
    createdAt: string;
}

export type LedgerKey =
    | "grant"
    | "serviceUsage"
    | "chatQuery"
    | "transcribe"
    | "ner"
    | "embed"
    | "ocr"
    | "distribution"
    | "proposalsRewrite"
    | "proposalsReview"
    | "scenarioInterview"
    | "scenarioUnit"
    | "scenarioRound";

export interface LedgerCopy {
    key: LedgerKey;
    /** Strings, numbers included, so they print exactly as the English did. */
    values?: Record<string, string>;
}

/** Model calls and what they used. Token counts are the provider's own. */
export interface ModelUsageTotals {
    /** Requests made; for a web search, searches made (or pages read). */
    calls: number;
    /** Everything below in chat-token equivalents: what allowances count. */
    weightedTokens: number;
    /** For an embedding, the tokens embedded. */
    inputTokens: number;
    /** Reasoning included. */
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    /** US dollars, summed over the calls whose model declared a price. */
    costUsd: number;
    pricedCalls: number;
}

export interface ModelUsageDay {
    /** ISO date. */
    date: string;
    /** Chat-token equivalents, by feature. */
    features: Record<string, number>;
    total: number;
}

/** One line of chat, embeddings or web search, with its own units beside the common one. */
export interface UsageByGroup extends ModelUsageTotals {
    group: AiUsageGroup;
    /** Web search only: searches made, and pages the provider read. */
    searches: number;
    pages: number;
}

/** What the conversion into chat-token equivalents came to, for the page to say so. */
export interface UsageRates {
    /** The standard chat token's price and where it came from. */
    chat: ChatPrice;
    /** A million embedded tokens, in chat-token equivalents. */
    embeddingPerMillion: number;
    /** One web search, in chat-token equivalents. */
    perSearch: number;
}

export interface ModelUsage {
    /** Totals over every kind; `weightedTokens` is the page's headline. */
    totals: ModelUsageTotals;
    /** Chat, embeddings, web search: always all three, in that order. */
    byGroup: UsageByGroup[];
    rates: UsageRates;
    daily: ModelUsageDay[];
    byFeature: (ModelUsageTotals & { feature: string })[];
    /** Chat calls only: default, fast, reasoning, vision, auxiliary — never a model id. */
    byRoute: (ModelUsageTotals & { route: string })[];
    /** Calls to an endpoint the workspace brought itself, which its own provider bills. */
    workspaceOwnedCalls: number;
    /**
     * The priced calls' cost plus, when the workspace set a price per 1M
     * tokens, the unpriced calls' tokens at that price. Null when nothing in
     * the window could be priced either way.
     */
    estimatedCostUsd: number | null;
}

export interface UsageOverview {
    days: number;
    balanceTokens: number;
    lifetime: { purchased: number; granted: number; used: number };
    daily: UsageDay[];
    byService: UsageByService[];
    byRoute: UsageByRoute[];
    recent: RecentTransaction[];
    /** From `usage.pricePerMillionTokens`; 0 means unset. */
    pricePerMillionTokens: number;
    /** From `usage.lowBalanceThreshold`. */
    lowBalanceThreshold: number;
    /** Estimated spend in the window, or null when no price is set. */
    estimatedCost: number | null;
    /** Every model call in the window, from `ai_usage_daily`. */
    models: ModelUsage;
}

function isoDate(value: Date | string): string {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * A ledger description as the page shows it. Older debits were written as
 * "Chat query via <model id>" or "Transcribe x via transcription:<model id>";
 * the screen never names a model, so the trailing "via …" is dropped on read.
 * The stored row keeps it for operators.
 */
export function ledgerDescription(description: string | null): string | null {
    if (!description) return description;
    return description.replace(/\s+via\s+\S+$/, "");
}

/**
 * The descriptions the app writes into the ledger (grants in ~/lib/credits,
 * debits across the verticals), read back into message data so the page can
 * word them. The stored row keeps its English for operators and the API.
 * Order matters: the specific shapes come before the general ones.
 */
const LEDGER_SHAPES: { pattern: RegExp; key: LedgerKey; names: string[] }[] = [
    {
        pattern: /^(signup_bonus|monthly_refresh|promotional|manual): \+([\d,]+) tokens$/,
        key: "grant",
        names: ["grantType", "amount"],
    },
    { pattern: /^Chat query \((\S+) route\)$/, key: "chatQuery", names: ["route"] },
    { pattern: /^NER extraction for (\d+) chunks$/, key: "ner", names: ["count"] },
    {
        pattern: /^Embed (\d+) chunks for document (\d+)$/,
        key: "embed",
        names: ["count", "document"],
    },
    { pattern: /^OCR (\d+) pages$/, key: "ocr", names: ["count"] },
    { pattern: /^Transcribe (.+)$/, key: "transcribe", names: ["file"] },
    { pattern: /^Distribution research: (.+)$/, key: "distribution", names: ["name"] },
    { pattern: /^Proposals: rewrite$/, key: "proposalsRewrite", names: [] },
    { pattern: /^Proposals: review$/, key: "proposalsReview", names: [] },
    { pattern: /^Scenario "(.+)": interview$/, key: "scenarioInterview", names: ["title"] },
    {
        pattern: /^Scenario "(.+)" \(round (\d+)\)$/,
        key: "scenarioRound",
        names: ["title", "round"],
    },
    {
        pattern: /^Scenario "(.+)" \((brief|cast|report)\)$/,
        key: "scenarioUnit",
        names: ["title", "unit"],
    },
    { pattern: /^(\S+) usage$/, key: "serviceUsage", names: ["service"] },
];

/** A shown description (after `ledgerDescription`) as message data, or null when it is free text. */
export function ledgerDescriptionCopy(description: string | null): LedgerCopy | null {
    if (!description) return null;
    for (const { pattern, key, names } of LEDGER_SHAPES) {
        const match = pattern.exec(description);
        if (!match) continue;
        return names.length === 0
            ? { key }
            : { key, values: Object.fromEntries(names.map((name, i) => [name, match[i + 1]!])) };
    }
    return null;
}

function emptyTotals(): ModelUsageTotals {
    return {
        calls: 0,
        weightedTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
        pricedCalls: 0,
    };
}

function addTotals(into: ModelUsageTotals, row: ModelUsageTotals): void {
    into.calls += row.calls;
    into.weightedTokens += row.weightedTokens;
    into.inputTokens += row.inputTokens;
    into.outputTokens += row.outputTokens;
    into.reasoningTokens += row.reasoningTokens;
    into.cachedInputTokens += row.cachedInputTokens;
    into.costUsd += row.costUsd;
    into.pricedCalls += row.pricedCalls;
}

/**
 * The model meter for one window. `pricePerMillionTokens` is the workspace's
 * own blended price (0 when unset), used only for calls whose model declared
 * none.
 */
export async function modelUsageOverview(
    companyId: bigint,
    sinceDate: string,
    pricePerMillionTokens: number
): Promise<ModelUsage> {
    const rows = await db
        .select({
            date: aiUsageDaily.date,
            feature: aiUsageDaily.feature,
            route: aiUsageDaily.route,
            owner: aiUsageDaily.owner,
            kind: aiUsageDaily.kind,
            calls: sql<number>`sum(${aiUsageDaily.calls})`,
            weightedTokens: sql<number>`sum(${aiUsageDaily.weightedTokens})`,
            inputTokens: sql<number>`sum(${aiUsageDaily.inputTokens})`,
            outputTokens: sql<number>`sum(${aiUsageDaily.outputTokens})`,
            reasoningTokens: sql<number>`sum(${aiUsageDaily.reasoningTokens})`,
            cachedInputTokens: sql<number>`sum(${aiUsageDaily.cachedInputTokens})`,
            pricedCalls: sql<number>`sum(${aiUsageDaily.pricedCalls})`,
            costUsd: sql<string>`sum(${aiUsageDaily.costUsd})`,
        })
        .from(aiUsageDaily)
        .where(and(eq(aiUsageDaily.companyId, companyId), gte(aiUsageDaily.date, sinceDate)))
        .groupBy(
            aiUsageDaily.date,
            aiUsageDaily.feature,
            aiUsageDaily.route,
            aiUsageDaily.owner,
            aiUsageDaily.kind
        )
        .orderBy(aiUsageDaily.date);

    const totals = emptyTotals();
    const byGroup = new Map<AiUsageGroup, UsageByGroup>(
        AI_USAGE_GROUPS.map(group => [group, { group, ...emptyTotals(), searches: 0, pages: 0 }])
    );
    const searched = { searches: 0, weighted: 0 };
    const byDay = new Map<string, ModelUsageDay>();
    const byFeature = new Map<string, ModelUsageTotals & { feature: string }>();
    const byRoute = new Map<string, ModelUsageTotals & { route: string }>();
    let workspaceOwnedCalls = 0;
    let unpricedTokens = 0;

    for (const raw of rows) {
        // Postgres sums come back as strings (bigint, numeric); counts fit a double.
        const row: ModelUsageTotals = {
            calls: Number(raw.calls),
            weightedTokens: Number(raw.weightedTokens),
            inputTokens: Number(raw.inputTokens),
            outputTokens: Number(raw.outputTokens),
            reasoningTokens: Number(raw.reasoningTokens),
            cachedInputTokens: Number(raw.cachedInputTokens),
            costUsd: Number(raw.costUsd),
            pricedCalls: Number(raw.pricedCalls),
        };
        const tokens = row.weightedTokens;
        const date = isoDate(raw.date);

        addTotals(totals, row);
        const group = byGroup.get(usageGroupOf(raw.kind))!;
        addTotals(group, row);
        if (raw.kind === "web_search") {
            group.searches += row.calls;
            searched.searches += row.calls;
            searched.weighted += row.weightedTokens;
        }
        if (raw.kind === "web_contents") group.pages += row.calls;
        const day = byDay.get(date) ?? { date, features: {}, total: 0 };
        day.features[raw.feature] = (day.features[raw.feature] ?? 0) + tokens;
        day.total += tokens;
        byDay.set(date, day);

        const feature = byFeature.get(raw.feature) ?? { feature: raw.feature, ...emptyTotals() };
        addTotals(feature, row);
        byFeature.set(raw.feature, feature);

        if (raw.kind === "chat") {
            const routeKey = raw.route || "default";
            const route = byRoute.get(routeKey) ?? { route: routeKey, ...emptyTotals() };
            addTotals(route, row);
            byRoute.set(routeKey, route);
        }

        if (raw.owner === "workspace") workspaceOwnedCalls += row.calls;
        // A row mixes priced and unpriced calls only on the day a price was
        // added; split its tokens by calls rather than pretend either way.
        if (row.calls > 0 && row.pricedCalls < row.calls) {
            unpricedTokens += tokens * ((row.calls - row.pricedCalls) / row.calls);
        }
    }

    const fallback =
        pricePerMillionTokens > 0 ? (unpricedTokens / 1_000_000) * pricePerMillionTokens : 0;
    const anyPrice = totals.pricedCalls > 0 || (pricePerMillionTokens > 0 && unpricedTokens > 0);

    return {
        totals,
        byGroup: [...byGroup.values()],
        rates: usageRates(
            {
                tokens: byGroup.get("embedding")!.inputTokens,
                weighted: byGroup.get("embedding")!.weightedTokens,
            },
            searched
        ),
        daily: [...byDay.values()],
        byFeature: [...byFeature.values()].sort((a, b) => b.weightedTokens - a.weightedTokens),
        byRoute: [...byRoute.values()].sort(
            (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
        ),
        workspaceOwnedCalls,
        estimatedCostUsd: anyPrice ? totals.costUsd + fallback : null,
    };
}

/** What one standard chat token costs, as a fraction of a dollar. */
function perChatToken(chat: ChatPrice): number {
    return chat.perMillion / 1_000_000;
}

/**
 * The rates the window's rows were weighed at, so the page can say what a
 * million embedded tokens or one search came to. With nothing of that kind in
 * the window, today's rate for the deployment's defaults.
 */
function usageRates(
    embedded: { tokens: number; weighted: number },
    searched: { searches: number; weighted: number }
): UsageRates {
    const chat = standardChatPrice();
    return {
        chat,
        embeddingPerMillion:
            embedded.tokens > 0
                ? Math.round((embedded.weighted / embedded.tokens) * 1_000_000)
                : weighUsage(
                      {
                          kind: "embedding",
                          owner: "deployment",
                          inputTokens: 1_000_000,
                          outputTokens: 0,
                      },
                      chat
                  ).weightedTokens,
        perSearch:
            searched.searches > 0
                ? Math.round(searched.weighted / searched.searches)
                : Math.round(
                      webUnitPrice("web_search", configuredWebSearchProvider() ?? "exa") /
                          perChatToken(chat)
                  ),
    };
}

/** OCR providers are one line item on this page; the ledger keeps them apart. */
export function foldService(service: string): string {
    return service.startsWith("ocr") ? "ocr" : service;
}

export async function usageOverview(companyId: bigint, days = 30): Promise<UsageOverview> {
    const window = Math.max(1, Math.min(365, days));
    const since = new Date(Date.now() - window * 86_400_000);
    const sinceDate = since.toISOString().slice(0, 10);

    const [balanceTokens, [account], dailyRows, recentRows, price, threshold] = await Promise.all([
        ensureTokenAccount(companyId),
        db
            .select({
                purchased: tokenAccounts.lifetimeTokensPurchased,
                granted: tokenAccounts.lifetimeTokensGranted,
                used: tokenAccounts.lifetimeTokensUsed,
            })
            .from(tokenAccounts)
            .where(eq(tokenAccounts.companyId, companyId))
            .limit(1),
        db
            .select({
                date: tokenUsageDaily.date,
                service: tokenUsageDaily.service,
                tokens: tokenUsageDaily.tokensUsed,
                operations: tokenUsageDaily.operationCount,
            })
            .from(tokenUsageDaily)
            .where(
                and(eq(tokenUsageDaily.companyId, companyId), gte(tokenUsageDaily.date, sinceDate))
            )
            .orderBy(tokenUsageDaily.date),
        db
            .select()
            .from(tokenTransactions)
            .where(eq(tokenTransactions.companyId, companyId))
            .orderBy(desc(tokenTransactions.createdAt))
            .limit(40),
        readWorkspaceSetting<number>(companyId, "usage.pricePerMillionTokens"),
        readWorkspaceSetting<number>(companyId, "usage.lowBalanceThreshold"),
    ]);

    const byDay = new Map<string, UsageDay>();
    const byService = new Map<string, UsageByService>();
    for (const row of dailyRows) {
        const date = isoDate(row.date);
        const service = foldService(row.service);
        const day = byDay.get(date) ?? { date, services: {}, total: 0 };
        day.services[service] = (day.services[service] ?? 0) + row.tokens;
        day.total += row.tokens;
        byDay.set(date, day);
        const agg = byService.get(service) ?? { service, tokens: 0, operations: 0 };
        agg.tokens += row.tokens;
        agg.operations += row.operations;
        byService.set(service, agg);
    }

    // Route attribution lives only in chat debits' metadata; aggregate what is there.
    const byRoute = new Map<string, UsageByRoute>();
    const routeRows = await db
        .select({
            route: sql<string | null>`${tokenTransactions.metadata} ->> 'route'`,
            tokens: sql<number>`coalesce(sum(-${tokenTransactions.amount}), 0)`,
            calls: sql<number>`count(*)`,
        })
        .from(tokenTransactions)
        .where(
            and(
                eq(tokenTransactions.companyId, companyId),
                eq(tokenTransactions.type, "debit"),
                gte(tokenTransactions.createdAt, since),
                sql`${tokenTransactions.metadata} ->> 'route' is not null`
            )
        )
        .groupBy(sql`${tokenTransactions.metadata} ->> 'route'`);
    for (const row of routeRows) {
        if (!row.route) continue;
        byRoute.set(row.route, {
            route: row.route,
            tokens: Number(row.tokens),
            calls: Number(row.calls),
        });
    }

    const windowTokens = [...byService.values()].reduce((sum, s) => sum + s.tokens, 0);
    const pricePerMillionTokens = typeof price === "number" ? price : 0;
    const models = await modelUsageOverview(companyId, sinceDate, pricePerMillionTokens);

    return {
        days: window,
        balanceTokens,
        lifetime: {
            purchased: account?.purchased ?? 0,
            granted: account?.granted ?? 0,
            used: account?.used ?? 0,
        },
        daily: [...byDay.values()],
        byService: [...byService.values()].sort((a, b) => b.tokens - a.tokens),
        byRoute: [...byRoute.values()].sort((a, b) => b.tokens - a.tokens),
        recent: recentRows.map(row => ({
            id: row.id,
            type: row.type,
            amount: row.amount,
            balanceAfter: row.balanceAfter,
            service: row.service ? foldService(row.service) : null,
            description: ledgerDescription(row.description),
            descriptionCopy: ledgerDescriptionCopy(ledgerDescription(row.description)),
            createdAt: row.createdAt.toISOString(),
        })),
        pricePerMillionTokens,
        lowBalanceThreshold: typeof threshold === "number" ? threshold : 500_000,
        estimatedCost:
            pricePerMillionTokens > 0 ? (windowTokens / 1_000_000) * pricePerMillionTokens : null,
        models,
    };
}
