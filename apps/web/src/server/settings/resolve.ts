/**
 * Pure resolution of a setting from its stored rows.
 *
 * Kept free of the database so the precedence rules — member beats folder
 * beats workspace beats default, nearest folder ancestor wins, a row the
 * schema rejects is ignored — are pinned by a unit test rather than by
 * whoever last looked at the panel.
 */

import { folderAncestors } from "~/lib/folders/path";
import type { SettingDefinition } from "~/lib/settings/registry";
import type { ResolvedSetting, StoredScope } from "~/lib/settings/types";

export interface StoredSettingRow {
    scopeType: string;
    scopeId: string;
    key: string;
    value: unknown;
    updatedBy: string | null;
    updatedAt: Date | string | null;
}

export interface ResolveViewer {
    authUserId: string;
    /** The folder whose overrides apply, when the caller is looking at one. */
    folderPath: string | null;
    can: (permission: NonNullable<SettingDefinition["permission"]>) => boolean;
}

function toIso(value: Date | string | null): string | null {
    if (value === null) return null;
    return value instanceof Date ? value.toISOString() : value;
}

/** Folder scope ids that apply to `folderPath`, nearest first. */
function applicableFolders(folderPath: string | null): string[] {
    if (!folderPath) return [];
    return [folderPath, ...folderAncestors(folderPath).reverse()].filter(
        (path, index, all) => all.indexOf(path) === index
    );
}

export function resolveSetting(
    definition: SettingDefinition,
    rows: readonly StoredSettingRow[],
    viewer: ResolveViewer
): ResolvedSetting {
    const own = rows.filter(row => row.key === definition.key);
    const valid = (row: StoredSettingRow) => definition.schema.safeParse(row.value).success;

    const stored: Partial<Record<StoredScope, unknown>> = {};
    let winner: { row: StoredSettingRow; scope: StoredScope } | null = null;

    const workspaceRow = own.find(
        row =>
            row.scopeType === "workspace" && definition.scopes.includes("workspace") && valid(row)
    );
    if (workspaceRow) {
        stored.workspace = workspaceRow.value;
        winner = { row: workspaceRow, scope: "workspace" };
    }

    if (definition.scopes.includes("folder")) {
        for (const path of applicableFolders(viewer.folderPath)) {
            const folderRow = own.find(
                row => row.scopeType === "folder" && row.scopeId === path && valid(row)
            );
            if (folderRow) {
                stored.folder = folderRow.value;
                winner = { row: folderRow, scope: "folder" };
                break;
            }
        }
    }

    if (definition.scopes.includes("member")) {
        const memberRow = own.find(
            row => row.scopeType === "member" && row.scopeId === viewer.authUserId && valid(row)
        );
        if (memberRow) {
            stored.member = memberRow.value;
            winner = { row: memberRow, scope: "member" };
        }
    }

    const mayWriteShared =
        definition.permission === null ? true : viewer.can(definition.permission);

    return {
        key: definition.key,
        value: winner ? winner.row.value : definition.default,
        source: winner ? winner.scope : "default",
        sourceId: winner ? (winner.scope === "workspace" ? null : winner.row.scopeId) : null,
        updatedBy: winner ? winner.row.updatedBy : null,
        updatedAt: winner ? toIso(winner.row.updatedAt) : null,
        canEdit: {
            workspace: definition.scopes.includes("workspace") && mayWriteShared,
            folder: definition.scopes.includes("folder") && mayWriteShared,
            member: definition.scopes.includes("member"),
        },
        stored,
    };
}
