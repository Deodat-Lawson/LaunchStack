/**
 * The distribution pipeline (design §4.1): eight stages declared with the
 * stage runner. Split into three host-callable pieces so a durable host can
 * make each candidate its own step:
 *
 *   prepareRun     profile → plan → gather → resolve   (one step)
 *   enrichCandidate agent → screen → score → report     (one step per candidate)
 *   finalizeRun    summary                              (one step)
 *
 * `runDistributionPipeline` composes them in-process for tests and
 * synchronous callers. Persistence goes through ./db; the host owns the
 * publish-to-Sources port because it needs apps/web's storage.
 */
import type { PipelineProgressEvent } from "@launchstack/tools/contract";
import { runStage, type RunStageOptions } from "@launchstack/tools/stage-runner";
import {
    getCompanyIdentity,
    buildCompanyKnowledgeContext,
    formatCompanyIdentity,
} from "@launchstack/tools/company-context";
import type { OrgMention, ResolvedOrg } from "@launchstack/tools/org-resolver";
import { normalizeOrgName, resolveOrganizations } from "@launchstack/tools/org-resolver";
import type { ComplianceScreenProvider } from "@launchstack/tools/compliance-screen";
import type { TradeDataProvider } from "@launchstack/tools/trade-data";
import type { RawSearchResult, ReadablePage } from "@launchstack/tools/web-research";
import type { AgentModelPort, ChatTokenUsage } from "@launchstack/llm";

import * as db from "./db";
import { runDossierAgent, type DossierAgentResult } from "./dossier-agent";
import { gather, type GatherPorts } from "./gather";
import { planDiscovery, type SellerProfile } from "./plan";
import { makeDossierCreationKey, makeDossierFilename, renderDossierMarkdown } from "./render";
import { buildRationaleInput, computeFit, deriveRiskFlags, templateRationale } from "./score";
import type {
    PartnerKind,
    ProgramRecord,
    RelationshipRecord,
    RunOptions,
    RunStatus,
    RunSummary,
    ScreeningState,
    SourceCount,
    Territory,
} from "./types";

export type DistributionStage = Exclude<RunStatus, "queued" | "completed" | "failed">;

const STAGE_LABELS: Record<DistributionStage, string> = {
    profiling: "Reading the seller profile",
    planning: "Planning discovery",
    gathering: "Gathering candidates",
    resolving: "Resolving organisations",
    enriching: "Researching candidates",
    screening: "Screening",
    scoring: "Scoring fit",
    reporting: "Publishing dossiers",
};

const LOG_PREFIX = "[distribution]";

export interface PublishDossierInput {
    title: string;
    filename: string;
    markdown: string;
    creationKey: string;
    /** Folder in Sources. */
    category: string;
}

/** Everything the pipeline needs from outside. `createDefaultPorts` wires production. */
export interface DistributionPorts {
    model: AgentModelPort;
    fetchPage: (url: string, signal?: AbortSignal) => Promise<ReadablePage>;
    searchWeb:
        | ((
              queries: Array<{ searchQuery: string; category: string; rationale: string }>
          ) => Promise<RawSearchResult[]>)
        | null;
    /** Geocode + place search for one city/region query; null when not configured. */
    searchPlaces:
        | ((args: {
              query: string;
              categoryIds?: string[];
              territory: Territory;
          }) => Promise<
              Array<{
                  fsqId: string;
                  name: string;
                  website?: string;
                  formattedAddress: string;
                  location: { lat: number; lng: number };
                  categories: Array<{ id: string; name: string }>;
              }>
          >)
        | null;
    tradeData: TradeDataProvider | null;
    compliance: ComplianceScreenProvider | null;
    /** Host-owned: store the markdown and run it through document ingestion. */
    publishDossier: ((input: PublishDossierInput) => Promise<{ documentId: number }>) | null;
    /** Host-owned metering; called once per completed candidate. */
    debitCredits:
        | ((args: { amount: number; description: string; referenceId: string }) => Promise<void>)
        | null;
    /** Rationale writer; null → template rationale. */
    writeRationale: ((input: string) => Promise<string>) | null;
    creditsPerCandidate: number;
}

