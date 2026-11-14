/**
 * Recorded replay. From the frozen initial world, each checkpoint's
 * interventions are applied and the round is run again with a model that
 * only serves the replies the checkpoint recorded, looked up by request
 * hash. No model is ever called: a request the record does not hold is a
 * mismatch (the agent's turn fails, as it would have without a reply), and a
 * recorded error is thrown back as it happened. Each round's state hash is
 * compared with the one the run saved.
 */
import {
    injectEvent,
    runRound,
    type ModelReply,
    type SimulationModel,
} from "@launchstack/simulation";

import { V2_VERSIONS, type ReplayResult, type RoundCheckpoint } from "./contracts";
import { requestHash, stateHash } from "./hash";
import type { WorldSpecRecord } from "./stage";

/** Engine versions this build can replay. */
export const REPLAYABLE_ENGINES: readonly string[] = [V2_VERSIONS.engine];

class UnrecordedRequestError extends Error {
    constructor(hash: string) {
        super(`No recorded reply for request ${hash.slice(0, 12)}`);
        this.name = "UnrecordedRequestError";
    }
}

function unavailable(reason: NonNullable<ReplayResult["reason"]>): ReplayResult {
    return { available: false, reason, matches: false, modelCalls: 0, rounds: [] };
}

/**
 * Replay a finished run. `frozen` is the world spec record (spec + initial
 * world); `checkpoints` are every round's checkpoint. Round 0 in the result
 * compares the initial world with the hash frozen in the spec.
 */
export async function replayRun(
    frozen: Pick<WorldSpecRecord, "spec" | "initialWorld">,
    checkpoints: RoundCheckpoint[]
): Promise<ReplayResult> {
    const { spec } = frozen;
    if (spec.version !== 1 || frozen.initialWorld.version !== 1)
        return unavailable("unsupported_version");
    if (
        !REPLAYABLE_ENGINES.includes(spec.versions.engine) ||
        checkpoints.some(c => !REPLAYABLE_ENGINES.includes(c.engineVersion))
    )
        return unavailable("replay_unavailable");
    const ordered = [...checkpoints].sort((a, b) => a.round - b.round);
    if (ordered.length === 0 || ordered.some((c, i) => c.round !== i + 1))
        return unavailable("not_finished");

    const rounds: ReplayResult["rounds"] = [];
    let world = structuredClone(frozen.initialWorld);
    const initial = stateHash(world);
    rounds.push({
        round: 0,
        expected: spec.initialStateHash,
        actual: initial,
        matches: initial === spec.initialStateHash,
    });

    for (const [index, checkpoint] of ordered.entries()) {
        const start = structuredClone(world);
        for (const event of checkpoint.interventions) injectEvent(start, event.text);
        const served = new Map(checkpoint.turns.map(t => [t.requestHash, t]));
        let unrecorded = 0;
        const recorded: SimulationModel = {
            async complete(request): Promise<ModelReply> {
                const hash = requestHash(request, spec.versions);
                const turn = served.get(hash);
                if (!turn) {
                    unrecorded += 1;
                    throw new UnrecordedRequestError(hash);
                }
                if (turn.error !== null || !turn.reply)
                    throw new Error(turn.error ?? "The recorded turn failed");
                return turn.reply;
            },
        };
        try {
            ({ world } = await runRound(start, { model: recorded, concurrency: 1 }));
        } catch {
            // Too many turns failed to finish the round: it and every later
            // round cannot match.
            for (const rest of ordered.slice(index))
                rounds.push({
                    round: rest.round,
                    expected: rest.stateHash,
                    actual: "",
                    matches: false,
                });
            break;
        }
        const actual = stateHash(world);
        rounds.push({
            round: checkpoint.round,
            expected: checkpoint.stateHash,
            actual,
            matches: actual === checkpoint.stateHash && unrecorded === 0,
        });
    }
    return {
        available: true,
        reason: null,
        matches: rounds.every(r => r.matches),
        modelCalls: 0,
        rounds,
    };
}
