import { db } from "~/server/db/index";
import { company } from "@launchstack/core/db/schema";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError } from "~/lib/api-utils";
import { validateRequestBody, EmployeeSignupSchema } from "~/lib/validation";
import { requireClerkIdentity } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const identity = await requireClerkIdentity();
        if (!identity.success) return identity.response;

        const validation = await validateRequestBody(request, EmployeeSignupSchema);
        if (!validation.success) return validation.response;
        const { name, email, employeePasskey, companyName } = validation.data;
        const userId = identity.data.clerkUserId;

        // Find company by company name
        const [existingCompany] = await db
            .select()
            .from(company)
            .where(
                and(
                    eq(company.name, companyName),
                    eq(company.employeepasskey, employeePasskey)
                )
            );

        if (!existingCompany) {
            return createValidationError(
                "Invalid company name or passkey. Please check your credentials and try again."
            );
        }

        // Insert new user
        const [insertedUser] = await db
            .insert(users)
            .values({
                userId,
                name: name,
                email: email,
                companyId: BigInt(existingCompany.id),
                status: "pending",
                role: "employee",
            })
            .returning({ id: users.id });

        if (insertedUser) {
            await db.insert(userCompanyMemberships).values({
                userId: BigInt(insertedUser.id),
                companyId: BigInt(existingCompany.id),
                role: "editor",
            });
        }

        return createSuccessResponse(
            { userId, role: "employee" },
            "Employee account created successfully. Awaiting approval."
        );
    } catch (error: unknown) {
        console.error("Error during employee signup:", error);
        return handleApiError(error);
    }
}