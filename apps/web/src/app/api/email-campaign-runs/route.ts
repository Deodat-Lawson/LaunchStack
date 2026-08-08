import { z } from "zod";

import {
  RecipientSchema,
  runAutomatedEmailCampaign,
} from "@launchstack/features/email-pipeline";

import {
  fail,
  handleRouteError,
  ok,
  readJson,
  resolveActor,
  unsubscribeBaseUrl,
} from "../email-campaigns/_lib/context";

export const runtime = "nodejs";
export const maxDuration = 300;

const RunSchema = z.object({
  name: z.string().min(1).max(256),
  goal: z.string().max(2000).optional(),
  recipients: z.array(RecipientSchema).min(1).max(500),
  mode: z.enum(["dry_run", "send"]).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  policy: z
    .object({
      /**
       * Defaults to true here, unlike the legacy one-shot endpoint: an
       * unattended run should not talk its way past its own reviewer.
       */
      requireReviewPass: z.boolean().optional(),
      maxRecipients: z.number().int().positive().optional(),
      overrideReason: z.string().min(1).max(1000).optional(),
    })
    .optional(),
});

/**
 * POST /api/email-campaign-runs
 * Unattended automation: prepare → policy → auto-approve → dispatch.
 *
 * Distinct from `/api/email-campaigns/{id}/send` on purpose. This is the only
 * endpoint allowed to approve on a human's behalf, and it still persists and
 * locks the exact template version first — the approval row records
 * `automation` as the approver, so the audit trail never claims a person
 * looked at it.
 *
 * When the policy blocks the run, the campaign and its reviewed template are
 * still persisted; it stops before delivery and returns `blockedReason`, so a
 * human can pick it up in the staged flow.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveActor();
    if (!actor.ok) return actor.response;

    const parsed = RunSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail("Invalid input", 400, { errors: parsed.error.flatten() });
    }

    const mode =
      parsed.data.mode === "send" &&
      process.env.EMAIL_SENDING_ENABLED === "true"
        ? "send"
        : "dry_run";

    const run = await runAutomatedEmailCampaign({
      companyId: actor.actor.companyId,
      name: parsed.data.name,
      ...(parsed.data.goal !== undefined ? { goal: parsed.data.goal } : {}),
      recipients: parsed.data.recipients,
      mode,
      senderIdentity: actor.actor.senderIdentity,
      unsubscribeBaseUrl: unsubscribeBaseUrl(request, actor.actor.companyId),
      ...(parsed.data.idempotencyKey
        ? { idempotencyKey: parsed.data.idempotencyKey }
        : {}),
      actorUserId: actor.actor.userId,
      actorEmail: actor.actor.email,
      ...(parsed.data.policy ? { policy: parsed.data.policy } : {}),
    });

    return ok(
      {
        campaignId: run.campaign.id,
        status: run.campaign.status,
        mode,
        templateVersionId: run.version.id,
        version: run.version.version,
        template: run.version.template,
        review: run.review,
        approval: run.approval,
        attempt: run.attempt,
        results: run.results,
        blockedReason: run.blockedReason,
      },
      run.blockedReason ? 409 : 200,
    );
  } catch (error) {
    return handleRouteError("email-campaign-runs", error);
  }
}
