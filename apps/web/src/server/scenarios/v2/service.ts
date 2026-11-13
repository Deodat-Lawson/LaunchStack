/**
 * Scenarios contract v2, as the API routes use it.
 *
 * Access (design §3.1): a v2 run's artifacts are derived from every source it
 * read, so a reader — the creator included — must still be able to open every
 * one of those files. Freezing content never grants permission. Failing that
 * the run reads as not found, without naming what is hidden. Sharing works as
 * for v1 (private to the creator until shared).
 */
import { randomInt } from "node:crypto";

import type { ScenarioRunRecord, ScenarioSourcesInput } from "@launchstack/pipelines/scenarios";
import { getCompanyRun } from "@launchstack/pipelines/scenarios/db";
import {
    BASES,
    CONTRACT_VERSION,
    DEFAULT_POLICIES,
    DEFAULT_SOURCE_BUDGET,
    EMPTY_FLAGS,
    V2_VERSIONS,
    buildInitialPlan,
    hashOf,
    planCeiling,
    stageOfV2,
    UNIT_TOKEN_CAPS,
    type CastBatchOutput,
    type ContextFallbackReason,
    type ContextMode,
    type RequestSpecV2,
    type RunFlagsV2,
} from "@launchstack/pipelines/scenarios/v2";
import {
    IdempotencyConflictError,
    InsufficientCreditsError,
    acceptRun,
} from "@launchstack/pipelines/scenarios/v2/db";
import {
    readActorContexts,
    readAttemptCounts,
    readCheckpoints,
    readGraphSnapshot,
    readManifest,
    readNextUnitKinds,
    readOntology,
    readRequestSpec,
    readTrace,
    readUnitOutputs,
    readWorldSpec,
    readWorldSpecWithWorld,
} from "@launchstack/pipelines/scenarios/v2/read";
import { replayRun } from "@launchstack/pipelines/scenarios/v2/stages";
import { estimateRun, MAX_AGENTS, MAX_ROUNDS } from "@launchstack/simulation";
import { llmChatTokens } from "@launchstack/store/credits";

import type { Locale } from "~/i18n/locales";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { getBalance } from "~/lib/credits";
import {
    SCENARIO_LIMITS,
    type CreateScenarioInput,
    type ScenarioDetail,
    type ScenarioOmission,
    type ScenarioPerson,
    type ScenarioProvenance,
    type ScenarioReplay,
    type ScenarioSummary,
    type ScenarioTrace,
    type ScenarioV2Detail,
} from "~/lib/scenarios/types";
import { assertWithinAiAllowance } from "~/server/ai-usage/refusal";
import { isMeteringEnforced } from "~/server/deployment";
import { getWorkspaceEndpointRow } from "~/server/workspace-models/store";

import { visibleDocumentIds } from "../evidence";
import {
    cleanScenarioSources,
    clampInt,
    ScenarioError,
    scenarioErrorCopy,
    titleFromSubject,
} from "../service";
import {
    recordSummary,
    sourceLabel,
    toFieldBasis,
    type DetailContext,
    type V2Progress,
} from "../views";
import { createAppScenarioCredits } from "./credits";
import { startV2Run } from "./executor";
import { scenarioGraphPort } from "./graph";

type Ctx = Pick<WorkspaceContext, "authUserId" | "companyId" | "can" | "documentScope">;

const notFound = () => new ScenarioError(scenarioErrorCopy("notFound"), 404, "not_found");

// ─── Context mode ────────────────────────────────────────────────────────────

/**
 * The mode a new run gets. Graph is the default where the service is set up
 * and answering; a workspace that brought its own model endpoint stays on
 * passages, since graph extraction runs on the graph service's own provider
 * and the workspace's files were meant for its own.
 */
export async function resolveContextMode(
    companyId: bigint,
    requested: ContextMode,
    sources: ScenarioSourcesInput
): Promise<{ mode: ContextMode; fallbackReason: ContextFallbackReason | null }> {
    if (requested !== "graph") return { mode: requested, fallbackReason: null };
    const port = scenarioGraphPort();
    if (!port) return { mode: "passage", fallbackReason: "graph_not_configured" };
    if (sources.documentIds.length === 0 && !sources.searchFiles && !sources.notes) {
        return { mode: "passage", fallbackReason: "no_documents" };
    }
    const endpoint = await getWorkspaceEndpointRow(companyId);
    if (endpoint?.models?.default?.id) {
        return { mode: "passage", fallbackReason: "workspace_endpoint" };
    }
    try {
        const health = await Promise.race([
            port.health(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 3_000)
            ),
        ]);
        if (!health.ok) return { mode: "passage", fallbackReason: "graph_unavailable" };
    } catch {
        return { mode: "passage", fallbackReason: "graph_unavailable" };
    }
    return { mode: "graph", fallbackReason: null };
}

