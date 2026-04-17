import {db} from "~/server/db";
import {company, users} from "~/server/db/schema";
import {eq} from "drizzle-orm";
import {handleApiError, createSuccessResponse, createValidationError} from "~/lib/api-utils";
import { initTokenAccount, TOKEN_SIGNUP_BONUS } from "~/lib/credits";
import { validateRequestBody, EmployerCompanySignupSchema } from "~/lib/validation";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, EmployerCompanySignupSchema);
        if (!validation.success) return validation.response;
        const { userId, name, email, companyName, numberOfEmployees } = validation.data;

        const [newCompany] = await db
            .insert(company)
            .values({
                name: companyName,
                numberOfEmployees: numberOfEmployees || "0",
            })
            .returning({ id: company.id });

        if(!newCompany) {
            console.error("Company creation returned no data. Database insert failed.");
            return createValidationError(
                "Could not create company. Please try again later."
            );
        }

        const companyId = BigInt(newCompany.id);

        await db.insert(users).values({
            userId,
            companyId,
            name,
            email,
            status: "verified",
            role: "owner",
        });

        // Initialize credit account with signup bonus
        await initTokenAccount(companyId, TOKEN_SIGNUP_BONUS);

        return createSuccessResponse(
            { userId, role: "owner" },
            "Company and owner account created successfully."
        );
    }
    catch (error: unknown) {
        console.error("Error during employer company signup:", error);
        if (error instanceof Error) {
            console.error("Error message:", error.message);
            console.error("Error stack:", error.stack);
        }
        return handleApiError(error);
    }
}