export interface RunContext {
    runId: string;
    companyId: bigint;
    programId: string;
    onProgress?: (event: PipelineProgressEvent<DistributionStage>) => void;
    signal?: AbortSignal;
}

function stageRunner(ctx: RunContext) {
    return function stage<S, F = S>(
        options: Omit<
            RunStageOptions<S, F, DistributionStage>,
            "label" | "onProgress" | "signal" | "logPrefix"
        >
    ): Promise<S | F> {
        return runStage<S, F, DistributionStage>({
            ...options,
            label: STAGE_LABELS[options.id],
            onProgress: ctx.onProgress,
            signal: ctx.signal,
            logPrefix: LOG_PREFIX,
        });
    };
}

async function setStatus(
    ctx: RunContext,
    status: RunStatus,
    extra: Parameters<typeof db.updateRun>[2] = {}
): Promise<void> {
    await db.updateRun(ctx.runId, ctx.companyId, { status, ...extra });
}

// ─── prepareRun ─────────────────────────────────────────────────────────────

export interface PrepareRunResult {
    candidateRelationshipIds: string[];
    sources: SourceCount[];
    mentions: number;
    resolved: number;
    excluded: number;
    warnings: string[];
    profile: SellerProfile;
}

function pickKind(org: ResolvedOrg, wanted: PartnerKind[]): PartnerKind {
    for (const role of org.roles)
        if ((wanted as string[]).includes(role)) return role as PartnerKind;
    return wanted[0]!;
}

function pickTerritory(org: ResolvedOrg, territories: Territory[]): Territory | null {
    if (org.country) {
        const match = territories.find(t => t.country === org.country);
        if (match) return match;
    }
    return territories[0] ?? null;
}

