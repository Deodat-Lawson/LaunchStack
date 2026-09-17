/**
 * Reading and writing scoped settings.
 *
 * Resolution is per request: `loadSettings` pulls every row that could apply
 * to this viewer (workspace rows, their member rows, and the folder rows on
 * the path they are looking at) in one query and resolves each registry key
 * in memory. There is deliberately no process-level cache — effective values
 * are read on hot paths once agents and document defaults are scoped, and a
 * cache that is wrong across workers is worse than one cheap query.
 *
 * Writes go through one function: validate against the registry schema,
 * check the scope is allowed and the viewer may write it, store (or reset),
 * and audit workspace- and folder-level changes in the same transaction.
 * Member-level changes are personal preferences and are not audited: a
 * theme flip is not an event the workspace audit log should carry.
 */

import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "~/server/db";
import { settingsValues } from "~/server/db/schema";
import { recordAuditEvent } from "~/lib/authz/audit";
import { folderAncestors, validateFolderPath } from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { SETTINGS, getSetting, type SettingDefinition } from "~/lib/settings/registry";
import {
    isStoredScope,
    type ResolvedSetting,
    type SettingWriteRequest,
    type SettingsPayload,
    type StoredScope,
} from "~/lib/settings/types";
import { badRequest, forbidden, notFound } from "~/server/workspace/errors";
import type { Executor } from "~/server/workspace/db-types";

import { getSettingBinding } from "./bindings";
import { resolveSetting, type StoredSettingRow } from "./resolve";

export interface LoadSettingsOptions {
    /** Resolve folder overrides for this path. Null: no folder in view. */
    folderPath?: string | null;
    /** Only these keys. Default: every registered key. */
    keys?: readonly string[];
}

async function loadRows(
    executor: Executor,
    companyId: bigint,
    authUserId: string,
    folderPath: string | null
): Promise<StoredSettingRow[]> {
    const folderIds = folderPath ? [folderPath, ...folderAncestors(folderPath)] : [];
    const scopeClauses = [
        eq(settingsValues.scopeType, "workspace"),
        and(eq(settingsValues.scopeType, "member"), eq(settingsValues.scopeId, authUserId)),
        ...(folderIds.length > 0
            ? [
                  and(
                      eq(settingsValues.scopeType, "folder"),
                      inArray(settingsValues.scopeId, folderIds)
                  ),
              ]
            : []),
    ];
    const rows = await executor
        .select({
            scopeType: settingsValues.scopeType,
            scopeId: settingsValues.scopeId,
            key: settingsValues.key,
            value: settingsValues.value,
            updatedBy: settingsValues.updatedBy,
            updatedAt: settingsValues.updatedAt,
        })
        .from(settingsValues)
        .where(and(eq(settingsValues.companyId, companyId), or(...scopeClauses)));
    return rows;
}

async function resolveBound(
    executor: Executor,
    definition: SettingDefinition,
    ctx: WorkspaceContext
): Promise<ResolvedSetting> {
    const binding = getSettingBinding(definition.key);
    const value = binding ? await binding.read(executor, ctx.companyId) : definition.default;
    const isDefault = JSON.stringify(value) === JSON.stringify(definition.default);
    const mayWrite = definition.permission === null || ctx.can(definition.permission);
    return {
        key: definition.key,
        value,
        source: isDefault ? "default" : "workspace",
        sourceId: null,
        updatedBy: null,
        updatedAt: null,
        canEdit: { workspace: mayWrite, folder: false, member: false },
        stored: isDefault ? {} : { workspace: value },
    };
}

/** Every registered setting, resolved for this viewer. */
export async function loadSettings(
    ctx: WorkspaceContext,
    options: LoadSettingsOptions = {},
    executor: Executor = db
): Promise<SettingsPayload> {
    const folderPath = options.folderPath ?? null;
    const definitions = options.keys
        ? options.keys.map(key => getSetting(key)).filter((d): d is SettingDefinition => Boolean(d))
        : SETTINGS;
    const rows = await loadRows(executor, ctx.companyId, ctx.authUserId, folderPath);
    const viewer = {
        authUserId: ctx.authUserId,
        folderPath,
        can: (permission: Parameters<WorkspaceContext["can"]>[0]) => ctx.can(permission),
    };

    const settings: Record<string, ResolvedSetting> = {};
    for (const definition of definitions) {
        settings[definition.key] = definition.bound
            ? await resolveBound(executor, definition, ctx)
            : resolveSetting(definition, rows, viewer);
    }
    return {
        settings,
        viewer: { authUserId: ctx.authUserId, permissions: [...ctx.permissions] },
        folder: folderPath,
    };
}

/** The effective value of one key, typed by the caller. For server code paths. */
export async function readSettingValue<T>(
    ctx: WorkspaceContext,
    key: string,
    options: Omit<LoadSettingsOptions, "keys"> = {}
): Promise<T> {
    const payload = await loadSettings(ctx, { ...options, keys: [key] });
    const resolved = payload.settings[key];
    if (!resolved) throw notFound(`Unknown setting "${key}"`);
    return resolved.value as T;
}

