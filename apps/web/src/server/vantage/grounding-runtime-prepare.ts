/** Runtime-only readiness projection. Declared synthetic identity, actual membership/ACL/DB readers. No authentication claim. */
import assert from "node:assert/strict";
import type { Db, SqlClient } from "@launchstack/store/client";
import { buildWorkspaceContext } from "~/lib/require-workspace-context";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { resolveDocumentScope } from "~/lib/authz/scope";
import { createGroundingService } from "./grounding-service";
export async function prepareGroundingForRuntime(input: {
    database: Db["db"];
    sql: SqlClient;
    owner: { id: string; userPk: string; companyId: string };
    asOf: string;
}) {
    const resolveWorkspace = async () => {
        const [row] = await input.sql<
            { user_id: string; company_id: string; role: string; status: string; auth_id: string }[]
        >`SELECT m.user_id::text,m.company_id::text,m.role,m.status,u."userId" AS auth_id FROM pdr_ai_v2_user_company_memberships m JOIN pdr_ai_v2_users u ON u.id=m.user_id WHERE m.user_id=${input.owner.userPk} AND m.company_id=${input.owner.companyId}`;
        assert.ok(
            row && row.status === "active" && row.auth_id === input.owner.id,
            "Runtime owner membership must be actual and active"
        );
        return {
            success: true as const,
            data: buildWorkspaceContext({
                authUserId: row.auth_id,
                userPk: BigInt(row.user_id),
                companyId: BigInt(row.company_id),
                role: row.role,
                status: "active",
                permissions: await resolvePermissionsForRole(
                    BigInt(row.company_id),
                    row.role,
                    input.database
                ),
                resolveScope: subject => resolveDocumentScope(subject, input.database),
            }),
        };
    };
    const service = createGroundingService({
        database: input.database,
        resolveWorkspace,
        now: () => new Date(input.asOf),
        resolveExecution: async () => {
            throw new Error("Readiness projection cannot dispatch");
        },
    });
    return service.prepare({ weekStart: "2026-10-12" });
}