export async function prepareRun(
    ctx: RunContext,
    ports: DistributionPorts
): Promise<PrepareRunResult> {
    const stage = stageRunner(ctx);
    const warnings: string[] = [];
    const program = await db.getProgram(ctx.programId, ctx.companyId);
    if (!program) throw new Error("Program not found");
    const run = await db.getRun(ctx.runId, ctx.companyId);
    if (!run) throw new Error("Run not found");
    const options: RunOptions = run.options;
    const territories = options.territories?.length
        ? options.territories
        : program.targetTerritories;
    const partnerKinds = options.partnerKinds?.length ? options.partnerKinds : program.partnerKinds;

    await setStatus(ctx, "profiling", { startedAt: new Date() });

    // 1. profile
    const identity = await stage({
        id: "profiling",
        policy: "required",
        run: async () => (await getCompanyIdentity({ companyId: Number(ctx.companyId) })).data,
        report: value => ({ detail: value.name }),
    });
    const knowledgeContext = await stage<string, string>({
        id: "profiling",
        policy: "degradable",
        run: () =>
            buildCompanyKnowledgeContext({
                companyId: Number(ctx.companyId),
                identity,
                prompt: `${program.offering}. Products, price band, certifications, minimum order, current distributors, importers, retailers and channel partners.`,
            }),
        fallback: {
            value: "",
            detail: "knowledge base unavailable",
            logMessage: `${LOG_PREFIX} knowledge context failed`,
        },
        report: value => ({
            detail: value ? `${value.length} chars of context` : "empty knowledge base",
            status: value ? "completed" : "skipped",
        }),
    });
    if (!knowledgeContext)
        warnings.push(
            "Seller knowledge base was empty or unavailable; fit scoring uses the program form only."
        );
    const profile: SellerProfile = {
        companyName: identity.name,
        industry: identity.industry,
        identity: formatCompanyIdentity(identity),
        knowledgeContext,
    };

    // 2. plan
    await setStatus(ctx, "planning");
    const { plan } = await stage({
        id: "planning",
        policy: "required",
        run: () =>
            planDiscovery({
                program,
                profile,
                territories,
                partnerKinds,
                sources: {
                    web: ports.searchWeb !== null,
                    place: ports.searchPlaces !== null,
                    trade: ports.tradeData !== null,
                },
            }),
        report: value => ({
            detail: `${value.plan.queries.length} queries, ${value.plan.adjacentBrands.length} adjacent brands`,
        }),
    });
    await db.updateRun(ctx.runId, ctx.companyId, { plan });

    // 3. gather
    await setStatus(ctx, "gathering");
    const gatherPorts: GatherPorts = {
        searchWeb: ports.searchWeb
            ? queries =>
                  ports.searchWeb!(
                      queries.map(q => ({
                          searchQuery: q.query,
                          category: q.label,
                          rationale: q.rationale,
                      }))
                  )
            : null,
        searchPlaces: ports.searchPlaces
            ? query =>
                  ports.searchPlaces!({
                      query: query.query,
                      categoryIds: query.categoryIds,
                      territory: query.territory,
                  })
            : null,
        tradeData: ports.tradeData,
        hsCodes: program.hsCodes,
        signal: ctx.signal,
    };
    const gathered = await stage({
        id: "gathering",
        policy: "required",
        run: async () => {
            const result = await gather(plan.queries, gatherPorts);
            const usable = result.sources.some(s => s.status === "ok" || s.status === "degraded");
            if (!usable && result.mentions.length === 0) {
                throw new Error(
                    `Every source failed or was skipped: ${result.sources.map(s => `${s.source}=${s.status}${s.detail ? ` (${s.detail})` : ""}`).join(", ")}`
                );
            }
            return result;
        },
        report: value => ({
            detail: `${value.mentions.length} mentions from ${value.sources.filter(s => s.status === "ok").length} sources`,
            data: { sources: value.sources },
        }),
    });
    for (const source of gathered.sources) {
        if (source.status === "failed" || source.status === "degraded")
            warnings.push(
                `${source.source}: ${source.status}${source.detail ? ` (${source.detail})` : ""}`
            );
    }

    // 4. resolve
    await setStatus(ctx, "resolving");
    const resolvedResult = await stage({
        id: "resolving",
        policy: "required",
        run: async () => {
            const exclusions = await db.listExclusions(ctx.companyId, ctx.programId);
            const sellerKey = normalizeOrgName(identity.name);
            const mentions: OrgMention[] = gathered.mentions;
            const before = resolveOrganizations(mentions).length;
            let orgs = resolveOrganizations(mentions, {
                excludeDomains: exclusions.domains,
                excludeKeys: exclusions.keys,
            });
            orgs = orgs.filter(org => normalizeOrgName(org.name) !== sellerKey);
            const excluded = before - orgs.length;

            // Shortlist: more mentions and a real domain first; wanted roles first.
            const wanted = new Set<string>(partnerKinds);
            const ranked = [...orgs].sort((a, b) => {
                const roleA = a.roles.some(r => wanted.has(r)) ? 1 : 0;
                const roleB = b.roles.some(r => wanted.has(r)) ? 1 : 0;
                if (roleA !== roleB) return roleB - roleA;
                const domA = a.domain ? 1 : 0;
                const domB = b.domain ? 1 : 0;
                if (domA !== domB) return domB - domA;
                return b.mentionCount - a.mentionCount;
            });
            const shortlist = ranked.slice(0, options.maxCandidates);
            const saved = await db.upsertOrgs({
                companyId: ctx.companyId,
                runId: ctx.runId,
                orgs: ranked,
            });
            const byKey = new Map(saved.map(o => [o.resolveKey, o]));

            // "Do we already know them" — link KG entities for the shortlist.
            for (const org of shortlist) {
                const row = byKey.get(org.resolveKey);
                if (!row || row.kgEntityId) continue;
                const known = await db.findKnownOrgEntity(ctx.companyId, org.name);
                if (known) await db.updateOrg(row.id, ctx.companyId, { kgEntityId: known.id });
            }

            const items = shortlist
                .map(org => {
                    const row = byKey.get(org.resolveKey);
                    if (!row) return null;
                    return {
                        orgId: row.id,
                        kind: pickKind(org, partnerKinds),
                        territory: pickTerritory(org, territories),
                    };
                })
                .filter((v): v is NonNullable<typeof v> => v !== null);
            const relationships = await db.upsertCandidateRelationships({
                companyId: ctx.companyId,
                programId: ctx.programId,
                items,
            });
            // Keep only the shortlist's relationships that are still candidates (never re-research an engaged partner).
            const shortlistOrgIds = new Set(items.map(i => i.orgId));
            const candidateIds = relationships
                .filter(
                    r =>
                        shortlistOrgIds.has(r.orgId) &&
                        (r.stage === "candidate" || r.stage === "researched")
                )
                .sort(
                    (a, b) =>
                        items.findIndex(i => i.orgId === a.orgId) -
                        items.findIndex(i => i.orgId === b.orgId)
                )
                .map(r => r.id);
            return { resolved: orgs.length, excluded, candidateIds, mentions: mentions.length };
        },
        report: value => ({
            detail: `${value.resolved} organisations, ${value.excluded} excluded, ${value.candidateIds.length} shortlisted`,
        }),
    });

    await db.updateRun(ctx.runId, ctx.companyId, {
        candidateOrgIds: resolvedResult.candidateIds,
        status: "enriching",
    });
    return {
        candidateRelationshipIds: resolvedResult.candidateIds,
        sources: gathered.sources,
        mentions: resolvedResult.mentions,
        resolved: resolvedResult.resolved,
        excluded: resolvedResult.excluded,
        warnings,
        profile,
    };
}

