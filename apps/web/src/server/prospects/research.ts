/**
 * Write one company's dossier when someone opens it. The search itself stops
 * at the shortlist, so this is the only place a website gets read.
 */
import {
    createDefaultPorts,
    createKeylessPorts,
    enrichCandidate,
    type SellerProfile,
} from "@launchstack/pipelines/distribution";
import {
    addEvent,
    getOrg,
    getProgram,
    getRelationship,
    getRun,
    listEvents,
    updateEventPayload,
} from "@launchstack/pipelines/distribution/db";
import type { ProfileProgress } from "@launchstack/pipelines/distribution";
import {
    buildCompanyKnowledgeContext,
    formatCompanyIdentity,
    getCompanyIdentity,
} from "@launchstack/tools/company-context";

import { debitTokens } from "~/lib/credits";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { canPublishToSources, publishProspectDossier } from "./keyless-run";
import { lookupLinkedInProfiles } from "./linkedin-browser";
import { prospectEmbedder, prospectFitJudge } from "./matching";
import { researchIntent } from "./research-intent";

export interface ResearchCtx {
    companyId: bigint;
    userId: string;
}

async function sellerProfile(companyId: bigint, offering: string): Promise<SellerProfile> {
    const identity = (await getCompanyIdentity({ companyId: Number(companyId) })).data;
    let knowledgeContext = "";
    try {
        knowledgeContext = await buildCompanyKnowledgeContext({
            companyId: Number(companyId),
            identity,
            prompt: `${offering}. Products, price band, certifications, minimum order, current distributors, importers, retailers and channel partners.`,
        });
    } catch (error) {
        console.warn("[prospects] seller context unavailable for a company profile:", error);
    }
    return {
        companyName: identity.name,
        industry: identity.industry,
        identity: formatCompanyIdentity(identity),
        knowledgeContext,
    };
}

/** Record that a profile should start, or that one is already running. */
export async function claimProspectResearch(
    ctx: ResearchCtx,
    relationshipId: string,
    requested: boolean | "refresh"
): Promise<"none" | "pending" | "start"> {
    const relationship = await getRelationship(relationshipId, ctx.companyId);
    if (!relationship) return "none";
    const events = await listEvents(ctx.companyId, relationshipId);
    const intent = researchIntent(events, relationship.dossier !== null, requested);
    if (intent !== "start") return intent;
    await addEvent({
        companyId: ctx.companyId,
        relationshipId,
        type: "research_started",
        payload:
            requested === "refresh"
                ? {
                      refresh: true,
                      step: "site",
                      pages: 0,
                      teamPages: 0,
                      named: 0,
                      slug: 0,
                      people: 0,
                  }
                : {},
        actorUserId: ctx.userId,
        touch: false,
    });
    return "start";
}

/**
 * Read this one company's site and store the dossier (with any named people
 * it lists). Safe to run after the response. `refresh` replaces a dossier
 * that already exists.
 */
export async function runProspectResearch(
    ctx: ResearchCtx,
    relationshipId: string,
    requestUrl: string,
    options: { refresh?: boolean } = {}
): Promise<void> {
    const relationship = await getRelationship(relationshipId, ctx.companyId);
    if (!relationship || (relationship.dossier && !options.refresh)) return;
    const [program, org] = await Promise.all([
        getProgram(relationship.programId, ctx.companyId),
        getOrg(relationship.orgId, ctx.companyId),
    ]);
    if (!program || !org?.firstSeenRunId) return;
    const run = await getRun(org.firstSeenRunId, ctx.companyId);
    const mode = run?.options.mode ?? "keyless";
    const profile = await sellerProfile(ctx.companyId, program.offering);
    const publishDossier = canPublishToSources()
        ? (input: Parameters<typeof publishProspectDossier>[0]["input"]) =>
              publishProspectDossier({
                  userId: ctx.userId,
                  companyId: ctx.companyId,
                  programName: program.name,
                  requestUrl,
                  input,
              })
        : null;
    const embed = await prospectEmbedder(ctx.companyId);
    const judgeFit = await prospectFitJudge(ctx.companyId);
    const ports =
        mode === "live"
            ? createDefaultPorts({
                  publishDossier,
                  embed,
                  debitCredits: async ({ amount, description, referenceId }) => {
                      await debitTokens({
                          companyId: ctx.companyId,
                          amount,
                          service: "distribution_research",
                          description,
                          referenceId,
                      });
                  },
              })
            : createKeylessPorts({
                  publishDossier,
                  debitCredits: null,
                  embed,
                  judgeFit,
                  searchLinkedIn: lookupLinkedInProfiles,
              });

    const aiUse = { feature: "prospects" as const, userId: ctx.userId, enforce: false };
    const started = (await listEvents(ctx.companyId, relationshipId)).find(
        event => event.type === "research_started"
    );
    const onProgress = started
        ? async (progress: ProfileProgress) => {
              await updateEventPayload(started.id, ctx.companyId, {
                  ...started.payload,
                  ...progress,
              }).catch(error =>
                  console.warn("[prospects] could not record people progress:", error)
              );
          }
        : undefined;
    try {
        await withWorkspaceChatModels(ctx.companyId, aiUse, () =>
            enrichCandidate(
                {
                    runId: org.firstSeenRunId!,
                    companyId: ctx.companyId,
                    programId: program.id,
                },
                ports,
                { relationshipId, profile, onProgress }
            )
        );
    } catch (error) {
        console.error(`[prospects] profile failed for ${org.name}:`, error);
        await addEvent({
            companyId: ctx.companyId,
            relationshipId,
            type: "researched",
            payload: {
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
            },
            actorUserId: ctx.userId,
            touch: false,
        });
    }
}
