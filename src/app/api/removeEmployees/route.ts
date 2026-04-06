import { db } from "../../../server/db/index";
import { users } from "../../../server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "~/lib/auth-server";
import {
    handleApiError,
    createSuccessResponse,
    createUnauthorizedError,
    createForbiddenError,
    createNotFoundError,
    createValidationError
} from "~/lib/api-utils";

type PostBody = {
    employeeId: string;
}

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

        const { employeeId } = (await request.json()) as PostBody;

        if (!employeeId) {
            return createValidationError("Employee ID is required.");
        }

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