// ─── enrichCandidate ─────────────────────────────────────────────────────────

export interface EnrichCandidateResult {
    relationshipId: string;
    status: "ok" | "budget_exhausted" | "gate_failed";
    fitScore: number;
    evidenceCount: number;
    flagged: boolean;
    screened: boolean;
    published: boolean;
    usage: ChatTokenUsage;
    creditsDebited: number;
}

export async function enrichCandidate(
    ctx: RunContext,
    ports: DistributionPorts,
    args: { relationshipId: string; profile: SellerProfile; seedUrls?: string[] }
): Promise<EnrichCandidateResult> {
    const relationship = await db.getRelationship(args.relationshipId, ctx.companyId);
    if (!relationship) throw new Error("Relationship not found");
    const [program, org] = await Promise.all([
        db.getProgram(ctx.programId, ctx.companyId),
        db.getOrg(relationship.orgId, ctx.companyId),
    ]);
    if (!program || !org) throw new Error("Program or organisation not found");

    const seedUrls = args.seedUrls ?? (org.domain ? [`https://${org.domain}/`] : []);
    const agentResult: DossierAgentResult = await runDossierAgent(
        {
            model: ports.model,
            fetchPage: url => ports.fetchPage(url, ctx.signal),
            searchWeb: ports.searchWeb
                ? async q =>
                      ports.searchWeb!([
                          { searchQuery: q, category: "dossier", rationale: "agent" },
                      ])
                : null,
            searchPlaces:
                ports.searchPlaces && relationship.territory?.region
                    ? async q =>
                          ports.searchPlaces!({ query: q, territory: relationship.territory! })
                    : null,
            tradeData: ports.tradeData,
            recordEvidence: async e =>
                (
                    await db.insertEvidence({
                        companyId: ctx.companyId,
                        orgId: org.id,
                        runId: ctx.runId,
                        kind: e.kind,
                        claim: e.claim,
                        sourceUrl: e.sourceUrl,
                        quote: e.quote,
                        confidence: e.confidence,
                        provenance: {
                            tool: "distribution.dossier-agent",
                            promptVersion: "distribution-dossier-agent/v1",
                        },
                    })
                ).id,
            signal: ctx.signal,
        },
        {
            program,
            sellerSummary:
                `${args.profile.companyName} (${args.profile.industry}). ${args.profile.identity}`.slice(
                    0,
                    1200
                ),
            org,
            kind: relationship.kind,
            territory: relationship.territory,
            seedUrls,
            hsCodes: program.hsCodes,
        }
    );

    // screen (advisory; degradable)
    let screening: ScreeningState = { status: "not_run" };
    let screened = false;
    if (ports.compliance) {
        try {
            const result = await ports.compliance.screen(
                { name: org.name, country: org.country, domain: org.domain },
                { signal: ctx.signal }
            );
            screened = true;
            screening = {
                status: result.flags.length > 0 ? "flagged" : "clear",
                provider: result.provider,
                checkedAt: result.checkedAt,
                flags: result.flags,
            };
        } catch (error) {
            console.warn(`${LOG_PREFIX} screening failed for ${org.name}:`, error);
            screening = { status: "not_run" };
        }
    }

    // score (deterministic) + rationale (model may only explain)
    const evidence = await db.listEvidenceForOrg(ctx.companyId, org.id);
    const newest = evidence.reduce<Date | null>(
        (acc, e) => (!acc || e.capturedAt > acc ? e.capturedAt : acc),
        null
    );
    const dossier = agentResult.outcome.status === "ok" ? agentResult.outcome.dossier : null;
    const breakdown = computeFit({
        program,
        org,
        kind: relationship.kind,
        territory: relationship.territory,
        dossier,
        evidenceCount: evidence.length,
        newestEvidenceAt: newest,
        knownEntity: org.kgEntityId !== null,
        sellerName: args.profile.companyName,
    });
    const riskFlags = deriveRiskFlags({
        dossier,
        breakdown,
        evidenceCount: evidence.length,
        budgetExhausted: agentResult.outcome.status === "budget_exhausted",
    });
    if (agentResult.outcome.status === "gate_failed")
        riskFlags.unshift("dossier failed grounding validation");
    if (screening.status === "flagged")
        riskFlags.unshift("compliance screening flagged (advisory)");

    let rationale = templateRationale({ breakdown, orgName: org.name, kind: relationship.kind });
    if (ports.writeRationale) {
        try {
            const written = await ports.writeRationale(
                buildRationaleInput({
                    breakdown,
                    dossierSummary: dossier?.summary ?? null,
                    kind: relationship.kind,
                    territory: relationship.territory,
                    orgName: org.name,
                })
            );
            if (written.trim()) rationale = written.trim();
        } catch (error) {
            console.warn(`${LOG_PREFIX} rationale failed for ${org.name}:`, error);
        }
    }

    const nextStage = agentResult.outcome.status === "gate_failed" ? "candidate" : "researched";
    await db.setResearchResult(relationship.id, ctx.companyId, {
        dossier,
        fitScore: breakdown.total,
        fitRationale: rationale,
        fitBreakdown: breakdown,
        riskFlags,
        screening,
        stage: nextStage,
    });
    await db.updateOrg(org.id, ctx.companyId, {
        lastEnrichedAt: new Date(),
        sizeBand:
            dossier?.sizeBand && dossier.sizeBand !== "unknown" ? dossier.sizeBand : org.sizeBand,
        roles: dossier ? [...new Set([...org.roles, ...dossier.roles])] : org.roles,
    });
    await db.addEvent({
        companyId: ctx.companyId,
        relationshipId: relationship.id,
        type: "researched",
        payload: {
            runId: ctx.runId,
            status: agentResult.outcome.status,
            fitScore: breakdown.total,
            evidence: evidence.length,
            turns: agentResult.turns,
        },
        touch: true,
    });

    // report: publish the dossier as a Source (host port; a failure keeps the rows)
    let published = false;
    if (ports.publishDossier) {
        try {
            const markdown = renderDossierMarkdown({
                program,
                org,
                kind: relationship.kind,
                territory: relationship.territory,
                dossier,
                evidence,
                fit: { score: breakdown.total, rationale, breakdown },
                riskFlags,
                screening,
                generatedAt: new Date(),
                provenance: {
                    runId: ctx.runId,
                    playbookHash: agentResult.playbookHash,
                    promptVersion: agentResult.promptVersion,
                    modelId: agentResult.modelId,
                },
            });
            const { documentId } = await ports.publishDossier({
                title: `${org.name} — ${relationship.kind} dossier`,
                filename: makeDossierFilename(org),
                markdown,
                creationKey: makeDossierCreationKey(program.id, org.id, ctx.runId),
                category: `Distribution / ${program.name}`,
            });
            await db.updateRelationship(relationship.id, ctx.companyId, {
                dossierDocumentId: documentId,
            });
            published = true;
        } catch (error) {
            console.warn(`${LOG_PREFIX} publish failed for ${org.name}:`, error);
        }
    }

    // meter after the work
    let creditsDebited = 0;
    if (ports.debitCredits && agentResult.outcome.status !== "gate_failed") {
        try {
            await ports.debitCredits({
                amount: ports.creditsPerCandidate,
                description: `Distribution research: ${org.name}`,
                referenceId: `${ctx.runId}:${relationship.id}`,
            });
            await db.addRunCredits(ctx.runId, ctx.companyId, ports.creditsPerCandidate);
            creditsDebited = ports.creditsPerCandidate;
        } catch (error) {
            console.warn(`${LOG_PREFIX} credit debit failed:`, error);
        }
    }

    return {
        relationshipId: relationship.id,
        status: agentResult.outcome.status,
        fitScore: breakdown.total,
        evidenceCount: evidence.length,
        flagged: screening.status === "flagged",
        screened,
        published,
        usage: agentResult.usage,
        creditsDebited,
    };
}

