/**
 * Usage and costs — the ledger, aggregated for one screen.
 *
 * Everything here already existed in `token_accounts`, `token_transactions`
 * and `token_usage_daily`; what was missing was a surface. The cost figure is
 * an estimate from a price the workspace sets itself, because the ledger
 * counts unified tokens and knows nothing about invoices. Per-member burn is
 * not shown: debits are recorded per company, not per person, and this page
 * does not pretend otherwise.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { tokenAccounts, tokenTransactions, tokenUsageDaily } from "~/server/db/schema";
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
    };
}
