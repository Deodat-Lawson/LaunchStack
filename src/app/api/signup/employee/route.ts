import { db } from "~/server/db/index";
import { users, company, authUser } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError, createUnauthorizedError } from "~/lib/api-utils";
import { auth } from "~/lib/auth-server";

type PostBody = {
    employeePasskey: string;
    companyName: string;
};

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return createUnauthorizedError("You must be signed in.");
        }

        // Get name and email from Better Auth user table
        const [authUserRecord] = await db
            .select({ name: authUser.name, email: authUser.email })
            .from(authUser)
            .where(eq(authUser.id, userId));
        const name = authUserRecord?.name ?? "";
        const email = authUserRecord?.email ?? "";

        const { employeePasskey, companyName } = (await request.json()) as PostBody;

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