import { db } from "~/server/db/index";
import { users, company } from "@launchstack/core/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError } from "~/lib/api-utils";
import { validateRequestBody, EmployerSignupSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, EmployerSignupSchema);
        if (!validation.success) return validation.response;
        const { userId, name, email, employerPasskey, companyName } = validation.data;

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

        await db.insert(users).values({
            userId,
            name,
            email,
            companyId,
            status: "pending",
            role: "employer",
        });

        return createSuccessResponse(
            { userId, role: "employer" },
            "Employer account created successfully. Awaiting approval."
        );
    } catch (error: unknown) {
        console.error("Error during employer signup:", error);
        return handleApiError(error);
    }
}