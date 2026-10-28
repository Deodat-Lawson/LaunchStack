/**
 * Per-person AI allowances: how much of this month's AI one person may use,
 * and whether they have used it.
 *
 * Two limits can apply, and the tighter one binds:
 *
 * - **The server's.** `AI_MONTHLY_TOKEN_LIMIT_PER_USER` caps what one person
 *   may run on this deployment's own models, summed across every workspace
 *   they belong to. It protects the operator's bill, so calls to an endpoint
 *   a workspace brought (and pays for) never count toward it, and it does not
 *   apply while the workspace runs on its own models. Emails in
 *   `AI_TOKEN_LIMIT_EXEMPT_EMAILS` are never capped.
 * - **The workspace's.** Admins set a default for everyone
 *   (`usage.memberMonthlyTokenLimit`, 0 = none) and may override it for one
 *   person (`member_ai_limits`, where a null limit means none). It counts all
 *   of the person's calls in that workspace, whoever's endpoint served them.
 *
 * Usage is the meter's (`ai_usage_daily`, written by ./record): tokens in plus
 * out, by calendar month in UTC. A person at a limit is refused new AI work
 * when it starts (see withWorkspaceChatModels and ./refusal); work already
 * running finishes, so one request can carry them a little past it.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { createSlot } from "@launchstack/runtime";

import { env } from "~/env";
import { db } from "~/server/db";
import { aiUsageDaily, memberAiLimits, users } from "~/server/db/schema";
import { readWorkspaceSetting } from "~/server/settings/store";

/** Registry key of the workspace default (tokens a month; 0 = no limit). */
export const MEMBER_LIMIT_SETTING = "usage.memberMonthlyTokenLimit";

/** What a workspace admin chose for one person. */
export type MemberLimitChoice =
    | { mode: "default" }
    | { mode: "none" }
    | { mode: "custom"; monthlyTokens: number };

export interface AllowancePeriod {
    /** ISO date of the 1st of this month (UTC). */
    start: string;
    /** ISO timestamp the allowance resets at: the 1st of next month, 00:00 UTC. */
    resetsAt: string;
}

export interface AiAllowance extends AllowancePeriod {
    /** Tokens this person used in this workspace this month. */
    used: number;
    workspace: {
        /** Tokens a month, or null for no limit. */
        limit: number | null;
        /** `member` when an admin set this person's limit, `default` otherwise. */
        source: "default" | "member";
    };
    /** The server-wide cap, or null when none applies to this person here. */
    server: { limit: number; used: number } | null;
    /** The limit nearest to (or past) its end, or null when none applies. */
    binding: "workspace" | "server" | null;
    /** Share of the binding limit used, 0–100 (may pass 100), or null. */
    percent: number | null;
    /** True once any limit is reached: new AI work is refused. */
    blocked: boolean;
}

export function allowancePeriod(at: Date = new Date()): AllowancePeriod {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
    return { start: start.toISOString().slice(0, 10), resetsAt: next.toISOString() };
}

// ── Server-wide cap ─────────────────────────────────────────────────

/** The configured cap in tokens, or null when the server sets none. */
export function serverMonthlyLimit(): number | null {
    const raw = env.server.AI_MONTHLY_TOKEN_LIMIT_PER_USER?.trim();
    if (!raw) return null;
    const value = Number(raw.replace(/[_,\s]/g, ""));
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
}

function exemptEmails(): Set<string> {
    const raw = env.server.AI_TOKEN_LIMIT_EXEMPT_EMAILS ?? "";
    return new Set(
        raw
            .split(",")
            .map(email => email.trim().toLowerCase())
            .filter(Boolean)
    );
}

export function isExemptFromServerLimit(email: string | null | undefined): boolean {
    if (!email) return false;
    return exemptEmails().has(email.trim().toLowerCase());
}

// ── Reading usage and limits ────────────────────────────────────────

/** Built per query, not at import: tests mock the schema module. */
const usedTokens = () =>
    sql<string>`coalesce(sum(${aiUsageDaily.inputTokens} + ${aiUsageDaily.outputTokens}), 0)`;

