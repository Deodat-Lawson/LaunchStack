/**
 * The per-person half of Settings › Usage: what each member used this month,
 * the limit that applies to them, and an admin's way to change it.
 */

import { z } from "zod";

import { copy } from "~/i18n/copy";
import { recordAuditEvent } from "~/lib/authz/audit";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { listMembers, type MemberView } from "~/server/workspace/members";
import { notFound } from "~/server/workspace/errors";
import { loadWorkspaceChatModelsScope } from "~/server/workspace-models/scope";

import {
    allowancePeriod,
    getAiAllowances,
    serverMonthlyLimit,
    setMemberLimit,
    unattributedUsage,
    workspaceDefaultLimit,
    type AiAllowance,
    type AllowancePeriod,
    type MemberLimitChoice,
} from "./quota";

export const memberLimitChoiceSchema: z.ZodType<MemberLimitChoice> = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("default") }),
    z.object({ mode: z.literal("none") }),
    z.object({
        mode: z.literal("custom"),
        monthlyTokens: z.number().int().min(1).max(1_000_000_000_000),
    }),
]);

export interface MemberAllowanceRow {
    authUserId: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
    roleName: string;
    status: MemberView["status"];
    isSelf: boolean;
    allowance: AiAllowance;
    /** What an admin chose for them; `default` when nothing was. */
    choice: MemberLimitChoice;
}

export interface MemberAllowances {
    period: AllowancePeriod;
    /** The workspace default in tokens a month, or null for none. */
    workspaceDefault: number | null;
    /**
     * The server-wide cap, when the server sets one. `appliesHere` is false
     * while the workspace runs on its own endpoint, which the server doesn't pay for.
     */
    serverCap: { limit: number; appliesHere: boolean } | null;
    members: MemberAllowanceRow[];
    /** Tokens this month from work no one person started (and from before per-person counting). */
    unattributed: number;
}

function choiceOf(allowance: AiAllowance): MemberLimitChoice {
    if (allowance.workspace.source === "default") return { mode: "default" };
    return allowance.workspace.limit === null
        ? { mode: "none" }
        : { mode: "custom", monthlyTokens: allowance.workspace.limit };
}

export async function memberAllowances(ctx: WorkspaceContext): Promise<MemberAllowances> {
    const [{ members }, scope, workspaceDefault, unattributed] = await Promise.all([
        listMembers(ctx),
        loadWorkspaceChatModelsScope(ctx.companyId),
        workspaceDefaultLimit(ctx.companyId),
        unattributedUsage(ctx.companyId),
    ]);
    const listed = members.filter(m => m.status !== "pending");
    const serverCapApplies = scope.source === "deployment";
    const allowances = await getAiAllowances(
        ctx.companyId,
        listed.map(m => m.authUserId),
        { serverCapApplies }
    );
    const serverLimit = serverMonthlyLimit();

    const rows = listed.map(member => {
        const allowance = allowances.get(member.authUserId)!;
        return {
            authUserId: member.authUserId,
            displayName: member.displayName,
            email: member.email,
            avatarUrl: member.avatarUrl,
            roleName: member.roleName,
            status: member.status,
            isSelf: member.isSelf,
            allowance,
            choice: choiceOf(allowance),
        };
    });
    // Heaviest users first: that is what this table is for.
    rows.sort(
        (a, b) => b.allowance.used - a.allowance.used || a.displayName.localeCompare(b.displayName)
    );

    return {
        period: allowancePeriod(),
        workspaceDefault,
        serverCap:
            serverLimit === null ? null : { limit: serverLimit, appliesHere: serverCapApplies },
        members: rows,
        unattributed,
    };
}

/** Set one member's limit. Throws a 404 WorkspaceError for someone not in the workspace. */
export async function updateMemberLimit(
    ctx: WorkspaceContext,
    authUserId: string,
    choice: MemberLimitChoice
): Promise<MemberAllowanceRow> {
    const { members } = await listMembers(ctx);
    const member = members.find(m => m.authUserId === authUserId && m.status !== "pending");
    if (!member) {
        throw notFound(copy("team.server.errors.memberNotFound"));
    }
    const previous = await setMemberLimit(ctx.companyId, authUserId, choice, ctx.authUserId);
    await recordAuditEvent(db, {
        companyId: ctx.companyId,
        actorUserId: ctx.authUserId,
        action: "settings.changed",
        targetType: "member",
        targetId: authUserId,
        detail: {
            key: "usage.memberLimit",
            label: "AI limit",
            member: member.displayName,
            from: previous,
            to: choice,
        },
    });
    const refreshed = await memberAllowances(ctx);
    return refreshed.members.find(m => m.authUserId === authUserId)!;
}
