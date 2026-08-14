import { NextResponse } from "next/server";
import { z } from "zod";

import {
  runEmailCampaign,
  RecipientSchema,
} from "@launchstack/features/email-pipeline";
import { resolveActor } from "../../email-campaigns/_lib/context";

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
    const actorResult = await resolveActor();
    if (!actorResult.ok) return actorResult.response;
    const { actor } = actorResult;

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
      companyId: actor.companyId,
      name: parsed.data.name,
      goal: parsed.data.goal,
      recipients: parsed.data.recipients,
      mode: "dry_run",
      senderIdentity: actor.senderIdentity,
      unsubscribeBaseUrl: `${origin}/api/email-pipeline/unsubscribe`,
      persist: true,
      actorUserId: actor.userId,
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