// ─── Create ──────────────────────────────────────────────────────────────────

const MODES: readonly ContextMode[] = ["passage", "facts", "graph"];

/** The graph-ingestion allowance a run may spend before its manifest exists. */
function ingestAllowance(mode: ContextMode): number {
    if (mode !== "graph") return 0;
    const c = UNIT_TOKEN_CAPS;
    const tokens = DEFAULT_SOURCE_BUDGET.totalTokens;
    const batches = Math.ceil(DEFAULT_SOURCE_BUDGET.maxSections / DEFAULT_POLICIES.ingestBatchSize);
    return llmChatTokens(
        c.ingestFloor.input * batches + c.ingestPerSourceToken.input * tokens,
        c.ingestFloor.output * batches + c.ingestPerSourceToken.output * tokens
    );
}

export interface CreatedV2 {
    run: ScenarioSummary;
    created: boolean;
    requestSpecId: number;
}

export async function createScenarioV2(
    ctx: Ctx,
    input: Partial<CreateScenarioInput>,
    idempotencyKey: string | null,
    locale: Locale,
    names: (ids: string[]) => Promise<Map<string, string>>
): Promise<CreatedV2> {
    if (!ctx.can("documents.read")) {
        throw new ScenarioError(scenarioErrorCopy("roleCantRun"), 403, "forbidden");
    }
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    if (!subject) throw new ScenarioError(scenarioErrorCopy("describeSituation"), 400, "invalid");
    if (subject.length > SCENARIO_LIMITS.subjectMax) {
        throw new ScenarioError(
            scenarioErrorCopy("situationTooLong", { max: String(SCENARIO_LIMITS.subjectMax) }),
            400,
            "invalid"
        );
    }
    const key =
        typeof idempotencyKey === "string" && idempotencyKey.trim()
            ? idempotencyKey.trim().slice(0, 200)
            : null;
    const sources = await cleanScenarioSources(ctx, input.sources);
    const agents = clampInt(
        input.agents,
        SCENARIO_LIMITS.agents.min,
        MAX_AGENTS,
        SCENARIO_LIMITS.agents.default
    );
    const rounds = clampInt(
        input.rounds,
        SCENARIO_LIMITS.rounds.min,
        MAX_ROUNDS,
        SCENARIO_LIMITS.rounds.default
    );
    const asked = input.contextMode;
    const requested: ContextMode = asked && MODES.includes(asked) ? asked : "graph";
    const titleRaw = typeof input.title === "string" ? input.title.trim() : "";
    const title = titleRaw ? titleRaw.slice(0, 120) : titleFromSubject(subject);
    // The payload a key stands for: what the person asked for, before any
    // server-side choice (seed, resolved mode) is made.
    const payloadHash = hashOf({ title, subject, sources, agents, rounds, requested });

    const estimate = estimateRun({ agents, rounds });
    const estimateCredits = llmChatTokens(estimate.inputTokens, estimate.outputTokens);
    await assertWithinAiAllowance(ctx.companyId, ctx.authUserId);
    if (isMeteringEnforced() && (await getBalance(ctx.companyId)) < estimateCredits) {
        throw new ScenarioError(
            scenarioErrorCopy("notEnoughCredits"),
            402,
            "insufficient_credits",
            { required: estimateCredits }
        );
    }

    const { mode, fallbackReason } = await resolveContextMode(ctx.companyId, requested, sources);
    const spec: RequestSpecV2 = {
        contractVersion: CONTRACT_VERSION,
        kind: "scenario",
        title,
        subject,
        agents,
        rounds,
        seed: randomInt(1, 2 ** 31 - 1),
        sources,
        contextMode: mode,
        requestedContextMode: requested,
        fallbackReason,
        budget: { maxCredits: 0, repairsPerUnit: 1 },
        policies: {
            versions: V2_VERSIONS,
            actorTokenCap: DEFAULT_POLICIES.actorTokenCap,
            sourceBudget: DEFAULT_SOURCE_BUDGET,
            castBatchSize: DEFAULT_POLICIES.castBatchSize,
            ingestBatchSize: DEFAULT_POLICIES.ingestBatchSize,
        },
    };
    spec.budget.maxCredits = planCeiling(buildInitialPlan(spec)) + ingestAllowance(mode);
    const flags: RunFlagsV2 = { ...EMPTY_FLAGS, contextMode: mode, fallbackReason };

    let accepted;
    try {
        accepted = await acceptRun(
            {
                companyId: ctx.companyId,
                createdByUserId: ctx.authUserId,
                idempotencyKey: key,
                payloadHash,
                spec,
                estimate: {
                    calls: estimate.calls,
                    inputTokens: estimate.inputTokens,
                    outputTokens: estimate.outputTokens,
                    credits: estimateCredits,
                },
                flags,
            },
            createAppScenarioCredits()
        );
    } catch (error) {
        if (error instanceof IdempotencyConflictError) {
            throw new ScenarioError(
                scenarioErrorCopy("idempotencyConflict"),
                409,
                "idempotency_conflict"
            );
        }
        if (error instanceof InsufficientCreditsError) {
            throw new ScenarioError(
                scenarioErrorCopy("notEnoughCredits"),
                402,
                "insufficient_credits",
                { required: error.required }
            );
        }
        throw error;
    }
    // Delivery after the commit; a lost send is the reconciler's to retry. A
    // replayed acceptance is safe to start again (the lease or the sent
    // dispatch stops a second driver).
    await startV2Run(accepted);
    const run = accepted.run;
    return {
        run: recordSummary(run, ctx.authUserId, await names([run.createdByUserId]), {
            stage: "gathering",
            round: 0,
        }),
        created: accepted.created,
        requestSpecId: accepted.requestSpecId,
    };
}

