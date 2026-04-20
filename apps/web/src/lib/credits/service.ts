/**
 * Core token service — check, debit, grant, and query token balances.
 * All tokens are scoped per-company.
 */

import { eq, sql, and, gte, lte, desc } from "drizzle-orm";
import { db } from "~/server/db";
import {
    tokenAccounts,
    tokenTransactions,
    tokenUsageDaily,
    tokenGrants,
} from "~/server/db/schema/credits";
import type { TokenService } from "./costs";

// ── Balance ─────────────────────────────────────────────────────────

export async function getBalance(companyId: bigint): Promise<number> {
    const [account] = await db
        .select({ balance: tokenAccounts.balanceTokens })
        .from(tokenAccounts)
        .where(eq(tokenAccounts.companyId, companyId));
    return account?.balance ?? 0;
}

/**
 * Ensure a company has a token account, auto-provisioning with the
 * signup bonus if one doesn't exist yet (handles pre-existing companies).
 */
export async function ensureTokenAccount(companyId: bigint): Promise<number> {
    const balance = await getBalance(companyId);
    if (balance > 0) return balance;

    // Check if account exists with zero balance vs doesn't exist at all
    const [account] = await db
        .select({ id: tokenAccounts.id })
        .from(tokenAccounts)
        .where(eq(tokenAccounts.companyId, companyId));

    if (account) return 0; // Account exists, genuinely zero balance

    // Auto-provision for pre-existing companies
    const { TOKEN_SIGNUP_BONUS } = await import("./costs");
    const { balance: newBalance } = await initTokenAccount(companyId, TOKEN_SIGNUP_BONUS);
    console.log(`[Tokens] Auto-provisioned ${TOKEN_SIGNUP_BONUS.toLocaleString()} tokens for company ${companyId}`);
    return newBalance;
}

export async function hasTokens(
    companyId: bigint,
    amount: number
): Promise<boolean> {
    const balance = await ensureTokenAccount(companyId);
    return balance >= amount;
}

// ── Debit ───────────────────────────────────────────────────────────

export interface DebitOptions {
    companyId: bigint;
    amount: number;
    service: TokenService;
    description: string;
    referenceId?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Atomically debit tokens from a company's account.
 * Returns the new balance, or null if insufficient tokens.
 */
export async function debitTokens(
    opts: DebitOptions
): Promise<{ newBalance: number } | null> {
    if (opts.amount <= 0) return { newBalance: await getBalance(opts.companyId) };

    // Atomic: only succeeds if balance >= amount
    const result = await db
        .update(tokenAccounts)
        .set({
            balanceTokens: sql`${tokenAccounts.balanceTokens} - ${opts.amount}`,
            lifetimeTokensUsed: sql`${tokenAccounts.lifetimeTokensUsed} + ${opts.amount}`,
        })
        .where(
            and(
                eq(tokenAccounts.companyId, opts.companyId),
                gte(tokenAccounts.balanceTokens, opts.amount)
            )
        )
        .returning({ newBalance: tokenAccounts.balanceTokens });

    if (result.length === 0) {
        return null; // Insufficient tokens
    }

    const newBalance = result[0]!.newBalance;

    // Log transaction
    await db.insert(tokenTransactions).values({
        companyId: opts.companyId,
        type: "debit",
        amount: -opts.amount,
        balanceAfter: newBalance,
        description: opts.description,
        service: opts.service,
        referenceId: opts.referenceId ?? null,
        metadata: opts.metadata ?? null,
    });

    // Update daily aggregation (upsert)
    const today = new Date().toISOString().slice(0, 10);
    await db
        .insert(tokenUsageDaily)
        .values({
            companyId: opts.companyId,
            date: today,
            service: opts.service,
            operationCount: 1,
            tokensUsed: opts.amount,
        })
        .onConflictDoUpdate({
            target: [
                tokenUsageDaily.companyId,
                tokenUsageDaily.date,
                tokenUsageDaily.service,
            ],
            set: {
                operationCount: sql`${tokenUsageDaily.operationCount} + 1`,
                tokensUsed: sql`${tokenUsageDaily.tokensUsed} + ${opts.amount}`,
            },
        });

    return { newBalance };
}

// ── Grant ───────────────────────────────────────────────────────────

export interface GrantOptions {
    companyId: bigint;
    amount: number;
    grantType: "signup_bonus" | "monthly_refresh" | "promotional" | "manual";
    grantedBy?: string;
    expiresAt?: Date;
}

/**
 * Grant tokens to a company. Creates the token account if it doesn't exist.
 */
export async function grantTokens(
    opts: GrantOptions
): Promise<{ newBalance: number }> {
    // Upsert token account
    const result = await db
        .insert(tokenAccounts)
        .values({
            companyId: opts.companyId,
            balanceTokens: opts.amount,
            lifetimeTokensGranted: opts.amount,
        })
        .onConflictDoUpdate({
            target: [tokenAccounts.companyId],
            set: {
                balanceTokens: sql`${tokenAccounts.balanceTokens} + ${opts.amount}`,
                lifetimeTokensGranted: sql`${tokenAccounts.lifetimeTokensGranted} + ${opts.amount}`,
            },
        })
        .returning({ newBalance: tokenAccounts.balanceTokens });

    const newBalance = result[0]!.newBalance;

    // Log grant record
    await db.insert(tokenGrants).values({
        companyId: opts.companyId,
        grantType: opts.grantType,
        amount: opts.amount,
        grantedBy: opts.grantedBy ?? "system",
        expiresAt: opts.expiresAt ?? null,
    });

    // Log transaction
    await db.insert(tokenTransactions).values({
        companyId: opts.companyId,
        type: "grant",
        amount: opts.amount,
        balanceAfter: newBalance,
        description: `${opts.grantType}: +${opts.amount.toLocaleString()} tokens`,
        service: null,
        referenceId: null,
        metadata: { grantType: opts.grantType, grantedBy: opts.grantedBy ?? "system" },
    });

    return { newBalance };
}

// ── Usage History ───────────────────────────────────────────────────

export interface UsageHistoryOptions {
    companyId: bigint;
    startDate?: string;
    endDate?: string;
    limit?: number;
}

export async function getUsageHistory(opts: UsageHistoryOptions) {
    const conditions = [eq(tokenUsageDaily.companyId, opts.companyId)];

    if (opts.startDate) {
        conditions.push(gte(tokenUsageDaily.date, opts.startDate));
    }
    if (opts.endDate) {
        conditions.push(lte(tokenUsageDaily.date, opts.endDate));
    }

    return db
        .select()
        .from(tokenUsageDaily)
        .where(and(...conditions))
        .orderBy(desc(tokenUsageDaily.date))
        .limit(opts.limit ?? 90);
}

export async function getTransactionHistory(
    companyId: bigint,
    limit = 50
) {
    return db
        .select()
        .from(tokenTransactions)
        .where(eq(tokenTransactions.companyId, companyId))
        .orderBy(desc(tokenTransactions.createdAt))
        .limit(limit);
}

// ── Init (for signup) ───────────────────────────────────────────────

/**
 * Initialize a token account for a new company with a signup bonus.
 */
export async function initTokenAccount(
    companyId: bigint,
    signupBonus: number
): Promise<{ balance: number }> {
    const { newBalance } = await grantTokens({
        companyId,
        amount: signupBonus,
        grantType: "signup_bonus",
        grantedBy: "system",
    });
    return { balance: newBalance };
}
