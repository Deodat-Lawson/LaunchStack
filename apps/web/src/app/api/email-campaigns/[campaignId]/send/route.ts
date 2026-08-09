import { z } from "zod";

import {
  dispatchEmailCampaign,
  RecipientSchema,
} from "@launchstack/features/email-pipeline";

import {
  fail,
  handleRouteError,
  ok,
  parseCampaignId,
  readJson,
  resolveActor,
  unsubscribeBaseUrl,
} from "../../_lib/context";

export const runtime = "nodejs";
export const maxDuration = 300;

const SendSchema = z.object({
  mode: z.enum(["dry_run", "send"]).optional(),
  /** Audience for the first dispatch only; ignored once the list is frozen. */
  recipients: z.array(RecipientSchema).max(500).optional(),
  /** Fallback when the `Idempotency-Key` header is absent. */
  idempotencyKey: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/email-campaigns/{campaignId}/send
 * Stage 3 — deliver the already-approved template version.
 *
 * This endpoint does not call the LLM and does not create or modify content.
 * It refuses if no version is approved, freezes the recipient list, checks
 * suppression, renders per recipient, delivers, and records provider results.
 *
 * Send `Idempotency-Key: <key>`. Repeating a request with the same key replays
 * the original attempt's results instead of delivering a second time — which
 * is exactly what a client retry after a timeout should do.
 *
 * As before, a real send needs mode:"send" AND server-side
 * EMAIL_SENDING_ENABLED; otherwise it degrades to a dry run.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  try {
    const actor = await resolveActor();
    if (!actor.ok) return actor.response;

    const campaignId = parseCampaignId((await params).campaignId);
    if (campaignId === null) return fail("Invalid campaign ID", 400);

    const parsed = SendSchema.safeParse((await readJson(request)) ?? {});
    if (!parsed.success) {
      return fail("Invalid input", 400, { errors: parsed.error.flatten() });
    }

    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim() ??
      parsed.data.idempotencyKey;
    if (!idempotencyKey) {
      return fail(
        "An Idempotency-Key header is required to send a campaign.",
        400,
        { code: "idempotency_key_required" },
      );
    }

    // Real sends require an explicit mode AND a server-side kill-switch.
    const mode =
      parsed.data.mode === "send" &&
      process.env.EMAIL_SENDING_ENABLED === "true"
        ? "send"
        : "dry_run";

    const dispatched = await dispatchEmailCampaign({
      companyId: actor.actor.companyId,
      campaignId,
      idempotencyKey,
      mode,
      ...(parsed.data.recipients
        ? { recipients: parsed.data.recipients }
        : {}),
      senderIdentity: actor.actor.senderIdentity,
      unsubscribeBaseUrl: unsubscribeBaseUrl(request),
      requestedBy: actor.actor.userId,
    });

    return ok({
      campaignId: dispatched.campaign.id,
      status: dispatched.campaign.status,
      mode,
      templateVersionId: dispatched.version.id,
      version: dispatched.version.version,
      attempt: dispatched.attempt,
      results: dispatched.results,
      replayed: dispatched.replayed,
      recipientsFrozen: dispatched.recipientsFrozen,
    });
  } catch (error) {
    return handleRouteError("email-campaigns/send", error);
  }
}