// ─── Read ────────────────────────────────────────────────────────────────────

/** Every file a v2 run's artifacts depend on: its manifest's, or its picks before the manifest exists. */
async function dependencyDocumentIds(run: ScenarioRunRecord): Promise<number[]> {
    const manifest = await readManifest(run);
    return manifest ? manifest.documentIds : run.sources.documentIds;
}

/**
 * Throws not-found unless the reader may open every file this run depends on.
 * Returns the dependencies so callers can reuse them.
 */
export async function assertV2Readable(ctx: Ctx, run: ScenarioRunRecord): Promise<number[]> {
    const deps = await dependencyDocumentIds(run);
    if (deps.length === 0) return deps;
    const visible = await visibleDocumentIds(ctx.companyId, await ctx.documentScope(), deps);
    if (deps.some(id => !visible.has(id))) throw notFound();
    return deps;
}

/** v2 progress for a set of runs (list rows or one record). */
export async function v2Progress(
    runs: Array<{
        id: number;
        generation: number;
        status: ScenarioRunRecord["status"];
        worldRound: number;
    }>
): Promise<Map<number, V2Progress>> {
    const kinds = await readNextUnitKinds(runs);
    const out = new Map<number, V2Progress>();
    for (const r of runs) {
        out.set(r.id, { stage: stageOfV2(r.status, kinds.get(r.id) ?? null), round: r.worldRound });
    }
    return out;
}

function omissionKind(sourceType: string): ScenarioOmission["kind"] {
    switch (sourceType) {
        case "document":
        case "search":
        case "prospect":
        case "brand_comment":
        case "company_profile":
        case "notes":
            return sourceType;
        case "company_fact":
            return "company_profile";
        default:
            return "document";
    }
}

/** Basis per cast slot, from the committed cast batches. */
async function basisBySlot(run: ScenarioRunRecord): Promise<Map<string, ScenarioPerson["basis"]>> {
    const outputs = await readUnitOutputs<CastBatchOutput>(run, "cast:batch:");
    const out = new Map<string, ScenarioPerson["basis"]>();
    for (const { output } of outputs) {
        for (const member of output.members ?? []) {
            const basis: NonNullable<ScenarioPerson["basis"]> = {};
            for (const [field, attributed] of Object.entries(member.attributes ?? {})) {
                if (!attributed || !BASES.includes(attributed.basis)) continue;
                basis[field as keyof typeof basis] = toFieldBasis(attributed);
            }
            out.set(member.slotId, basis);
        }
    }
    return out;
}

