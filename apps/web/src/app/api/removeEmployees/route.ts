import { db } from "../../../server/db/index";
import { users } from "../../../server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import {
    handleApiError,
    createSuccessResponse,
    createUnauthorizedError,
    createForbiddenError,
    createNotFoundError,
} from "~/lib/api-utils";
import { validateRequestBody, RemoveEmployeeSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return createUnauthorizedError("Authentication required. Please sign in to continue.");
        }

        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return createNotFoundError("User account not found. Please contact support.");
        }

        if (userInfo.role !== "employer" && userInfo.role !== "owner") {
            return createForbiddenError("Insufficient permissions. Only employers and owners can remove employees.");
        }

        const validation = await validateRequestBody(request, RemoveEmployeeSchema);
        if (!validation.success) return validation.response;
        const { employeeId } = validation.data;

        await db.delete(users).where(eq(users.id, Number(employeeId)));

        return createSuccessResponse(
            { employeeId },
            "Employee removed successfully"
        );
    } catch (error: unknown) {
        console.error("Error removing employee:", error);
        return handleApiError(error);
    }
}

