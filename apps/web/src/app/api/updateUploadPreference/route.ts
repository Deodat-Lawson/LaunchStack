/**
 * Update Upload Preference API
 * Lightweight endpoint to toggle between UploadThing and database storage
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "~/server/db";
import { company, users } from "~/server/db/schema";
import { validateRequestBody, UpdateUploadPreferenceSchema } from "~/lib/validation";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const validation = await validateRequestBody(request, UpdateUploadPreferenceSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { useUploadThing } = validation.data;

    const [userRecord] = await db
      .select({
        companyId: users.companyId,
        role: users.role,
      })
      .from(users)
      .where(eq(users.userId, userId));

    if (!userRecord) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 }
      );
    }

    if (!AUTHORIZED_ROLES.has(userRecord.role)) {
      return NextResponse.json(
        { success: false, message: "Forbidden" },
        { status: 403 }
      );
    }

    const updateResult = await db
      .update(company)
      .set({ useUploadThing })
      .where(eq(company.id, Number(userRecord.companyId)))
      .returning({ id: company.id, useUploadThing: company.useUploadThing });

    if (!updateResult || updateResult.length === 0) {
      return NextResponse.json(
        { success: false, message: "Company not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      useUploadThing: updateResult[0]!.useUploadThing,
    });
  } catch (error) {
    console.error("Error updating upload preference:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update preference" },
      { status: 500 }
    );
  }
}

