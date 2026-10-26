/**
 * Settings that live in legacy columns.
 *
 * The audit retention window predates the settings table and has a reader of
 * its own (the workspace settings API in `server/workspace/settings.ts`).
 * Moving the bytes would mean touching every reader for no gain, so the
 * registry indexes it and this binding reads and writes the column. The
 * panel, the API and the audit log cannot tell the difference — which is the
 * point.
 *
 * A bound setting is workspace-scoped only. Its value is reported with source
 * `workspace` when it differs from the registry default, `default` otherwise.
 */

import { eq } from "drizzle-orm";

import { workspaceSettings } from "~/server/db/schema";
import type { Executor } from "~/server/workspace/db-types";

export interface SettingBinding {
    read(executor: Executor, companyId: bigint): Promise<unknown>;
    /** `null` value means "reset to the registry default". */
    write(executor: Executor, companyId: bigint, value: unknown): Promise<void>;
}

async function upsertWorkspaceSettings(
    executor: Executor,
    companyId: bigint,
    patch: { auditRetentionDays: number | null }
): Promise<void> {
    const [existing] = await executor
        .select({ companyId: workspaceSettings.companyId })
        .from(workspaceSettings)
        .where(eq(workspaceSettings.companyId, companyId))
        .limit(1);
    if (existing) {
        await executor
            .update(workspaceSettings)
            .set(patch)
            .where(eq(workspaceSettings.companyId, companyId));
    } else {
        await executor.insert(workspaceSettings).values({ companyId, ...patch });
    }
}

export const SETTING_BINDINGS: Readonly<Record<string, SettingBinding>> = {
    "workspace.auditRetentionDays": {
        async read(executor, companyId) {
            const [row] = await executor
                .select({ days: workspaceSettings.auditRetentionDays })
                .from(workspaceSettings)
                .where(eq(workspaceSettings.companyId, companyId))
                .limit(1);
            return row?.days ?? null;
        },
        async write(executor, companyId, value) {
            const days = typeof value === "number" ? value : null;
            await upsertWorkspaceSettings(executor, companyId, { auditRetentionDays: days });
        },
    },
};

export function getSettingBinding(key: string): SettingBinding | undefined {
    return SETTING_BINDINGS[key];
}
