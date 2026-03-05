import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users, company } from "~/server/db/schema";

interface OnboardingBody {
  description?: string;
  industry?: string;
}

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [userInfo] = await db
      .select({ companyId: users.companyId, role: users.role })
      .from(users)
      .where(eq(users.userId, userId));

    if (!userInfo) {
      return NextResponse.json({ error: "User not found" }, { status: 400 });
    }

    if (!AUTHORIZED_ROLES.has(userInfo.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as OnboardingBody;

    await db
      .update(company)
      .set({
        description: body.description?.trim() ?? null,
        industry: body.industry?.trim() ?? null,
      })
      .where(eq(company.id, Number(userInfo.companyId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[company/onboarding] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [userInfo] = await db
      .select({ companyId: users.companyId })
      .from(users)
      .where(eq(users.userId, userId));

    if (!userInfo) {
      return NextResponse.json({ error: "User not found" }, { status: 400 });
    }

    const [companyRow] = await db
      .select({
        name: company.name,
        description: company.description,
        industry: company.industry,
      })
      .from(company)
      .where(eq(company.id, Number(userInfo.companyId)));

    return NextResponse.json({
      name: companyRow?.name ?? null,
      description: companyRow?.description ?? null,
      industry: companyRow?.industry ?? null,
    });
  } catch (error) {
    console.error("[company/onboarding] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
