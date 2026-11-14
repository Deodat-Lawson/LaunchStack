/**
 * `round:NN` — one simulated round, recorded so it can be replayed.
 *
 * Like the v1 round unit: the final round closes the event window before it
 * reads pending events, so an event is either applied or refused. Every turn
 * goes through a recorder around the journaled model that keeps
 * {agent, request hash, reply or error}; the checkpoint saves those turns in
 * world agent order with the state hash, so replay can serve the same
 * replies back without a model and check it reaches the same state.
 */
import {
    injectEvent,
    runRound,
    type ModelReply,
    type ModelRequest,
    type SimulationModel,
    type World,
} from "@launchstack/simulation";

import type { RecordedTurn, RoundCheckpoint, V2_VERSIONS } from "../contracts";
import { requestHash, stateHash } from "../hash";
import type { Stage, StageContext } from "../stage";
import { inputNumber } from "./common";

/** The agent a decision request is for: its system prompt opens with the persona's name and handle. */
export function agentForRequest(world: World, request: ModelRequest): string | undefined {
    return world.agents.find(a =>
        request.system.startsWith(`You are ${a.persona.name} (${a.persona.handle}).`)
    )?.persona.id;
}

interface RecordedCall {
    request: ModelRequest;
    requestHash: string;
    reply: ModelReply | null;
    error: string | null;
}

/** Wraps a model and keeps every call it served, with the request's hash. */
export function recordingModel(
    model: SimulationModel,
    versions: Pick<typeof V2_VERSIONS, "modelPolicy" | "prompts">
): { model: SimulationModel; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    return {
        calls,
        model: {
            async complete(request) {
                const hash = requestHash(request, versions);
                try {
                    const reply = await model.complete(request);
                    calls.push({ request, requestHash: hash, reply, error: null });
                    return reply;
                } catch (error) {
                    calls.push({
                        request,
                        requestHash: hash,
                        reply: null,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                }
            },
        },
    };
}

/** Recorded calls as checkpoint turns, in the world's agent order. */
export function turnsInAgentOrder(world: World, calls: RecordedCall[]): RecordedTurn[] {
    const order = new Map(world.agents.map((a, i) => [a.persona.id, i]));
    return calls
        .map(call => {
            const agentId = agentForRequest(world, call.request);
            if (!agentId) throw new Error("A recorded turn names no agent in the world");
            const turn: RecordedTurn = {
                agentId,
                requestHash: call.requestHash,
                reply: call.reply
                    ? {
                          text: call.reply.text,
                          ...(call.reply.usage ? { usage: call.reply.usage } : {}),
                      }
                    : null,
                error: call.error,
            };
            return turn;
        })
        .sort((a, b) => order.get(a.agentId)! - order.get(b.agentId)!);
}

/** The world a round starts from: the frozen world for round 1, else the last committed one. */
async function startingWorld(ctx: StageContext, round: number, previous?: RoundCheckpoint) {
    if (round === 1) {
        const spec = await ctx.artifacts.worldSpec();
        if (!spec) throw new Error("The run has no frozen world");
        return structuredClone(spec.initialWorld);
    }
    const world = ctx.run.world;
    if (!world) throw new Error("The run has no world");
    if (!previous) throw new Error(`Round ${round - 1} has no checkpoint`);
    if (world.round !== round - 1 || stateHash(world) !== previous.stateHash)
        throw new Error(`The run's world does not match round ${round - 1}'s checkpoint`);
    return structuredClone(world);
}

export const roundStage: Stage = async ctx => {
    const round = inputNumber(ctx, "round");
    const earlier = (await ctx.artifacts.checkpoints())
        .filter(c => c.round < round)
        .sort((a, b) => a.round - b.round);
    const start = await startingWorld(
        ctx,
        round,
        earlier.find(c => c.round === round - 1)
    );

    // The last round is the last chance to apply an event: close the window
    // first, then read what is pending.
    if (round === ctx.spec.rounds) await ctx.closeEvents();
    const pending = [...(await ctx.artifacts.pendingInjections())].sort((a, b) => a.id - b.id);
    for (const event of pending) injectEvent(start, event.text);

    const recorder = recordingModel(ctx.model, ctx.spec.policies.versions);
    const skipped = new Set<string>();
    const { world, summary } = await runRound(start, {
        model: recorder.model,
        concurrency: ctx.concurrency,
        onAgentError: (agentId, error) => {
            skipped.add(agentId);
            ctx.ports.log?.("scenario agent turn failed", {
                runId: ctx.run.id,
                round,
                agentId,
                error: String(error),
            });
        },
    });

    const checkpoint: RoundCheckpoint = {
        round,
        stateHash: stateHash(world),
        engineVersion: ctx.spec.policies.versions.engine,
        turns: turnsInAgentOrder(world, recorder.calls),
        interventions: pending.map(p => ({ id: p.id, text: p.text })),
        skipped: world.agents.map(a => a.persona.id).filter(id => skipped.has(id)),
        summary,
        degraded: summary.failed * 3 > summary.active,
    };
    const degradedRounds = [
        ...earlier.filter(c => c.degraded).map(c => c.round),
        ...(checkpoint.degraded ? [round] : []),
    ];
    const skippedTurns =
        earlier.reduce((sum, c) => sum + c.skipped.length, 0) + checkpoint.skipped.length;
    return {
        output: {
            round,
            stateHash: checkpoint.stateHash,
            active: summary.active,
            failed: summary.failed,
            degraded: checkpoint.degraded,
        },
        writes: [{ type: "checkpoint", checkpoint, appliedInjectionIds: pending.map(p => p.id) }],
        run: { world, flags: { degradedRounds, skippedTurns } },
    };
};
