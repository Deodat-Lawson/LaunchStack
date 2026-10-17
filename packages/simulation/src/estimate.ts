/**
 * What a run will cost before it starts, in model calls and tokens. The
 * per-call token figures are deliberately on the high side.
 */

export const MAX_AGENTS = 200;
export const MAX_ROUNDS = 30;
export const CAST_BATCH_SIZE = 10;

export const TOKENS_PER_CALL = {
    brief: { input: 5000, output: 600 },
    castPerPersona: { input: 300, output: 260 },
    castBase: { input: 2500, output: 200 },
    decide: { input: 1700, output: 250 },
    report: { input: 5000, output: 1200 },
} as const;

export interface RunEstimate {
    calls: number;
    /** Expected agent turns across all rounds. */
    turns: number;
    inputTokens: number;
    outputTokens: number;
}

export function estimateRun(input: {
    agents: number;
    rounds: number;
    /** Mean persona activity; personas are written at 0.15–1, mostly lurkers. */
    meanActivity?: number;
    activationScale?: number;
    firstRoundActivation?: number;
}): RunEstimate {
    const agents = Math.max(1, Math.min(MAX_AGENTS, Math.round(input.agents)));
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Math.round(input.rounds)));
    const p = Math.min(1, (input.meanActivity ?? 0.45) * (input.activationScale ?? 1));
    const first = Math.max(p, input.firstRoundActivation ?? 0.8);
    const turns = Math.ceil(agents * (first + (rounds - 1) * p));
    const castCalls = Math.ceil(agents / CAST_BATCH_SIZE);
    const t = TOKENS_PER_CALL;
    return {
        calls: 1 + castCalls + turns + 1,
        turns,
        inputTokens:
            t.brief.input + castCalls * t.castBase.input + agents * t.castPerPersona.input + turns * t.decide.input + t.report.input,
        outputTokens:
            t.brief.output + castCalls * t.castBase.output + agents * t.castPerPersona.output + turns * t.decide.output + t.report.output,
    };
}
