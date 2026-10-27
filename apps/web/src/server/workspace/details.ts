/**
 * The workspace's own details: name, URL handle, description, industry, team
 * size and colour. Set when the workspace is created (`POST /api/workspaces`)
 * and changed from the Workspace tab's General screen.
 *
 * The slug is unique by this check alone — the column carries no database
 * constraint, as at creation — and every change is audited with what it was
 * and what it became, like the other workspace settings.
 */

import { eq } from "drizzle-orm";

import { company } from "@launchstack/store/schema";

import { copy } from "~/i18n/copy";
import { db } from "~/server/db";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import type { WorkspaceDetails, WorkspaceDetailsPatch } from "~/lib/workspace-details";

import { conflict, notFound } from "./errors";

const COLUMNS = {
    id: company.id,
    name: company.name,
    slug: company.slug,
    description: company.description,
    industry: company.industry,
    numberOfEmployees: company.numberOfEmployees,
    swatch: company.swatch,
} as const;

type Row = {
    id: number;
    name: string;
    slug: string | null;
    description: string | null;
    industry: string | null;
    numberOfEmployees: string;
    swatch: number | null;
};

function toDetails(row: Row): WorkspaceDetails {
    return {
        id: Number(row.id),
        name: row.name,
        slug: row.slug ?? null,
        description: row.description ?? null,
        industry: row.industry ?? null,
        teamSize: row.numberOfEmployees,
        swatch: row.swatch ?? 1,
    };
}

export async function getWorkspaceDetails(ctx: WorkspaceContext): Promise<WorkspaceDetails> {
    const [row] = await db
        .select(COLUMNS)
        .from(company)
        .where(eq(company.id, Number(ctx.companyId)))
        .limit(1);
    if (!row) throw notFound(copy("settings.server.workspaceDetails.notFound"));
    return toDetails(row);
}

/** The fields a patch actually changes, each with what it was and what it becomes. */
function diff(
    current: WorkspaceDetails,
    patch: WorkspaceDetailsPatch
): Partial<Record<keyof WorkspaceDetailsPatch, { from: unknown; to: unknown }>> {
    const changes: Partial<Record<keyof WorkspaceDetailsPatch, { from: unknown; to: unknown }>> =
        {};
    for (const key of Object.keys(patch) as (keyof WorkspaceDetailsPatch)[]) {
        const to = patch[key];
        if (to === undefined) continue;
        const from = current[key];
        if (from !== to) changes[key] = { from, to };
    }
    return changes;
}

export async function updateWorkspaceDetails(
    ctx: WorkspaceContext,
    patch: WorkspaceDetailsPatch
): Promise<WorkspaceDetails> {
    const current = await getWorkspaceDetails(ctx);
    const changes = diff(current, patch);
    if (Object.keys(changes).length === 0) return current;

    if (changes.slug) {
        const slug = changes.slug.to as string;
        const holders = await db
            .select({ id: company.id })
            .from(company)
            .where(eq(company.slug, slug));
        if (holders.some(holder => Number(holder.id) !== current.id)) {
            throw conflict(copy("settings.server.workspaceDetails.urlTaken"), { field: "slug" });
        }
    }

    const next: WorkspaceDetails = { ...current };
    const set: Partial<typeof company.$inferInsert> = {};
    if (changes.name) set.name = next.name = changes.name.to as string;
    if (changes.slug) set.slug = next.slug = changes.slug.to as string;
    if (changes.description) {
        set.description = next.description = changes.description.to as string | null;
    }
    if (changes.industry) set.industry = next.industry = changes.industry.to as string | null;
    if (changes.teamSize) set.numberOfEmployees = next.teamSize = changes.teamSize.to as string;
    if (changes.swatch) set.swatch = next.swatch = changes.swatch.to as number;

    await db.transaction(async tx => {
        await tx.update(company).set(set).where(eq(company.id, current.id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "settings.changed",
            targetType: "workspace",
            targetId: ctx.companyId,
            detail: { changes },
        });
    });

    return next;
}
