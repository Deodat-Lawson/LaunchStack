// POST /api/distribution/outreach — { programId, relationshipIds, goal? }
//
// Hands selected relationships to the email vertical as ONE campaign:
// recipients are the public generic mailboxes recorded in each dossier, the
// template is generated with brand voice, and nothing is sent — approval and
// dispatch stay in the email vertical (design §4.2 "Outreach"). Four checks
// keep an existing partner out: program exclusions, engaged-stage exclusion,
// the email vertical's suppression list, and its human approval gate.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { prepareEmailCampaign, type Recipient } from "@launchstack/pipelines/email";
import {
    addEvent,
    getOrg,
    getProgram,
    getRelationship,
    listExclusions,
} from "@launchstack/pipelines/distribution/db";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";

const OutreachSchema = z.object({
    programId: z.string().min(1),
    relationshipIds: z.array(z.string().min(1)).min(1).max(50),
    goal: z.string().max(1000).optional(),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    return withRateLimit(
        request,
        {
            maxRequests: 10,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `distribution-outreach:${ctx.data.authUserId}`,
        },
        async () => {
            try {
                const parsed = OutreachSchema.safeParse(await readJsonBody(request));
                if (!parsed.success)
                    return error("Validation failed", 400, { details: parsed.error.flatten() });
                const companyId = ctx.data.companyId;
                const program = await getProgram(parsed.data.programId, companyId);
                if (!program) return error("Program not found", 404);
                const exclusions = await listExclusions(companyId, program.id);
                const excludedDomains = new Set(exclusions.domains);

                const recipients: Recipient[] = [];
                const included: string[] = [];
                const skipped: Array<{ relationshipId: string; reason: string }> = [];
                for (const relationshipId of parsed.data.relationshipIds) {
                    const relationship = await getRelationship(relationshipId, companyId);
                    if (!relationship || relationship.programId !== program.id) {
                        skipped.push({ relationshipId, reason: "not found in this program" });
                        continue;
                    }
                    if (["contracted", "active", "declined"].includes(relationship.stage)) {
                        skipped.push({ relationshipId, reason: `stage is ${relationship.stage}` });
                        continue;
                    }
                    const org = await getOrg(relationship.orgId, companyId);
                    if (!org) {
                        skipped.push({ relationshipId, reason: "organisation missing" });
                        continue;
                    }
                    if (org.domain && excludedDomains.has(org.domain)) {
                        skipped.push({ relationshipId, reason: "existing partner (excluded)" });
                        continue;
                    }
                    const emails = (relationship.dossier?.contactChannels ?? [])
                        .map(c => c.value.trim())
                        .filter(v => EMAIL.test(v))
                        .filter(
                            v =>
                                !org.domain ||
                                v.toLowerCase().endsWith(`@${org.domain}`) ||
                                /^(info|sales|hello|contact|office|purchasing|einkauf|import)@/i.test(
                                    v
                                )
                        );
                    if (emails.length === 0) {
                        skipped.push({ relationshipId, reason: "no public mailbox in dossier" });
                        continue;
                    }
                    recipients.push({
                        email: emails[0]!,
                        name: null,
                        company: org.name,
                        contextNotes: relationship.dossier?.summary ?? null,
                        vars: {
                            partner_kind: relationship.kind,
                            territory: relationship.territory?.country ?? "",
                        },
                    });
                    included.push(relationshipId);
                }
                if (recipients.length === 0)
                    return error("No eligible recipients", 422, { skipped });

                const prepared = await prepareEmailCampaign({
                    companyId: Number(companyId),
                    name: `Distribution outreach — ${program.name} — ${new Date().toISOString().slice(0, 10)}`,
                    goal:
                        parsed.data.goal ??
                        `Introduce ${program.offering.slice(0, 200)} to a prospective ${program.partnerKinds.join("/")} and ask for a first conversation about carrying it in their territory.`,
                    recipients,
                    actorUserId: Number.isFinite(Number(ctx.data.userPk))
                        ? Number(ctx.data.userPk)
                        : null,
                });
                for (const relationshipId of included) {
                    await addEvent({
                        companyId,
                        relationshipId,
                        type: "note",
                        payload: {
                            text: `Outreach campaign #${prepared.campaign.id} drafted (awaiting approval in Email).`,
                            campaignId: prepared.campaign.id,
                        },
                        actorUserId: ctx.data.authUserId,
                        ref: String(prepared.campaign.id),
                    });
                }
                return json(
                    {
                        campaignId: prepared.campaign.id,
                        status: prepared.campaign.status,
                        included,
                        skipped,
                    },
                    201
                );
            } catch (err) {
                return handleRouteError("POST outreach", err);
            }
        }
    );
}
