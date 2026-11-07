/**
 * The Usage tab's services, one per `/api/usage/*` route. Each gathers who is
 * in the workspace (`listMembers`), what they did (./queries) and what it
 * cost (`usage.pricePerMillionTokens`), and hands the folding to ./rollup.
 *
 * Who may see what is the routes' gate: the workspace-wide reads are for
 * `analytics.view`; `usageMe` is any member's own numbers plus the
 * workspace's median, and never carries anyone else's name or figures.
 *
 * People are members by auth id. A current member is active or suspended; a
 * pending invitation is not one yet. Anyone else whose work is in the window
 * has left, and is only ever counted together (`formerMembers`).
 */

import { copy } from "~/i18n/copy";
import type { AiFeature } from "~/lib/ai-usage";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { isoDay } from "~/lib/usage/range";
import {
    MIN_MEMBERS_FOR_MEDIAN,
    type UsageActivity,
    type UsageAllowance,
    type UsageDocuments,
    type UsageMe,
    type UsagePeople,
    type UsageScope,
    type UsageSummary,
    type UsageWindow,
} from "~/lib/usage/types";
import { getAiAllowances } from "~/server/ai-usage/quota";
import { workspacePricePerMillionTokens } from "~/server/settings/usage";
import { notFound } from "~/server/workspace/errors";
import { listMembers } from "~/server/workspace/members";
import { loadWorkspaceChatModelsScope } from "~/server/workspace-models/scope";

import { aiUsageRows, documentUsage, usageRaw, workspaceGroupList } from "./queries";
import {
    activeDaysOf,
    activityOf,
    currentMembers,
    documentsOf,
    medianOf,
    peopleOf,
    streakOf,
    summarize,
    toUsageAllowance,
    type UsageMember,
} from "./rollup";

export { readUsageQuery, DOCUMENTS_PAGE, type UsageQuery } from "./params";

/** How far back `usageMe` looks for the start of a current streak. */
const STREAK_LOOKBACK_DAYS = 366;

const memberNotFound = () => notFound(copy("team.server.errors.memberNotFound"));
const groupNotFound = () => notFound(copy("team.server.errors.groupNotFound"));

async function members(ctx: WorkspaceContext): Promise<UsageMember[]> {
    return currentMembers((await listMembers(ctx)).members);
}

function memberById(list: readonly UsageMember[], id: number): UsageMember {
    const member = list.find(m => m.id === id);
    if (!member) throw memberNotFound();
    return member;
}

const inGroup = (list: readonly UsageMember[], groupId: number) =>
    list.filter(member => member.groups.some(group => group.id === groupId));

/** The workspace, one person or one group: totals, the previous window, every day, features, routes. */
export async function usageSummary(
    ctx: WorkspaceContext,
    window: UsageWindow,
    filter: { person: number | null; group: number | null }
): Promise<UsageSummary> {
    const [current, price, groups] = await Promise.all([
        members(ctx),
        workspacePricePerMillionTokens(ctx.companyId),
        filter.group === null ? Promise.resolve([]) : workspaceGroupList(ctx.companyId),
    ]);

    let scope: UsageScope = { kind: "workspace" };
    let people: Set<string> | undefined;
    let count = current.length;
    if (filter.person !== null) {
        const member = memberById(current, filter.person);
        scope = { kind: "person", memberId: member.id, displayName: member.displayName };
        people = new Set([member.authUserId]);
        count = 1;
    } else if (filter.group !== null) {
        const group = groups.find(g => g.id === filter.group);
        if (!group) throw groupNotFound();
        const listed = inGroup(current, group.id);
        scope = { kind: "group", groupId: group.id, name: group.name };
        people = new Set(listed.map(m => m.authUserId));
        count = listed.length;
    }

    const raw = await usageRaw(
        ctx.companyId,
        { from: window.previousFrom, to: window.to },
        people ? { userIds: [...people] } : {}
    );
    return summarize({ window, scope, raw, pricePerMillionTokens: price, people, members: count });
}

