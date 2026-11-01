/**
 * The Usage tab's reads: per person, per UTC day, from the four places a
 * person's use of a workspace is written down. Nothing here adds up across
 * people or days — ./rollup does that, so it can be tested without a database.
 *
 * - **AI** — `ai_usage_daily`, the meter's own rows (one per model; the model
 *   id is never selected, so it can't reach a screen).
 * - **Questions** — user turns in Ask chats (`workspace_session_messages`
 *   under the owner's `workspace_sessions`). Not the legacy `chat_history`:
 *   the Ask panel's document-scoped answers write a row there as well as the
 *   turn here, so reading both would count one question twice, and nothing
 *   else in the current product writes it. Copies are not questions: a turn
 *   carried into a fork of a teammate's chat keeps their name (`askedBy`) and
 *   is skipped, and a turn copied into your own new chat keeps its client id
 *   (`metadata.id`), so each question counts once, on the day it was first
 *   asked.
 * - **Files added** — `workspace_activity` verb `added` on a document: what a
 *   person uploaded or created, not what a sync brought in.
 * - **Documents opened** — `document_views`.
 *
 * Days are UTC calendar days, the days `ai_usage_daily` keeps; timestamps are
 * bucketed the same way.
 */

import {
    and,
    count,
    desc,
    eq,
    gte,
    inArray,
    isNull,
    lt,
    lte,
    sql,
    type AnyColumn,
    type SQL,
} from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import type { UsageDocumentRow } from "~/lib/usage/types";
import { db } from "~/server/db";
import {
    aiUsageDaily,
    documentViews,
    workspaceActivity,
    workspaceGroups,
    workspaceSessionMessages,
    workspaceSessions,
} from "~/server/db/schema";

import type { AiUsageRow, PersonDayCount, UsageRange, UsageRaw } from "./rollup";

/** Narrows every read to some people (auth ids). Absent: everyone, unattributed work included. */
export interface UsageRowFilter {
    userIds?: readonly string[];
}

const DAY_MS = 86_400_000;

/** A range's first instant and the instant after its last day, for timestamp columns. */
function bounds(range: UsageRange): { start: Date; end: Date } {
    return {
        start: new Date(`${range.from}T00:00:00Z`),
        end: new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS),
    };
}

/**
 * Built per query, not at import: tests mock the schema module. Neither
 * carries a bind parameter, so the same text can sit in a select and its
 * group by.
 */
const utcDay = (column: AnyColumn | SQL | SQL.Aliased) =>
    sql<string>`to_char((${column} at time zone 'UTC')::date, 'YYYY-MM-DD')`;
