import { db } from "~/server/db/index";
import { users, company } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError } from "~/lib/api-utils";
import { validateRequestBody, EmployeeSignupSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, EmployeeSignupSchema);
        if (!validation.success) return validation.response;
        const { userId, name, email, employeePasskey, companyName } = validation.data;

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
        await db.insert(users).values({
            userId,
            name: name,
            email: email,
            companyId: BigInt(existingCompany.id),
            status: "pending",
            role: "employee",
        });

        return createSuccessResponse(
            { userId, role: "employee" },
            "Employee account created successfully. Awaiting approval."
        );
    } catch (error: unknown) {
        console.error("Error during employee signup:", error);
        return handleApiError(error);
    }
}