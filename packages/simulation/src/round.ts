/**
 * One time step — OASIS's `env.step()`:
 *
 * 1. Activate each agent with its activation probability.
 * 2. Rebuild every active agent's feed from the world as it stood before the round.
 * 3. Ask the model what each active agent does (in parallel, bounded).
 * 4. Apply the actions in a fixed agent order, update stances and memories.
 *
 * The input world is never mutated; the caller persists the returned world.
 * Randomness is seeded per (run seed, round), so retrying a round after a
 * crash makes the same activation and feed choices.
 */

import { applyAction, describeAction } from "./actions";
import { buildDecisionRequest, parseDecision } from "./decide";
import { summarizeRound } from "./metrics";
import { buildFeeds, type Similarity } from "./recommend";
import { createRng, hashSeed } from "./rng";
import { clip } from "./text";
import type { AgentDecision, FeedItem, RoundSummary, SimulationModel, Usage, World } from "./types";

export interface RoundDeps {
    model: SimulationModel;
    /** Parallel model calls per round (default 6). */
    concurrency?: number;
    similarity?: Similarity;
    /** Called when one agent's turn fails; the agent does nothing this round. */
    onAgentError?: (agentId: string, error: unknown) => void;
}

export class RoundFailedError extends Error {
    constructor(
        readonly round: number,
        readonly failed: number,
        readonly active: number
    ) {
        super(`Round ${round}: ${failed} of ${active} agent turns failed`);
        this.name = "RoundFailedError";
    }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]!);
        }
    });
    await Promise.all(workers);
    return results;
}

export function selectActive(world: World, round: number): string[] {
    const rng = createRng(hashSeed(world.config.seed, round, "activate"));
    const active: string[] = [];
    for (const agent of world.agents) {
        let p = agent.persona.activity * world.config.activationScale;
        if (round === 1) p = Math.max(p, world.config.firstRoundActivation);
        if (rng() < Math.min(1, Math.max(0, p))) active.push(agent.persona.id);
    }
    if (active.length === 0 && world.agents.length > 0) {
        active.push(world.agents[Math.floor(rng() * world.agents.length)]!.persona.id);
    }
    return active;
}

export async function runRound(input: World, deps: RoundDeps): Promise<{ world: World; summary: RoundSummary }> {
    const world = structuredClone(input);
    const round = world.round + 1;
    const active = selectActive(world, round);
    const feeds = buildFeeds(world, active, createRng(hashSeed(world.config.seed, round, "feed")), {
        similarity: deps.similarity,
    });

    const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
    const turns = await mapLimit(active, deps.concurrency ?? 6, async agentId => {
        const agent = world.agents.find(a => a.persona.id === agentId)!;
        const feed = feeds.get(agentId) ?? [];
        try {
            const reply = await deps.model.complete(buildDecisionRequest(world, agent, feed));
            usage.calls += 1;
            usage.inputTokens += reply.usage?.inputTokens ?? 0;
            usage.outputTokens += reply.usage?.outputTokens ?? 0;
            const decision = parseDecision(reply.text, { world, agent, feed });
            if (!decision) throw new Error("Reply was not JSON");
            return { agentId, feed, decision };
        } catch (error) {
            deps.onAgentError?.(agentId, error);
            return { agentId, feed, decision: undefined as AgentDecision | undefined };
        }
    });

    const failed = turns.filter(t => !t.decision).length;
    if (failed > 0 && failed * 2 > active.length) throw new RoundFailedError(round, failed, active.length);

    // Everyone who was active saw their feed, whether or not their turn succeeded.
    for (const { agentId, feed } of turns) {
        const seen = world.seen[agentId] ?? [];
        for (const item of feed) if (!seen.includes(item.postId)) seen.push(item.postId);
        world.seen[agentId] = seen.slice(-300);
    }

    // Apply in the fixed agent order so parallel completion order never changes the outcome.
    const byAgent = new Map(turns.map(t => [t.agentId, t]));
    for (const agent of world.agents) {
        const turn = byAgent.get(agent.persona.id);
        if (turn?.decision) {
            agent.activeRounds.push(round);
            const done: string[] = [];
            for (const action of turn.decision.actions) {
                const result = applyAction(world, agent.persona.id, action, round);
                if (!result.ok) continue;
                world.actions.push({
                    round,
                    agentId: agent.persona.id,
                    action,
                    ...(result.createdId ? { createdId: result.createdId } : {}),
                });
                done.push(describeAction(world, action));
            }
            agent.stance = turn.decision.stance;
            if (turn.decision.thought) agent.lastThought = turn.decision.thought;
            remember(world, agent.persona.id, round, turn.feed, done);
        }
        agent.stanceHistory.push(agent.stance);
    }

    world.round = round;
    const summary = summarizeRound(world, round, active.length, failed, usage);
    world.rounds.push(summary);
    return { world, summary };
}

function remember(world: World, agentId: string, round: number, feed: FeedItem[], done: string[]): void {
    const agent = world.agents.find(a => a.persona.id === agentId)!;
    const notable = feed
        .slice()
        .sort((a, b) => b.likes + b.comments * 2 + b.shares * 3 - (a.likes + a.comments * 2 + a.shares * 3))
        .slice(0, 2)
        .map(f => `${f.authorHandle}: "${clip(f.root?.text ?? f.text, 90)}"`);
    if (notable.length > 0) agent.memory.push({ round, text: `You saw ${notable.join("; ")}` });
    for (const line of done) agent.memory.push({ round, text: line });
    if (agent.memory.length > world.config.memorySize) {
        agent.memory.splice(0, agent.memory.length - world.config.memorySize);
    }
}
