import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import {
  generateTemplate,
  reviewTemplate,
} from "@launchstack/features/email-pipeline";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/email-pipeline/generate
 * Generates a company-grounded outreach template for the active company and
 * reviews it with an LLM. Body: { goal? }. No emails are sent.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    let body: { goal?: string };
    try {
      body = (await request.json()) as { goal?: string };
    } catch {
      body = {};
    }

    const [requestingUser] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    if (!requestingUser) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 },
      );
    }

    const companyId = Number(
      await resolveActiveCompanyForUser(
        requestingUser.id,
        requestingUser.companyId,
      ),
    );
    if (Number.isNaN(companyId)) {
      return NextResponse.json(
        { success: false, message: "Invalid company ID" },
        { status: 400 },
      );
    }

    const { template, companyContext } = await generateTemplate({
      companyId,
      goal: body.goal,
    });
    const review = await reviewTemplate({ template, companyContext });

    return NextResponse.json({ success: true, data: { template, review } });
  } catch (error) {
    console.error("[email-pipeline/generate] failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to generate email template",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