const isoTimestamp = (value: SQL) =>
    sql<string | null>`to_char(${value} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** A Postgres date as `YYYY-MM-DD`, whichever way the driver handed it over. */
function isoDate(value: Date | string): string {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const toCount = (row: { date: string; userId: string; count: number; lastAt: string | null }) => ({
    date: row.date,
    userId: row.userId,
    count: Number(row.count),
    lastAt: row.lastAt,
});

/** The meter's rows, one per day, person, feature, route, owner and (unread) model. */
export async function aiUsageRows(
    companyId: bigint,
    range: UsageRange,
    filter: UsageRowFilter & { feature?: string } = {}
): Promise<AiUsageRow[]> {
    if (filter.userIds?.length === 0) return [];
    const rows = await db
        .select({
            date: aiUsageDaily.date,
            userId: aiUsageDaily.userId,
            feature: aiUsageDaily.feature,
            route: aiUsageDaily.route,
            owner: aiUsageDaily.owner,
            calls: aiUsageDaily.calls,
            inputTokens: aiUsageDaily.inputTokens,
            outputTokens: aiUsageDaily.outputTokens,
            cachedInputTokens: aiUsageDaily.cachedInputTokens,
            reasoningTokens: aiUsageDaily.reasoningTokens,
            pricedCalls: aiUsageDaily.pricedCalls,
            costUsd: aiUsageDaily.costUsd,
            // Every call stamps `updated_at`; the first only `created_at`.
            lastAt: isoTimestamp(
                sql`coalesce(${aiUsageDaily.updatedAt}, ${aiUsageDaily.createdAt})`
            ),
        })
        .from(aiUsageDaily)
        .where(
            and(
                eq(aiUsageDaily.companyId, companyId),
                gte(aiUsageDaily.date, range.from),
                lte(aiUsageDaily.date, range.to),
                filter.userIds ? inArray(aiUsageDaily.userId, [...filter.userIds]) : undefined,
                filter.feature ? eq(aiUsageDaily.feature, filter.feature) : undefined
            )
        );
    // bigint and numeric columns can come back as strings; counts fit a double.
    return rows.map(row => ({
        date: isoDate(row.date),
        userId: row.userId,
        feature: row.feature,
        route: row.route,
        owner: row.owner,
        calls: Number(row.calls),
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
        cachedInputTokens: Number(row.cachedInputTokens),
        reasoningTokens: Number(row.reasoningTokens),
        pricedCalls: Number(row.pricedCalls),
        costUsd: Number(row.costUsd),
        lastAt: row.lastAt,
    }));
}

/**
 * Questions per owner and day. A question's day is its earliest copy's, so
 * the inner query can't start at the range: it reads every turn up to the
 * range's end, and the outer one keeps the questions first asked inside it.
 */
export async function questionCounts(
    companyId: bigint,
    range: UsageRange,
    filter: UsageRowFilter = {}
): Promise<PersonDayCount[]> {
    if (filter.userIds?.length === 0) return [];
    const { start, end } = bounds(range);
    const m = workspaceSessionMessages;
    // Turns from before client ids existed fall back to their text and exact
    // time, which a server-side fork copies unchanged.
    const questionKey = sql`coalesce(${m.metadata} ->> 'id', 'legacy:' || md5(${m.text}) || ':' || ${m.createdAt}::text)`;
    const firsts = db
        .select({
            userId: workspaceSessions.userId,
            firstAt: sql<string>`min(${m.createdAt})`.as("first_at"),
        })
        .from(m)
        .innerJoin(workspaceSessions, eq(workspaceSessions.id, m.sessionId))
        .where(
            and(
                eq(workspaceSessions.companyId, companyId),
                eq(m.role, "user"),
                isNull(sql`${m.metadata} ->> 'askedBy'`),
                lt(m.createdAt, end),
                filter.userIds ? inArray(workspaceSessions.userId, [...filter.userIds]) : undefined
            )
        )
        .groupBy(workspaceSessions.userId, questionKey)
        .as("question_firsts");

    const rows = await db
        .select({
            userId: firsts.userId,
            date: utcDay(firsts.firstAt),
            count: count(),
            lastAt: isoTimestamp(sql`max(${firsts.firstAt})`),
        })
        .from(firsts)
        .where(sql`${firsts.firstAt} >= ${start.toISOString()}::timestamptz`)
        .groupBy(firsts.userId, utcDay(firsts.firstAt));
    return rows.map(toCount);
}

/** Documents each person added, by day. */
export async function filesAddedCounts(
    companyId: bigint,
    range: UsageRange,
    filter: UsageRowFilter = {}
): Promise<PersonDayCount[]> {
    if (filter.userIds?.length === 0) return [];
    const { start, end } = bounds(range);
    const a = workspaceActivity;
    const rows = await db
        .select({
            userId: a.actorUserId,
            date: utcDay(a.createdAt),
            count: count(),
            lastAt: isoTimestamp(sql`max(${a.createdAt})`),
        })
        .from(a)
        .where(
            and(
                eq(a.companyId, companyId),
                eq(a.verb, "added"),
                eq(a.targetType, "document"),
                gte(a.createdAt, start),
                lt(a.createdAt, end),
                filter.userIds ? inArray(a.actorUserId, [...filter.userIds]) : undefined
            )
        )
        .groupBy(a.actorUserId, utcDay(a.createdAt));
    return rows.map(toCount);
}

/** Documents each person opened, by day. */
export async function docsOpenedCounts(
    companyId: bigint,
    range: UsageRange,
    filter: UsageRowFilter = {}
): Promise<PersonDayCount[]> {
    if (filter.userIds?.length === 0) return [];
    const { start, end } = bounds(range);
    const v = documentViews;
    const rows = await db
        .select({
            userId: v.userId,
            date: utcDay(v.viewedAt),
            count: count(),
            lastAt: isoTimestamp(sql`max(${v.viewedAt})`),
        })
        .from(v)
        .where(
            and(
                eq(v.companyId, companyId),
                gte(v.viewedAt, start),
                lt(v.viewedAt, end),
                filter.userIds ? inArray(v.userId, [...filter.userIds]) : undefined
            )
        )
        .groupBy(v.userId, utcDay(v.viewedAt));
    return rows.map(toCount);
}

/** Everything ./rollup folds, for one range. */
export async function usageRaw(
    companyId: bigint,
    range: UsageRange,
    filter: UsageRowFilter = {}
): Promise<UsageRaw> {
    const [ai, questions, filesAdded, docsOpened] = await Promise.all([
        aiUsageRows(companyId, range, filter),
        questionCounts(companyId, range, filter),
        filesAddedCounts(companyId, range, filter),
        docsOpenedCounts(companyId, range, filter),
    ]);
    return { ai, questions, filesAdded, docsOpened };
}

/** The workspace's groups, by name. */
export async function workspaceGroupList(
    companyId: bigint
): Promise<{ id: number; name: string }[]> {
    const rows = await db
        .select({ id: workspaceGroups.id, name: workspaceGroups.name })
        .from(workspaceGroups)
        .where(eq(workspaceGroups.companyId, companyId))
        .orderBy(workspaceGroups.name);
    return rows.map(row => ({ id: Number(row.id), name: row.name }));
}

/**
 * Documents the reader may see (`visible`, from `scopedDocumentWhere`) that
 * existed by the range's end, most opened in the range first, with the opens
 * per day. `lastViewedAt` is the latest open up to the range's end, so a
 * document nobody opened in the range still says when it last was; a later
 * one doesn't leak into a past window, and neither does a later document.
 */
export async function documentUsage(
    companyId: bigint,
    visible: SQL,
    range: UsageRange,
    limit: number
): Promise<{
    documents: UsageDocumentRow[];
    totalDocuments: number;
    trend: { date: string; views: number }[];
}> {
    const { start, end } = bounds(range);
    const inRange = sql`${documentViews.viewedAt} >= ${start.toISOString()}::timestamptz`;
    const views = sql<number>`count(${documentViews.id}) filter (where ${inRange})`;
    const viewers = sql<number>`count(distinct ${documentViews.userId}) filter (where ${inRange})`;
    const lastViewed = sql`max(${documentViews.viewedAt})`;
    const existed = and(visible, lt(document.createdAt, end));

    const [documentRows, [total], trendRows] = await Promise.all([
        db
            .select({
                id: document.id,
                title: document.title,
                category: document.category,
                createdAt: document.createdAt,
                views,
                viewers,
                lastViewedAt: isoTimestamp(lastViewed),
            })
            .from(document)
            .leftJoin(
                documentViews,
                and(
                    eq(documentViews.documentId, document.id),
                    eq(documentViews.companyId, companyId),
                    lt(documentViews.viewedAt, end)
                )
            )
            .where(existed)
            .groupBy(document.id, document.title, document.category, document.createdAt)
            .orderBy(
                desc(views),
                desc(viewers),
                sql`${lastViewed} desc nulls last`,
                desc(document.createdAt),
                desc(document.id)
            )
            .limit(limit),
        db.select({ count: count() }).from(document).where(existed),
        db
            .select({ date: utcDay(documentViews.viewedAt), views: count() })
            .from(documentViews)
            .innerJoin(document, eq(document.id, documentViews.documentId))
            .where(
                and(
                    existed,
                    eq(documentViews.companyId, companyId),
                    gte(documentViews.viewedAt, start),
                    lt(documentViews.viewedAt, end)
                )
            )
            .groupBy(utcDay(documentViews.viewedAt)),
    ]);

    return {
        documents: documentRows.map(row => ({
            id: Number(row.id),
            title: row.title,
            category: row.category,
            views: Number(row.views),
            viewers: Number(row.viewers),
            lastViewedAt: row.lastViewedAt,
            createdAt: row.createdAt.toISOString(),
        })),
        totalDocuments: Number(total?.count ?? 0),
        trend: trendRows.map(row => ({ date: row.date, views: Number(row.views) })),
    };
}