// ─── finalizeRun ─────────────────────────────────────────────────────────────

export async function finalizeRun(
    ctx: RunContext,
    prepared: Pick<
        PrepareRunResult,
        "sources" | "mentions" | "resolved" | "excluded" | "warnings" | "candidateRelationshipIds"
    >,
    enriched: EnrichCandidateResult[],
    startedAt: Date
): Promise<RunSummary> {
    const tokens = enriched.reduce(
        (acc, e) => ({
            input: acc.input + (e.usage.inputTokens ?? 0),
            output: acc.output + (e.usage.outputTokens ?? 0),
            total: acc.total + (e.usage.totalTokens ?? 0),
        }),
        { input: 0, output: 0, total: 0 }
    );
    const summary: RunSummary = {
        sources: prepared.sources,
        mentions: prepared.mentions,
        resolved: prepared.resolved,
        excluded: prepared.excluded,
        shortlisted: prepared.candidateRelationshipIds.length,
        enriched: enriched.filter(e => e.status === "ok").length,
        gateRejections: enriched.filter(e => e.status === "gate_failed").length,
        budgetExhausted: enriched.filter(e => e.status === "budget_exhausted").length,
        screened: enriched.filter(e => e.screened).length,
        flagged: enriched.filter(e => e.flagged).length,
        published: enriched.filter(e => e.published).length,
        degraded:
            prepared.sources.some(s => s.status === "degraded" || s.status === "failed") ||
            prepared.warnings.length > 0,
        warnings: prepared.warnings,
        tokens,
        wallMs: Date.now() - startedAt.getTime(),
    };
    await db.updateRun(ctx.runId, ctx.companyId, {
        status: "completed",
        summary,
        errorMessage: null,
    });
    return summary;
}

export async function failRun(
    ctx: Pick<RunContext, "runId" | "companyId">,
    message: string
): Promise<void> {
    await db.updateRun(ctx.runId, ctx.companyId, { status: "failed", errorMessage: message });
}

// ─── In-process composition ──────────────────────────────────────────────────

export async function runDistributionPipeline(
    ctx: RunContext,
    ports: DistributionPorts
): Promise<RunSummary> {
    const startedAt = new Date();
    try {
        const prepared = await prepareRun(ctx, ports);
        const enriched: EnrichCandidateResult[] = [];
        for (const relationshipId of prepared.candidateRelationshipIds) {
            if (ctx.signal?.aborted) break;
            enriched.push(
                await enrichCandidate(ctx, ports, { relationshipId, profile: prepared.profile })
            );
        }
        return await finalizeRun(ctx, prepared, enriched, startedAt);
    } catch (error) {
        await failRun(ctx, error instanceof Error ? error.message : String(error));
        throw error;
    }
}

export type { RelationshipRecord, ProgramRecord };