/**
 * The workspace-level value of one key without a viewer — for server paths
 * that act on behalf of the workspace (a meeting run, a purge job) rather
 * than a person. Member and folder scopes are ignored by design.
 */
export async function readWorkspaceSetting<T>(
    companyId: bigint,
    key: string,
    executor: Executor = db
): Promise<T> {
    const definition = getSetting(key);
    if (!definition) throw notFound(`Unknown setting "${key}"`);
    if (definition.bound) {
        const binding = getSettingBinding(key);
        return (binding ? await binding.read(executor, companyId) : definition.default) as T;
    }
    const [row] = await executor
        .select({ value: settingsValues.value })
        .from(settingsValues)
        .where(
            and(
                eq(settingsValues.companyId, companyId),
                eq(settingsValues.scopeType, "workspace"),
                eq(settingsValues.key, key)
            )
        )
        .limit(1);
    if (!row) return definition.default as T;
    const parsed = definition.schema.safeParse(row.value);
    return (parsed.success ? parsed.data : definition.default) as T;
}

function scopeIdFor(
    scope: StoredScope,
    request: SettingWriteRequest,
    ctx: WorkspaceContext
): string {
    switch (scope) {
        case "workspace":
            return "";
        case "member":
            return ctx.authUserId;
        case "folder": {
            const path = (request.scopeId ?? "").trim();
            if (!path) throw badRequest("A folder scope needs a folder path");
            const problem = validateFolderPath(path);
            if (problem) throw badRequest(problem);
            return path;
        }
    }
}

/** Validate, authorise, store and audit one write. Returns the key re-resolved for the viewer. */
export async function writeSetting(
    ctx: WorkspaceContext,
    request: SettingWriteRequest
): Promise<ResolvedSetting> {
    const definition = getSetting(request.key);
    if (!definition) throw notFound(`Unknown setting "${request.key}"`);
    if (!isStoredScope(request.scope) || !definition.scopes.includes(request.scope)) {
        throw badRequest(`"${definition.key}" cannot be set at the ${String(request.scope)} scope`);
    }
    const scope = request.scope;
    if (scope !== "member" && definition.permission !== null && !ctx.can(definition.permission)) {
        throw forbidden(`Changing "${definition.label}" needs ${definition.permission}`, {
            permission: definition.permission,
        });
    }
    if (scope === "member" && request.scopeId && request.scopeId !== ctx.authUserId) {
        throw forbidden("You can only change your own preferences");
    }
    const scopeId = scopeIdFor(scope, request, ctx);

    let nextValue: unknown = null;
    if (!request.reset) {
        const parsed = definition.schema.safeParse(request.value);
        if (!parsed.success) {
            const detail = parsed.error.issues.map(issue => issue.message).join("; ");
            throw badRequest(`Invalid value for "${definition.label}": ${detail}`);
        }
        nextValue = parsed.data;
    }

    const binding = definition.bound ? getSettingBinding(definition.key) : undefined;

    await db.transaction(async tx => {
        let previous: unknown = null;
        if (binding) {
            previous = await binding.read(tx, ctx.companyId);
            await binding.write(tx, ctx.companyId, request.reset ? null : nextValue);
        } else {
            const where = and(
                eq(settingsValues.companyId, ctx.companyId),
                eq(settingsValues.scopeType, scope),
                eq(settingsValues.scopeId, scopeId),
                eq(settingsValues.key, definition.key)
            );
            const [existing] = await tx
                .select({ id: settingsValues.id, value: settingsValues.value })
                .from(settingsValues)
                .where(where)
                .limit(1);
            previous = existing ? existing.value : null;
            if (request.reset) {
                if (existing) await tx.delete(settingsValues).where(where);
            } else if (existing) {
                await tx
                    .update(settingsValues)
                    .set({ value: nextValue, updatedBy: ctx.authUserId, updatedAt: new Date() })
                    .where(where);
            } else {
                await tx.insert(settingsValues).values({
                    companyId: ctx.companyId,
                    scopeType: scope,
                    scopeId,
                    key: definition.key,
                    value: nextValue,
                    updatedBy: ctx.authUserId,
                });
            }
        }

        if (scope !== "member") {
            await recordAuditEvent(tx, {
                companyId: ctx.companyId,
                actorUserId: ctx.authUserId,
                action: "settings.changed",
                targetType: "setting",
                targetId: definition.key,
                detail: {
                    key: definition.key,
                    label: definition.label,
                    scope,
                    scopeId: scope === "folder" ? scopeId : null,
                    from: previous,
                    to: request.reset ? null : nextValue,
                    reset: Boolean(request.reset),
                },
            });
        }
    });

    const payload = await loadSettings(ctx, {
        keys: [definition.key],
        folderPath: scope === "folder" ? scopeId : null,
    });
    return payload.settings[definition.key]!;
}
