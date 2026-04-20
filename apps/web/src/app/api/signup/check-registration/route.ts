import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users, company } from "~/server/db/schema";
import {
    createSuccessResponse,
    createUnauthorizedError,
    handleApiError,
} from "~/lib/api-utils";

/**
 * GET /api/signup/check-registration
 * Auth required – checks whether the current Clerk user already
 * has a record in the `users` table (i.e. is already registered
 * with a company).
 */
export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return createUnauthorizedError("You must be signed in.");
        }

        const [existingUser] = await db
            .select({
                id: users.id,
                role: users.role,
                companyId: users.companyId,
            })
            .from(users)
            .where(eq(users.userId, userId));

        if (!existingUser) {
            return createSuccessResponse({ registered: false });
        }

        // Fetch company name for context
        const [companyRecord] = await db
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(existingUser.companyId)));

        return createSuccessResponse({
            registered: true,
            role: existingUser.role,
            companyName: companyRecord?.name ?? "Unknown",
        });
    } catch (error: unknown) {
        console.error("Error checking registration:", error);
        return handleApiError(error);
    }
}
