import {
  resolveAutomationPolicy,
  runAutomatedEmailCampaign,
} from "@launchstack/features/email-pipeline";

import { AutomatedRunSchema } from "../email-campaigns/_lib/schemas";

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

/**
 * POST /api/email-campaign-runs
 * Unattended automation: claim → prepare → policy → auto-approve → dispatch.
 *
 * Distinct from `/api/email-campaigns/{id}/send` on purpose. This is the only
 * endpoint allowed to approve on a human's behalf, and it still persists and
 * locks the exact template version first — the approval row records
 * `automation` as the approver, so the audit trail never claims a person
 * looked at it.
 *
 * Requires `Idempotency-Key` (or `idempotencyKey` in the body). The key is
 * claimed against the company BEFORE generation, so a retry after a timeout
 * resumes the original campaign instead of generating and sending a second.
 *
 * When the policy blocks the run, the campaign and its reviewed template are
 * still persisted; it stops before delivery and returns `blockedReason`, so a
 * human can pick it up in the staged flow.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveActor();
    if (!actor.ok) return actor.response;

    const parsed = AutomatedRunSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail("Invalid input", 400, { errors: parsed.error.flatten() });
    }

    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim() ??
      parsed.data.idempotencyKey;
    if (!idempotencyKey) {
      return fail(
        "An Idempotency-Key header is required to start an automated run.",
        400,
        { code: "idempotency_key_required" },
      );
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
      unsubscribeBaseUrl: unsubscribeBaseUrl(request),
      idempotencyKey,
      actorUserId: actor.actor.userId,
      actorEmail: actor.actor.email,
      policy: resolveAutomationPolicy(),
    });

    return ok(
      {
        campaignId: run.campaign.id,
        status: run.campaign.status,
        mode,
        resumed: run.resumed,
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
