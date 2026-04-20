import { db } from "~/server/db";
import { users, inviteCodes, company } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError } from "~/lib/api-utils";
import { validateRequestBody, JoinWithInviteSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, JoinWithInviteSchema);
        if (!validation.success) return validation.response;
        const { userId, name, email, inviteCode } = validation.data;

        // Find the active invite code
        const [codeRecord] = await db
            .select({
                id: inviteCodes.id,
                companyId: inviteCodes.companyId,
                role: inviteCodes.role,
                isActive: inviteCodes.isActive,
            })
            .from(inviteCodes)
            .where(
                and(
                    eq(inviteCodes.code, inviteCode.toUpperCase()),
                    eq(inviteCodes.isActive, true)
                )
            );

        if (!codeRecord) {
            return createValidationError(
                "Invalid or expired invite code. Please check the code and try again."
            );
        }

        // Verify the company exists
        const [companyRecord] = await db
            .select({ id: company.id, name: company.name })
            .from(company)
            .where(eq(company.id, Number(codeRecord.companyId)));

        if (!companyRecord) {
            return createValidationError("The company associated with this code no longer exists.");
        }

        // Check if user already exists in the system
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, userId));

        if (existingUser) {
            return createValidationError("You are already registered. Please sign in instead.");
        }

        // Insert new user with the role from the invite code
        await db.insert(users).values({
            userId,
            name,
            email,
            companyId: codeRecord.companyId,
            status: "pending",
            role: codeRecord.role,
        });

        const redirectPath = codeRecord.role === "employee"
            ? "/employee/pending-approval"
            : "/employer/pending-approval";

        return createSuccessResponse(
            { userId, role: codeRecord.role, companyName: companyRecord.name, redirectPath },
            `Successfully joined as ${codeRecord.role}. Awaiting approval.`
        );
    } catch (error: unknown) {
        console.error("Error during invite code signup:", error);
        return handleApiError(error);
    }
}
