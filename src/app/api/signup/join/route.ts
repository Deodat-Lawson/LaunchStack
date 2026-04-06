import { db } from "~/server/db";
import { users, inviteCodes, company, authUser } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError, createUnauthorizedError } from "~/lib/api-utils";
import { auth } from "~/lib/auth-server";

type PostBody = {
    inviteCode: string;
};

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return createUnauthorizedError("You must be signed in.");
        }

        const { inviteCode } = (await request.json()) as PostBody;

        if (!inviteCode) {
            return createValidationError("Invite code is required");
        }

        // Get name and email from Better Auth user table
        const [authUserRecord] = await db
            .select({ name: authUser.name, email: authUser.email })
            .from(authUser)
            .where(eq(authUser.id, userId));
        const name = authUserRecord?.name ?? "";
        const email = authUserRecord?.email ?? "";

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
