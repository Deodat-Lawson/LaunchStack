/**
 * Archive and retention — everything the workspace has put away, in one list.
 *
 * Four kinds share one shape: trashed mindmaps and artifacts (soft-deleted
 * with `deleted_at`), retired agents and archived channels (an `archived`
 * flag). Restore reverses each the way its own feature does; permanent
 * delete removes the row (cascades take revisions and presence with it).
 * The trash retention window is applied here, when the archive is read,
 * because that is the only moment the app is looking — there is no nightly
 * job, and the setting says so.
 */

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import { db } from "~/server/db";
import { claudeArtifacts, collabAgentPersona, collabChannel, mindmaps } from "~/server/db/schema";
import { recordAuditEvent } from "~/lib/authz/audit";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { badRequest } from "~/server/workspace/errors";

import { readWorkspaceSetting } from "./store";

export type ArchiveKind = "mindmap" | "artifact" | "agent" | "channel";

export interface ArchivedItem {
    kind: ArchiveKind;
    id: string;
    title: string;
    detail: string | null;
    /** When it was put away. Null when the row does not record it. */
    archivedAt: string | null;
    /** Whether it can be removed for good from this page. */
    deletable: boolean;
}

export interface ArchiveOverview {
    items: ArchivedItem[];
    trashDays: number | null;
    /** Rows the retention window removed while building this answer. */
    purged: number;
}

async function purgeExpiredTrash(companyId: bigint, trashDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - trashDays * 86_400_000);
    const [maps, artifacts] = await Promise.all([
        db
            .delete(mindmaps)
            .where(
                and(
                    eq(mindmaps.companyId, companyId),
                    isNotNull(mindmaps.deletedAt),
                    lt(mindmaps.deletedAt, cutoff)
                )
            )
            .returning({ id: mindmaps.id }),
        db
            .delete(claudeArtifacts)
            .where(
                and(
                    eq(claudeArtifacts.companyId, companyId),
                    isNotNull(claudeArtifacts.deletedAt),
                    lt(claudeArtifacts.deletedAt, cutoff)
                )
            )
            .returning({ id: claudeArtifacts.id }),
    ]);
    return maps.length + artifacts.length;
}

export async function archiveOverview(companyId: bigint): Promise<ArchiveOverview> {
    const trashDays = await readWorkspaceSetting<number | null>(companyId, "retention.trashDays");
    const purged = trashDays ? await purgeExpiredTrash(companyId, trashDays) : 0;

    const [maps, artifacts, agents, channels] = await Promise.all([
        db
            .select({
                id: mindmaps.id,
                title: mindmaps.title,
                folder: mindmaps.folder,
                deletedAt: mindmaps.deletedAt,
            })
            .from(mindmaps)
            .where(and(eq(mindmaps.companyId, companyId), isNotNull(mindmaps.deletedAt))),
        db
            .select({
                id: claudeArtifacts.id,
                title: claudeArtifacts.title,
                folder: claudeArtifacts.folder,
                deletedAt: claudeArtifacts.deletedAt,
            })
            .from(claudeArtifacts)
            .where(
                and(eq(claudeArtifacts.companyId, companyId), isNotNull(claudeArtifacts.deletedAt))
            ),
        db
            .select({
                id: collabAgentPersona.id,
                displayName: collabAgentPersona.displayName,
                role: collabAgentPersona.role,
                updatedAt: collabAgentPersona.updatedAt,
            })
            .from(collabAgentPersona)
            .where(
                and(
                    eq(collabAgentPersona.companyId, companyId),
                    eq(collabAgentPersona.archived, true)
                )
            ),
        db
            .select({
                id: collabChannel.id,
                name: collabChannel.name,
                slug: collabChannel.slug,
                updatedAt: collabChannel.updatedAt,
            })
            .from(collabChannel)
            .where(and(eq(collabChannel.companyId, companyId), eq(collabChannel.archived, true))),
    ]);

    const items: ArchivedItem[] = [
        ...maps.map(row => ({
            kind: "mindmap" as const,
            id: String(row.id),
            title: row.title,
            detail: row.folder,
            archivedAt: row.deletedAt?.toISOString() ?? null,
            deletable: true,
        })),
        ...artifacts.map(row => ({
            kind: "artifact" as const,
            id: String(row.id),
            title: row.title,
            detail: row.folder,
            archivedAt: row.deletedAt?.toISOString() ?? null,
            deletable: true,
        })),
        ...agents.map(row => ({
            kind: "agent" as const,
            id: row.id,
            title: row.displayName,
            detail: row.role,
            archivedAt: row.updatedAt?.toISOString() ?? null,
            // Persona ids appear in past transcripts; the row must keep resolving.
            deletable: false,
        })),
        ...channels.map(row => ({
            kind: "channel" as const,
            id: row.id,
            title: row.name,
            detail: `#${row.slug}`,
            archivedAt: row.updatedAt?.toISOString() ?? null,
            deletable: false,
        })),
    ].sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));

    return { items, trashDays, purged };
}

