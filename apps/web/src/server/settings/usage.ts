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

export interface UsageByModel {
    model: string;
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
    model: string | null;
    createdAt: string;
}

export interface UsageOverview {
    days: number;
    balanceTokens: number;
    lifetime: { purchased: number; granted: number; used: number };
    daily: UsageDay[];
    byService: UsageByService[];
    byModel: UsageByModel[];
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

/** The model a chat debit recorded, when it recorded one. */
function modelOf(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== "object") return null;
    const model = (metadata as { model?: unknown }).model;
    return typeof model === "string" && model ? model : null;
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

    // Model attribution lives only in chat debits' metadata; aggregate what is there.
    const byModel = new Map<string, UsageByModel>();
    const modelRows = await db
        .select({
            model: sql<string | null>`${tokenTransactions.metadata} ->> 'model'`,
            tokens: sql<number>`coalesce(sum(-${tokenTransactions.amount}), 0)`,
            calls: sql<number>`count(*)`,
        })
        .from(tokenTransactions)
        .where(
            and(
                eq(tokenTransactions.companyId, companyId),
                eq(tokenTransactions.type, "debit"),
                gte(tokenTransactions.createdAt, since),
                sql`${tokenTransactions.metadata} ->> 'model' is not null`
            )
        )
        .groupBy(sql`${tokenTransactions.metadata} ->> 'model'`);
    for (const row of modelRows) {
        if (!row.model) continue;
        byModel.set(row.model, {
            model: row.model,
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
        byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
        recent: recentRows.map(row => ({
            id: row.id,
            type: row.type,
            amount: row.amount,
            balanceAfter: row.balanceAfter,
            service: row.service ? foldService(row.service) : null,
            description: row.description,
            model: modelOf(row.metadata),
            createdAt: row.createdAt.toISOString(),
        })),
        pricePerMillionTokens,
        lowBalanceThreshold: typeof threshold === "number" ? threshold : 500_000,
        estimatedCost:
            pricePerMillionTokens > 0 ? (windowTokens / 1_000_000) * pricePerMillionTokens : null,
    };
}