/** The v2 parts of a detail view; the caller has already checked access. */
export async function v2DetailContext(
    run: ScenarioRunRecord,
    isCreator: boolean,
    visibleDocIds: ReadonlySet<number>,
    locale: Locale
): Promise<NonNullable<DetailContext["v2"]>> {
    const [manifest, spec, world, attempts, checkpoints, bySlot, progress] = await Promise.all([
        readManifest(run),
        run.requestSpecId ? readRequestSpec(run.requestSpecId) : Promise.resolve(undefined),
        readWorldSpec(run),
        readAttemptCounts(run),
        readCheckpoints(run),
        basisBySlot(run),
        v2Progress([
            {
                id: run.id,
                generation: run.generation,
                status: run.status,
                worldRound: run.world?.round ?? 0,
            },
        ]),
    ]);
    const flags = { ...EMPTY_FLAGS, ...(run.flags ?? {}) };
    const omitted: ScenarioOmission[] = (manifest?.omissions ?? []).map(o => {
        const documentId = o.sourceType === "document" ? Number(o.sourceId) : null;
        const redacted = !isCreator && documentId !== null && !visibleDocIds.has(documentId);
        const kind = omissionKind(o.sourceType);
        return {
            label: redacted ? "" : sourceLabel(kind, o.label, locale),
            kind,
            reason: o.reason,
            redacted,
        };
    });
    const files = new Set(
        (manifest?.items ?? []).filter(i => i.sourceType === "document").map(i => i.sourceId)
    );
    const detail: ScenarioV2Detail = {
        specHash: spec?.specHash ?? null,
        worldSpecHash: world?.specHash ?? null,
        contextMode: flags.contextMode,
        fallbackReason: flags.fallbackReason,
        coverage: { sections: manifest?.items.length ?? 0, files: files.size, omitted },
        degradedRounds: flags.degradedRounds,
        skippedTurns: flags.skippedTurns,
        unfilledSlots: flags.unfilledSlots,
        attempts: {
            succeeded: attempts.succeeded,
            failed: attempts.failed,
            unknown: attempts.unknown + attempts.started,
        },
        replayAvailable:
            run.status === "done" && Boolean(world) && checkpoints.length === run.roundCount,
        waitingSince: flags.waitingSince,
    };
    return {
        progress: progress.get(run.id) ?? { stage: "gathering", round: 0 },
        basisBySlot: bySlot,
        detail,
    };
}

// ─── Provenance, trace, replay ───────────────────────────────────────────────

async function readableV2(ctx: Ctx, id: number): Promise<ScenarioRunRecord> {
    const run = await getCompanyRun(ctx.companyId, id);
    if (!run || run.contractVersion !== 2) throw notFound();
    if (run.createdByUserId !== ctx.authUserId && !run.sharedAt) throw notFound();
    await assertV2Readable(ctx, run);
    return run;
}

const CONTEXT_PAGE = 50;

export async function getScenarioProvenance(
    ctx: Ctx,
    id: number,
    page: { after: string | null; limit: number | null },
    locale: Locale
): Promise<ScenarioProvenance> {
    const run = await readableV2(ctx, id);
    const [manifest, spec, ontology, contexts] = await Promise.all([
        readManifest(run),
        run.requestSpecId ? readRequestSpec(run.requestSpecId) : Promise.resolve(undefined),
        readOntology(run.id),
        readActorContexts(run),
    ]);
    const flags = { ...EMPTY_FLAGS, ...(run.flags ?? {}) };
    const snapshotId = contexts.find(c => c.graphSnapshotId !== null)?.graphSnapshotId ?? null;
    const snapshot = snapshotId ? await readGraphSnapshot(snapshotId, run.companyId) : undefined;
    const agentBySlot = new Map(
        (run.world?.agents ?? []).flatMap(a => {
            const slot = (a.persona as { slotId?: string }).slotId;
            return slot ? [[slot, a.persona.id] as const] : [];
        })
    );
    const limit = Math.max(1, Math.min(CONTEXT_PAGE, page.limit ?? CONTEXT_PAGE));
    const after = page.after;
    const sorted = [...contexts].sort((a, b) => a.slotId.localeCompare(b.slotId));
    const start = after ? sorted.findIndex(c => c.slotId > after) : 0;
    const slice = start < 0 ? [] : sorted.slice(start, start + limit);
    const nextAfter =
        start >= 0 && start + limit < sorted.length
            ? (slice[slice.length - 1]?.slotId ?? null)
            : null;

    return {
        runId: run.id,
        specHash: spec?.specHash ?? null,
        manifestHash: manifest?.manifestHash ?? null,
        contextMode: flags.contextMode,
        fallbackReason: flags.fallbackReason,
        sources: (manifest?.items ?? []).map(item => ({
            id: item.id,
            kind: item.kind,
            label: sourceLabel(item.kind, item.label, locale),
            excerpt: item.quote,
            href: item.href,
            redacted: false,
            page: item.locator.page,
            section: item.locator.section,
            versionId: item.versionId,
            contentHash: item.contentHash,
        })),
        omitted: (manifest?.omissions ?? []).map(o => {
            const kind = omissionKind(o.sourceType);
            return {
                label: sourceLabel(kind, o.label, locale),
                kind,
                reason: o.reason,
                redacted: false,
            };
        }),
        ontology: ontology
            ? {
                  ontologyHash: ontology.ontologyHash,
                  entities: ontology.schema.entities.map(e => ({
                      name: e.name,
                      origin: e.origin,
                      source: e.motivatingEvidenceId,
                  })),
                  edges: ontology.schema.edges.map(e => ({
                      name: e.name,
                      endpoints: e.endpoints,
                      origin: e.origin,
                      source: e.motivatingEvidenceId,
                  })),
                  valid: ontology.validation.ok,
                  repairs: ontology.validation.repairs,
              }
            : null,
        graph: snapshot
            ? {
                  graphHash: snapshot.graphHash,
                  nodes: snapshot.data.nodes.length,
                  edges: snapshot.data.edges.length,
                  supportedEdges: snapshot.data.edges.filter(e => e.supported).length,
                  unresolvedIdentities: snapshot.data.unresolvedIdentities.length,
              }
            : null,
        contexts: slice.map(c => ({
            slotId: c.slotId,
            personId: agentBySlot.get(c.slotId) ?? null,
            segment: c.segment,
            mode: c.mode,
            facts: c.facts.map(f => ({ text: f.text, sources: f.evidenceIds })),
            passages: c.passages.map(p => p.evidenceId),
            tokens: c.tokens,
            contextHash: c.contextHash,
        })),
        nextAfter,
    };
}

