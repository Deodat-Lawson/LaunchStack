
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

const shouldLogPerf =
    process.env.NODE_ENV === "development" &&
    (process.env.DEBUG_PERF === "1" || process.env.DEBUG_PERF === "true");

export async function GET() {
    const requestStart = Date.now();
    let dbQueryMs: number | null = null;
    let outcome = "ok";
    try {
        const { userId } = await auth();
        if (!userId) {
            outcome = "unauthorized";
            return createUnauthorizedError("Authentication required. Please sign in to continue.");
        }

        const dbStart = Date.now();
        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));
        dbQueryMs = Date.now() - dbStart;

        if (!userInfo) {
            outcome = "not_found";
            return createNotFoundError("User account not found. Please contact support.");
        }

        if (userInfo.role === "employee") {
            outcome = "forbidden_role";
            return createForbiddenError("Employer access required. Your account does not have the necessary permissions.");
        }

        if (userInfo.status !== "verified") {
            outcome = "forbidden_status";
            return createForbiddenError("Account not verified. Please wait for administrator approval.");
        }

        return createSuccessResponse({ role: userInfo.role }, "Authorization successful");
    } catch (error: unknown) {
        outcome = "error";
        console.error("Error during employer authorization check:", error);
        return handleApiError(error);
    } finally {
        if (shouldLogPerf) {
            const totalMs = Date.now() - requestStart;
            const dbSegment = dbQueryMs == null ? "n/a" : `${dbQueryMs}ms`;
            console.info(`[perf] employerAuth total=${totalMs}ms db=${dbSegment} outcome=${outcome}`);
        }
    }
}