export interface ArchiveActionInput {
    action: "restore" | "delete";
    items: Array<{ kind: ArchiveKind; id: string }>;
}

/** Applies one action to a batch, one kind at a time. Partial failure is reported, not hidden. */
export async function applyArchiveAction(
    ctx: WorkspaceContext,
    input: ArchiveActionInput
): Promise<{ done: number; failed: Array<{ kind: ArchiveKind; id: string; reason: string }> }> {
    const failed: Array<{ kind: ArchiveKind; id: string; reason: string }> = [];
    let done = 0;
    const byKind = new Map<ArchiveKind, string[]>();
    for (const item of input.items) {
        byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item.id]);
    }

    for (const [kind, ids] of byKind) {
        try {
            const numeric = ids
                .map(id => Number(id))
                .filter(id => Number.isSafeInteger(id) && id > 0);
            switch (kind) {
                case "mindmap": {
                    const where = and(
                        eq(mindmaps.companyId, ctx.companyId),
                        inArray(mindmaps.id, numeric)
                    );
                    const rows =
                        input.action === "restore"
                            ? await db
                                  .update(mindmaps)
                                  .set({ deletedAt: null, updatedByUserId: ctx.authUserId })
                                  .where(where)
                                  .returning({ id: mindmaps.id })
                            : await db.delete(mindmaps).where(where).returning({ id: mindmaps.id });
                    done += rows.length;
                    break;
                }
                case "artifact": {
                    const where = and(
                        eq(claudeArtifacts.companyId, ctx.companyId),
                        inArray(claudeArtifacts.id, numeric)
                    );
                    const rows =
                        input.action === "restore"
                            ? await db
                                  .update(claudeArtifacts)
                                  .set({ deletedAt: null, updatedByUserId: ctx.authUserId })
                                  .where(where)
                                  .returning({ id: claudeArtifacts.id })
                            : await db
                                  .delete(claudeArtifacts)
                                  .where(where)
                                  .returning({ id: claudeArtifacts.id });
                    done += rows.length;
                    break;
                }
                case "agent": {
                    if (input.action === "delete") {
                        throw badRequest(
                            "Retired agents cannot be deleted: their handles appear in past transcripts."
                        );
                    }
                    const rows = await db
                        .update(collabAgentPersona)
                        .set({ archived: false })
                        .where(
                            and(
                                eq(collabAgentPersona.companyId, ctx.companyId),
                                inArray(collabAgentPersona.id, ids)
                            )
                        )
                        .returning({ id: collabAgentPersona.id });
                    done += rows.length;
                    break;
                }
                case "channel": {
                    if (input.action === "delete") {
                        throw badRequest(
                            "Channels keep their transcript; archive is as far as they go."
                        );
                    }
                    const rows = await db
                        .update(collabChannel)
                        .set({ archived: false })
                        .where(
                            and(
                                eq(collabChannel.companyId, ctx.companyId),
                                inArray(collabChannel.id, ids)
                            )
                        )
                        .returning({ id: collabChannel.id });
                    done += rows.length;
                    break;
                }
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : "Failed";
            for (const id of ids) failed.push({ kind, id, reason });
        }
    }

    if (done > 0) {
        await recordAuditEvent(db, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: input.action === "restore" ? "archive.restored" : "archive.deleted",
            targetType: "workspace",
            targetId: ctx.companyId,
            detail: { count: done, kinds: [...byKind.keys()] },
        });
    }

    return { done, failed };
}
