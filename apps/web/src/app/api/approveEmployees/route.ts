import { and, eq } from "drizzle-orm";

import { db } from "../../../server/db/index";
import { users } from "~/server/db/schema";
import {
    handleApiError,
    createSuccessResponse,
    createForbiddenError,
    createNotFoundError,
} from "~/lib/api-utils";
import { validateRequestBody, ApproveEmployeeByIdSchema } from "~/lib/validation";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        if (!isManagementRole(ctx.data.role)) {
            return createForbiddenError(
                "Insufficient permissions. Only workspace owners and admins can approve employees."
            );
        }

        const validation = await validateRequestBody(request, ApproveEmployeeByIdSchema);
        if (!validation.success) return validation.response;
        const { employeeId } = validation.data;

        const updated = await db
            .update(users)
            .set({ status: "verified" })
            .where(and(eq(users.id, Number(employeeId)), eq(users.companyId, ctx.data.companyId)))
            .returning({ id: users.id });

        if (updated.length === 0) {
            return createNotFoundError("Employee not found.");
        }

        return createSuccessResponse({ employeeId }, "Employee approved successfully");
    } catch (error: unknown) {
        console.error("Error approving employee:", error);
        return handleApiError(error);
    }
}
