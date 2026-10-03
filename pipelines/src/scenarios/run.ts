/**
 * The run loop. A run is a fixed sequence of units — brief, cast, one per
 * round, report — and `advanceRun` performs exactly one. Each unit reads the
 * run, does its model work, and commits with a compare-and-set on `step`, so
 * a retried or duplicated unit (an Inngest replay, two pollers resuming the
 * same run) never applies twice. Hosts drive it: in-process with a lease, or
 * one Inngest `step.run` per unit.
 */
import {
    buildBriefRequest,
    buildCastRequest,
    buildReportRequest,
    CAST_BATCH_SIZE,
    createWorld,
    injectEvent,
    mapLimit,
    parseBrief,
    parseCast,
    parseReport,
    postReception,
    runRound,
    stripCitations,
    totalUsage,
    type Account,
    type Brief,
    type ModelReply,
    type ModelRequest,
    type Persona,
    type ScenarioReport,
    type SimulationModel,
    type Usage,
    type World,
} from "@launchstack/simulation";

import type { RunUsage, ScenarioRunRecord, StoredEvidence } from "./types";
import { TERMINAL_STATUSES, unitCount } from "./types";

export interface RunPatch {
    status?: ScenarioRunRecord["status"];
    evidence?: StoredEvidence[];
    brief?: Brief;
    world?: World;
    report?: ScenarioReport;
    reception?: ScenarioRunRecord["reception"];
    usage?: RunUsage;
    error?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
}

export interface ScenarioStore {
    get(runId: number): Promise<ScenarioRunRecord | undefined>;
    /**
     * Commit a finished unit: apply `patch` and set `step = expectedStep + 1`,
     * only if the run is still at `expectedStep` and not finished. Marks the
     * given injections applied in the same transaction. False when another
     * worker got there first.
     */
    commitUnit(
        runId: number,
        expectedStep: number,
        patch: RunPatch,
        applied?: { injectionIds: number[]; round: number }
    ): Promise<boolean>;
    /** Set a terminal status unless the run already has one. */
    finish(
        runId: number,
        status: "failed" | "cancelled",
        error: string | null,
        at: Date
    ): Promise<boolean>;
    pendingInjections(runId: number): Promise<Array<{ id: number; text: string }>>;
    /**
     * Close the event window (the final round is starting). Must serialize
     * with event inserts, so every accepted event is read by some round.
     */
    closeEvents(runId: number, at: Date): Promise<void>;
    /** queued → running as soon as a worker picks the run up, so the UI never says "queued" while it works. */
    markStarted(runId: number, at: Date): Promise<void>;
}

export interface ScenarioRunPorts {
    store: ScenarioStore;
    model: SimulationModel;
    /** Collect evidence from the run's sources, as the creator is allowed to see them. */
    gatherEvidence(run: ScenarioRunRecord): Promise<StoredEvidence[]>;
    /** Credits a unit's tokens cost. */
    creditsFor(usage: Usage): number;
    /**
     * Debit a committed unit. Called only after the unit's commit won, so a
     * worker that lost a race is never charged. False when the balance ran out.
     */
    charge(run: ScenarioRunRecord, credits: number, unit: string): Promise<boolean>;
    now(): Date;
    /** Parallel model calls inside a unit (default 6). */
    concurrency?: number;
    log?: (message: string, meta?: Record<string, unknown>) => void;
}

export type AdvanceOutcome =
    | { state: "advanced"; step: number }
    | { state: "done" | "failed" | "cancelled" }
    | { state: "skipped"; reason: string };

export class OutOfCreditsError extends Error {
    constructor() {
        super("The workspace ran out of credits during this run.");
        this.name = "OutOfCreditsError";
    }
}

const NARRATOR: Account = { id: "narrator", name: "Newswire", handle: "@newswire" };

