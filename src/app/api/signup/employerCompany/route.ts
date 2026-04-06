import {db} from "~/server/db";
import {company, users, authUser} from "~/server/db/schema";
import {eq} from "drizzle-orm";
import {handleApiError, createSuccessResponse, createValidationError, createUnauthorizedError} from "~/lib/api-utils";
import { auth } from "~/lib/auth-server";

type PostBody = {
    companyName: string;
    numberOfEmployees: string;
}

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

        const {companyName, numberOfEmployees} = (await request.json()) as PostBody;

        // Validate required fields
        if (!name?.trim()) {
            return createValidationError(
                "User name is required. Please ensure you are logged in with a complete profile."
            );
        }

        // Check if company already exists
        const [existingCompany] = await db
            .select()
            .from(company)
            .where(eq(company.name, companyName));

        if (existingCompany) {
            return createValidationError(
                "Company already exists. Please use a different company name."
            );
        }

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