async function workspaceUsedBy(
    companyId: bigint,
    userIds: string[],
    since: string
): Promise<Map<string, number>> {
    const used = new Map<string, number>();
    if (userIds.length === 0) return used;
    const rows = await db
        .select({ userId: aiUsageDaily.userId, tokens: usedTokens() })
        .from(aiUsageDaily)
        .where(
            and(
                eq(aiUsageDaily.companyId, companyId),
                gte(aiUsageDaily.date, since),
                inArray(aiUsageDaily.userId, userIds)
            )
        )
        .groupBy(aiUsageDaily.userId);
    for (const row of rows) used.set(row.userId, Number(row.tokens));
    return used;
}

/** Each person's calls on this server's own models, in every workspace. */
async function serverUsedBy(userIds: string[], since: string): Promise<Map<string, number>> {
    const used = new Map<string, number>();
    if (userIds.length === 0) return used;
    const rows = await db
        .select({ userId: aiUsageDaily.userId, tokens: usedTokens() })
        .from(aiUsageDaily)
        .where(
            and(
                inArray(aiUsageDaily.userId, userIds),
                gte(aiUsageDaily.date, since),
                eq(aiUsageDaily.owner, "deployment")
            )
        )
        .groupBy(aiUsageDaily.userId);
    for (const row of rows) used.set(row.userId, Number(row.tokens));
    return used;
}

/** The workspace default, in tokens a month; null when it sets none. */
export async function workspaceDefaultLimit(companyId: bigint): Promise<number | null> {
    const value = await readWorkspaceSetting<number>(companyId, MEMBER_LIMIT_SETTING);
    return typeof value === "number" && value > 0 ? value : null;
}

/** Admins' per-person overrides: limit in tokens, or null for "no limit". */
async function memberOverrides(
    companyId: bigint,
    userIds: string[]
): Promise<Map<string, number | null>> {
    const overrides = new Map<string, number | null>();
    if (userIds.length === 0) return overrides;
    const rows = await db
        .select({ userId: memberAiLimits.userId, monthlyTokens: memberAiLimits.monthlyTokens })
        .from(memberAiLimits)
        .where(
            and(eq(memberAiLimits.companyId, companyId), inArray(memberAiLimits.userId, userIds))
        );
    for (const row of rows) overrides.set(row.userId, row.monthlyTokens);
    return overrides;
}

async function emailsOf(userIds: string[]): Promise<Map<string, string>> {
    const emails = new Map<string, string>();
    if (userIds.length === 0) return emails;
    const rows = await db
        .select({ userId: users.userId, email: users.email })
        .from(users)
        .where(inArray(users.userId, userIds));
    for (const row of rows) emails.set(row.userId, row.email);
    return emails;
}

interface AllowanceInputs {
    period: AllowancePeriod;
    used: number;
    workspaceLimit: number | null;
    workspaceSource: "default" | "member";
    server: { limit: number; used: number } | null;
}

/** Pure: which limit binds, how far along it is, and whether it is reached. */
export function evaluateAllowance(inputs: AllowanceInputs): AiAllowance {
    const ratios: { which: "workspace" | "server"; ratio: number }[] = [];
    if (inputs.workspaceLimit !== null) {
        ratios.push({ which: "workspace", ratio: inputs.used / inputs.workspaceLimit });
    }
    if (inputs.server) {
        ratios.push({ which: "server", ratio: inputs.server.used / inputs.server.limit });
    }
    const tightest = ratios.sort((a, b) => b.ratio - a.ratio)[0];
    return {
        ...inputs.period,
        used: inputs.used,
        workspace: { limit: inputs.workspaceLimit, source: inputs.workspaceSource },
        server: inputs.server,
        binding: tightest?.which ?? null,
        percent: tightest ? Math.round(tightest.ratio * 1000) / 10 : null,
        blocked: ratios.some(r => r.ratio >= 1),
    };
}

export interface AllowanceOptions {
    /**
     * Whether the server-wide cap can apply: false while the workspace runs on
     * its own endpoint, whose calls the server doesn't pay for.
     */
    serverCapApplies: boolean;
    at?: Date;
    /** Read past the short cache: a readout right after an answer must include it. */
    fresh?: boolean;
}

