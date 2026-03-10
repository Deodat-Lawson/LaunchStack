import {db} from "~/server/db";
import {company, users} from "~/server/db/schema";
import {eq} from "drizzle-orm";
import {handleApiError, createSuccessResponse, createValidationError} from "~/lib/api-utils";

type PostBody = {
    userId: string;
    companyName: string;
    name: string;
    email: string;
    numberOfEmployees: string;
}

export async function POST(request: Request) {
    try {
        const {userId, name, email, companyName, numberOfEmployees} = (await request.json()) as PostBody;

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
        return handleApiError(error);
    }
}
