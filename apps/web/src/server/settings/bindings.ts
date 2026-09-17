/**
 * Settings that live in legacy columns.
 *
 * The join policy, the audit retention window and the upload storage
 * preference predate the settings table and have readers of their own
 * (`join-links.ts`, the upload bootstrap). Moving the bytes would mean
 * touching every reader for no gain, so the registry indexes them and these
 * bindings read and write the column. The panel, the API and the audit log
 * cannot tell the difference — which is the point.
 *
 * A bound setting is workspace-scoped only. Its value is reported with source
 * `workspace` when it differs from the registry default, `default` otherwise.
 */

import { eq } from "drizzle-orm";

import { company } from "@launchstack/store/schema";
import { workspaceSettings } from "~/server/db/schema";
import { isJoinPolicy } from "~/lib/authz/permissions";
import type { Executor } from "~/server/workspace/db-types";

export interface SettingBinding {
    read(executor: Executor, companyId: bigint): Promise<unknown>;
    /** `null` value means "reset to the registry default". */
    write(executor: Executor, companyId: bigint, value: unknown): Promise<void>;
}

async function upsertWorkspaceSettings(
    executor: Executor,
    companyId: bigint,
    patch: { joinPolicy?: string; auditRetentionDays?: number | null }
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
    "workspace.joinPolicy": {
        async read(executor, companyId) {
            const [row] = await executor
                .select({ joinPolicy: workspaceSettings.joinPolicy })
                .from(workspaceSettings)
                .where(eq(workspaceSettings.companyId, companyId))
                .limit(1);
            return row && isJoinPolicy(row.joinPolicy) ? row.joinPolicy : "approval";
        },
        async write(executor, companyId, value) {
            const joinPolicy = isJoinPolicy(value) ? value : "approval";
            await upsertWorkspaceSettings(executor, companyId, { joinPolicy });
        },
    },
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
    "documents.uploadStorage": {
        async read(executor, companyId) {
            const [row] = await executor
                .select({ useUploadThing: company.useUploadThing })
                .from(company)
                .where(eq(company.id, Number(companyId)))
                .limit(1);
            return row?.useUploadThing === false ? "database" : "cloud";
        },
        async write(executor, companyId, value) {
            const useUploadThing = value !== "database";
            await executor
                .update(company)
                .set({ useUploadThing })
                .where(eq(company.id, Number(companyId)));
        },
    },
};

export function getSettingBinding(key: string): SettingBinding | undefined {
    return SETTING_BINDINGS[key];
}