/** Every listed person's allowance in one workspace, in four queries. */
export async function getAiAllowances(
    companyId: bigint,
    userIds: string[],
    options: AllowanceOptions
): Promise<Map<string, AiAllowance>> {
    const period = allowancePeriod(options.at);
    const serverLimit = options.serverCapApplies ? serverMonthlyLimit() : null;
    const [used, overrides, workspaceDefault, emails, serverUsed] = await Promise.all([
        workspaceUsedBy(companyId, userIds, period.start),
        memberOverrides(companyId, userIds),
        workspaceDefaultLimit(companyId),
        serverLimit === null ? Promise.resolve(new Map<string, string>()) : emailsOf(userIds),
        serverLimit === null
            ? Promise.resolve(new Map<string, number>())
            : serverUsedBy(userIds, period.start),
    ]);

    const allowances = new Map<string, AiAllowance>();
    for (const userId of userIds) {
        const hasOverride = overrides.has(userId);
        const capped = serverLimit !== null && !isExemptFromServerLimit(emails.get(userId));
        allowances.set(
            userId,
            evaluateAllowance({
                period,
                used: used.get(userId) ?? 0,
                workspaceLimit: hasOverride ? (overrides.get(userId) ?? null) : workspaceDefault,
                workspaceSource: hasOverride ? "member" : "default",
                server: capped ? { limit: serverLimit, used: serverUsed.get(userId) ?? 0 } : null,
            })
        );
    }
    return allowances;
}

/**
 * Checks re-enter often — a chat turn, then its starters, then a poll — so one
 * person's allowance is read at most every few seconds per process. Changing a
 * limit clears this process's entries at once.
 */
const CACHE_TTL_MS = 5_000;
const cacheSlot =
    createSlot<Map<string, { at: number; allowance: AiAllowance }>>("ai-usage/allowanceCache");

function cache(): Map<string, { at: number; allowance: AiAllowance }> {
    let map = cacheSlot.get();
    if (!map) {
        map = new Map();
        cacheSlot.set(map);
    }
    return map;
}

export function invalidateAiAllowances(): void {
    cache().clear();
}

/** One person's allowance in one workspace. */
export async function getAiAllowance(
    companyId: bigint,
    userId: string,
    options: AllowanceOptions
): Promise<AiAllowance> {
    const key = `${companyId}:${userId}:${options.serverCapApplies ? 1 : 0}`;
    const hit = cache().get(key);
    if (!options.at && !options.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return hit.allowance;
    }
    const allowance = (await getAiAllowances(companyId, [userId], options)).get(userId)!;
    if (!options.at) cache().set(key, { at: Date.now(), allowance });
    return allowance;
}

// ── Writing limits ──────────────────────────────────────────────────

/** Store what an admin chose for one person. Returns the previous choice. */
export async function setMemberLimit(
    companyId: bigint,
    userId: string,
    choice: MemberLimitChoice,
    updatedBy: string
): Promise<MemberLimitChoice> {
    const [previousRow] = await db
        .select({ monthlyTokens: memberAiLimits.monthlyTokens })
        .from(memberAiLimits)
        .where(and(eq(memberAiLimits.companyId, companyId), eq(memberAiLimits.userId, userId)));
    const previous: MemberLimitChoice = !previousRow
        ? { mode: "default" }
        : previousRow.monthlyTokens === null
          ? { mode: "none" }
          : { mode: "custom", monthlyTokens: previousRow.monthlyTokens };

    if (choice.mode === "default") {
        await db
            .delete(memberAiLimits)
            .where(and(eq(memberAiLimits.companyId, companyId), eq(memberAiLimits.userId, userId)));
    } else {
        const monthlyTokens = choice.mode === "none" ? null : choice.monthlyTokens;
        await db
            .insert(memberAiLimits)
            .values({ companyId, userId, monthlyTokens, updatedBy })
            .onConflictDoUpdate({
                target: [memberAiLimits.companyId, memberAiLimits.userId],
                set: { monthlyTokens, updatedBy, updatedAt: new Date() },
            });
    }
    invalidateAiAllowances();
    return previous;
}

/** Tokens used this month in a workspace by work no one person started. */
export async function unattributedUsage(companyId: bigint, at?: Date): Promise<number> {
    const { start } = allowancePeriod(at);
    const [row] = await db
        .select({ tokens: usedTokens() })
        .from(aiUsageDaily)
        .where(
            and(
                eq(aiUsageDaily.companyId, companyId),
                gte(aiUsageDaily.date, start),
                eq(aiUsageDaily.userId, "")
            )
        );
    return Number(row?.tokens ?? 0);
}

export { AiAllowanceExceededError, isAiAllowanceExceededError } from "./errors";
