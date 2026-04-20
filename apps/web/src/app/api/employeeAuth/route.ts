
import { db } from "../../../server/db/index";
import { users } from "../../../server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import {
    handleApiError,
    createSuccessResponse,
    createUnauthorizedError,
    createForbiddenError,
    createNotFoundError
} from "~/lib/api-utils";


export async function GET() {
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

        if (userInfo.role !== "employee") {
            return createForbiddenError("Employee access required. Your account does not have the necessary permissions.");
        }

        if (userInfo.status !== "verified") {
            return createForbiddenError("Account not verified. Please wait for administrator approval.");
        }

        return createSuccessResponse({ role: userInfo.role }, "Authorization successful");
    } catch (error: unknown) {
        console.error("Error during employee authorization check:", error);
        return handleApiError(error);
    }
}