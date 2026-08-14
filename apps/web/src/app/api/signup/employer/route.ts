import { db } from "~/server/db/index";
import { company } from "@launchstack/core/db/schema";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError } from "~/lib/api-utils";
import { validateRequestBody, EmployerSignupSchema } from "~/lib/validation";
import { requireClerkIdentity } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const identity = await requireClerkIdentity();
        if (!identity.success) return identity.response;

        const validation = await validateRequestBody(request, EmployerSignupSchema);
        if (!validation.success) return validation.response;
        const { name, email, employerPasskey, companyName } = validation.data;
        const userId = identity.data.clerkUserId;

        let companyId: bigint;
        const [existingCompany] = await db
            .select()
            .from(company)
            .where(
                and(
                    eq(company.name, companyName),
                    eq(company.employerpasskey, employerPasskey)
                )
            );

        if (!existingCompany) {
            return createValidationError(
                "Invalid company name or passkey. Please check your credentials and try again."
            );
        }

        // eslint-disable-next-line prefer-const
        companyId = BigInt(existingCompany.id);

        const [insertedUser] = await db
            .insert(users)
            .values({
                userId,
                name,
                email,
                companyId,
                status: "pending",
                role: "employer",
            })
            .returning({ id: users.id });

        if (insertedUser) {
            await db.insert(userCompanyMemberships).values({
                userId: BigInt(insertedUser.id),
                companyId,
                role: "owner",
            });
        }

        return createSuccessResponse(
            { userId, role: "employer" },
            "Employer account created successfully. Awaiting approval."
        );
    } catch (error: unknown) {
        console.error("Error during employer signup:", error);
        return handleApiError(error);
    }
}