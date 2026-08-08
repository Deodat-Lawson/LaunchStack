import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import {
  runEmailCampaign,
  RecipientSchema,
} from "@launchstack/features/email-pipeline";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  name: z.string().min(1),
  goal: z.string().optional(),
  recipients: z.array(RecipientSchema).min(1).max(500),
  mode: z.enum(["dry_run", "send"]).optional(),
});

/**
 * POST /api/email-pipeline/send
 * Generates + reviews a template, then renders per recipient and (by default)
 * DRY-RUNS. A real send requires mode:"send" AND server-side EMAIL_SENDING_ENABLED;
 * even then the default adapter only logs until a real provider is wired in.
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

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 },
      );
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid input",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      );
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

    // Real sends require an explicit mode AND a server-side kill-switch.
    const mode =
      parsed.data.mode === "send" &&
      process.env.EMAIL_SENDING_ENABLED === "true"
        ? "send"
        : "dry_run";

    const origin = new URL(request.url).origin;
    const result = await runEmailCampaign({
      companyId,
      name: parsed.data.name,
      goal: parsed.data.goal,
      recipients: parsed.data.recipients,
      mode,
      senderIdentity: requestingUser.email ?? requestingUser.name ?? "the sender",
      unsubscribeBaseUrl: `${origin}/api/email-pipeline/unsubscribe/${companyId}`,
      persist: true,
    });

    return NextResponse.json({ success: true, data: { ...result, mode } });
  } catch (error) {
    console.error("[email-pipeline/send] failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to run email campaign",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
