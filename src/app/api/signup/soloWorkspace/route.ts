import { db } from "~/server/db";
import { company, users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import {
    handleApiError,
    createSuccessResponse,
    createValidationError,
} from "~/lib/api-utils";

type PostBody = {
    userId: string;
    name: string;
    email: string;
};

export async function POST(request: Request) {
    try {
        const { userId, name, email } = (await request.json()) as PostBody;

        if (!name?.trim()) {
            return createValidationError(
                "User name is required. Please ensure you are logged in with a complete profile.",
            );
        }

        // Check if user already exists
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, userId));

        if (existingUser) {
            return createValidationError(
                "You are already registered. Please sign in instead.",
            );
        }

        const workspaceName = `${name}'s Workspace`;

        const [newCompany] = await db
            .insert(company)
            .values({
                name: workspaceName,
                type: "personal",
                numberOfEmployees: "1",
            })
            .returning({ id: company.id });

        if (!newCompany) {
            return createValidationError(
                "Could not create workspace. Please try again later.",
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
            "Personal workspace created successfully.",
        );
    } catch (error: unknown) {
        console.error("Error during solo workspace signup:", error);
        return handleApiError(error);
    }
}
