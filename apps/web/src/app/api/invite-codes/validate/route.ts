import { db } from "~/server/db";
import { inviteCodes, company } from "@launchstack/core/db/schema";
import { and, eq } from "drizzle-orm";
import {
    createSuccessResponse,
    createValidationError,
    handleApiError,
} from "~/lib/api-utils";
import { validateRequestBody, ValidateInviteCodeSchema } from "~/lib/validation";

/**
 * POST /api/invite-codes/validate
 * Public endpoint (no auth required) – validates an invite code
 * and returns the associated company name and role without consuming it.
 */
export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, ValidateInviteCodeSchema);
        if (!validation.success) return validation.response;
        const code = validation.data.code.toUpperCase();

        // Look up the active invite code
        const [codeRecord] = await db
            .select({
                id: inviteCodes.id,
                companyId: inviteCodes.companyId,
                role: inviteCodes.role,
                isActive: inviteCodes.isActive,
            })
            .from(inviteCodes)
            .where(
                and(
                    eq(inviteCodes.code, code),
                    eq(inviteCodes.isActive, true)
                )
            );

        if (!codeRecord) {
            return createValidationError(
                "Invalid or expired invite code. Please check the code and try again."
            );
        }

        // Fetch the company name
        const [companyRecord] = await db
            .select({ id: company.id, name: company.name })
            .from(company)
            .where(eq(company.id, Number(codeRecord.companyId)));

        if (!companyRecord) {
            return createValidationError(
                "The company associated with this code no longer exists."
            );
        }

        return createSuccessResponse(
            {
                companyName: companyRecord.name,
                role: codeRecord.role,
            },
            "Invite code is valid."
        );
    } catch (error: unknown) {
        console.error("Error validating invite code:", error);
        return handleApiError(error);
    }
}