/** Wrap the model to count every call's tokens. */
function metered(model: SimulationModel): { model: SimulationModel; usage: Usage } {
    const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
    return {
        usage,
        model: {
            async complete(request: ModelRequest): Promise<ModelReply> {
                const reply = await model.complete(request);
                usage.calls += 1;
                usage.inputTokens += reply.usage?.inputTokens ?? 0;
                usage.outputTokens += reply.usage?.outputTokens ?? 0;
                return reply;
            },
        },
    };
}

function addUsage(total: RunUsage, unit: Usage, credits: number): RunUsage {
    return {
        calls: total.calls + unit.calls,
        inputTokens: total.inputTokens + unit.inputTokens,
        outputTokens: total.outputTokens + unit.outputTokens,
        credits: total.credits + credits,
    };
}

function audienceFor(run: ScenarioRunRecord): string {
    if (run.kind === "post_test" && run.draft) {
        const where =
            run.draft.networks.length > 0 ? run.draft.networks.join(" and ") : "social media";
        return `people who would see ${run.draft.brandName}'s post on ${where}: followers, customers, prospects, peers in the industry, and a few skeptics`;
    }
    return "people who would plausibly hear about this situation and have a view on it: customers, prospects, people in the market, critics and bystanders";
}

async function buildCast(
    run: ScenarioRunRecord,
    ports: ScenarioRunPorts,
    model: SimulationModel,
    brief: string
): Promise<Persona[]> {
    const evidence = run.evidence ?? [];
    const evidenceIds = new Set(evidence.map(e => e.id));
    const batches: number[] = [];
    for (let left = run.agentCount; left > 0; left -= CAST_BATCH_SIZE)
        batches.push(Math.min(CAST_BATCH_SIZE, left));
    const takenHandles = new Set<string>(["@newswire"]);
    if (run.draft) takenHandles.add(run.draft.brandHandle.toLowerCase());
    // Batches run in parallel but parse in order, so ids and handles are stable.
    const replies = await mapLimit(batches, Math.min(3, ports.concurrency ?? 6), async count =>
        model.complete(
            buildCastRequest({
                subject: run.subject,
                brief,
                evidence,
                count,
                takenHandles: [],
                audience: audienceFor(run),
                maxInvented: evidence.length === 0 ? count : Math.max(1, Math.ceil(count * 0.2)),
            })
        )
    );
    const personas: Persona[] = [];
    replies.forEach((reply, i) => {
        const parsed = parseCast(reply.text, {
            evidenceIds,
            startIndex: personas.length + 1,
            takenHandles,
            limit: batches[i]!,
        });
        personas.push(...parsed);
    });
    return personas;
}

/**
 * Perform the run's next unit. Throws on model or storage failure so the
 * host can retry; the host marks the run failed after its last attempt.
 */
