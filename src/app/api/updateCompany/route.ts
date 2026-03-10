import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "../../../server/db/index";
import { company, users } from "../../../server/db/schema";
import { validateRequestBody, UpdateCompanySchema } from "~/lib/validation";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    const validation = await validateRequestBody(request, UpdateCompanySchema);
    if (!validation.success) {
      return validation.response;
    }
    const { name, employerPasskey, employeePasskey, numberOfEmployees, useUploadThing } = validation.data;

    const [userRecord] = await db
      .select({
        id: users.id,
        companyId: users.companyId,
        role: users.role,
      })
      .from(users)
      .where(eq(users.userId, userId));

    if (!userRecord) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (!AUTHORIZED_ROLES.has(userRecord.role)) {
      return NextResponse.json(
        {
          success: false,
          message: "Forbidden",
        },
        { status: 403 }
      );
    }

    const updateData: Partial<{
      name: string;
      employerpasskey: string;
      employeepasskey: string;
      numberOfEmployees: string;
      useUploadThing: boolean;
    }> = {
      name,
      numberOfEmployees,
    };

    // Only include passkeys if they were explicitly provided
    if (employerPasskey !== undefined) {
      updateData.employerpasskey = employerPasskey;
    }
    if (employeePasskey !== undefined) {
      updateData.employeepasskey = employeePasskey;
    }

    // Only include useUploadThing if it was explicitly provided
    if (useUploadThing !== undefined) {
      updateData.useUploadThing = useUploadThing;
    }

    const updateResult = await db
      .update(company)
      .set(updateData)
      .where(eq(company.id, Number(userRecord.companyId)))
      .returning({ id: company.id });

    if (!updateResult || updateResult.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Unable to update company record.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Company settings updated.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating company settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unable to update company settings.",
      },
      { status: 500 }
    );
  }
}
