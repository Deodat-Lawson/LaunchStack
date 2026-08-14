import { z } from "zod";

import {
  listCampaigns,
  prepareEmailCampaign,
  RecipientSchema,
} from "@launchstack/features/email-pipeline";

import {
  fail,
  handleRouteError,
  ok,
  readJson,
  resolveActor,
} from "./_lib/context";

export const runtime = "nodejs";
export const maxDuration = 60;

const CreateSchema = z.object({
  name: z.string().min(1).max(256),
  goal: z.string().max(2000).optional(),
  /** Optional audience; it can also be supplied at send time. */
  recipients: z.array(RecipientSchema).max(500).optional(),
});

/**
 * POST /api/email-campaigns
 * Stage 1 — create a campaign, generate template version 1, review it, and
 * persist both. Returns the ids a client needs to approve an exact version.
 * Sends nothing.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveActor();
    if (!actor.ok) return actor.response;

    const parsed = CreateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail("Invalid input", 400, { errors: parsed.error.flatten() });
    }

    const prepared = await prepareEmailCampaign({
      companyId: actor.actor.companyId,
      name: parsed.data.name,
      ...(parsed.data.goal !== undefined ? { goal: parsed.data.goal } : {}),
      ...(parsed.data.recipients
        ? { recipients: parsed.data.recipients }
        : {}),
      actorUserId: actor.actor.userId,
    });

    return ok(
      {
        campaignId: prepared.campaign.id,
        status: prepared.campaign.status,
        templateVersionId: prepared.version.id,
        version: prepared.version.version,
        template: prepared.template,
        review: prepared.review,
      },
      201,
    );
  } catch (error) {
    return handleRouteError("email-campaigns/create", error);
  }
}

/** GET /api/email-campaigns — the active workspace's campaigns, newest first. */
export async function GET() {
  try {
    const actor = await resolveActor();
    if (!actor.ok) return actor.response;
    return ok({ campaigns: await listCampaigns(actor.actor.companyId) });
  } catch (error) {
    return handleRouteError("email-campaigns/list", error);
  }
}
