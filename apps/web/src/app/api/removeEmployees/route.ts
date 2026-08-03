import { and, eq } from "drizzle-orm";

import { db } from "../../../server/db/index";
import { users } from "@launchstack/core/db/schema";
import {
  handleApiError,
  createSuccessResponse,
  createForbiddenError,
  createNotFoundError,
} from "~/lib/api-utils";
import { validateRequestBody, RemoveEmployeeSchema } from "~/lib/validation";
import {
  isManagementRole,
  requireWorkspaceContext,
} from "~/lib/require-workspace-context";

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    if (!isManagementRole(ctx.data.role)) {
      return createForbiddenError(
        "Insufficient permissions. Only workspace owners and admins can remove employees.",
      );
    }

    const validation = await validateRequestBody(request, RemoveEmployeeSchema);
    if (!validation.success) return validation.response;
    const { employeeId } = validation.data;

    const deleted = await db
      .delete(users)
      .where(
        and(
          eq(users.id, Number(employeeId)),
          eq(users.companyId, ctx.data.companyId),
        ),
      )
      .returning({ id: users.id });

    if (deleted.length === 0) {
      return createNotFoundError("Employee not found.");
    }

    return createSuccessResponse(
      { employeeId },
      "Employee removed successfully",
    );
  } catch (error: unknown) {
    console.error("Error removing employee:", error);
    return handleApiError(error);
  }
}