export async function advanceRun(ports: ScenarioRunPorts, runId: number): Promise<AdvanceOutcome> {
    const run = await ports.store.get(runId);
    if (!run) return { state: "skipped", reason: "missing" };
    if (TERMINAL_STATUSES.includes(run.status))
        return { state: run.status as "done" | "failed" | "cancelled" };
    if (run.cancelRequestedAt) {
        await ports.store.finish(runId, "cancelled", null, ports.now());
        return { state: "cancelled" };
    }

    const step = run.step;
    const { model, usage } = metered(ports.model);
    const outOfCredits = async (): Promise<AdvanceOutcome> => {
        await ports.store.finish(runId, "failed", new OutOfCreditsError().message, ports.now());
        return { state: "failed" };
    };
    /**
     * Commit the unit with its usage, then debit it, so a worker that lost a
     * race commits and charges nothing. The report is the exception: it is
     * charged before it is stored, so a refused charge fails the run instead of
     * handing out a finished report nobody paid for. (Two drivers racing on the
     * report would both be charged; the lease and Inngest's single execution
     * make that the rare case, and the alternative is worse.)
     */
    const commit = async (
        unit: string,
        patch: RunPatch,
        applied?: { injectionIds: number[]; round: number }
    ): Promise<AdvanceOutcome> => {
        const credits = ports.creditsFor(usage);
        const finishing = patch.status === "done";
        if (finishing && !(await ports.charge(run, credits, unit))) return outOfCredits();
        const ok = await ports.store.commitUnit(
            runId,
            step,
            { ...patch, usage: addUsage(run.usage, usage, credits) },
            applied
        );
        if (!ok) return { state: "skipped", reason: "raced" };
        if (finishing) return { state: "done" };
        if (!(await ports.charge(run, credits, unit))) return outOfCredits();
        return { state: "advanced", step: step + 1 };
    };

    // 1. Gather evidence and write the shared brief.
    if (step === 0) {
        if (run.status === "queued") await ports.store.markStarted(runId, ports.now());
        const evidence = await ports.gatherEvidence(run);
        const reply = await model.complete(
            buildBriefRequest({
                subject: run.subject,
                evidence,
                mode: run.kind === "post_test" ? "post_test" : "scenario",
            })
        );
        const brief: Brief = parseBrief(reply.text, new Set(evidence.map(e => e.id))) ?? {
            brief: "",
            openingPost: "",
            evidenceIds: [],
        };
        return commit("brief", {
            status: "running",
            startedAt: run.startedAt ?? ports.now(),
            evidence,
            brief,
        });
    }

    // 2. Build the cast and the starting world.
    if (step === 1) {
        const brief = stripCitations(run.brief?.brief ?? "");
        const personas = await buildCast(run, ports, model, brief);
        const minimum = Math.min(3, run.agentCount);
        if (personas.length < minimum)
            throw new Error(`Only ${personas.length} people could be built from the sources`);
        const isPostTest = run.kind === "post_test" && run.draft;
        const accounts: Account[] = isPostTest
            ? [
                  { id: "brand", name: run.draft!.brandName, handle: run.draft!.brandHandle },
                  NARRATOR,
              ]
            : [NARRATOR];
        const opening = isPostTest
            ? { authorId: "brand" as const, text: run.draft!.text }
            : {
                  authorId: "narrator" as const,
                  text:
                      run.brief && run.brief.openingPost.length > 0
                          ? run.brief.openingPost
                          : run.subject,
              };
        const world = createWorld({
            subject: run.subject,
            brief,
            personas,
            accounts,
            seedPosts: [opening],
            config: { seed: run.seed },
        });
        return commit("cast", { world });
    }

    // 3. One round.
    if (step < 2 + run.roundCount) {
        if (!run.world) throw new Error("Run has no world");
        // The last round is the last chance to apply an event: close the
        // window first, then read what is pending.
        if (step === 1 + run.roundCount) await ports.store.closeEvents(runId, ports.now());
        const pending = await ports.store.pendingInjections(runId);
        const start = structuredClone(run.world);
        for (const event of pending) injectEvent(start, event.text);
        const { world } = await runRound(start, {
            model,
            concurrency: ports.concurrency ?? 6,
            onAgentError: (agentId, error) =>
                ports.log?.("scenario agent turn failed", { runId, agentId, error: String(error) }),
        });
        return commit(
            `round ${world.round}`,
            { world },
            pending.length > 0
                ? { injectionIds: pending.map(p => p.id), round: world.round }
                : undefined
        );
    }

    // 4. The report.
    if (step === 2 + run.roundCount) {
        if (!run.world) throw new Error("Run has no world");
        const targetPostId = run.kind === "post_test" ? "p1" : undefined;
        const reply = await model.complete(buildReportRequest(run.world, { targetPostId }));
        const report = parseReport(reply.text, run.world);
        if (!report) throw new Error("The report could not be read");
        return commit("report", {
            report,
            reception: targetPostId ? (postReception(run.world, targetPostId) ?? null) : null,
            status: "done",
            finishedAt: ports.now(),
        });
    }

    return { state: "skipped", reason: `step ${step} beyond ${unitCount(run.roundCount)} units` };
}

/** Sum of usage recorded in the world's rounds (for reconciliation in tests). */
export function worldUsage(world: World): Usage {
    return totalUsage(world);
}