/** Error text in a trace is a code, never provider text (it may quote documents). */
function classifyError(error: string | null): string | null {
    if (!error) return null;
    if (/credit/i.test(error)) return "out_of_credits";
    if (/graph/i.test(error)) return "graph_unavailable";
    if (/timeout|timed out/i.test(error)) return "timeout";
    if (/access/i.test(error)) return "access_revoked";
    if (/json|parse|read/i.test(error)) return "invalid_reply";
    return "error";
}

const TRACE_PAGE = 100;

export async function getScenarioTrace(
    ctx: Ctx,
    id: number,
    page: { afterSeq: number | null; limit: number | null }
): Promise<ScenarioTrace> {
    const run = await readableV2(ctx, id);
    const limit = Math.max(1, Math.min(TRACE_PAGE, page.limit ?? TRACE_PAGE));
    const units = await readTrace(run, { afterSeq: page.afterSeq ?? -1, limit: limit + 1 });
    const shown = units.slice(0, limit);
    const progress = await v2Progress([
        {
            id: run.id,
            generation: run.generation,
            status: run.status,
            worldRound: run.world?.round ?? 0,
        },
    ]);
    const now = Date.now();
    return {
        runId: run.id,
        stage: progress.get(run.id)?.stage ?? "gathering",
        committed: run.step,
        heartbeatAgeMs:
            run.leaseOwner && run.leaseUntil
                ? Math.max(0, now - (run.leaseUntil.getTime() - 2 * 60_000))
                : null,
        units: shown.map(u => ({
            seq: u.seq,
            key: u.key,
            kind: u.kind,
            status: u.status,
            attempts: u.attempts,
            credits: u.credits,
            durationMs: u.durationMs,
            error: classifyError(u.error),
            calls: u.calls,
            callAttempts: {
                succeeded: u.attemptsByStatus.succeeded,
                failed: u.attemptsByStatus.failed,
                unknown: u.attemptsByStatus.unknown + u.attemptsByStatus.started,
            },
        })),
        nextAfterSeq: units.length > limit ? (shown[shown.length - 1]?.seq ?? null) : null,
    };
}

export async function replayScenario(ctx: Ctx, id: number): Promise<ScenarioReplay> {
    const run = await readableV2(ctx, id);
    if (run.status !== "done") {
        return {
            available: false,
            reason: "not_finished",
            matches: false,
            modelCalls: 0,
            rounds: [],
        };
    }
    const [world, checkpoints] = await Promise.all([
        readWorldSpecWithWorld(run),
        readCheckpoints(run),
    ]);
    if (!world || checkpoints.length !== run.roundCount) {
        return {
            available: false,
            reason: "replay_unavailable",
            matches: false,
            modelCalls: 0,
            rounds: [],
        };
    }
    return replayRun(world, checkpoints);
}

export type { ScenarioDetail };
