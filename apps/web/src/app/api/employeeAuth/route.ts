import { db } from "../../../server/db/index";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import {
    handleApiError,
    createSuccessResponse,
    createForbiddenError,
    createNotFoundError,
} from "~/lib/api-utils";
import { requireClerkIdentity } from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const identity = await requireClerkIdentity();
        if (!identity.success) return identity.response;
        const clerkUserId = identity.data.clerkUserId;

        const [userInfo] = await db.select().from(users).where(eq(users.userId, clerkUserId));

        if (!userInfo) {
            return createNotFoundError("User account not found. Please contact support.");
        }

        if (userInfo.role !== "employee") {
            return createForbiddenError(
                "Employee access required. Your account does not have the necessary permissions."
            );
        }

        if (userInfo.status !== "verified") {
            return createForbiddenError(
                "Account not verified. Please wait for administrator approval."
            );
        }

        return createSuccessResponse({ role: userInfo.role }, "Authorization successful");
    } catch (error: unknown) {
        console.error("Error during employee authorization check:", error);
        return handleApiError(error);
    }
}
