import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
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
 * POST /api/email-pipeline/send — DEPRECATED, preview only.
 *
 * Generates + reviews a template and renders every recipient as a dry run.
 * It no longer delivers: mode:"send" returns 410 and points at the staged API.
 *
 * The reason is retry safety, not tidiness. Generating and sending in one
 * request means a client that retries after a timeout generates a *different*
 * template and a *new* campaign, so no per-campaign idempotency key can catch
 * the duplicate. Delivery now requires an approved, immutable template version:
 *
 *   POST /api/email-campaigns              (generate + review)
 *   POST /api/email-campaigns/{id}/approve (name the exact version)
 *   POST /api/email-campaigns/{id}/send    (Idempotency-Key; no LLM)
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

    // Delivery is no longer reachable from here, regardless of the kill-switch.
    if (parsed.data.mode === "send") {
      return NextResponse.json(
        {
          success: false,
          code: "one_shot_send_removed",
          message:
            "Real sending has moved to the staged campaign API, which cannot " +
            "regenerate content on a retry. Create a campaign with POST " +
            "/api/email-campaigns, approve a template version with POST " +
            "/api/email-campaigns/{id}/approve, then deliver with POST " +
            "/api/email-campaigns/{id}/send and an Idempotency-Key header.",
        },
        { status: 410 },
      );
    }

    const origin = new URL(request.url).origin;
    const result = await runEmailCampaign({
      companyId,
      name: parsed.data.name,
      goal: parsed.data.goal,
      recipients: parsed.data.recipients,
      mode: "dry_run",
      senderIdentity: requestingUser.email ?? requestingUser.name ?? "the sender",
      unsubscribeBaseUrl: `${origin}/api/email-pipeline/unsubscribe`,
      persist: true,
      actorUserId: requestingUser.id,
    });

    return NextResponse.json({
      success: true,
      data: { ...result, mode: "dry_run" },
    });
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
