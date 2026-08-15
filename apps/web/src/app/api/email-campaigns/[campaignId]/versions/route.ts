import { z } from "zod";

import {
  EmailTemplateSchema,
  getCampaign,
  listTemplateVersions,
  prepareEmailCampaign,
} from "@launchstack/features/email-pipeline";

import {
  fail,
  handleRouteError,
  ok,
  parseCampaignId,
  readJson,
  resolveActor,
} from "../../_lib/context";

export const runtime = "nodejs";
export const maxDuration = 60;

const CreateVersionSchema = z.object({
  /** Regenerate with a new goal. Ignored when `template` is supplied. */
  goal: z.string().max(2000).optional(),
  /** A hand-written template — recorded as `human_edited`, still reviewed. */
  template: EmailTemplateSchema.optional(),
  /** Skip the AI review (approval then requires an explicit override). */
  skipReview: z.boolean().optional(),
});

/**
 * POST /api/email-campaigns/{campaignId}/versions
 * Stage 1, repeated — regenerate or hand-edit the template. Each call appends
 * a new immutable version; earlier versions are never overwritten, so an
 * approval always keeps pointing at the exact text that was approved.
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

    const parsed = CreateVersionSchema.safeParse((await readJson(request)) ?? {});
    if (!parsed.success) {
      return fail("Invalid input", 400, { errors: parsed.error.flatten() });
    }

    const prepared = await prepareEmailCampaign({
      companyId: actor.actor.companyId,
      campaignId,
      ...(parsed.data.goal !== undefined ? { goal: parsed.data.goal } : {}),
      ...(parsed.data.template ? { template: parsed.data.template } : {}),
      ...(parsed.data.skipReview !== undefined
        ? { skipReview: parsed.data.skipReview }
        : {}),
      actorUserId: actor.actor.userId,
    });

    return ok(
      {
        campaignId: prepared.campaign.id,
        status: prepared.campaign.status,
        templateVersionId: prepared.version.id,
        version: prepared.version.version,
        source: prepared.version.source,
        template: prepared.template,
        review: prepared.review,
      },
      201,
    );
  } catch (error) {
    return handleRouteError("email-campaigns/versions/create", error);
  }
}

/** GET — the campaign's version history, oldest first. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  try {
    const actor = await resolveActor();
    if (!actor.ok) return actor.response;

    const campaignId = parseCampaignId((await params).campaignId);
    if (campaignId === null) return fail("Invalid campaign ID", 400);

    // Scope check: listing versions must not leak another workspace's content.
    const campaign = await getCampaign(actor.actor.companyId, campaignId);
    if (!campaign) return fail("Campaign not found", 404);

    return ok({ versions: await listTemplateVersions(campaign.id) });
  } catch (error) {
    return handleRouteError("email-campaigns/versions/list", error);
  }
}
