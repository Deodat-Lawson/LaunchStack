import { db } from "../../../server/db/index";
import { users } from "../../../server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "~/lib/auth-server";
import {
    handleApiError,
    createSuccessResponse,
    createUnauthorizedError,
    createForbiddenError,
    createNotFoundError
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
            return createForbiddenError("Insufficient permissions. Only employers and owners can approve employees.");
        }

        const { employeeId } = (await request.json()) as PostBody;

        await db
            .update(users)
            .set({
                status: "verified"
            })
            .where(eq(users.id, Number(employeeId)));

        return createSuccessResponse(
            { employeeId },
            "Employee approved successfully"
        );
    } catch (error: unknown) {
        console.error("Error approving employee:", error);
        return handleApiError(error);
    }
}