/** Every current member (or one group's) with their numbers and AI allowance. */
export async function usagePeople(
    ctx: WorkspaceContext,
    window: UsageWindow,
    filter: { group: number | null }
): Promise<UsagePeople> {
    const [current, groups, price, models] = await Promise.all([
        members(ctx),
        workspaceGroupList(ctx.companyId),
        workspacePricePerMillionTokens(ctx.companyId),
        loadWorkspaceChatModelsScope(ctx.companyId),
    ]);
    if (filter.group !== null && !groups.some(g => g.id === filter.group)) throw groupNotFound();
    const listed = filter.group === null ? current : inGroup(current, filter.group);
    const authIds = listed.map(m => m.authUserId);

    const [raw, allowances] = await Promise.all([
        usageRaw(ctx.companyId, window, filter.group === null ? {} : { userIds: authIds }),
        // The server's cap doesn't apply while the workspace runs on its own endpoint.
        getAiAllowances(ctx.companyId, authIds, {
            serverCapApplies: models.source === "deployment",
        }),
    ]);
    const usageAllowances = new Map<string, UsageAllowance>();
    for (const [authId, allowance] of allowances) {
        usageAllowances.set(authId, toUsageAllowance(allowance));
    }

    return peopleOf({
        window,
        raw,
        pricePerMillionTokens: price,
        members: listed,
        currentAuthIds: new Set(current.map(m => m.authUserId)),
        allowances: usageAllowances,
        groups,
        grouped: filter.group !== null,
    });
}

/** AI use by day, person, feature, route and owner — never by model. */
export async function usageActivity(
    ctx: WorkspaceContext,
    window: UsageWindow,
    filter: { person: number | null; feature: AiFeature | null; offset: number; limit: number }
): Promise<UsageActivity> {
    const [current, price] = await Promise.all([
        members(ctx),
        workspacePricePerMillionTokens(ctx.companyId),
    ]);
    const person = filter.person === null ? null : memberById(current, filter.person);
    const rows = await aiUsageRows(ctx.companyId, window, {
        ...(person ? { userIds: [person.authUserId] } : {}),
        ...(filter.feature ? { feature: filter.feature } : {}),
    });
    return activityOf({
        window,
        rows,
        members: current,
        pricePerMillionTokens: price,
        offset: filter.offset,
        limit: filter.limit,
    });
}

/** The documents the caller may read, most opened first. */
export async function usageDocuments(
    ctx: WorkspaceContext,
    window: UsageWindow,
    options: { limit: number }
): Promise<UsageDocuments> {
    const visible = scopedDocumentWhere(ctx.companyId, await ctx.documentScope());
    const usage = await documentUsage(ctx.companyId, visible, window, options.limit);
    return documentsOf({ window, ...usage });
}

/** The caller's own numbers, the workspace's median and their streak. */
export async function usageMe(
    ctx: WorkspaceContext,
    window: UsageWindow,
    now: Date = new Date()
): Promise<UsageMe> {
    const [current, price] = await Promise.all([
        members(ctx),
        workspacePricePerMillionTokens(ctx.companyId),
    ]);
    const me = current.find(m => m.authUserId === ctx.authUserId);
    if (!me) throw memberNotFound();

    const today = isoDay(now);
    const lookback = isoDay(
        new Date(Date.parse(`${today}T00:00:00Z`) - STREAK_LOOKBACK_DAYS * 86_400_000)
    );
    const [everyone, mine] = await Promise.all([
        // Everyone's window, for the median only; nothing of it leaves here but that.
        usageRaw(ctx.companyId, window),
        // Mine, far enough back for both windows and a long streak.
        usageRaw(
            ctx.companyId,
            { from: lookback < window.previousFrom ? lookback : window.previousFrom, to: today },
            { userIds: [me.authUserId] }
        ),
    ]);

    return {
        summary: summarize({
            window,
            scope: { kind: "person", memberId: me.id, displayName: me.displayName },
            raw: mine,
            pricePerMillionTokens: price,
            people: new Set([me.authUserId]),
            members: 1,
        }),
        median:
            current.length >= MIN_MEMBERS_FOR_MEDIAN
                ? medianOf({ window, raw: everyone, authIds: current.map(m => m.authUserId) })
                : null,
        members: current.length,
        streak: streakOf(activeDaysOf(mine, me.authUserId), window, today),
    };
}
