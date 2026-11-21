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
import {
    runDossierAgent,
    type DossierAgentResult,
    type DossierAgentInput,
    type DossierAgentPorts,
} from "./dossier-agent";
import {
    gather,
    lookalikeSeeds,
    type DescribeCompaniesPort,
    type GatherPorts,
    type SearchCompaniesPort,
} from "./gather";
import { planDiscovery, type PlanInput, type SellerProfile } from "./plan";
import { fillMissingPictures } from "./pictures";
import { mapInPool } from "./pool";
import { makeDossierCreationKey, makeDossierFilename, renderDossierMarkdown } from "./render";
import { bestTerritoryFit, placeLabel } from "./locate";
import { buildRationaleInput, computeFit, deriveRiskFlags, templateRationale } from "./score";
import {
    buyerBrief,
    judgeQuestionFor,
    companyText,
    relevanceOf,
    relevanceShare,
    type EmbedTexts,
    type JudgeFit,
} from "./semantic";
import type {
    DiscoveryPlan,
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
    /** General web search: discovery without a company index, and the research agent. */
    searchWeb:
        | ((
              queries: Array<{ searchQuery: string; category: string; rationale: string }>
          ) => Promise<RawSearchResult[]>)
        | null;
    /**
     * Company search (Exa's company index). When set, discovery runs every
     * planned web query through it, and lookalikes run; absent or null when
     * the search engine has no company index, and in keyless and fixture modes.
     */
    searchCompanies?: SearchCompaniesPort | null;
    /** What each seed company sells, for lookalike queries (Exa). */
    describeCompanies?: DescribeCompaniesPort | null;
    /** Geocode + place search for one city/region query; null when not configured. */
    searchPlaces:
        | ((args: { query: string; categoryIds?: string[]; territory: Territory }) => Promise<
              Array<{
                  fsqId: string;
                  name: string;
                  website?: string;
                  formattedAddress: string;
                  location: { lat: number; lng: number };
                  categories: Array<{ id: string; name: string }>;
                  /** Roles the directory's own tags establish, if any. */
                  roles?: PartnerKind[];
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
    /**
     * Discovery planner. Defaults to the structured LLM call in ./plan; the
     * fixture ports supply a deterministic plan so the whole pipeline can run
     * without a model, a key or a credit.
     */
    plan?: (
        input: PlanInput
    ) => Promise<{ plan: DiscoveryPlan; modelId?: string; playbookHash: string }>;
    /**
     * Candidate profiler. Defaults to the research agent in ./dossier-agent;
     * keyless mode supplies a page reader that needs no model. Either way
     * the result passes the same grounding gate before it is stored.
     */
    profile?: (ports: DossierAgentPorts, input: DossierAgentInput) => Promise<DossierAgentResult>;
    /**
     * Text embedder for matching companies to the segment by meaning; null or
     * absent → word overlap (the run warns).
     */
    embed?: EmbedTexts | null;
    /** Chat-model check of the closest companies; null or absent → none. */
    judgeFit?: JudgeFit | null;
    /**
     * Candidates `runDistributionPipeline` researches at once; absent → one at
     * a time. Each is a different company, so its own site's requests still
     * come one after another. A durable host schedules its own steps instead.
     */
    enrichConcurrency?: number;
}

/** Companies the model checks per open shortlist place, each round down the ranking. */
const JUDGE_POOL_FACTOR = 2;

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
            (ports.plan ?? planDiscovery)({
                program,
                profile,
                territories,
                partnerKinds,
                sources: {
                    web: ports.searchWeb !== null || Boolean(ports.searchCompanies),
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
    // Read once for discovery and for the resolver: company search is told
    // to leave out excluded companies, customers and the lookalike seeds.
    const exclusions = await db.listExclusions(ctx.companyId, ctx.programId);
    const seeds = ports.searchCompanies
        ? lookalikeSeeds(
              program.customerDomains,
              await db.listWonDomains(ctx.companyId, ctx.programId)
          )
        : [];
    const countries = [...new Set(territories.map(t => t.country))];
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
        searchCompanies: ports.searchCompanies ?? null,
        describeCompanies: ports.describeCompanies ?? null,
        excludeDomains: [...exclusions.domains, ...seeds],
        lookalikes: {
            seeds,
            country: countries.length === 1 ? countries[0]! : null,
            partnerKind: partnerKinds[0]!,
        },
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
            const sellerKey = normalizeOrgName(identity.name);
            const mentions: OrgMention[] = gathered.mentions;
            const before = resolveOrganizations(mentions).length;
            let orgs = resolveOrganizations(mentions, {
                excludeDomains: exclusions.domains,
                excludeKeys: exclusions.keys,
            });
            orgs = orgs.filter(org => normalizeOrgName(org.name) !== sellerKey);
            const excluded = before - orgs.length;

            // Gates before anyone spends a research turn on a company:
            // - where it is: out on evidence (a known country or city
            //   elsewhere); unknown stays, and is ranked below confirmed. A
            //   country named in a text is weak evidence ("beans from
            //   Ethiopia"), so with a fit check, it reads those and decides;
            // - what it is, by meaning: it must read more like the segment's
            //   buyer than like business in general (./semantic);
            // - and, with a chat model, the closest ones are asked "would this
            //   business buy this?"; a no takes a company off the list.
            const fitOf = new Map(orgs.map(o => [o.resolveKey, bestTerritoryFit(o, territories)]));
            const isOut = (o: ResolvedOrg) => fitOf.get(o.resolveKey) === "out";
            let outOfArea = ports.judgeFit ? 0 : orgs.filter(isOut).length;
            if (!ports.judgeFit) orgs = orgs.filter(o => !isOut(o));

            const relevance = await relevanceOf(ports.embed, program, partnerKinds, orgs, profile);
            const scoreOf = new Map(orgs.map((o, i) => [o.resolveKey, relevance.scores[i] ?? 0]));
            if (relevance.method === "lexical")
                warnings.push(
                    "No embedding model is configured, so companies were matched by shared words rather than by meaning."
                );
            const offTopic = orgs.filter(o => (scoreOf.get(o.resolveKey) ?? 0) <= 0).length;
            orgs = orgs.filter(o => (scoreOf.get(o.resolveKey) ?? 0) > 0);

            // Rank: confirmed inside the area first, then unknown, then named
            // elsewhere; within those the most relevant, then a wanted role
            // the text states, a real domain, and mentions.
            const wanted = new Set<string>(partnerKinds);
            const FIT_RANK = { in: 2, unknown: 1, out: 0 };
            const byRank = (a: ResolvedOrg, b: ResolvedOrg) => {
                const fitA = FIT_RANK[fitOf.get(a.resolveKey) ?? "unknown"];
                const fitB = FIT_RANK[fitOf.get(b.resolveKey) ?? "unknown"];
                if (fitA !== fitB) return fitB - fitA;
                const relA = scoreOf.get(a.resolveKey) ?? 0;
                const relB = scoreOf.get(b.resolveKey) ?? 0;
                if (relA !== relB) return relB - relA;
                const roleA = a.roles.some(r => wanted.has(r)) ? 1 : 0;
                const roleB = b.roles.some(r => wanted.has(r)) ? 1 : 0;
                if (roleA !== roleB) return roleB - roleA;
                const domA = a.domain ? 1 : 0;
                const domB = b.domain ? 1 : 0;
                if (domA !== domB) return domB - domA;
                return b.mentionCount - a.mentionCount;
            };

            let notBuyers = 0;
            // Companies the fit check saw; the shortlist comes from these alone.
            let checked: Set<string> | null = null;
            if (ports.judgeFit && orgs.length > 0) {
                const queue = [...orgs].sort(byRank);
                const seen = new Set<string>();
                const rejected = new Set<string>();
                // Down the ranking until the shortlist is full or no one is
                // left: a batch of no's must not end the run with an empty list.
                let at = 0;
                let kept = 0;
                try {
                    while (at < queue.length && kept < options.maxCandidates) {
                        const room = options.maxCandidates - kept;
                        const batch = queue.slice(at, at + room * JUDGE_POOL_FACTOR);
                        at += batch.length;
                        const verdicts = await ports.judgeFit({
                            brief: buyerBrief(program, partnerKinds, profile),
                            where: territories.map(placeLabel).join("; "),
                            seller: profile,
                            question: judgeQuestionFor(program),
                            candidates: batch.map(o => ({
                                id: o.resolveKey,
                                name: o.name,
                                text: companyText(o),
                            })),
                        });
                        for (const o of batch) {
                            seen.add(o.resolveKey);
                            const verdict = verdicts.get(o.resolveKey);
                            if (verdict && !verdict.fit) {
                                rejected.add(o.resolveKey);
                                console.info(
                                    `${LOG_PREFIX} fit check left out ${o.name}: ${verdict.reason}`
                                );
                            } else kept += 1;
                        }
                    }
                } catch (error) {
                    console.warn(`${LOG_PREFIX} fit check failed; keeping the ranking:`, error);
                    warnings.push(
                        "The fit check could not finish; part of the list is ranked by meaning only."
                    );
                }
                notBuyers = rejected.size;
                orgs = orgs.filter(o => !rejected.has(o.resolveKey));
                if (seen.size > 0) checked = seen;
                // Kept by the fit check: the country named in the text was not
                // where they are. Named elsewhere and not read: out, as without one.
                outOfArea = orgs.filter(o => isOut(o) && !seen.has(o.resolveKey)).length;
                orgs = orgs
                    .filter(o => !isOut(o) || seen.has(o.resolveKey))
                    .map(o => (isOut(o) ? { ...o, country: null, region: null, city: null } : o));
            }
            if (outOfArea + offTopic + notBuyers > 0)
                warnings.push(
                    `Left out ${outOfArea} compan${outOfArea === 1 ? "y" : "ies"} outside the segment's area, ${offTopic} unrelated to what you sell${ports.judgeFit ? ` and ${notBuyers} the fit check judged would not buy it or are elsewhere` : ""}.`
                );

            const ranked = [...orgs].sort(byRank);
            const shortlist = ranked
                .filter(o => !checked || checked.has(o.resolveKey))
                .slice(0, options.maxCandidates);
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
            // Keep one still-unengaged relationship per shortlisted organisation (never
            // re-research an engaged partner, never research the same company twice);
            // the one in the kind just picked wins over an older kind.
            const wantedKind = new Map(items.map(i => [i.orgId, i.kind]));
            const perOrg = new Map<string, (typeof relationships)[number]>();
            for (const r of relationships) {
                if (!wantedKind.has(r.orgId)) continue;
                if (r.stage !== "lead") continue;
                const current = perOrg.get(r.orgId);
                if (!current || (r.kind === wantedKind.get(r.orgId) && current.kind !== r.kind))
                    perOrg.set(r.orgId, r);
            }
            const candidateIds = [...perOrg.values()]
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
    // The picture for the company's card: what its own site declares on the
    // first of its pages research reads. No extra request.
    let pictures: { imageUrl: string | null; iconUrl: string | null } | null = null;
    const readPage = async (url: string) => {
        const page = await ports.fetchPage(url, ctx.signal);
        if (!pictures && (page.image || page.icon) && isOwnSite(page.finalUrl, org.domain))
            pictures = { imageUrl: page.image ?? null, iconUrl: page.icon ?? null };
        return page;
    };
    const research = ports.profile ?? runDossierAgent;
    const agentResult: DossierAgentResult = await research(
        {
            model: ports.model,
            fetchPage: readPage,
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

    if (pictures) await db.updateOrg(org.id, ctx.companyId, pictures);

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
    // Relevance by meaning, now with what research found (summary, brands).
    let relevance: number | null = null;
    if (ports.embed) {
        const measured = await relevanceOf(
            ports.embed,
            program,
            [relationship.kind],
            [
                {
                    name: org.name,
                    categories: org.categories,
                    description: org.description,
                    extra: [
                        dossier?.summary ?? "",
                        ...(dossier?.brandsCarried.map(b => b.brand) ?? []),
                    ],
                },
            ],
            args.profile
        );
        if (measured.method === "semantic")
            relevance = relevanceShare(measured.scores[0] ?? 0, "semantic");
    }
    // The shortlist was judged on a listing; now judge what research found. A
    // company that has closed, or turns out not to buy this, must not rank on
    // its website's evidence.
    let rejectedBecause: string | null = null;
    // For a `companies` list, the check's reason for a yes ("Snap: Santa
    // Monica tech company, market value about $15B") is the best rationale.
    let matchReason: string | null = null;
    if (ports.judgeFit) {
        try {
            const verdicts = await ports.judgeFit({
                question: judgeQuestionFor(program),
                brief: buyerBrief(program, [relationship.kind], args.profile),
                where: relationship.territory
                    ? placeLabel(relationship.territory)
                    : program.targetTerritories.map(placeLabel).join("; "),
                seller: args.profile,
                candidates: [
                    {
                        id: org.id,
                        name: org.name,
                        text: companyText({
                            name: org.name,
                            description: org.description,
                            extra: [
                                dossier?.summary ?? "",
                                ...(dossier?.risks.map(r => r.risk) ?? []),
                                ...evidence.slice(0, 20).map(e => e.claim),
                            ],
                        }),
                    },
                ],
            });
            const verdict = verdicts.get(org.id);
            if (verdict && !verdict.fit) {
                rejectedBecause = verdict.reason;
                console.info(`${LOG_PREFIX} research ruled out ${org.name}: ${verdict.reason}`);
            } else if (verdict?.fit && program.intent === "companies") {
                matchReason = verdict.reason;
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX} fit check after research failed for ${org.name}:`, error);
        }
    }
    const breakdown = computeFit({
        relevance,
        rejectedBecause,
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

    let rationale =
        matchReason && !breakdown.excludedBecause
            ? matchReason
            : templateRationale({ breakdown, orgName: org.name, kind: relationship.kind });
    if (ports.writeRationale && !matchReason) {
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

    await db.setResearchResult(relationship.id, ctx.companyId, {
        dossier,
        fitScore: breakdown.total,
        fitRationale: rationale,
        fitBreakdown: breakdown,
        riskFlags,
        screening,
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
        const enriched = await mapInPool(
            prepared.candidateRelationshipIds,
            ports.enrichConcurrency ?? 1,
            relationshipId =>
                enrichCandidate(ctx, ports, { relationshipId, profile: prepared.profile }),
            () => ctx.signal?.aborted ?? false
        );
        await fillPicturesAfterRun(ctx, ports);
        return await finalizeRun(ctx, prepared, enriched, startedAt);
    } catch (error) {
        await failRun(ctx, error instanceof Error ? error.message : String(error));
        throw error;
    }
}

export type { RelationshipRecord, ProgramRecord };

/** Whether a page is on the organisation's own domain (or a subdomain of it). */
function isOwnSite(url: string, domain: string | null): boolean {
    if (!domain) return false;
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        const own = domain.toLowerCase().replace(/^www\./, "");
        return host === own || host.endsWith(`.${own}`);
    } catch {
        return false;
    }
}

/**
 * A picture for every company the run saved, not only the ones researched:
 * after enrichment, sites still without one are read for theirs. Never fails
 * the run; whatever is left is picked up by the next run or the backfill.
 */
export async function fillPicturesAfterRun(
    ctx: Pick<RunContext, "companyId" | "signal">,
    ports: Pick<DistributionPorts, "fetchPage">
): Promise<{ checked: number; found: number }> {
    try {
        return await fillMissingPictures(ctx.companyId, url => ports.fetchPage(url, ctx.signal));
    } catch (error) {
        console.warn(`${LOG_PREFIX} filling company pictures failed:`, error);
        return { checked: 0, found: 0 };
    }
}
