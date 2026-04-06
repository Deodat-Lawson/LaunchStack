import { db } from "~/server/db/index";
import { users, company, authUser } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError, createUnauthorizedError } from "~/lib/api-utils";
import { auth } from "~/lib/auth-server";

type PostBody = {
    employerPasskey: string;
    companyName: string;
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

        const {employerPasskey, companyName} = (await request.json()) as PostBody;

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